import { Channel, ChannelMember, User } from '../models';

const GENERAL_CHANNEL_NAME = 'General';
const GENERAL_CHANNEL_DESCRIPTION = 'General discussion for all members';

const getOrCreateGeneralChannel = async (creatorUserId?: string) => {
  const existingChannel = await Channel.findOne({
    where: { name: GENERAL_CHANNEL_NAME },
  });

  if (existingChannel) {
    return existingChannel;
  }

  let resolvedCreatorId = creatorUserId;

  if (!resolvedCreatorId) {
    const firstUser = await User.findOne({
      order: [['createdAt', 'ASC']],
    });

    if (!firstUser) {
      return null;
    }

    resolvedCreatorId = firstUser.id;
  }

  return Channel.create({
    name: GENERAL_CHANNEL_NAME,
    description: GENERAL_CHANNEL_DESCRIPTION,
    isGroup: true,
    createdBy: resolvedCreatorId,
  });
};

export const ensureUserInGeneralChannel = async (
  userId: string,
  options: {
    role?: 'admin' | 'member';
    lastReadAt?: Date;
  } = {},
): Promise<Channel | null> => {
  const channel = await getOrCreateGeneralChannel(userId);

  if (!channel) {
    return null;
  }

  const defaultRole = options.role ?? (channel.createdBy === userId ? 'admin' : 'member');

  const [membership] = await ChannelMember.findOrCreate({
    where: { channelId: channel.id, userId },
    defaults: {
      channelId: channel.id,
      userId,
      role: defaultRole,
      lastReadAt: options.lastReadAt ?? new Date(),
    },
  });

  if (channel.createdBy === userId && membership.role !== 'admin') {
    await membership.update({ role: 'admin' });
  }

  return channel;
};

const syncGeneralChannelMemberships = async (channel: Channel) => {
  const users = await User.findAll({
    attributes: ['id'],
  });

  if (!users.length) {
    return { addedCount: 0, creatorPromoted: false };
  }

  const memberships = await ChannelMember.findAll({
    where: { channelId: channel.id },
    attributes: ['id', 'userId', 'role'],
  });

  const membershipByUserId = new Map(memberships.map((membership) => [membership.userId, membership]));
  const now = new Date();
  let addedCount = 0;
  let creatorPromoted = false;

  for (const user of users) {
    const existingMembership = membershipByUserId.get(user.id);

    if (!existingMembership) {
      await ChannelMember.create({
        channelId: channel.id,
        userId: user.id,
        role: channel.createdBy === user.id ? 'admin' : 'member',
        lastReadAt: now,
      });
      addedCount += 1;
      continue;
    }

    if (channel.createdBy === user.id && existingMembership.role !== 'admin') {
      await existingMembership.update({ role: 'admin' });
      creatorPromoted = true;
    }
  }

  return { addedCount, creatorPromoted };
};

/**
 * Ensures the General channel exists on server startup.
 * This channel is used for all users to communicate.
 */
export const initializeGeneralChannel = async (): Promise<void> => {
  try {
    const channel = await getOrCreateGeneralChannel();

    if (!channel) {
      console.log('No users exist yet - General channel will be created when the first user signs up');
      return;
    }

    const { addedCount, creatorPromoted } = await syncGeneralChannelMemberships(channel);

    console.log(
      `General channel ready (${addedCount} membership${addedCount === 1 ? '' : 's'} synced${creatorPromoted ? ', creator promoted to admin' : ''})`,
    );
  } catch (error) {
    console.error('Failed to initialize General channel:', error);
  }
};

