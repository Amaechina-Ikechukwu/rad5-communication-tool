import type { Response } from 'express';
import { Op, literal } from 'sequelize';
import { Message, Reaction, User, ChannelMember, DirectMessageMember } from '../models';
import type { AuthRequest } from '../middleware/auth';
import { uploadToCloudinary } from '../utils/cloudinary';
import { isWithinEditWindow } from '../utils/validators';
import { getIO } from '../socket/io';
import {
  buildAttachmentFromUpload,
  formatMessagePayload,
  formatMediaPayload,
  normalizePoll,
  parseDurationSeconds,
} from '../utils/messagePayload';
import { countChannelUnread } from '../utils/unread';

const getUploadResourceType = (mimeType: string): 'image' | 'video' | 'raw' | 'auto' => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) return 'video';
  return 'auto';
};

const buildPollPayload = (value: unknown) => {
  const normalizedPoll = normalizePoll(value);
  if (!normalizedPoll) {
    return null;
  }

  return {
    options: normalizedPoll.options,
    votes: Object.fromEntries(normalizedPoll.options.map((option) => [option, []])),
  };
};

// GET /api/channels/:channelId/messages
export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const channelId = String(req.params.channelId);
    const { page = 1, limit = 50, before } = req.query;
    const userId = req.user!.id;
    const offset = (Number(page) - 1) * Number(limit);

    const membership = await ChannelMember.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    const whereClause: any = { channelId, isDeleted: false };

    if (membership.clearedAt) {
      whereClause.createdAt = { ...(whereClause.createdAt || {}), [Op.gt]: membership.clearedAt };
    }

    if (before) {
      whereClause.createdAt = { ...(whereClause.createdAt || {}), [Op.lt]: new Date(before as string) };
    }

    const { count, rows: messages } = await Message.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'name', 'avatar'],
        },
        {
          model: Reaction,
          as: 'reactions',
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'name'],
            },
          ],
        },
      ],
      limit: Number(limit),
      offset,
      order: [['createdAt', 'DESC']],
    });

    const formattedMessages = messages.map((msg: any) => formatMessagePayload(msg, userId));

    res.json({
      messages: formattedMessages.reverse(),
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        hasMore: offset + messages.length < count,
      },
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

// POST /api/channels/:channelId/messages
export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const channelId = String(req.params.channelId);
    const { text, poll } = req.body;
    const userId = req.user!.id;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    const membership = await ChannelMember.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    if (!text && !files?.attachments?.length && !files?.audio?.length && !poll) {
      res.status(400).json({ error: 'Message must have content' });
      return;
    }

    const messageData: any = {
      channelId,
      senderId: userId,
      text: text ? String(text).trim() : null,
    };

    if (files?.attachments?.length) {
      const attachmentUploads = await Promise.all(
        files.attachments.map(async (file) => {
          const uploadResult = await uploadToCloudinary(
            file.buffer,
            'attachments',
            getUploadResourceType(file.mimetype)
          );
          return buildAttachmentFromUpload(file, uploadResult);
        })
      );
      messageData.attachments = attachmentUploads;
    }

    if (files?.audio?.length) {
      const audioFile = files.audio[0]!;
      const uploadResult = await uploadToCloudinary(audioFile.buffer, 'audio', 'video');
      messageData.audio = buildAttachmentFromUpload(audioFile, uploadResult, {
        type: 'audio',
        duration:
          parseDurationSeconds(req.body.audioDuration) ??
          parseDurationSeconds(uploadResult.duration),
        thumbnailUrl: null,
      });
    }

    if (poll) {
      try {
        const pollData = typeof poll === 'string' ? JSON.parse(poll) : poll;
        const pollPayload = buildPollPayload(pollData);
        if (pollPayload) {
          messageData.poll = pollPayload;
        }
      } catch {
        // Ignore invalid poll payloads to match the existing permissive behavior.
      }
    }

    const message = await Message.create(messageData);

    const fullMessage = await Message.findByPk(message.id, {
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'name', 'avatar'],
        },
      ],
    });

    const formattedMessage = formatMessagePayload(fullMessage, userId);

    try {
      const io = getIO();
      io.to(`channel:${channelId}`).emit('new_message', {
        channelId,
        message: formattedMessage,
      });

      const members = await ChannelMember.findAll({
        where: { channelId },
        attributes: ['userId', 'lastReadAt', 'clearedAt'],
      });

      await Promise.all(
        members.map(async (member: any) => {
          if (member.userId === userId) {
            return;
          }

          const unreadCount = await countChannelUnread({
            channelId,
            userId: member.userId,
            lastReadAt: member.lastReadAt,
            clearedAt: member.clearedAt,
          });

          io.to(`user:${member.userId}`).emit('unread_update', {
            type: 'channel',
            channelId,
            senderId: userId,
            messageId: fullMessage!.id,
            unreadCount,
          });
        })
      );
    } catch (e) {
      console.error('Socket broadcast error (new_message):', e);
    }

    res.status(201).json({
      message: 'Message sent',
      data: formattedMessage,
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

// PUT /api/messages/:id
export const editMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const messageId = id as string;
    const { text } = req.body;
    const userId = req.user!.id;

    const message = await Message.findByPk(messageId);

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (message.senderId !== userId) {
      res.status(403).json({ error: 'You can only edit your own messages' });
      return;
    }

    if (message.isDeleted) {
      res.status(400).json({ error: 'Cannot edit a deleted message' });
      return;
    }

    if (!isWithinEditWindow(message.createdAt)) {
      res.status(400).json({ error: 'Cannot edit message after 20 minutes' });
      return;
    }

    await message.update({ text, isEdited: true });

    try {
      const io = getIO();
      if (message.channelId) {
        io.to(`channel:${message.channelId}`).emit('message_edited', {
          channelId: message.channelId,
          messageId: message.id,
          text: message.text,
        });
      }
      if (message.dmId) {
        io.to(`dm:${message.dmId}`).emit('dm_message_edited', {
          dmId: message.dmId,
          messageId: message.id,
          text: message.text,
        });
      }
    } catch (e) {
      console.error('Socket broadcast error (message_edited):', e);
    }

    res.json({
      message: 'Message updated',
      data: {
        id: message.id,
        text: message.text,
        isEdited: true,
      },
    });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
};

// DELETE /api/messages/:id
export const deleteMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const messageId = id as string;
    const userId = req.user!.id;

    const message = await Message.findByPk(messageId);

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (message.senderId !== userId) {
      res.status(403).json({ error: 'You can only delete your own messages' });
      return;
    }

    await message.update({ isDeleted: true, text: null, attachments: [], audio: null, poll: null });

    try {
      const io = getIO();
      if (message.channelId) {
        io.to(`channel:${message.channelId}`).emit('message_deleted', {
          channelId: message.channelId,
          messageId: message.id,
        });
      }
      if (message.dmId) {
        io.to(`dm:${message.dmId}`).emit('dm_message_deleted', {
          dmId: message.dmId,
          messageId: message.id,
        });
      }
    } catch (e) {
      console.error('Socket broadcast error (message_deleted):', e);
    }

    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
};

// POST /api/messages/:id/reactions
export const addReaction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const messageId = id as string;
    const { emoji } = req.body;
    const userId = req.user!.id;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(messageId)) {
      res.status(400).json({ error: 'Invalid message ID format' });
      return;
    }

    if (!emoji) {
      res.status(400).json({ error: 'Emoji is required' });
      return;
    }

    const message = await Message.findByPk(messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (message.channelId) {
      const membership = await ChannelMember.findOne({
        where: { channelId: message.channelId, userId },
      });
      if (!membership) {
        res.status(403).json({ error: 'You are not a member of this channel' });
        return;
      }
    } else if (message.dmId) {
      const dmMembership = await DirectMessageMember.findOne({
        where: { dmId: message.dmId, userId },
      });
      if (!dmMembership) {
        res.status(403).json({ error: 'You are not a member of this conversation' });
        return;
      }
    } else {
      res.status(400).json({ error: 'Message does not belong to a channel or DM' });
      return;
    }

    const existingReaction = await Reaction.findOne({
      where: { messageId: id, userId, emoji },
    });

    let action: string;
    if (existingReaction) {
      await existingReaction.destroy();
      action = 'removed';
    } else {
      await Reaction.create({ messageId, userId, emoji });
      action = 'added';
    }

    try {
      const io = getIO();
      if (message.channelId) {
        io.to(`channel:${message.channelId}`).emit('reaction_update', {
          channelId: message.channelId,
          messageId,
          userId,
          emoji,
          action,
        });
      }
      if (message.dmId) {
        io.to(`dm:${message.dmId}`).emit('dm_reaction_update', {
          dmId: message.dmId,
          messageId,
          userId,
          emoji,
          action,
        });
      }
    } catch (e) {
      console.error('Socket broadcast error (reaction_update):', e);
    }

    res.json({ message: action === 'added' ? 'Reaction added' : 'Reaction removed', action });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
};

// POST /api/messages/upload
export const uploadFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const uploadResult = await uploadToCloudinary(file.buffer, 'uploads', getUploadResourceType(file.mimetype));
    const attachment = buildAttachmentFromUpload(file, uploadResult, {
      type: file.mimetype.startsWith('audio/') ? 'audio' : undefined,
      duration:
        parseDurationSeconds(req.body.duration) ??
        parseDurationSeconds(req.body.audioDuration) ??
        parseDurationSeconds(uploadResult.duration),
      thumbnailUrl: file.mimetype.startsWith('audio/') ? null : undefined,
    });

    res.status(201).json({
      attachment,
      url: attachment.url,
      type: attachment.type,
      originalName: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      duration: attachment.duration,
      thumbnailUrl: attachment.thumbnailUrl,
    });
  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
};

// POST /api/messages/:id/poll/vote
export const votePoll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const messageId = id as string;
    const { option } = req.body;
    const userId = req.user!.id;

    if (!option || typeof option !== 'string') {
      res.status(400).json({ error: 'Poll option is required' });
      return;
    }

    const message = await Message.findByPk(messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (!message.poll) {
      res.status(400).json({ error: 'This message does not have a poll' });
      return;
    }

    if (message.channelId) {
      const membership = await ChannelMember.findOne({
        where: { channelId: message.channelId, userId },
      });
      if (!membership) {
        res.status(403).json({ error: 'You are not a member of this channel' });
        return;
      }
    } else if (message.dmId) {
      const membership = await DirectMessageMember.findOne({
        where: { dmId: message.dmId, userId },
      });
      if (!membership) {
        res.status(403).json({ error: 'You are not a member of this conversation' });
        return;
      }
    }

    if (!message.poll.options.includes(option)) {
      res.status(400).json({ error: 'Invalid poll option' });
      return;
    }

    const votes = { ...message.poll.votes };
    for (const pollOption of message.poll.options) {
      const currentVotes = Array.isArray(votes[pollOption]) ? votes[pollOption] : [];
      votes[pollOption] = currentVotes.filter((voterId: string) => voterId !== userId);
    }

    votes[option] = [...(votes[option] || []), userId];

    const updatedPoll = {
      options: message.poll.options,
      votes,
    };

    await message.update({ poll: updatedPoll });

    try {
      const io = getIO();
      const payload = {
        messageId: message.id,
        ...(message.channelId ? { channelId: message.channelId } : {}),
        ...(message.dmId ? { dmId: message.dmId } : {}),
        poll: updatedPoll,
      };

      if (message.channelId) {
        io.to(`channel:${message.channelId}`).emit('poll_update', payload);
      }
      if (message.dmId) {
        io.to(`dm:${message.dmId}`).emit('poll_update', payload);
        io.to(`dm:${message.dmId}`).emit('dm_poll_update', payload);
      }
    } catch (e) {
      console.error('Socket broadcast error (poll_update):', e);
    }

    res.json({
      message: 'Vote recorded',
      poll: updatedPoll,
    });
  } catch (error) {
    console.error('Vote poll error:', error);
    res.status(500).json({ error: 'Failed to vote on poll' });
  }
};

// PATCH /api/messages/:id/status
export const updateMessageStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const messageId = id as string;
    const { status } = req.body;
    const userId = req.user!.id;

    if (!status || !['delivered', 'read'].includes(status)) {
      res.status(400).json({ error: 'Status must be "delivered" or "read"' });
      return;
    }

    const message = await Message.findByPk(messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    if (message.senderId === userId) {
      res.status(400).json({ error: 'Cannot update status of your own message' });
      return;
    }

    if (message.channelId) {
      const membership = await ChannelMember.findOne({
        where: { channelId: message.channelId, userId },
      });
      if (!membership) {
        res.status(403).json({ error: 'You are not a member of this channel' });
        return;
      }
    }

    if (message.dmId) {
      const membership = await DirectMessageMember.findOne({
        where: { dmId: message.dmId, userId },
      });
      if (!membership) {
        res.status(403).json({ error: 'You are not a member of this conversation' });
        return;
      }
    }

    const updates: any = { status };
    if (status === 'delivered' && !message.deliveredAt) {
      updates.deliveredAt = new Date();
    }
    if (status === 'read') {
      if (!message.deliveredAt) updates.deliveredAt = new Date();
      updates.readAt = new Date();
    }

    await message.update(updates);

    try {
      const io = getIO();
      if (message.channelId) {
        io.to(`channel:${message.channelId}`).emit('message_status_update', {
          messageId: message.id,
          channelId: message.channelId,
          status: message.status,
          deliveredAt: message.deliveredAt,
          readAt: message.readAt,
        });
      }
      if (message.dmId) {
        io.to(`dm:${message.dmId}`).emit('dm_message_status_update', {
          messageId: message.id,
          dmId: message.dmId,
          status: message.status,
          deliveredAt: message.deliveredAt,
          readAt: message.readAt,
        });
      }
    } catch (e) {
      console.error('Socket broadcast error (message_status_update):', e);
    }

    res.json({
      message: 'Message status updated',
      data: {
        id: message.id,
        status: message.status,
        deliveredAt: message.deliveredAt,
        readAt: message.readAt,
      },
    });
  } catch (error) {
    console.error('Update message status error:', error);
    res.status(500).json({ error: 'Failed to update message status' });
  }
};

// GET /api/channels/:channelId/media
export const getChannelMedia = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const channelId = String(req.params.channelId);
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user!.id;
    const offset = (Number(page) - 1) * Number(limit);

    const membership = await ChannelMember.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    const whereClause: any = {
      channelId,
      isDeleted: false,
      [Op.or]: [
        { audio: { [Op.not]: null } },
        literal("json_typeof(attachments) = 'array' AND json_array_length(attachments) > 0")
      ],
    };

    if (membership.clearedAt) {
      whereClause.createdAt = { [Op.gt]: membership.clearedAt };
    }

    const { count, rows: messages } = await Message.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'name', 'avatar'],
        },
      ],
      limit: Number(limit),
      offset,
      order: [['createdAt', 'DESC']],
    });

    const formattedMedia = messages.map((msg: any) => formatMediaPayload(msg, userId));

    res.json({
      media: formattedMedia,
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        hasMore: offset + messages.length < count,
      },
    });
  } catch (error) {
    console.error('Get channel media error:', error);
    res.status(500).json({ error: 'Failed to fetch channel media' });
  }
};
