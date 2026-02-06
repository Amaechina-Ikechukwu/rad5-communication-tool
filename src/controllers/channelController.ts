import type { Response } from 'express';
import { Op, fn, col, where as sequelizeWhere } from 'sequelize';
import { Channel, ChannelMember, User, Message } from '../models';
import type { AuthRequest } from '../middleware/auth';

// GET /api/channels
export const getChannels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { search, filter } = req.query;

    // Build channel filter based on query params
    const channelWhere: any = {};
    
    if (search && typeof search === 'string') {
      const searchTerm = search.toLowerCase().trim();
      channelWhere[Op.or] = [
        sequelizeWhere(fn('LOWER', col('channel.name')), { [Op.like]: `%${searchTerm}%` }),
        sequelizeWhere(fn('LOWER', col('channel.description')), { [Op.like]: `%${searchTerm}%` }),
      ];
    }

    // Get all channels the user is a member of
    const memberships = await ChannelMember.findAll({
      where: { userId },
      include: [
        {
          model: Channel,
          as: 'channel',
          where: Object.keys(channelWhere).length > 0 ? channelWhere : undefined,
          include: [
            {
              model: User,
              as: 'members',
              attributes: ['id', 'name', 'avatar', 'isOnline'],
              through: { attributes: ['role'] },
            },
          ],
        },
      ],
    });

    // Get unread counts for each channel
    let channelsWithDetails = await Promise.all(
      memberships.map(async (m: any) => {
        const unreadCount = await Message.count({
          where: {
            channelId: m.channelId,
            isDeleted: false,
            senderId: { [Op.ne]: userId },
            ...(m.lastReadAt && { createdAt: { [Op.gt]: m.lastReadAt } }),
          },
        });

        return {
          ...m.channel.toJSON(),
          role: m.role,
          isArchived: m.isArchived,
          isStarred: m.isStarred,
          isMuted: m.isMuted,
          unreadCount,
        };
      })
    );

    // Apply additional filters
    if (filter && typeof filter === 'string') {
      switch (filter.toLowerCase()) {
        case 'starred':
          channelsWithDetails = channelsWithDetails.filter(c => c.isStarred);
          break;
        case 'archived':
          channelsWithDetails = channelsWithDetails.filter(c => c.isArchived);
          break;
        case 'muted':
          channelsWithDetails = channelsWithDetails.filter(c => c.isMuted);
          break;
        case 'unread':
          channelsWithDetails = channelsWithDetails.filter(c => c.unreadCount > 0);
          break;
        case 'groups':
          channelsWithDetails = channelsWithDetails.filter(c => c.isGroup);
          break;
        case 'personal':
          channelsWithDetails = channelsWithDetails.filter(c => !c.isGroup);
          break;
        case 'active':
          // Exclude archived channels
          channelsWithDetails = channelsWithDetails.filter(c => !c.isArchived);
          break;
      }
    } else {
      // By default, exclude archived channels unless specifically filtered
      channelsWithDetails = channelsWithDetails.filter(c => !c.isArchived);
    }

    res.json({ channels: channelsWithDetails });
  } catch (error) {
    console.error('Get channels error:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
};

// POST /api/channels
export const createChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, memberIds, isGroup = true } = req.body;
    const userId = req.user!.id;

    if (!name) {
      res.status(400).json({ error: 'Channel name is required' });
      return;
    }

    // Create channel
    const channel = await Channel.create({
      name,
      description,
      isGroup,
      createdBy: userId,
    });

    // Add creator as admin
    await ChannelMember.create({
      channelId: channel.id,
      userId,
      role: 'admin',
    });

    // Add other members
    if (Array.isArray(memberIds) && memberIds.length > 0) {
      const memberPromises = memberIds
        .filter((id: string) => id !== userId)
        .map((memberId: string) =>
          ChannelMember.create({
            channelId: channel.id,
            userId: memberId,
            role: 'member',
          })
        );
      await Promise.all(memberPromises);
    }

    // Fetch channel with members
    const channelWithMembers = await Channel.findByPk(channel.id, {
      include: [
        {
          model: User,
          as: 'members',
          attributes: ['id', 'name', 'avatar'],
          through: { attributes: ['role'] },
        },
      ],
    });

    res.status(201).json({
      message: 'Channel created successfully',
      channel: channelWithMembers,
    });
  } catch (error) {
    console.error('Create channel error:', error);
    res.status(500).json({ error: 'Failed to create channel' });
  }
};

// GET /api/channels/:id
export const getChannelDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const channelId = id as string;
    const userId = req.user!.id;

    // Check if user is a member
    const membership = await ChannelMember.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    // Get channel with members
    const channel = await Channel.findByPk(channelId, {
      include: [
        {
          model: User,
          as: 'members',
          attributes: ['id', 'name', 'avatar'],
          through: { attributes: ['role'] },
        },
      ],
    });

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Get media and attachments from messages
    const messages = await Message.findAll({
      where: { channelId, isDeleted: false },
      attributes: ['attachments', 'audio'],
    });

    const media: string[] = [];
    const attachments: { name: string; url: string; type: string }[] = [];

    messages.forEach((msg: any) => {
      if (msg.attachments && Array.isArray(msg.attachments)) {
        msg.attachments.forEach((url: string) => {
          if (url.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm)$/i)) {
            media.push(url);
          } else {
            const name = url.split('/').pop() || 'file';
            const type = url.split('.').pop() || 'file';
            attachments.push({ name, url, type });
          }
        });
      }
      if (msg.audio?.url) {
        attachments.push({
          name: 'Audio message',
          url: msg.audio.url,
          type: 'audio',
        });
      }
    });

    res.json({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      members: channel.get('members'),
      media,
      attachments,
    });
  } catch (error) {
    console.error('Get channel details error:', error);
    res.status(500).json({ error: 'Failed to fetch channel details' });
  }
};

// POST /api/channels/:id/members
export const addMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { userId: newMemberId } = req.body;
    const userId = req.user!.id;

    // Check if requester is admin
    const membership = await ChannelMember.findOne({
      where: { channelId: id, userId, role: 'admin' },
    });

    if (!membership) {
      res.status(403).json({ error: 'Only admins can add members' });
      return;
    }

    // Check if user exists
    const user = await User.findByPk(newMemberId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Check if already a member
    const existingMembership = await ChannelMember.findOne({
      where: { channelId: id, userId: newMemberId },
    });

    if (existingMembership) {
      res.status(409).json({ error: 'User is already a member' });
      return;
    }

    await ChannelMember.create({
      channelId: id as string,
      userId: newMemberId,
      role: 'member',
    });

    res.status(201).json({ message: 'Member added successfully' });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
};

// DELETE /api/channels/:id/members/:userId
export const removeMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, memberId } = req.params;
    const userId = req.user!.id;

    // Check if requester is admin or removing self
    const membership = await ChannelMember.findOne({
      where: { channelId: id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    if (membership.role !== 'admin' && memberId !== userId) {
      res.status(403).json({ error: 'Only admins can remove other members' });
      return;
    }

    await ChannelMember.destroy({
      where: { channelId: id, userId: memberId },
    });

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
};

// POST /api/channels/:id/archive
export const archiveChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const membership = await ChannelMember.findOne({
      where: { channelId: id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    // Toggle archive status
    const newStatus = !membership.isArchived;
    await membership.update({ isArchived: newStatus });

    res.json({ 
      message: newStatus ? 'Channel archived successfully' : 'Channel unarchived successfully',
      isArchived: newStatus
    });
  } catch (error) {
    console.error('Archive channel error:', error);
    res.status(500).json({ error: 'Failed to archive channel' });
  }
};

// POST /api/channels/:id/star
export const starChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const membership = await ChannelMember.findOne({
      where: { channelId: id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    // Toggle star status
    const newStatus = !membership.isStarred;
    await membership.update({ isStarred: newStatus });

    res.json({ 
      message: newStatus ? 'Channel starred successfully' : 'Channel unstarred successfully',
      isStarred: newStatus
    });
  } catch (error) {
    console.error('Star channel error:', error);
    res.status(500).json({ error: 'Failed to star channel' });
  }
};

// POST /api/channels/:id/mute
export const muteChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const membership = await ChannelMember.findOne({
      where: { channelId: id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    // Toggle mute status
    const newStatus = !membership.isMuted;
    await membership.update({ isMuted: newStatus });

    res.json({ 
      message: newStatus ? 'Channel muted successfully' : 'Channel unmuted successfully',
      isMuted: newStatus
    });
  } catch (error) {
    console.error('Mute channel error:', error);
    res.status(500).json({ error: 'Failed to mute channel' });
  }
};

// PATCH /api/channels/:id/settings - Update channel settings explicitly
export const updateChannelSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { isArchived, isStarred, isMuted } = req.body;
    const userId = req.user!.id;

    const membership = await ChannelMember.findOne({
      where: { channelId: id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    // Build update object with only provided fields
    const updates: { isArchived?: boolean; isStarred?: boolean; isMuted?: boolean } = {};
    
    if (typeof isArchived === 'boolean') {
      updates.isArchived = isArchived;
    }
    if (typeof isStarred === 'boolean') {
      updates.isStarred = isStarred;
    }
    if (typeof isMuted === 'boolean') {
      updates.isMuted = isMuted;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid settings provided. Use isArchived, isStarred, or isMuted (boolean values).' });
      return;
    }

    await membership.update(updates);

    res.json({
      message: 'Channel settings updated successfully',
      settings: {
        isArchived: membership.isArchived,
        isStarred: membership.isStarred,
        isMuted: membership.isMuted,
      },
    });
  } catch (error) {
    console.error('Update channel settings error:', error);
    res.status(500).json({ error: 'Failed to update channel settings' });
  }
};
export const markChannelAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const membership = await ChannelMember.findOne({
      where: { channelId: id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this channel' });
      return;
    }

    await membership.update({ lastReadAt: new Date() });

    res.json({ 
      message: 'Channel marked as read',
      lastReadAt: membership.lastReadAt
    });
  } catch (error) {
    console.error('Mark channel as read error:', error);
    res.status(500).json({ error: 'Failed to mark channel as read' });
  }
};

// GET /api/channels/personal/:userId - Get or create personal chat with a user
export const getPersonalChat = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const userId = req.user!.id;

    if (recipientId === userId) {
      res.status(400).json({ error: 'Cannot create personal chat with yourself' });
      return;
    }

    // Check if recipient exists
    const recipient = await User.findByPk(recipientId);
    if (!recipient) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Find existing personal chat (non-group channel) between these two users
    const existingChannels = await Channel.findAll({
      where: { isGroup: false },
      include: [
        {
          model: User,
          as: 'members',
          attributes: ['id'],
          through: { attributes: [] },
        },
      ],
    });

    let personalChat = existingChannels.find((channel: any) => {
      const memberIds = channel.members.map((m: any) => m.id);
      return memberIds.length === 2 && 
             memberIds.includes(userId) && 
             memberIds.includes(recipientId);
    });

    if (!personalChat) {
      // Create new personal chat
      personalChat = await Channel.create({
        name: `${req.user!.name} - ${recipient.name}`,
        isGroup: false,
        createdBy: userId,
      });

      // Add both users as members
      await Promise.all([
        ChannelMember.create({
          channelId: personalChat.id,
          userId,
          role: 'member',
        }),
        ChannelMember.create({
          channelId: personalChat.id,
          userId: recipientId,
          role: 'member',
        }),
      ]);
    }

    // Fetch channel with members and membership details
    const channelWithDetails = await Channel.findByPk(personalChat.id, {
      include: [
        {
          model: User,
          as: 'members',
          attributes: ['id', 'name', 'avatar', 'isOnline', 'lastActive'],
          through: { attributes: ['role'] },
        },
      ],
    });

    // Get user's membership for channel settings
    const membership = await ChannelMember.findOne({
      where: { channelId: personalChat.id, userId },
    });

    // Get unread count
    const unreadCount = await Message.count({
      where: {
        channelId: personalChat.id,
        isDeleted: false,
        senderId: { [Op.ne]: userId },
        ...(membership?.lastReadAt && { createdAt: { [Op.gt]: membership.lastReadAt } }),
      },
    });

    res.json({
      channel: {
        ...channelWithDetails?.toJSON(),
        isArchived: membership?.isArchived || false,
        isStarred: membership?.isStarred || false,
        isMuted: membership?.isMuted || false,
        unreadCount,
      },
    });
  } catch (error) {
    console.error('Get personal chat error:', error);
    res.status(500).json({ error: 'Failed to get personal chat' });
  }
};

// POST /api/channels/personal/:recipientId/messages - Send a direct message to a user
export const sendDirectMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const { text } = req.body;
    const userId = req.user!.id;

    if (recipientId === userId) {
      res.status(400).json({ error: 'Cannot send a message to yourself' });
      return;
    }

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Message text is required' });
      return;
    }

    // Check if recipient exists
    const recipient = await User.findByPk(recipientId);
    if (!recipient) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Find existing personal chat (non-group channel) between these two users
    const existingChannels = await Channel.findAll({
      where: { isGroup: false },
      include: [
        {
          model: User,
          as: 'members',
          attributes: ['id'],
          through: { attributes: [] },
        },
      ],
    });

    let personalChat = existingChannels.find((channel: any) => {
      const memberIds = channel.members.map((m: any) => m.id);
      return memberIds.length === 2 && 
             memberIds.includes(userId) && 
             memberIds.includes(recipientId);
    });

    if (!personalChat) {
      // Create new personal chat
      personalChat = await Channel.create({
        name: `${req.user!.name} - ${recipient.name}`,
        isGroup: false,
        createdBy: userId,
      });

      // Add both users as members
      await Promise.all([
        ChannelMember.create({
          channelId: personalChat.id,
          userId,
          role: 'member',
        }),
        ChannelMember.create({
          channelId: personalChat.id,
          userId: recipientId,
          role: 'member',
        }),
      ]);
    }

    // Create the message
    const message = await Message.create({
      channelId: personalChat.id,
      senderId: userId,
      text: text.trim(),
    });

    // Fetch with sender info
    const fullMessage = await Message.findByPk(message.id, {
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'name', 'avatar'],
        },
      ],
    });

    // Update sender's lastReadAt
    await ChannelMember.update(
      { lastReadAt: new Date() },
      { where: { channelId: personalChat.id, userId } }
    );

    const formattedMessage = {
      id: fullMessage!.id,
      sender: (fullMessage as any).sender,
      text: fullMessage!.text,
      time: fullMessage!.createdAt,
      isOwn: true,
      reactions: [],
      channelId: personalChat.id,
    };

    res.status(201).json({
      message: 'Direct message sent',
      data: formattedMessage,
      channel: {
        id: personalChat.id,
        name: personalChat.name,
        isGroup: false,
      },
    });
  } catch (error) {
    console.error('Send direct message error:', error);
    res.status(500).json({ error: 'Failed to send direct message' });
  }
};

// GET /api/channels/personal/:userId/messages - Get messages from personal chat
export const getPersonalChatMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const { page = 1, limit = 50, before } = req.query;
    const userId = req.user!.id;
    const offset = (Number(page) - 1) * Number(limit);

    // Find personal chat channel
    const existingChannels = await Channel.findAll({
      where: { isGroup: false },
      include: [
        {
          model: User,
          as: 'members',
          attributes: ['id'],
          through: { attributes: [] },
        },
      ],
    });

    const personalChat = existingChannels.find((channel: any) => {
      const memberIds = channel.members.map((m: any) => m.id);
      return memberIds.length === 2 && 
             memberIds.includes(userId) && 
             memberIds.includes(recipientId);
    });

    if (!personalChat) {
      res.status(404).json({ error: 'Personal chat not found' });
      return;
    }

    const whereClause: any = { channelId: personalChat.id, isDeleted: false };
    if (before) {
      whereClause.createdAt = { [Op.lt]: new Date(before as string) };
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

    // Format messages
    const formattedMessages = messages.map((msg: any) => ({
      id: msg.id,
      sender: msg.sender,
      text: msg.text,
      time: msg.createdAt,
      isOwn: msg.senderId === userId,
      isEdited: msg.isEdited,
      attachments: msg.attachments,
      audio: msg.audio,
    }));

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
    console.error('Get personal chat messages error:', error);
    res.status(500).json({ error: 'Failed to fetch personal chat messages' });
  }
};
