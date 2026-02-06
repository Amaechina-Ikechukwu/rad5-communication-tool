import { Channel, User } from '../models';

/**
 * Ensures the General channel exists on server startup.
 * This channel is used for all users to communicate.
 */
export const initializeGeneralChannel = async (): Promise<void> => {
  try {
    // Check if General channel already exists
    const existingChannel = await Channel.findOne({
      where: { name: 'General' },
    });

    if (existingChannel) {
      console.log('✅ General channel already exists');
      return;
    }

    // Find the first user to use as creator (system user concept)
    const firstUser = await User.findOne({
      order: [['createdAt', 'ASC']],
    });

    if (!firstUser) {
      console.log('⚠️ No users exist yet - General channel will be created when first user signs up');
      return;
    }

    // Create General channel with the first user as creator
    await Channel.create({
      name: 'General',
      description: 'General discussion for all members',
      isGroup: true,
      createdBy: firstUser.id,
    });

    console.log('✅ General channel created');
  } catch (error) {
    console.error('❌ Failed to initialize General channel:', error);
  }
};
