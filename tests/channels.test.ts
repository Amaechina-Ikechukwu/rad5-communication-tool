import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { waitForServer, stopTestServer, baseUrl } from './setup';

let authToken: string;
let userId: string;
let channelId: string;

beforeAll(async () => {
  await waitForServer();
  
  const signupRes = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Channel Test User',
      email: `channeltest-${Date.now()}@example.com`,
      password: 'TestPass123',
    }),
  });

  const data = await signupRes.json() as any;
  authToken = data.token;
  userId = data.user.id;
});

afterAll(async () => {
  await stopTestServer();
});

describe('Channel Endpoints', () => {
  describe('POST /api/channels', () => {
    it('should create a new channel', async () => {
      const response = await fetch(`${baseUrl}/channels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Channel',
          description: 'A test channel',
          isGroup: true,
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(201);
      expect(data.channel).toBeDefined();
      expect(data.channel.name).toBe('Test Channel');

      channelId = data.channel.id;
    });

    it('should reject channel without name', async () => {
      const response = await fetch(`${baseUrl}/channels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: 'Missing name',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/channels', () => {
    it('should return user channels', async () => {
      const response = await fetch(`${baseUrl}/channels`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.channels).toBeDefined();
      expect(Array.isArray(data.channels)).toBe(true);
      expect(data.channels.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/channels/:id', () => {
    it('should return channel details', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.id).toBe(channelId);
      expect(data.name).toBe('Test Channel');
      expect(data.members).toBeDefined();
    });

    it('should reject non-member access', async () => {
      // Create another user
      const signupRes = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Other User',
          email: `other-${Date.now()}@example.com`,
          password: 'TestPass123',
        }),
      });

      const otherUser = await signupRes.json() as any;

      const response = await fetch(`${baseUrl}/channels/${channelId}`, {
        headers: { Authorization: `Bearer ${otherUser.token}` },
      });

      expect(response.status).toBe(403);
    });
  });
});

export { channelId, authToken };
