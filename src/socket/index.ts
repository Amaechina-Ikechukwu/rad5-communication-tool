import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User, ChannelMember, DirectMessageMember, Message } from '../models';
import { Op } from 'sequelize';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

// Track online users per channel/dm
const channelUsers: Map<string, Set<string>> = new Map();
const dmUsers: Map<string, Set<string>> = new Map();
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

    // Join user-specific room for targeted events (unread updates, etc.)
    socket.join(`user:${userId}`);

    // Update user online status
    await User.update({ isOnline: true, lastActive: new Date() }, { where: { id: userId } });

    // Broadcast user presence to all connected clients
    io.emit('user_presence', { userId, status: 'online', lastActive: new Date() });

    // Mark undelivered channel messages as delivered
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
      console.error('Failed to update channel message delivery status:', err);
    }

    // Mark undelivered DM messages as delivered
    try {
      const dmMemberships = await DirectMessageMember.findAll({
        where: { userId },
        attributes: ['dmId'],
      });
      const dmIds = dmMemberships.map(m => m.dmId);

      if (dmIds.length > 0) {
        const undeliveredDmMessages = await Message.findAll({
          where: {
            dmId: { [Op.in]: dmIds },
            senderId: { [Op.ne]: userId },
            status: 'sent',
            isDeleted: false,
          },
        });

        if (undeliveredDmMessages.length > 0) {
          const now = new Date();
          await Message.update(
            { status: 'delivered', deliveredAt: now },
            {
              where: {
                id: { [Op.in]: undeliveredDmMessages.map(m => m.id) },
              },
            }
          );

          // Notify senders
          for (const msg of undeliveredDmMessages) {
            const senderSocketId = userSockets.get(msg.senderId);
            if (senderSocketId) {
              io.to(senderSocketId).emit('dm_message_status_update', {
                messageId: msg.id,
                dmId: msg.dmId,
                status: 'delivered',
                deliveredAt: now,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to update DM message delivery status:', err);
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

    // ─── DM Events ───────────────────────────────────

    socket.on('join_dm', async (data: { dmId: string }) => {
      try {
        const { dmId } = data;

        const membership = await DirectMessageMember.findOne({
          where: { dmId, userId },
        });

        if (!membership) {
          socket.emit('error', { message: 'Not a member of this DM' });
          return;
        }

        socket.join(`dm:${dmId}`);

        if (!dmUsers.has(dmId)) {
          dmUsers.set(dmId, new Set());
        }
        dmUsers.get(dmId)!.add(userId);

        socket.emit('joined_dm', { dmId });
      } catch (error) {
        console.error('Join DM error:', error);
        socket.emit('error', { message: 'Failed to join DM' });
      }
    });

    socket.on('leave_dm', (data: { dmId: string }) => {
      const { dmId } = data;
      socket.leave(`dm:${dmId}`);
      dmUsers.get(dmId)?.delete(userId);
    });

    // ─── Typing Indicators ──────────────────────────

    socket.on('typing', (data: { channelId: string; isTyping: boolean }) => {
      const { channelId, isTyping } = data;
      socket.to(`channel:${channelId}`).emit('typing', { channelId, userId, isTyping });
    });

    socket.on('dm_typing', (data: { dmId: string; isTyping: boolean }) => {
      const { dmId, isTyping } = data;
      socket.to(`dm:${dmId}`).emit('dm_typing', { dmId, userId, isTyping });
    });

    // ─── Channel Message Events ──────────────────────

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

    // ─── DM Message Events ───────────────────────────

    socket.on('new_dm_message', (data: { dmId: string; message: any }) => {
      const { dmId, message } = data;

      // Broadcast to DM room (the other participant)
      socket.to(`dm:${dmId}`).emit('new_dm_message', {
        dmId,
        message: { ...message, status: 'sent' },
      });

      // Auto-deliver to the other participant if they're in the DM room
      const onlineDmMembers = dmUsers.get(dmId);
      if (onlineDmMembers) {
        for (const memberId of onlineDmMembers) {
          if (memberId !== userId) {
            const memberSocketId = userSockets.get(memberId);
            if (memberSocketId) {
              io.to(memberSocketId).emit('dm_message_status_update', {
                messageId: message.id,
                dmId,
                status: 'delivered',
                deliveredAt: new Date(),
              });
            }
          }
        }
        // Notify sender about delivery
        socket.emit('dm_message_status_update', {
          messageId: message.id,
          dmId,
          status: 'delivered',
          deliveredAt: new Date(),
        });
      }

      // Also emit unread_update to the recipient's user room
      if (onlineDmMembers) {
        for (const memberId of onlineDmMembers) {
          if (memberId !== userId) {
            io.to(`user:${memberId}`).emit('unread_update', {
              type: 'dm',
              dmId,
              senderId: userId,
            });
          }
        }
      }
    });

    socket.on('dm_message_edited', (data: { dmId: string; messageId: string; text: string }) => {
      const { dmId, messageId, text } = data;
      socket.to(`dm:${dmId}`).emit('dm_message_edited', { dmId, messageId, text });
    });

    socket.on('dm_message_deleted', (data: { dmId: string; messageId: string }) => {
      const { dmId, messageId } = data;
      socket.to(`dm:${dmId}`).emit('dm_message_deleted', { dmId, messageId });
    });

    // ─── Channel Message Status Events ───────────────

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

    // ─── DM Message Status Events ────────────────────

    socket.on('dm_messages_delivered', async (data: { dmId: string; messageIds: string[] }) => {
      try {
        const { dmId, messageIds } = data;
        const now = new Date();

        await Message.update(
          { status: 'delivered', deliveredAt: now },
          { where: { id: { [Op.in]: messageIds }, status: 'sent' } }
        );

        const messages = await Message.findAll({
          where: { id: { [Op.in]: messageIds } },
          attributes: ['id', 'senderId'],
        });

        for (const msg of messages) {
          const senderSocketId = userSockets.get(msg.senderId);
          if (senderSocketId) {
            io.to(senderSocketId).emit('dm_message_status_update', {
              messageId: msg.id,
              dmId,
              status: 'delivered',
              deliveredAt: now,
            });
          }
        }
      } catch (err) {
        console.error('dm_messages_delivered error:', err);
      }
    });

    socket.on('dm_messages_read', async (data: { dmId: string; messageIds: string[] }) => {
      try {
        const { dmId, messageIds } = data;
        const now = new Date();

        await Message.update(
          { status: 'read', readAt: now, deliveredAt: now },
          { where: { id: { [Op.in]: messageIds }, status: { [Op.ne]: 'read' } } }
        );

        await DirectMessageMember.update(
          { lastReadAt: now },
          { where: { dmId, userId } }
        );

        const messages = await Message.findAll({
          where: { id: { [Op.in]: messageIds } },
          attributes: ['id', 'senderId'],
        });

        for (const msg of messages) {
          const senderSocketId = userSockets.get(msg.senderId);
          if (senderSocketId) {
            io.to(senderSocketId).emit('dm_message_status_update', {
              messageId: msg.id,
              dmId,
              status: 'read',
              readAt: now,
            });
          }
        }
      } catch (err) {
        console.error('dm_messages_read error:', err);
      }
    });

    // ─── Reaction Events ─────────────────────────────

    socket.on('reaction_update', (data: { channelId: string; messageId: string; emoji: string; action: string }) => {
      const { channelId, messageId, emoji, action } = data;
      socket.to(`channel:${channelId}`).emit('reaction_update', {
        channelId, messageId, userId, emoji, action,
      });
    });

    socket.on('dm_reaction_update', (data: { dmId: string; messageId: string; emoji: string; action: string }) => {
      const { dmId, messageId, emoji, action } = data;
      socket.to(`dm:${dmId}`).emit('dm_reaction_update', {
        dmId, messageId, userId, emoji, action,
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

      // Remove from all DMs
      dmUsers.forEach((users, dmId) => {
        users.delete(userId);
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

export const broadcastToDm = (io: Server, dmId: string, event: string, data: any) => {
  io.to(`dm:${dmId}`).emit(event, data);
};

export const broadcastToUser = (io: Server, userId: string, event: string, data: any) => {
  io.to(`user:${userId}`).emit(event, data);
};

export const getOnlineChannelUsers = (channelId: string): string[] => {
  return Array.from(channelUsers.get(channelId) || []);
};

export const getOnlineDmUsers = (dmId: string): string[] => {
  return Array.from(dmUsers.get(dmId) || []);
};

export const isUserOnline = (userId: string): boolean => {
  return userSockets.has(userId);
};
