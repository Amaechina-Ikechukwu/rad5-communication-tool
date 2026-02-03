import sequelize from '../config/db.js';
import '../models/index.js'; // Import all models to register them

async function pushDatabase() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    console.log('🔄 Syncing database schema...');
    await sequelize.sync({ alter: true });
    console.log('✅ Database schema synchronized successfully');

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Database push failed:', error);
    process.exit(1);
  }
}

pushDatabase();
