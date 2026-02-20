import type { Response } from 'express';
import { Message, Reaction, User, ChannelMember, Channel } from '../models';
import type { AuthRequest } from '../middleware/auth';
import { uploadToCloudinary, getFileType } from '../utils/cloudinary';
import { isWithinEditWindow } from '../utils/validators';

// GET /api/channels/:channelId/messages
export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { channelId } = req.params;
    const { page = 1, limit = 50, before } = req.query;
    const userId = req.user!.id;
    const offset = (Number(page) - 1) * Number(limit);

    // Verify membership
    const membership = await ChannelMember.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    const whereClause: any = { channelId, isDeleted: false };

    // Respect clearedAt - only show messages after the user cleared the chat
    if (membership.clearedAt) {
      whereClause.createdAt = { ...(whereClause.createdAt || {}), [require('sequelize').Op.gt]: membership.clearedAt };
    }

    if (before) {
      whereClause.createdAt = { ...(whereClause.createdAt || {}), [require('sequelize').Op.lt]: new Date(before as string) };
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

    // Format messages
    const formattedMessages = messages.map((msg: any) => ({
      id: msg.id,
      sender: msg.sender,
      text: msg.text,
      time: msg.createdAt,
      isOwn: msg.senderId === userId,
      isEdited: msg.isEdited,
      reactions: msg.reactions.map((r: any) => ({
        emoji: r.emoji,
        user: r.user,
      })),
      attachments: msg.attachments,
      audio: msg.audio,
      poll: msg.poll,
      status: msg.status,
      deliveredAt: msg.deliveredAt,
      readAt: msg.readAt,
    }));

    res.json({
      messages: formattedMessages.reverse(), // Oldest first
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
    const { channelId } = req.params;
    const { text, poll } = req.body;
    const userId = req.user!.id;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    // Verify membership
    const membership = await ChannelMember.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    // Must have at least text, attachments, audio, or poll
    if (!text && !files?.attachments?.length && !files?.audio?.length && !poll) {
      res.status(400).json({ error: 'Message must have content' });
      return;
    }

    const messageData: any = {
      channelId,
      senderId: userId,
      text: text || null,
    };

    // Upload attachments
    if (files?.attachments?.length) {
      const uploadPromises = files.attachments.map((file) =>
        uploadToCloudinary(file.buffer, 'attachments', 'auto')
      );
      const results = await Promise.all(uploadPromises);
      messageData.attachments = results.map((r) => r.url);
    }

    // Upload audio
    if (files?.audio?.length) {
      const audioResult = await uploadToCloudinary(files.audio[0].buffer, 'audio', 'video');
      messageData.audio = {
        url: audioResult.url,
        duration: req.body.audioDuration || '0:00',
      };
    }

    // Handle poll
    if (poll) {
      try {
        const pollData = typeof poll === 'string' ? JSON.parse(poll) : poll;
        if (pollData.options && Array.isArray(pollData.options)) {
          messageData.poll = {
            options: pollData.options,
            votes: {},
          };
        }
      } catch (e) {
        // Invalid poll data, ignore
      }
    }

    const message = await Message.create(messageData);

    // Fetch with sender
    const fullMessage = await Message.findByPk(message.id, {
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'name', 'avatar'],
        },
      ],
    });

    const formattedMessage = {
      id: fullMessage!.id,
      sender: (fullMessage as any).sender,
      text: fullMessage!.text,
      time: fullMessage!.createdAt,
      isOwn: true,
      reactions: [],
      attachments: fullMessage!.attachments,
      audio: fullMessage!.audio,
      poll: fullMessage!.poll,
      status: fullMessage!.status,
      deliveredAt: fullMessage!.deliveredAt,
      readAt: fullMessage!.readAt,
    };

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

    await message.update({ isDeleted: true, text: null, attachments: [], audio: null });

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

    if (!emoji) {
      res.status(400).json({ error: 'Emoji is required' });
      return;
    }

    const message = await Message.findByPk(messageId);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    // Check if user is in channel
    const membership = await ChannelMember.findOne({
      where: { channelId: message.channelId, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    // Toggle reaction (add or remove)
    const existingReaction = await Reaction.findOne({
      where: { messageId: id, userId, emoji },
    });

    if (existingReaction) {
      await existingReaction.destroy();
      res.json({ message: 'Reaction removed', action: 'removed' });
    } else {
      await Reaction.create({ messageId, userId, emoji });
      res.json({ message: 'Reaction added', action: 'added' });
    }
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
};

// POST /api/upload
export const uploadFile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const result = await uploadToCloudinary(file.buffer, 'uploads', 'auto');
    const fileType = getFileType(file.mimetype);

    res.json({
      url: result.url,
      type: fileType,
      originalName: file.originalname,
    });
  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
};

// POST /api/messages/:id/poll/vote - Vote on a poll
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

    // Verify membership
    const membership = await ChannelMember.findOne({
      where: { channelId: message.channelId, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    if (!message.poll.options.includes(option)) {
      res.status(400).json({ error: 'Invalid poll option' });
      return;
    }

    const votes = { ...message.poll.votes };

    // Remove previous vote from all options
    for (const opt of Object.keys(votes)) {
      votes[opt] = (votes[opt] || []).filter((uid: string) => uid !== userId);
    }

    // Add vote to the chosen option
    if (!votes[option]) {
      votes[option] = [];
    }
    votes[option].push(userId);

    await message.update({
      poll: {
        options: message.poll.options,
        votes,
      },
    });

    res.json({
      message: 'Vote recorded',
      poll: message.poll,
    });
  } catch (error) {
    console.error('Vote poll error:', error);
    res.status(500).json({ error: 'Failed to vote on poll' });
  }
};

// PATCH /api/messages/:id/status - Update message delivery/read status
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

    // Only the recipient can update the status (not the sender)
    if (message.senderId === userId) {
      res.status(400).json({ error: 'Cannot update status of your own message' });
      return;
    }

    // Verify membership
    const membership = await ChannelMember.findOne({
      where: { channelId: message.channelId, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
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
