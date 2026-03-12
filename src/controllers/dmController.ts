import type { Response } from 'express';
import { Op, fn, col, literal, where as sequelizeWhere } from 'sequelize';
import { DirectMessage, DirectMessageMember, User, Message, Reaction } from '../models';
import type { AuthRequest } from '../middleware/auth';
import { getIO } from '../socket/io';
import { uploadToCloudinary } from '../utils/cloudinary';
import {
  buildAttachmentFromUpload,
  formatMessagePayload,
  formatMediaPayload,
  normalizeAttachmentInput,
  normalizeAudioInput,
  normalizePoll,
  parseDurationSeconds,
} from '../utils/messagePayload';
import { countDmUnread, getLatestReadBoundary } from '../utils/unread';

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

const buildRealtimeDmForUser = async (dmId: string, userId: string) => {
  const membership = await DirectMessageMember.findOne({
    where: { dmId, userId },
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

  const dm = (membership as any)?.directMessage;
  if (!membership || !dm) {
    return null;
  }

  const unreadCount = await countDmUnread({
    dmId,
    userId,
    lastReadAt: membership.lastReadAt,
    clearedAt: membership.clearedAt,
  });

  const lastMessage = await Message.findOne({
    where: { dmId, isDeleted: false },
    order: [['createdAt', 'DESC']],
    include: [
      {
        model: User,
        as: 'sender',
        attributes: ['id', 'name'],
      },
    ],
  });

  const otherParticipant = dm.participants.find((participant: any) => participant.id !== userId);

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
    isArchived: membership.isArchived,
    isStarred: membership.isStarred,
    isMuted: membership.isMuted,
    unreadCount,
    createdAt: dm.createdAt,
    updatedAt: dm.updatedAt,
  };
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

        const unreadCount = await countDmUnread({
          dmId: dm.id,
          userId,
          lastReadAt: m.lastReadAt,
          clearedAt: m.clearedAt,
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
    const recipientId = String(req.params.recipientId);
    const userId = req.user!.id;

    let dm = await findDmByIdOrRecipient(userId, recipientId);
    let createdNewDm = false;
    let otherUserId: string | null = null;

    if (!dm) {
      if (recipientId === userId) {
        res.status(400).json({ error: 'Cannot create a DM with yourself' });
        return;
      }

      const recipient = await User.findByPk(recipientId);
      if (!recipient) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      otherUserId = recipientId;
      createdNewDm = true;
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

    const membership = await DirectMessageMember.findOne({
      where: { dmId: dm.id, userId },
    });

    const otherParticipant = (dmWithDetails as any)?.participants?.find((participant: any) => participant.id !== userId) || null;
    otherUserId = otherUserId || otherParticipant?.id || null;

    const unreadCount = membership
      ? await countDmUnread({
          dmId: dm.id,
          userId,
          lastReadAt: membership.lastReadAt,
          clearedAt: membership.clearedAt,
        })
      : 0;

    const responseDm = {
      id: dmWithDetails?.id,
      participant: otherParticipant,
      participants: (dmWithDetails as any)?.participants || [],
      isArchived: membership?.isArchived || false,
      isStarred: membership?.isStarred || false,
      isMuted: membership?.isMuted || false,
      unreadCount,
      createdAt: dmWithDetails?.createdAt,
      updatedAt: dmWithDetails?.updatedAt,
    };

    if (createdNewDm && otherUserId) {
      try {
        const io = getIO();
        await Promise.all(
          [userId, otherUserId].map(async (participantId) => {
            const payload = await buildRealtimeDmForUser(dm.id, participantId);
            if (payload) {
              io.to(`user:${participantId}`).emit('dm_created', {
                dm: payload,
              });
            }
          })
        );
      } catch (e) {
        console.error('Socket broadcast error (dm_created):', e);
      }
    }

    res.json({
      dm: responseDm,
    });
  } catch (error) {
    console.error('Get/create DM error:', error);
    res.status(500).json({ error: 'Failed to get/create DM' });
  }
};

// POST /api/dms/:recipientId/messages - Send a DM
export const sendDm = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const recipientId = String(req.params.recipientId);
    const { text, poll } = req.body;
    const userId = req.user!.id;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    const trimmedText = typeof text === 'string' ? text.trim() : '';
    const bodyAttachments = normalizeAttachmentInput(req.body.attachments);
    const bodyAudio = normalizeAudioInput(req.body.audio);
    const normalizedPoll = normalizePoll(poll);

    if (!trimmedText && !bodyAttachments.length && !bodyAudio && !files?.attachments?.length && !files?.audio?.length && !normalizedPoll) {
      res.status(400).json({ error: 'Message must have content' });
      return;
    }

    let dm = await findDmByIdOrRecipient(userId, recipientId as string);
    let createdNewDm = false;
    let otherUserId: string | null = null;

    if (!dm) {
      if (recipientId === userId) {
        res.status(400).json({ error: 'Cannot send a message to yourself' });
        return;
      }

      const recipient = await User.findByPk(recipientId as string);
      if (!recipient) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      otherUserId = recipientId as string;
      createdNewDm = true;
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
          userId: recipientId as string,
        }),
      ]);
    }

    const participantMemberships = await DirectMessageMember.findAll({
      where: { dmId: dm.id },
      attributes: ['userId', 'lastReadAt', 'clearedAt'],
    });
    otherUserId = otherUserId || participantMemberships.find((membership) => membership.userId !== userId)?.userId || null;

    const messageData: any = {
      dmId: dm.id,
      senderId: userId,
      text: trimmedText || null,
    };

    const attachmentUploads = files?.attachments?.length
      ? await Promise.all(
          files.attachments.map(async (file) => {
            const uploadResult = await uploadToCloudinary(
              file.buffer,
              'attachments',
              file.mimetype.startsWith('image/') ? 'image' : (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) ? 'video' : 'auto',
            );
            return buildAttachmentFromUpload(file, uploadResult);
          })
        )
      : [];

    const combinedAttachments = [...bodyAttachments, ...attachmentUploads];
    if (combinedAttachments.length) {
      messageData.attachments = combinedAttachments;
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
    } else if (bodyAudio) {
      messageData.audio = bodyAudio;
    }

    if (normalizedPoll) {
      messageData.poll = {
        options: normalizedPoll.options,
        votes: Object.fromEntries(normalizedPoll.options.map((option) => [option, []])),
      };
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

    await DirectMessageMember.update(
      { lastReadAt: new Date() },
      { where: { dmId: dm.id, userId } }
    );

    const formattedMessage = formatMessagePayload(fullMessage, userId, { dmId: dm.id });

    try {
      const io = getIO();

      if (createdNewDm && otherUserId) {
        await Promise.all(
          [userId, otherUserId].map(async (participantId) => {
            const payload = await buildRealtimeDmForUser(dm.id, participantId);
            if (payload) {
              io.to(`user:${participantId}`).emit('dm_created', {
                dm: payload,
              });
            }
          })
        );
      }

      io.to(`dm:${dm.id}`).emit('new_dm_message', {
        dmId: dm.id,
        message: { ...formattedMessage, isOwn: false },
      });

      if (otherUserId) {
        const recipientMembership = participantMemberships.find((membership) => membership.userId === otherUserId);
        const unreadCount = recipientMembership
          ? await countDmUnread({
              dmId: dm.id,
              userId: otherUserId,
              lastReadAt: recipientMembership.lastReadAt,
              clearedAt: recipientMembership.clearedAt,
            })
          : 0;

        io.to(`user:${otherUserId}`).emit('unread_update', {
          type: 'dm',
          dmId: dm.id,
          senderId: userId,
          otherUserId,
          messageId: fullMessage!.id,
          unreadCount,
        });
      }
    } catch (e) {
      console.error('Socket broadcast error (new_dm_message):', e);
    }

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
    const recipientId = String(req.params.recipientId);
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

    // Respect clearedAt - only show messages after the user cleared the chat
    const membership = await DirectMessageMember.findOne({
      where: { dmId: dm.id, userId },
    });
    if (membership?.clearedAt) {
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
    const unreadCount = membership
      ? await countDmUnread({
          dmId: dm.id,
          userId,
          lastReadAt: membership.lastReadAt,
          clearedAt: membership.clearedAt,
        })
      : 0;

    res.json({
      messages: formattedMessages.reverse(),
      unreadCount,
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
    const recipientId = String(req.params.recipientId);
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
    const recipientId = String(req.params.recipientId);
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
    const recipientId = String(req.params.recipientId);
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
    const recipientId = String(req.params.recipientId);
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
    const recipientId = String(req.params.recipientId);
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

    const otherMembership = await DirectMessageMember.findOne({
      where: { dmId: dm.id, userId: { [Op.ne]: userId } },
      attributes: ['userId'],
    });

    const now = new Date();
    const cutoff = getLatestReadBoundary(membership.lastReadAt, membership.clearedAt);
    const readWhere: any = {
      dmId: dm.id,
      isDeleted: false,
      senderId: { [Op.ne]: userId },
      status: { [Op.ne]: 'read' },
    };

    if (cutoff) {
      readWhere.createdAt = { [Op.gt]: cutoff };
    }

    const unreadMessages = await Message.findAll({
      where: readWhere,
      attributes: ['id'],
    });

    if (unreadMessages.length > 0) {
      await Message.update(
        { status: 'read', deliveredAt: now, readAt: now },
        { where: { id: { [Op.in]: unreadMessages.map((message) => message.id) } } }
      );
    }

    await membership.update({ lastReadAt: now });

    try {
      const io = getIO();
      io.to(`user:${userId}`).emit('unread_update', {
        type: 'dm',
        dmId: dm.id,
        otherUserId: otherMembership?.userId || null,
        unreadCount: 0,
      });

      if (otherMembership?.userId) {
        unreadMessages.forEach((message) => {
          io.to(`user:${otherMembership.userId}`).emit('dm_message_status_update', {
            messageId: message.id,
            dmId: dm.id,
            status: 'read',
            deliveredAt: now,
            readAt: now,
          });
        });
      }
    } catch (e) {
      console.error('Socket broadcast error (dm read):', e);
    }

    res.json({
      message: 'DM marked as read',
      lastReadAt: membership.lastReadAt,
      unreadCount: 0,
    });
  } catch (error) {
    console.error('Mark DM as read error:', error);
    res.status(500).json({ error: 'Failed to mark DM as read' });
  }
};

// DELETE /api/dms/:recipientId/messages - Clear DM messages
export const clearDmMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const recipientId = String(req.params.recipientId);
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

    // Set clearedAt to now — messages before this timestamp won't be shown to this user
    // The other person's view is unaffected
    await membership.update({ clearedAt: new Date(), lastReadAt: new Date() });

    res.json({ message: 'Chat cleared successfully' });
  } catch (error) {
    console.error('Clear DM messages error:', error);
    res.status(500).json({ error: 'Failed to clear messages' });
  }
};

// GET /api/dms/:recipientId/media - Get DM media
export const getDMMedia = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const recipientId = String(req.params.recipientId);
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user!.id;
    const offset = (Number(page) - 1) * Number(limit);

    // Find DM by DM ID or recipient user ID
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

    const whereClause: any = {
      dmId: dm.id,
      isDeleted: false,
      [Op.or]: [
        { audio: { [Op.not]: null } },
        literal("json_typeof(attachments) = 'array' AND json_array_length(attachments) > 0")
      ],
    };

    // Respect clearedAt - only show media after the user cleared the chat
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
    console.error('Get DM media error:', error);
    res.status(500).json({ error: 'Failed to fetch DM media' });
  }
};

