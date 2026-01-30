import type { Response } from 'express';
import { Op, fn, col, where as sequelizeWhere } from 'sequelize';
import { User, ChannelMember, Message } from '../models';
import type { AuthRequest } from '../middleware/auth';
import { uploadToCloudinary } from '../utils/cloudinary';

// GET /api/users
export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const whereClause: any = {};
    
    if (search && typeof search === 'string') {
      const searchTerm = search.toLowerCase().trim();
      
      // Use case-insensitive search with ILIKE (PostgreSQL)
      // Search across name and email fields
      whereClause[Op.or] = [
        sequelizeWhere(fn('LOWER', col('name')), { [Op.like]: `%${searchTerm}%` }),
        sequelizeWhere(fn('LOWER', col('email')), { [Op.like]: `%${searchTerm}%` }),
      ];
    }

    const { count, rows: users } = await User.findAndCountAll({
      where: whereClause,
      attributes: ['id', 'name', 'email', 'avatar', 'bio', 'lastSeen', 'profileVisibility', 'isOnline', 'lastActive'],
      limit: Number(limit),
      offset,
      order: [
        // Order by relevance: exact matches first, then partial matches
        ...(search ? [
          [fn('CASE', 
            sequelizeWhere(fn('LOWER', col('name')), search.toString().toLowerCase()), 
            0,
            sequelizeWhere(fn('LOWER', col('name')), { [Op.like]: `${search.toString().toLowerCase()}%` }),
            1,
            2
          ), 'ASC']
        ] as any : []),
        ['name', 'ASC'],
      ],
    });

    res.json({
      users,
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(count / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// GET /api/users/:id
export const getUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = id as string;

    const user = await User.findByPk(userId, {
      attributes: [
        'id', 'name', 'email', 'avatar', 'bio', 
        'lastSeen', 'profileVisibility', 'readReceipts', 
        'typingIndicators', 'notificationSettings', 'isOnline', 'lastActive'
      ],
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// GET /api/users/me
export const getCurrentUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await User.findByPk(userId);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Get total unread count across all channels
    const memberships = await ChannelMember.findAll({
      where: { userId },
      attributes: ['channelId', 'lastReadAt'],
    });

    let totalUnread = 0;
    for (const membership of memberships) {
      const unreadCount = await Message.count({
        where: {
          channelId: membership.channelId,
          isDeleted: false,
          senderId: { [Op.ne]: userId },
          ...(membership.lastReadAt && { createdAt: { [Op.gt]: membership.lastReadAt } }),
        },
      });
      totalUnread += unreadCount;
    }

    res.json({ 
      user: {
        ...user.toJSON(),
        unread: totalUnread,
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// PUT /api/users/profile
export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, bio } = req.body;
    const file = req.file;

    const user = await User.findByPk(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (bio !== undefined) updates.bio = bio;

    // Handle avatar upload
    if (file) {
      const result = await uploadToCloudinary(file.buffer, 'avatars', 'image');
      updates.avatar = result.url;
    }

    await user.update(updates);

    res.json({
      message: 'Profile updated successfully',
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

// PUT /api/users/privacy
export const updatePrivacySettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { lastSeen, profileVisibility, readReceipts, typingIndicators } = req.body;

    const user = await User.findByPk(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updates: any = {};
    if (lastSeen !== undefined && ['everyone', 'contacts', 'nobody'].includes(lastSeen)) {
      updates.lastSeen = lastSeen;
    }
    if (profileVisibility !== undefined && ['everyone', 'contacts', 'nobody'].includes(profileVisibility)) {
      updates.profileVisibility = profileVisibility;
    }
    if (typeof readReceipts === 'boolean') {
      updates.readReceipts = readReceipts;
    }
    if (typeof typingIndicators === 'boolean') {
      updates.typingIndicators = typingIndicators;
    }

    await user.update(updates);

    res.json({
      message: 'Privacy settings updated',
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('Update privacy settings error:', error);
    res.status(500).json({ error: 'Failed to update privacy settings' });
  }
};

// PUT /api/users/notifications
export const updateNotificationSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { messages, groups, sounds } = req.body;

    const user = await User.findByPk(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const currentSettings = user.notificationSettings || { messages: true, groups: true, sounds: true };
    const newSettings = {
      messages: typeof messages === 'boolean' ? messages : currentSettings.messages,
      groups: typeof groups === 'boolean' ? groups : currentSettings.groups,
      sounds: typeof sounds === 'boolean' ? sounds : currentSettings.sounds,
    };

    await user.update({ notificationSettings: newSettings });

    res.json({
      message: 'Notification settings updated',
      notificationSettings: newSettings,
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
};
