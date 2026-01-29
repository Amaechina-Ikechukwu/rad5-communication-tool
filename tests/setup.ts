import { beforeAll, afterAll } from 'bun:test';
import { resolve } from 'path';

// Set test environment first
process.env.NODE_ENV = 'test';
// Use a different port for tests to avoid conflicts
process.env.PORT = '3333';

// Manually load .env since dotenv may not find it properly in tests
const envPath = resolve(__dirname, '../.env');
const envFile = Bun.file(envPath);

// Load env file
const loadEnv = async () => {
  try {
    const content = await envFile.text();
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');
        if (key && value !== undefined) {
          // Don't override PORT - we set it above
          if (key.trim() !== 'PORT') {
            process.env[key.trim()] = value.trim();
          }
        }
      }
    }
    console.log('✅ Loaded environment variables from .env');
  } catch (error) {
    console.error('Failed to load .env:', error);
  }
};

let serverReady = false;
let serverInstance: any = null;

export const waitForServer = async () => {
  if (serverReady) return;
  
  // Load env first
  await loadEnv();
  
  // Now import the server (after env is loaded)
  const { startServer, server } = await import('../src/index');
  serverInstance = server;
  
  try {
    await startServer();
    serverReady = true;
    console.log('✅ Test server started on port 3333');
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    throw error;
  }
};

export const stopTestServer = async () => {
  if (serverInstance) {
    await new Promise<void>((resolve) => {
      serverInstance.close(() => {
        console.log('✅ Test server stopped');
        resolve();
      });
    });
    serverReady = false;
  }
};

export const baseUrl = 'http://localhost:3333/api';
