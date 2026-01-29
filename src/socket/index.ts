import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User, ChannelMember } from '../models';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

// Track online users per channel
const channelUsers: Map<string, Set<string>> = new Map();
const userSockets: Map<string, string> = new Map(); // userId -> socketId

export const initializeSocket = (server: HttpServer): Server => {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || ['http://localhost:5173', '*'],
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
    io.emit('user_presence', { userId, status: 'online' });

    // Join channel room
    socket.on('join_channel', async (data: { channelId: string }) => {
      try {
        const { channelId } = data;

        // Verify membership
        const membership = await ChannelMember.findOne({
          where: { channelId, userId },
        });

        if (!membership) {
          socket.emit('error', { message: 'Not a member of this channel' });
          return;
        }

        // Join the room
        socket.join(`channel:${channelId}`);

        // Track user in channel
        if (!channelUsers.has(channelId)) {
          channelUsers.set(channelId, new Set());
        }
        channelUsers.get(channelId)!.add(userId);

        // Notify channel members
        socket.to(`channel:${channelId}`).emit('user_joined', {
          channelId,
          userId,
        });

        socket.emit('joined_channel', { channelId });
        console.log(`User ${userId} joined channel ${channelId}`);
      } catch (error) {
        console.error('Join channel error:', error);
        socket.emit('error', { message: 'Failed to join channel' });
      }
    });

    // Leave channel room
    socket.on('leave_channel', (data: { channelId: string }) => {
      const { channelId } = data;
      
      socket.leave(`channel:${channelId}`);
      
      // Remove from tracking
      channelUsers.get(channelId)?.delete(userId);

      // Notify channel members
      socket.to(`channel:${channelId}`).emit('user_left', {
        channelId,
        userId,
      });

      console.log(`User ${userId} left channel ${channelId}`);
    });

    // Typing indicator
    socket.on('typing', (data: { channelId: string; isTyping: boolean }) => {
      const { channelId, isTyping } = data;
      
      socket.to(`channel:${channelId}`).emit('typing', {
        channelId,
        userId,
        isTyping,
      });
    });

    // New message (for broadcasting)
    socket.on('new_message', (data: { channelId: string; message: any }) => {
      const { channelId, message } = data;
      
      // Broadcast to all channel members except sender
      socket.to(`channel:${channelId}`).emit('new_message', {
        channelId,
        message,
      });
    });

    // Message edited
    socket.on('message_edited', (data: { channelId: string; messageId: string; text: string }) => {
      const { channelId, messageId, text } = data;
      
      socket.to(`channel:${channelId}`).emit('message_edited', {
        channelId,
        messageId,
        text,
      });
    });

    // Message deleted
    socket.on('message_deleted', (data: { channelId: string; messageId: string }) => {
      const { channelId, messageId } = data;
      
      socket.to(`channel:${channelId}`).emit('message_deleted', {
        channelId,
        messageId,
      });
    });

    // Reaction added/removed
    socket.on('reaction_update', (data: { channelId: string; messageId: string; emoji: string; action: string }) => {
      const { channelId, messageId, emoji, action } = data;
      
      socket.to(`channel:${channelId}`).emit('reaction_update', {
        channelId,
        messageId,
        userId,
        emoji,
        action,
      });
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`User ${userId} disconnected`);

      // Remove socket mapping
      userSockets.delete(userId);

      // Update user offline status
      await User.update({ isOnline: false, lastActive: new Date() }, { where: { id: userId } });

      // Remove from all channels
      channelUsers.forEach((users, channelId) => {
        if (users.has(userId)) {
          users.delete(userId);
          io.to(`channel:${channelId}`).emit('user_left', {
            channelId,
            userId,
          });
        }
      });

      // Broadcast user presence
      io.emit('user_presence', { userId, status: 'offline' });
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
