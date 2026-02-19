import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User, ChannelMember, Message } from '../models';
import { Op } from 'sequelize';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

// Track online users per channel
const channelUsers: Map<string, Set<string>> = new Map();
const userSockets: Map<string, string> = new Map(); // userId -> socketId
const activeCalls: Map<string, { callerId: string; receiverId: string; type: 'audio' | 'video'; channelId?: string; startedAt: Date }> = new Map();

export const initializeSocket = (server: HttpServer): Server => {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    path: '/ws',
  });

  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.query.token as string;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
        id: string;
        email: string;
      };

      const user = await User.findByPk(decoded.id);
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = decoded.id;
      socket.userEmail = decoded.email;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    console.log(`User ${userId} connected`);

    // Store socket mapping
    userSockets.set(userId, socket.id);

    // Update user online status
    await User.update({ isOnline: true, lastActive: new Date() }, { where: { id: userId } });

    // Broadcast user presence to all connected clients
    io.emit('user_presence', { userId, status: 'online', lastActive: new Date() });

    // Mark undelivered messages addressed to this user as delivered
    try {
      const memberships = await ChannelMember.findAll({
        where: { userId },
        attributes: ['channelId'],
      });
      const channelIds = memberships.map(m => m.channelId);

      if (channelIds.length > 0) {
        const undeliveredMessages = await Message.findAll({
          where: {
            channelId: { [Op.in]: channelIds },
            senderId: { [Op.ne]: userId },
            status: 'sent',
            isDeleted: false,
          },
        });

        if (undeliveredMessages.length > 0) {
          const now = new Date();
          await Message.update(
            { status: 'delivered', deliveredAt: now },
            {
              where: {
                id: { [Op.in]: undeliveredMessages.map(m => m.id) },
              },
            }
          );

          // Notify senders that their messages were delivered
          for (const msg of undeliveredMessages) {
            const senderSocketId = userSockets.get(msg.senderId);
            if (senderSocketId) {
              io.to(senderSocketId).emit('message_status_update', {
                messageId: msg.id,
                channelId: msg.channelId,
                status: 'delivered',
                deliveredAt: now,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to update message delivery status:', err);
    }

    // ─── Channel Events ──────────────────────────────

    socket.on('join_channel', async (data: { channelId: string }) => {
      try {
        const { channelId } = data;

        const membership = await ChannelMember.findOne({
          where: { channelId, userId },
        });

        if (!membership) {
          socket.emit('error', { message: 'Not a member of this channel' });
          return;
        }

        socket.join(`channel:${channelId}`);

        if (!channelUsers.has(channelId)) {
          channelUsers.set(channelId, new Set());
        }
        channelUsers.get(channelId)!.add(userId);

        socket.to(`channel:${channelId}`).emit('user_joined', { channelId, userId });
        socket.emit('joined_channel', { channelId });
      } catch (error) {
        console.error('Join channel error:', error);
        socket.emit('error', { message: 'Failed to join channel' });
      }
    });

    socket.on('leave_channel', (data: { channelId: string }) => {
      const { channelId } = data;
      socket.leave(`channel:${channelId}`);
      channelUsers.get(channelId)?.delete(userId);
      socket.to(`channel:${channelId}`).emit('user_left', { channelId, userId });
    });

    // ─── Typing Indicator ────────────────────────────

    socket.on('typing', (data: { channelId: string; isTyping: boolean }) => {
      const { channelId, isTyping } = data;
      socket.to(`channel:${channelId}`).emit('typing', { channelId, userId, isTyping });
    });

    // ─── Message Events ──────────────────────────────

    socket.on('new_message', (data: { channelId: string; message: any }) => {
      const { channelId, message } = data;

      // Broadcast to channel members except sender
      socket.to(`channel:${channelId}`).emit('new_message', {
        channelId,
        message: { ...message, status: 'sent' },
      });

      // Auto-deliver to online members in that channel
      const onlineMembers = channelUsers.get(channelId);
      if (onlineMembers) {
        for (const memberId of onlineMembers) {
          if (memberId !== userId) {
            const memberSocketId = userSockets.get(memberId);
            if (memberSocketId) {
              io.to(memberSocketId).emit('message_status_update', {
                messageId: message.id,
                channelId,
                status: 'delivered',
                deliveredAt: new Date(),
              });
            }
          }
        }
        // Notify sender about delivery
        socket.emit('message_status_update', {
          messageId: message.id,
          channelId,
          status: 'delivered',
          deliveredAt: new Date(),
        });
      }
    });

    socket.on('message_edited', (data: { channelId: string; messageId: string; text: string }) => {
      const { channelId, messageId, text } = data;
      socket.to(`channel:${channelId}`).emit('message_edited', { channelId, messageId, text });
    });

    socket.on('message_deleted', (data: { channelId: string; messageId: string }) => {
      const { channelId, messageId } = data;
      socket.to(`channel:${channelId}`).emit('message_deleted', { channelId, messageId });
    });

    // ─── Message Status Events ───────────────────────

    // Client tells server messages have been delivered
    socket.on('messages_delivered', async (data: { channelId: string; messageIds: string[] }) => {
      try {
        const { channelId, messageIds } = data;
        const now = new Date();

        await Message.update(
          { status: 'delivered', deliveredAt: now },
          { where: { id: { [Op.in]: messageIds }, status: 'sent' } }
        );

        // Notify senders
        const messages = await Message.findAll({
          where: { id: { [Op.in]: messageIds } },
          attributes: ['id', 'senderId'],
        });

        for (const msg of messages) {
          const senderSocketId = userSockets.get(msg.senderId);
          if (senderSocketId) {
            io.to(senderSocketId).emit('message_status_update', {
              messageId: msg.id,
              channelId,
              status: 'delivered',
              deliveredAt: now,
            });
          }
        }
      } catch (err) {
        console.error('messages_delivered error:', err);
      }
    });

    // Client tells server messages have been read
    socket.on('messages_read', async (data: { channelId: string; messageIds: string[] }) => {
      try {
        const { channelId, messageIds } = data;
        const now = new Date();

        await Message.update(
          { status: 'read', readAt: now, deliveredAt: now },
          { where: { id: { [Op.in]: messageIds }, status: { [Op.ne]: 'read' } } }
        );

        // Update lastReadAt
        await ChannelMember.update(
          { lastReadAt: now },
          { where: { channelId, userId } }
        );

        // Notify senders
        const messages = await Message.findAll({
          where: { id: { [Op.in]: messageIds } },
          attributes: ['id', 'senderId'],
        });

        for (const msg of messages) {
          const senderSocketId = userSockets.get(msg.senderId);
          if (senderSocketId) {
            io.to(senderSocketId).emit('message_status_update', {
              messageId: msg.id,
              channelId,
              status: 'read',
              readAt: now,
            });
          }
        }
      } catch (err) {
        console.error('messages_read error:', err);
      }
    });

    // ─── Reaction Events ─────────────────────────────

    socket.on('reaction_update', (data: { channelId: string; messageId: string; emoji: string; action: string }) => {
      const { channelId, messageId, emoji, action } = data;
      socket.to(`channel:${channelId}`).emit('reaction_update', {
        channelId, messageId, userId, emoji, action,
      });
    });

    // ─── Video & Audio Call Signaling ─────────────────

    // Initiate a call
    socket.on('call_initiate', (data: { receiverId: string; type: 'audio' | 'video'; channelId?: string }) => {
      const { receiverId, type, channelId } = data;

      const callId = `${userId}-${receiverId}-${Date.now()}`;
      activeCalls.set(callId, {
        callerId: userId,
        receiverId,
        type,
        channelId,
        startedAt: new Date(),
      });

      const receiverSocketId = userSockets.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('call_incoming', {
          callId,
          callerId: userId,
          type,
          channelId,
        });
      } else {
        // Receiver is offline
        socket.emit('call_failed', {
          callId,
          reason: 'User is offline',
        });
        activeCalls.delete(callId);
      }

      socket.emit('call_initiated', { callId, receiverId, type });
    });

    // Accept a call
    socket.on('call_accept', (data: { callId: string }) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call) {
        socket.emit('error', { message: 'Call not found' });
        return;
      }

      const callerSocketId = userSockets.get(call.callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call_accepted', { callId, acceptedBy: userId });
      }
    });

    // Reject a call
    socket.on('call_reject', (data: { callId: string; reason?: string }) => {
      const { callId, reason } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const callerSocketId = userSockets.get(call.callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call_rejected', {
          callId,
          rejectedBy: userId,
          reason: reason || 'Call declined',
        });
      }
      activeCalls.delete(callId);
    });

    // End a call
    socket.on('call_end', (data: { callId: string }) => {
      const { callId } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const otherUserId = call.callerId === userId ? call.receiverId : call.callerId;
      const otherSocketId = userSockets.get(otherUserId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('call_ended', { callId, endedBy: userId });
      }
      activeCalls.delete(callId);
    });

    // WebRTC Signaling: Send offer
    socket.on('call_offer', (data: { callId: string; offer: any }) => {
      const { callId, offer } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const receiverSocketId = userSockets.get(call.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('call_offer', { callId, offer, callerId: userId });
      }
    });

    // WebRTC Signaling: Send answer
    socket.on('call_answer', (data: { callId: string; answer: any }) => {
      const { callId, answer } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const callerSocketId = userSockets.get(call.callerId);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call_answer', { callId, answer, answererId: userId });
      }
    });

    // WebRTC Signaling: ICE candidate
    socket.on('ice_candidate', (data: { callId: string; candidate: any }) => {
      const { callId, candidate } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const otherUserId = call.callerId === userId ? call.receiverId : call.callerId;
      const otherSocketId = userSockets.get(otherUserId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('ice_candidate', { callId, candidate, from: userId });
      }
    });

    // Toggle media during call
    socket.on('call_toggle_media', (data: { callId: string; mediaType: 'audio' | 'video'; enabled: boolean }) => {
      const { callId, mediaType, enabled } = data;
      const call = activeCalls.get(callId);
      if (!call) return;

      const otherUserId = call.callerId === userId ? call.receiverId : call.callerId;
      const otherSocketId = userSockets.get(otherUserId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('call_media_toggled', {
          callId, userId, mediaType, enabled,
        });
      }
    });

    // ─── Disconnect ──────────────────────────────────

    socket.on('disconnect', async () => {
      console.log(`User ${userId} disconnected`);

      userSockets.delete(userId);

      await User.update({ isOnline: false, lastActive: new Date() }, { where: { id: userId } });

      // Remove from all channels
      channelUsers.forEach((users, channelId) => {
        if (users.has(userId)) {
          users.delete(userId);
          io.to(`channel:${channelId}`).emit('user_left', { channelId, userId });
        }
      });

      // End any active calls
      for (const [callId, call] of activeCalls.entries()) {
        if (call.callerId === userId || call.receiverId === userId) {
          const otherUserId = call.callerId === userId ? call.receiverId : call.callerId;
          const otherSocketId = userSockets.get(otherUserId);
          if (otherSocketId) {
            io.to(otherSocketId).emit('call_ended', { callId, endedBy: userId, reason: 'disconnected' });
          }
          activeCalls.delete(callId);
        }
      }

      // Broadcast user presence
      io.emit('user_presence', { userId, status: 'offline', lastActive: new Date() });
    });
  });

  return io;
};

// Helper to broadcast from outside socket context
export const broadcastToChannel = (io: Server, channelId: string, event: string, data: any) => {
  io.to(`channel:${channelId}`).emit(event, data);
};

export const getOnlineChannelUsers = (channelId: string): string[] => {
  return Array.from(channelUsers.get(channelId) || []);
};

export const isUserOnline = (userId: string): boolean => {
  return userSockets.has(userId);
};
