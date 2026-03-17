import { Channel, ChannelMember, User } from '../models';

const GENERAL_CHANNEL_NAME = 'General';
const GENERAL_CHANNEL_DESCRIPTION = 'General discussion for all members';

const ensureGeneralChannelShape = async (channel: Channel, creatorUserId: string) => {
  const updates: Partial<Channel> = {};

  if (channel.description !== GENERAL_CHANNEL_DESCRIPTION) {
    (updates as any).description = GENERAL_CHANNEL_DESCRIPTION;
  }
  if (!channel.isGroup) {
    (updates as any).isGroup = true;
  }
  if (!channel.isSystem) {
    (updates as any).isSystem = true;
  }
  if (!channel.isDefault) {
    (updates as any).isDefault = true;
  }
  if (channel.membershipPolicy !== 'admin_managed') {
    (updates as any).membershipPolicy = 'admin_managed';
  }
  if (!channel.createdBy) {
    (updates as any).createdBy = creatorUserId;
  }

  if (Object.keys(updates).length > 0) {
    await channel.update(updates);
  }

  return channel;
};

const getOrCreateGeneralChannel = async (creatorUserId?: string) => {
  const existingChannel = await Channel.findOne({
    where: { name: GENERAL_CHANNEL_NAME },
  });

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

  if (existingChannel) {
    return ensureGeneralChannelShape(existingChannel, resolvedCreatorId);
  }

  return Channel.create({
    name: GENERAL_CHANNEL_NAME,
    description: GENERAL_CHANNEL_DESCRIPTION,
    isGroup: true,
    isSystem: true,
    isDefault: true,
    membershipPolicy: 'admin_managed',
    createdBy: resolvedCreatorId,
  });
};

const getDefaultChannels = async (creatorUserId?: string): Promise<Channel[]> => {
  const generalChannel = await getOrCreateGeneralChannel(creatorUserId);
  const defaultChannels = await Channel.findAll({
    where: { isDefault: true },
    order: [['name', 'ASC']],
  });

  if (!generalChannel) {
    return defaultChannels;
  }

  if (!defaultChannels.some((channel) => channel.id === generalChannel.id)) {
    return [generalChannel, ...defaultChannels];
  }

  return defaultChannels;
};

const ensureMembership = async (
  channel: Channel,
  userId: string,
  options: {
    role?: 'admin' | 'member';
    lastReadAt?: Date;
  } = {},
) => {
  const [membership] = await ChannelMember.findOrCreate({
    where: { channelId: channel.id, userId },
    defaults: {
      channelId: channel.id,
      userId,
      role: options.role ?? (channel.createdBy === userId ? 'admin' : 'member'),
      lastReadAt: options.lastReadAt ?? new Date(),
    },
  });

  if (channel.createdBy === userId && membership.role !== 'admin') {
    await membership.update({ role: 'admin' });
  }

  return membership;
};

export const isProtectedChannel = (channel: Pick<Channel, 'isSystem' | 'isDefault' | 'membershipPolicy'>): boolean =>
  channel.isSystem || channel.isDefault || channel.membershipPolicy === 'admin_managed';

export const ensureUserInDefaultChannels = async (
  userId: string,
  options: {
    role?: 'admin' | 'member';
    lastReadAt?: Date;
  } = {},
): Promise<Channel[]> => {
  const channels = await getDefaultChannels(userId);

  for (const channel of channels) {
    await ensureMembership(channel, userId, options);
  }

  return channels;
};

const syncDefaultMembershipsForChannel = async (channel: Channel) => {
  const users = await User.findAll({
    attributes: ['id'],
  });

  if (!users.length) {
    return { channelId: channel.id, addedCount: 0, creatorPromoted: false };
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

  return { channelId: channel.id, addedCount, creatorPromoted };
};

export const syncDefaultChannelMemberships = async (channelId?: string) => {
  const channels = channelId
    ? await Channel.findAll({ where: { id: channelId, isDefault: true } })
    : await getDefaultChannels();

  const results = [];
  for (const channel of channels) {
    results.push(await syncDefaultMembershipsForChannel(channel));
  }

  return results;
};

/**
 * Ensures the General channel exists on server startup and backfills memberships
 * for every default channel.
 */
export const initializeGeneralChannel = async (): Promise<void> => {
  try {
    const channel = await getOrCreateGeneralChannel();

    if (!channel) {
      console.log('No users exist yet - General channel will be created when the first managed user is added');
      return;
    }

    const syncResults = await syncDefaultChannelMemberships();
    const addedCount = syncResults.reduce((sum, result) => sum + result.addedCount, 0);
    const creatorPromoted = syncResults.some((result) => result.creatorPromoted);

    console.log(
      `Default channels ready (${syncResults.length} channel${syncResults.length === 1 ? '' : 's'}, ${addedCount} membership${addedCount === 1 ? '' : 's'} synced${creatorPromoted ? ', creator promoted to admin' : ''})`,
    );
  } catch (error) {
    console.error('Failed to initialize General channel:', error);
  }
};
