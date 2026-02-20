import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { waitForServer, stopTestServer, baseUrl } from './setup';

let authToken: string;
let userId: string;
let channelId: string;
let otherUserToken: string;
let otherUserId: string;

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

  // Create another user for personal chat tests
  const otherSignupRes = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Other Test User',
      email: `othertest-${Date.now()}@example.com`,
      password: 'TestPass123',
    }),
  });

  const otherData = await otherSignupRes.json() as any;
  otherUserToken = otherData.token;
  otherUserId = otherData.user.id;
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

  describe('POST /api/channels/:id/archive', () => {
    it('should toggle archive status', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.isArchived).toBe(true);
      expect(data.message).toBe('Channel archived successfully');
    });

    it('should unarchive when toggled again', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.isArchived).toBe(false);
      expect(data.message).toBe('Channel unarchived successfully');
    });

    it('should reject non-member', async () => {
      // Create a new user not in the channel
      const signupRes = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Non Member',
          email: `nonmember-${Date.now()}@example.com`,
          password: 'TestPass123',
        }),
      });
      const nonMember = await signupRes.json() as any;

      const response = await fetch(`${baseUrl}/channels/${channelId}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonMember.token}` },
      });

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/channels/:id/star', () => {
    it('should toggle star status', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/star`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.isStarred).toBe(true);
      expect(data.message).toBe('Channel starred successfully');
    });

    it('should unstar when toggled again', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/star`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.isStarred).toBe(false);
      expect(data.message).toBe('Channel unstarred successfully');
    });
  });

  describe('POST /api/channels/:id/mute', () => {
    it('should toggle mute status', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/mute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.isMuted).toBe(true);
      expect(data.message).toBe('Channel muted successfully');
    });

    it('should unmute when toggled again', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/mute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.isMuted).toBe(false);
      expect(data.message).toBe('Channel unmuted successfully');
    });
  });

  describe('POST /api/channels/:id/read', () => {
    it('should mark channel as read', async () => {
      const response = await fetch(`${baseUrl}/channels/${channelId}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.message).toBe('Channel marked as read');
      expect(data.lastReadAt).toBeDefined();
    });
  });

  describe('GET /api/channels - with channel settings', () => {
    it('should return channels with isArchived, isStarred, isMuted, unreadCount', async () => {
      const response = await fetch(`${baseUrl}/channels`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.channels).toBeDefined();
      expect(data.channels.length).toBeGreaterThan(0);

      const channel = data.channels[0];
      expect(typeof channel.isArchived).toBe('boolean');
      expect(typeof channel.isStarred).toBe('boolean');
      expect(typeof channel.isMuted).toBe('boolean');
      expect(typeof channel.unreadCount).toBe('number');
    });

    it('should only return group channels (no DMs)', async () => {
      const response = await fetch(`${baseUrl}/channels`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      // Every channel returned should be a group channel
      for (const channel of data.channels) {
        expect(channel.isGroup).toBe(true);
      }
    });
  });
});

export { channelId, authToken };
