import { Sequelize } from 'sequelize';
import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import dotenv from 'dotenv';

dotenv.config();

// Check if running in Cloud Run with Cloud SQL connection name
const cloudSqlConnectionName = process.env.CLOUD_SQL_CONNECTION_NAME;

// Initialize sequelize synchronously for local, async for Cloud SQL
let sequelize: Sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'rad5_comms',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  dialectOptions: {
    ssl: process.env.DB_SSL === 'true' ? {
      require: true,
      rejectUnauthorized: false,
    } : false,
  },
});

const initCloudSqlSequelize = async (): Promise<Sequelize> => {
  console.log('🔄 Using Cloud SQL Connector...');
  const connector = new Connector();
  const clientOpts = await connector.getOptions({
    instanceConnectionName: cloudSqlConnectionName!,
    ipType: IpAddressTypes.PUBLIC,
  });

  return new Sequelize({
    dialect: 'postgres',
    database: process.env.DB_NAME || 'rad5_comms',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    dialectOptions: clientOpts,
  });
};

export const connectDB = async (): Promise<void> => {
  try {
    // Use Cloud SQL Connector if connection name is provided
    if (cloudSqlConnectionName) {
      sequelize = await initCloudSqlSequelize();
    }
    
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
