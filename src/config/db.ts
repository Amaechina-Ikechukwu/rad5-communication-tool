import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Database connection using connection string
const sequelize = new Sequelize(
  process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/rad5_comms',
  {
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
  }
);

// Run explicit migrations for schema changes that sync({ alter }) may not handle
const migrateMessagesTable = async (): Promise<void> => {
  try {
    // Make channelId nullable (was NOT NULL before DM refactoring)
    await sequelize.query(`
      ALTER TABLE messages ALTER COLUMN "channelId" DROP NOT NULL;
    `).catch(() => { /* Column may already be nullable */ });

    // Add dmId column if it doesn't exist
    await sequelize.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS "dmId" UUID;
    `).catch(() => { /* Column may already exist */ });

    console.log('✅ Messages table migration complete');
  } catch (error) {
    console.log('⚠️ Messages table migration skipped (table may not exist yet)');
  }
};

export const connectDB = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL connected successfully');
    
    // Sync all models - use force in test env, alter otherwise
    // Using force: true in test to avoid constraint issues with alter
    const isTest = process.env.NODE_ENV === 'test';
    
    if (isTest) {
      // In test environment, drop and recreate tables
      await sequelize.sync({ force: true });
    } else {
      // Run explicit migrations for critical schema changes first
      await migrateMessagesTable();
      
      // Then sync all models
      try {
        await sequelize.sync({ alter: true });
      } catch (alterError: any) {
        if (alterError.name === 'SequelizeUnknownConstraintError' || alterError.code === '42704') {
          console.log('⚠️ Constraint error during alter, syncing without alter...');
          await sequelize.sync();
        } else {
          throw alterError;
        }
      }
    }
    console.log('✅ Database synchronized');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
};

export default sequelize;
