import type { Response } from 'express';
import { Op, fn, col, where as sequelizeWhere } from 'sequelize';
import { DirectMessage, DirectMessageMember, User, Message, Reaction } from '../models';
import type { AuthRequest } from '../middleware/auth';

// Helper function to find existing DM between two users
const findExistingDm = async (userId: string, recipientId: string) => {
  const userDmMemberships = await DirectMessageMember.findAll({
    where: { userId },
    attributes: ['dmId'],
  });

  const dmIds = userDmMemberships.map(m => m.dmId);

  if (dmIds.length === 0) return null;

  // Find a DM where the recipient is also a member
  const recipientMembership = await DirectMessageMember.findOne({
    where: {
      dmId: { [Op.in]: dmIds },
      userId: recipientId,
    },
  });

  if (!recipientMembership) return null;

  return DirectMessage.findByPk(recipientMembership.dmId);
};

// Helper: find a DM by its own ID (if the param IS a DM id) or by recipient user ID
// The frontend may pass either the DM id or the recipient's user id
const findDmByIdOrRecipient = async (userId: string, idOrRecipient: string) => {
  // First, try treating idOrRecipient as the DM's own ID
  const directLookup = await DirectMessageMember.findOne({
    where: { dmId: idOrRecipient, userId },
  });

  if (directLookup) {
    return DirectMessage.findByPk(idOrRecipient);
  }

  // Otherwise, treat it as a recipient user ID
  return findExistingDm(userId, idOrRecipient);
};

// GET /api/dms - List all DM conversations
export const getDms = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { search, filter } = req.query;

    // Get all DMs the user is a member of
    const memberships = await DirectMessageMember.findAll({
      where: { userId },
      include: [
        {
          model: DirectMessage,
          as: 'directMessage',
          include: [
            {
              model: User,
              as: 'participants',
              attributes: ['id', 'name', 'avatar', 'isOnline', 'lastActive'],
              through: { attributes: [] },
            },
          ],
        },
      ],
    });

    // Build DM list with unread counts and last message
    let dmsWithDetails = await Promise.all(
      memberships.map(async (m: any) => {
        const dm = m.directMessage;
        if (!dm) return null;

        const unreadCount = await Message.count({
          where: {
            dmId: dm.id,
            isDeleted: false,
            senderId: { [Op.ne]: userId },
            ...(m.lastReadAt && { createdAt: { [Op.gt]: m.lastReadAt } }),
          },
        });

        // Get last message for preview
        const lastMessage = await Message.findOne({
          where: { dmId: dm.id, isDeleted: false },
          order: [['createdAt', 'DESC']],
          include: [
            {
              model: User,
              as: 'sender',
              attributes: ['id', 'name'],
            },
          ],
        });

        // Get the other participant for DM display name
        const otherParticipant = dm.participants.find((p: any) => p.id !== userId);

        return {
          id: dm.id,
          participant: otherParticipant || null,
          participants: dm.participants,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                text: lastMessage.text,
                senderId: lastMessage.senderId,
                senderName: (lastMessage as any).sender?.name,
                time: lastMessage.createdAt,
                status: lastMessage.status,
              }
            : null,
          isArchived: m.isArchived,
          isStarred: m.isStarred,
          isMuted: m.isMuted,
          unreadCount,
          createdAt: dm.createdAt,
          updatedAt: dm.updatedAt,
        };
      })
    );

    // Filter out nulls
    dmsWithDetails = dmsWithDetails.filter(Boolean);

    // Apply search filter
    if (search && typeof search === 'string') {
      const searchTerm = search.toLowerCase().trim();
      dmsWithDetails = dmsWithDetails.filter((dm: any) =>
        dm.participant?.name?.toLowerCase().includes(searchTerm)
      );
    }

    // Apply additional filters
    if (filter && typeof filter === 'string') {
      switch (filter.toLowerCase()) {
        case 'starred':
          dmsWithDetails = dmsWithDetails.filter((d: any) => d.isStarred);
          break;
        case 'archived':
          dmsWithDetails = dmsWithDetails.filter((d: any) => d.isArchived);
          break;
        case 'muted':
          dmsWithDetails = dmsWithDetails.filter((d: any) => d.isMuted);
          break;
        case 'unread':
          dmsWithDetails = dmsWithDetails.filter((d: any) => d.unreadCount > 0);
          break;
        case 'active':
          dmsWithDetails = dmsWithDetails.filter((d: any) => !d.isArchived);
          break;
        case 'all':
          break;
      }
    } else {
      // Default: exclude archived
      dmsWithDetails = dmsWithDetails.filter((d: any) => !d.isArchived);
    }

    // Sort by last message time (most recent first)
    dmsWithDetails.sort((a: any, b: any) => {
      const aTime = a.lastMessage?.time || a.createdAt;
      const bTime = b.lastMessage?.time || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    res.json({ dms: dmsWithDetails });
  } catch (error) {
    console.error('Get DMs error:', error);
    res.status(500).json({ error: 'Failed to fetch direct messages' });
  }
};

// GET/POST /api/dms/:recipientId - Get or create a DM conversation
export const getOrCreateDm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const userId = req.user!.id;

    if (recipientId === userId) {
      res.status(400).json({ error: 'Cannot create a DM with yourself' });
      return;
    }

    // Check if recipient exists
    const recipient = await User.findByPk(recipientId);
    if (!recipient) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Find existing DM
    let dm = await findExistingDm(userId, recipientId);

    if (!dm) {
      // Create new DM
      dm = await DirectMessage.create({
        createdBy: userId,
      });

      // Add both users as participants
      await Promise.all([
        DirectMessageMember.create({
          dmId: dm.id,
          userId,
        }),
        DirectMessageMember.create({
          dmId: dm.id,
          userId: recipientId,
        }),
      ]);
    }

    // Fetch DM with participants
    const dmWithDetails = await DirectMessage.findByPk(dm.id, {
      include: [
        {
          model: User,
          as: 'participants',
          attributes: ['id', 'name', 'avatar', 'isOnline', 'lastActive'],
          through: { attributes: [] },
        },
      ],
    });

    // Get membership for settings
    const membership = await DirectMessageMember.findOne({
      where: { dmId: dm.id, userId },
    });

    // Get unread count
    const unreadCount = await Message.count({
      where: {
        dmId: dm.id,
        isDeleted: false,
        senderId: { [Op.ne]: userId },
        ...(membership?.lastReadAt && { createdAt: { [Op.gt]: membership.lastReadAt } }),
      },
    });

    const otherParticipant = (dmWithDetails as any)?.participants?.find((p: any) => p.id !== userId);

    res.json({
      dm: {
        id: dmWithDetails?.id,
        participant: otherParticipant || null,
        participants: (dmWithDetails as any)?.participants || [],
        isArchived: membership?.isArchived || false,
        isStarred: membership?.isStarred || false,
        isMuted: membership?.isMuted || false,
        unreadCount,
        createdAt: dmWithDetails?.createdAt,
        updatedAt: dmWithDetails?.updatedAt,
      },
    });
  } catch (error) {
    console.error('Get/create DM error:', error);
    res.status(500).json({ error: 'Failed to get/create DM' });
  }
};

// POST /api/dms/:recipientId/messages - Send a DM
export const sendDm = async (req: AuthRequest, res: Response): Promise<void> => {
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

    // Find or create DM
    let dm = await findExistingDm(userId, recipientId);

    if (!dm) {
      dm = await DirectMessage.create({
        createdBy: userId,
      });

      await Promise.all([
        DirectMessageMember.create({
          dmId: dm.id,
          userId,
        }),
        DirectMessageMember.create({
          dmId: dm.id,
          userId: recipientId,
        }),
      ]);
    }

    // Create the message
    const message = await Message.create({
      dmId: dm.id,
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
    await DirectMessageMember.update(
      { lastReadAt: new Date() },
      { where: { dmId: dm.id, userId } }
    );

    const formattedMessage = {
      id: fullMessage!.id,
      sender: (fullMessage as any).sender,
      text: fullMessage!.text,
      time: fullMessage!.createdAt,
      isOwn: true,
      reactions: [],
      dmId: dm.id,
      status: fullMessage!.status,
      deliveredAt: fullMessage!.deliveredAt,
      readAt: fullMessage!.readAt,
    };

    res.status(201).json({
      message: 'Direct message sent',
      data: formattedMessage,
      dm: {
        id: dm.id,
      },
    });
  } catch (error) {
    console.error('Send DM error:', error);
    res.status(500).json({ error: 'Failed to send direct message' });
  }
};

// GET /api/dms/:recipientId/messages - Get DM messages
export const getDmMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const { page = 1, limit = 50, before } = req.query;
    const userId = req.user!.id;
    const offset = (Number(page) - 1) * Number(limit);

    // Find DM by DM ID or recipient user ID
    const dm = await findDmByIdOrRecipient(userId, recipientId);

    if (!dm) {
      res.status(404).json({ error: 'DM conversation not found' });
      return;
    }

    const whereClause: any = { dmId: dm.id, isDeleted: false };
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
      messages: formattedMessages.reverse(),
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        hasMore: offset + messages.length < count,
      },
    });
  } catch (error) {
    console.error('Get DM messages error:', error);
    res.status(500).json({ error: 'Failed to fetch DM messages' });
  }
};

// POST /api/dms/:recipientId/archive
export const archiveDm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const userId = req.user!.id;

    const dm = await findDmByIdOrRecipient(userId, recipientId);
    if (!dm) {
      res.status(404).json({ error: 'DM conversation not found' });
      return;
    }

    const membership = await DirectMessageMember.findOne({
      where: { dmId: dm.id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this DM' });
      return;
    }

    const newStatus = !membership.isArchived;
    await membership.update({ isArchived: newStatus });
    await membership.reload();

    res.json({
      message: newStatus ? 'DM archived successfully' : 'DM unarchived successfully',
      isArchived: membership.isArchived,
    });
  } catch (error) {
    console.error('Archive DM error:', error);
    res.status(500).json({ error: 'Failed to archive DM' });
  }
};

// POST /api/dms/:recipientId/star
export const starDm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const userId = req.user!.id;

    const dm = await findDmByIdOrRecipient(userId, recipientId);
    if (!dm) {
      res.status(404).json({ error: 'DM conversation not found' });
      return;
    }

    const membership = await DirectMessageMember.findOne({
      where: { dmId: dm.id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this DM' });
      return;
    }

    const newStatus = !membership.isStarred;
    await membership.update({ isStarred: newStatus });
    await membership.reload();

    res.json({
      message: newStatus ? 'DM starred successfully' : 'DM unstarred successfully',
      isStarred: membership.isStarred,
    });
  } catch (error) {
    console.error('Star DM error:', error);
    res.status(500).json({ error: 'Failed to star DM' });
  }
};

// POST /api/dms/:recipientId/mute
export const muteDm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const userId = req.user!.id;

    const dm = await findDmByIdOrRecipient(userId, recipientId);
    if (!dm) {
      res.status(404).json({ error: 'DM conversation not found' });
      return;
    }

    const membership = await DirectMessageMember.findOne({
      where: { dmId: dm.id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this DM' });
      return;
    }

    const newStatus = !membership.isMuted;
    await membership.update({ isMuted: newStatus });
    await membership.reload();

    res.json({
      message: newStatus ? 'DM muted successfully' : 'DM unmuted successfully',
      isMuted: membership.isMuted,
    });
  } catch (error) {
    console.error('Mute DM error:', error);
    res.status(500).json({ error: 'Failed to mute DM' });
  }
};

// PATCH /api/dms/:recipientId/settings
export const updateDmSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const { isArchived, isStarred, isMuted } = req.body;
    const userId = req.user!.id;

    const dm = await findDmByIdOrRecipient(userId, recipientId);
    if (!dm) {
      res.status(404).json({ error: 'DM conversation not found' });
      return;
    }

    const membership = await DirectMessageMember.findOne({
      where: { dmId: dm.id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this DM' });
      return;
    }

    const updates: { isArchived?: boolean; isStarred?: boolean; isMuted?: boolean } = {};
    if (typeof isArchived === 'boolean') updates.isArchived = isArchived;
    if (typeof isStarred === 'boolean') updates.isStarred = isStarred;
    if (typeof isMuted === 'boolean') updates.isMuted = isMuted;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid settings provided' });
      return;
    }

    await membership.update(updates);
    await membership.reload();

    res.json({
      message: 'DM settings updated successfully',
      settings: {
        isArchived: membership.isArchived,
        isStarred: membership.isStarred,
        isMuted: membership.isMuted,
      },
    });
  } catch (error) {
    console.error('Update DM settings error:', error);
    res.status(500).json({ error: 'Failed to update DM settings' });
  }
};

// POST /api/dms/:recipientId/read - Mark DM as read
export const markDmAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const userId = req.user!.id;

    const dm = await findDmByIdOrRecipient(userId, recipientId);
    if (!dm) {
      res.status(404).json({ error: 'DM conversation not found' });
      return;
    }

    const membership = await DirectMessageMember.findOne({
      where: { dmId: dm.id, userId },
    });

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this DM' });
      return;
    }

    await membership.update({ lastReadAt: new Date() });

    res.json({
      message: 'DM marked as read',
      lastReadAt: membership.lastReadAt,
    });
  } catch (error) {
    console.error('Mark DM as read error:', error);
    res.status(500).json({ error: 'Failed to mark DM as read' });
  }
};

// DELETE /api/dms/:recipientId/messages - Clear DM messages
export const clearDmMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { recipientId } = req.params;
    const userId = req.user!.id;

    const dm = await findDmByIdOrRecipient(userId, recipientId);
    if (!dm) {
      res.status(404).json({ error: 'DM conversation not found' });
      return;
    }

    // Soft-delete messages the user sent
    await Message.update(
      { isDeleted: true, text: null, attachments: [], audio: null, poll: null },
      { where: { dmId: dm.id, senderId: userId } }
    );

    // Update lastReadAt
    await DirectMessageMember.update(
      { lastReadAt: new Date() },
      { where: { dmId: dm.id, userId } }
    );

    res.json({ message: 'Your messages in this DM have been cleared' });
  } catch (error) {
    console.error('Clear DM messages error:', error);
    res.status(500).json({ error: 'Failed to clear DM messages' });
  }
};
