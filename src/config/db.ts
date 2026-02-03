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
      // In other environments, try alter first, fall back to sync if constraint errors occur
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
