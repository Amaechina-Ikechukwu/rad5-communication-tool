import type { Response } from 'express';
import { Channel, ChannelMember, User, Message } from '../models';
import type { AuthRequest } from '../middleware/auth';

// GET /api/channels
export const getChannels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Get all channels the user is a member of
    const memberships = await ChannelMember.findAll({
      where: { userId },
      include: [
        {
          model: Channel,
          as: 'channel',
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

    const channels = memberships.map((m: any) => ({
      ...m.channel.toJSON(),
      role: m.role,
    }));

    res.json({ channels });
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
