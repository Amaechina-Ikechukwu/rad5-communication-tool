import type { Response } from 'express';
import { Op, fn, col, where as sequelizeWhere } from 'sequelize';
import { User, ChannelMember, Channel, DirectMessage, DirectMessageMember } from '../models';
import type { AuthRequest } from '../middleware/auth';
import { uploadToCloudinary } from '../utils/cloudinary';
import { countChannelUnread, countDmUnread } from '../utils/unread';

// GET /api/users
export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const currentUserId = req.user!.id;

    const whereClause: any = {};

    whereClause.accountStatus = 'active';
    
    if (search && typeof search === 'string') {
      const searchTerm = search.toLowerCase().trim();
      
      whereClause[Op.or] = [
        sequelizeWhere(fn('LOWER', col('name')), { [Op.like]: `%${searchTerm}%` }),
        sequelizeWhere(fn('LOWER', col('email')), { [Op.like]: `%${searchTerm}%` }),
      ];
    }

    const { count, rows: users } = await User.findAndCountAll({
      where: whereClause,
      attributes: [
        'id', 'name', 'email', 'role', 'team', 'department', 'avatar', 'bio',
        'lastSeen', 'profileVisibility', 'isOnline', 'lastActive',
        'readReceipts', 'typingIndicators', 'notificationSettings',
        'createdAt', 'updatedAt'
      ],
      limit: Number(limit),
      offset,
      order: [['name', 'ASC']],
    });

    const dmMemberships = await DirectMessageMember.findAll({
      where: { userId: currentUserId },
      include: [
        {
          model: DirectMessage,
          as: 'directMessage',
          include: [
            {
              model: User,
              as: 'participants',
              attributes: ['id'],
              through: { attributes: [] },
            },
          ],
        },
      ],
    });

    const dmMap = new Map();
    dmMemberships.forEach((membership) => {
      const directMessage = (membership as any).directMessage;
      const otherParticipant = directMessage?.participants?.find((participant: any) => participant.id !== currentUserId);
      if (otherParticipant) {
        dmMap.set(otherParticipant.id, {
          dmId: membership.dmId,
          lastReadAt: membership.lastReadAt,
          clearedAt: membership.clearedAt,
          isArchived: membership.isArchived,
          isStarred: membership.isStarred,
          isMuted: membership.isMuted,
        });
      }
    });

    const usersWithDetails = await Promise.all(users.map(async (user) => {
      const dmInfo = dmMap.get(user.id);
      const unreadCount = dmInfo
        ? await countDmUnread({
            dmId: dmInfo.dmId,
            userId: currentUserId,
            lastReadAt: dmInfo.lastReadAt,
            clearedAt: dmInfo.clearedAt,
          })
        : 0;

      return {
        ...user.toJSON(),
        dmId: dmInfo?.dmId || null,
        unreadCount,
        unread: unreadCount,
        isArchived: dmInfo?.isArchived || false,
        isStarred: dmInfo?.isStarred || false,
        isMuted: dmInfo?.isMuted || false,
      };
    }));

    res.json({
      users: usersWithDetails,
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(count / Number(limit)),
        hasMore: offset + users.length < count,
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
        'id', 'name', 'email', 'role', 'team', 'department', 'avatar', 'bio',
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

    const [channelMemberships, dmMemberships] = await Promise.all([
      ChannelMember.findAll({
        where: { userId },
        attributes: ['channelId', 'lastReadAt', 'clearedAt'],
      }),
      DirectMessageMember.findAll({
        where: { userId },
        attributes: ['dmId', 'lastReadAt', 'clearedAt'],
      }),
    ]);

    const [channelUnreadCounts, dmUnreadCounts] = await Promise.all([
      Promise.all(channelMemberships.map((membership) => countChannelUnread({
        channelId: membership.channelId,
        userId,
        lastReadAt: membership.lastReadAt,
        clearedAt: membership.clearedAt,
      }))),
      Promise.all(dmMemberships.map((membership) => countDmUnread({
        dmId: membership.dmId,
        userId,
        lastReadAt: membership.lastReadAt,
        clearedAt: membership.clearedAt,
      }))),
    ]);

    const totalUnread = [...channelUnreadCounts, ...dmUnreadCounts].reduce((sum, count) => sum + count, 0);

    res.json({ 
      user: {
        ...user.toJSON(),
        unread: totalUnread,
        unreadCount: totalUnread,
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

    const currentSettings = user.notificationSettings || {
      messages: true, groups: true, sounds: true,
      audio: true, images: true, videos: true,
      files: true, reactions: true, mentions: true, calls: true,
    };

    const { audio, images, videos, files, reactions, mentions, calls } = req.body;

    const newSettings = {
      messages: typeof messages === 'boolean' ? messages : currentSettings.messages,
      groups: typeof groups === 'boolean' ? groups : currentSettings.groups,
      sounds: typeof sounds === 'boolean' ? sounds : currentSettings.sounds,
      audio: typeof audio === 'boolean' ? audio : currentSettings.audio,
      images: typeof images === 'boolean' ? images : currentSettings.images,
      videos: typeof videos === 'boolean' ? videos : currentSettings.videos,
      files: typeof files === 'boolean' ? files : currentSettings.files,
      reactions: typeof reactions === 'boolean' ? reactions : currentSettings.reactions,
      mentions: typeof mentions === 'boolean' ? mentions : currentSettings.mentions,
      calls: typeof calls === 'boolean' ? calls : currentSettings.calls,
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

// GET /api/users/:id/avatar - Get a user's profile image
export const getUserAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = id as string;

    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'avatar'],
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user.id,
      name: user.name,
      avatar: user.avatar,
    });
  } catch (error) {
    console.error('Get user avatar error:', error);
    res.status(500).json({ error: 'Failed to fetch user avatar' });
  }
};

// PUT /api/users/avatar - Upload/update avatar only
export const updateAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;

    const user = await User.findByPk(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!file) {
      res.status(400).json({ error: 'Image file is required' });
      return;
    }

    const result = await uploadToCloudinary(file.buffer, 'avatars', 'image');
    await user.update({ avatar: result.url });

    res.json({
      message: 'Avatar updated successfully',
      avatar: result.url,
    });
  } catch (error) {
    console.error('Update avatar error:', error);
    res.status(500).json({ error: 'Failed to update avatar' });
  }
};

// DELETE /api/users/avatar - Remove avatar
export const deleteAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findByPk(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await user.update({ avatar: null });

    res.json({ message: 'Avatar removed successfully' });
  } catch (error) {
    console.error('Delete avatar error:', error);
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
};
