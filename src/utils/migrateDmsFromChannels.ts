/**
 * Migration Script: Migrate DMs from Channels to DirectMessages
 * 
 * This script converts existing Channel records where isGroup=false
 * into DirectMessage and DirectMessageMember records. It also updates
 * all messages that belonged to those channels to reference the new DM.
 * 
 * This should be run once during deployment. It can be safely re-run
 * (idempotent) — it skips channels already migrated.
 */
import { Channel, ChannelMember, Message } from '../models';
import DirectMessage from '../models/DirectMessage';
import DirectMessageMember from '../models/DirectMessageMember';

export const migrateDmsFromChannels = async (): Promise<void> => {
  console.log('[Migration] Starting DM migration from channels...');

  try {
    // Find all non-group channels (DMs stored as channels)
    const dmChannels = await Channel.findAll({
      where: { isGroup: false },
      include: [
        {
          model: require('../models').User,
          as: 'members',
          attributes: ['id'],
          through: { attributes: ['isArchived', 'isStarred', 'isMuted', 'lastReadAt'] },
        },
      ],
    });

    if (dmChannels.length === 0) {
      console.log('[Migration] No DM channels to migrate.');
      return;
    }

    console.log(`[Migration] Found ${dmChannels.length} DM channel(s) to migrate.`);

    let migrated = 0;
    let skipped = 0;

    for (const channel of dmChannels) {
      const members = (channel as any).members || [];

      if (members.length < 2) {
        console.log(`[Migration] Skipping channel ${channel.id} — only ${members.length} member(s).`);
        skipped++;
        continue;
      }

      // Check if DM already exists between these two users
      const userIds = members.map((m: any) => m.id);
      
      // Check if we already migrated this (look for a DM with the same two users)
      const existingDmMembers = await DirectMessageMember.findAll({
        where: { userId: userIds[0] },
        attributes: ['dmId'],
      });

      let alreadyMigrated = false;
      for (const existingMem of existingDmMembers) {
        const otherMember = await DirectMessageMember.findOne({
          where: { dmId: existingMem.dmId, userId: userIds[1] },
        });
        if (otherMember) {
          alreadyMigrated = true;
          break;
        }
      }

      if (alreadyMigrated) {
        console.log(`[Migration] Skipping channel ${channel.id} — already migrated.`);
        skipped++;
        continue;
      }

      // Create new DirectMessage
      const dm = await DirectMessage.create({
        createdBy: channel.createdBy,
      });

      // Create DirectMessageMember records, preserving settings
      for (const member of members) {
        const memberSettings = (member as any).ChannelMember || {};
        await DirectMessageMember.create({
          dmId: dm.id,
          userId: member.id,
          isArchived: memberSettings.isArchived || false,
          isStarred: memberSettings.isStarred || false,
          isMuted: memberSettings.isMuted || false,
          lastReadAt: memberSettings.lastReadAt || null,
        });
      }

      // Update messages to reference the new DM instead of the channel
      const [updatedCount] = await Message.update(
        { dmId: dm.id, channelId: null },
        { where: { channelId: channel.id } }
      );

      console.log(`[Migration] Migrated channel ${channel.id} -> DM ${dm.id} (${updatedCount} messages)`);
      migrated++;
    }

    console.log(`[Migration] DM migration complete. Migrated: ${migrated}, Skipped: ${skipped}`);
  } catch (error) {
    console.error('[Migration] DM migration failed:', error);
    // Don't throw — migration failure shouldn't prevent server startup
  }
};
