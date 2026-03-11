import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';

const PORT = 3000;
const URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';

async function testConnection() {
  console.log(`\nDiagnostic Start: Checking local server at ${URL}...\n`);

  try {
    const res = await fetch(`${URL}/health`);
    if (res.ok) {
      console.log(`HTTP Health Check PASSED: status ${res.status}`);
      const data = await res.json();
      console.log('   Response:', data);
    } else {
      console.error(`HTTP Health Check FAILED: status ${res.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('HTTP Connection ERROR:', message);
    console.log('   Is the server running? Check terminal.');
    process.exit(1);
  }

  const token = jwt.sign(
    { id: 'test-user-id', email: 'test@example.com' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  console.log(`\nGenerated Test Token: ${token.substring(0, 20)}...`);

  console.log(`\nConnecting to WebSocket at ${URL}/ws ...`);
  
  const socket = io(URL, {
    path: '/ws',
    query: { token },
    transports: ['websocket', 'polling'],
    reconnection: false,
    timeout: 5000,
  });

  socket.on('connect', () => {
    console.log(`WebSocket Connection PASSED! Socket ID: ${socket.id}`);
    socket.emit('disconnect');
    process.exit(0);
  });

  socket.on('connect_error', (err) => {
    console.error('WebSocket Connection FAILED:', err.message);
    
    if (err.message.includes('xhr poll error')) {
      console.log("   Hint: This often means the path '/ws' is wrong or the server isn't handling the upgrade.");
    }
    console.log('   Full Error:', err);
    process.exit(1);
  });
  
  socket.on('disconnect', (reason) => {
    console.log('Socket Disconnected:', reason);
  });
}

testConnection();
