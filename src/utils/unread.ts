import { Op } from 'sequelize';
import { Message } from '../models';

export const getLatestReadBoundary = (...dates: Array<Date | null | undefined>): Date | null => {
  const timestamps = dates
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());

  if (!timestamps.length) {
    return null;
  }

  return new Date(Math.max(...timestamps));
};

export const buildUnreadWhere = (input: {
  channelId?: string;
  dmId?: string;
  userId: string;
  lastReadAt?: Date | null;
  clearedAt?: Date | null;
}) => {
  const cutoff = getLatestReadBoundary(input.lastReadAt, input.clearedAt);

  return {
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.dmId ? { dmId: input.dmId } : {}),
    isDeleted: false,
    senderId: { [Op.ne]: input.userId },
    ...(cutoff ? { createdAt: { [Op.gt]: cutoff } } : {}),
  };
};

export const countChannelUnread = async (input: {
  channelId: string;
  userId: string;
  lastReadAt?: Date | null;
  clearedAt?: Date | null;
}): Promise<number> => {
  return Message.count({
    where: buildUnreadWhere(input),
  });
};

export const countDmUnread = async (input: {
  dmId: string;
  userId: string;
  lastReadAt?: Date | null;
  clearedAt?: Date | null;
}): Promise<number> => {
  return Message.count({
    where: buildUnreadWhere(input),
  });
};
