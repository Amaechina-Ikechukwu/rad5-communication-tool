import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import swaggerUi from 'swagger-ui-express';
import { connectDB } from './config/db';
import { initializeSocket } from './socket';
import { setIO } from './socket/io';
import { initializeGeneralChannel } from './utils/initializeGeneralChannel';
import { migrateDmsFromChannels } from './utils/migrateDmsFromChannels';

// Import routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import channelRoutes from './routes/channels';
import dmRoutes from './routes/dms';
import messageRoutes from './routes/messages';

// Import Swagger documentation
import swaggerDocument from '../swagger.json';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const PORT = parseInt(process.env.PORT || '8080', 10);
app.set("trust proxy", 1);

// Build allowed origins from env + localhost fallbacks
const ALLOWED_ORIGINS: string[] = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  ...(process.env.ALLOWED ? process.env.ALLOWED.split(',').map(o => o.trim()) : []),
];

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug Logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/dms', dmRoutes);
app.use('/api', messageRoutes); // Messages are under /api/channels/:id/messages and /api/messages/:id

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'RAD5 Communication Tool API',
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  
  if (err.name === 'MulterError' || (err.message && err.message.includes('not allowed'))) {
    res.status(400).json({ error: err.message });
    return;
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize WebSocket
const io = initializeSocket(server);
setIO(io);

// Start server function (exported for tests)
const startServer = async (): Promise<void> => {
  await connectDB();
  await initializeGeneralChannel(); // Ensure General channel exists on startup
  await migrateDmsFromChannels(); // Migrate existing DMs from channels (one-time, idempotent)
  return new Promise((resolve) => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on 0.0.0.0:${PORT}`);
      console.log(`📡 WebSocket available at /ws`);
      console.log(`📋 API available at /api`);
      resolve();
    });
  });
};

// Stop server function (exported for tests)
const stopServer = (): Promise<void> => {
  return new Promise((resolve) => {
    server.close(() => {
      console.log('Server stopped');
      resolve();
    });
  });
};

// Only start if running directly (not imported for tests)
if (process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { app, io, server, startServer, stopServer };
