import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { waitForServer, stopTestServer, baseUrl } from './setup';

let authToken: string;
let channelId: string;
let messageId: string;

beforeAll(async () => {
  await waitForServer();
  
  // Create user
  const signupRes = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Message Test User',
      email: `messagetest-${Date.now()}@example.com`,
      password: 'TestPass123',
    }),
  });

  const userData = await signupRes.json() as any;
  authToken = userData.token;

  // Create channel
  const channelRes = await fetch(`${baseUrl}/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Message Test Channel',
      isGroup: true,
    }),
  });

  const channelData = await channelRes.json() as any;
  channelId = channelData.channel.id;
});

afterAll(async () => {
  await stopTestServer();
});

describe('Message Endpoints', () => {
  describe('POST /api/channels/:channelId/messages', () => {
    it('should send a text message', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Hello, World!',
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(201);
      expect(data.data).toBeDefined();
      expect(data.data.text).toBe('Hello, World!');
      expect(data.data.isOwn).toBe(true);

      messageId = data.data.id;
    });

    it('should reject empty message', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/channels/:channelId/messages', () => {
    it('should get channel messages', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/messages`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.messages).toBeDefined();
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.pagination).toBeDefined();
    });
  });

  describe('PUT /api/messages/:id', () => {
    it('should edit message within 20 min window', async () => {
      const response = await fetch(`${baseUrl}/messages/${messageId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Edited message',
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.data.text).toBe('Edited message');
      expect(data.data.isEdited).toBe(true);
    });
  });

  describe('POST /api/messages/:id/reactions', () => {
    it('should add reaction to message', async () => {
      const response = await fetch(`${baseUrl}/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emoji: '👍',
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.action).toBe('added');
    });

    it('should toggle (remove) reaction', async () => {
      const response = await fetch(`${baseUrl}/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emoji: '👍',
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.action).toBe('removed');
    });
  });

  describe('DELETE /api/messages/:id', () => {
    it('should delete message within 20 min window', async () => {
      // First create a new message to delete
      const createRes = await fetch(`${baseUrl}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Message to delete',
        }),
      });

      const createData = await createRes.json() as any;
      const deleteMessageId = createData.data.id;

      const response = await fetch(`${baseUrl}/messages/${deleteMessageId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status).toBe(200);
    });
  });
});
