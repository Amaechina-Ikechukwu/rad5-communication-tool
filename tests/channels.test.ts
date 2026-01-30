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

  describe('GET /api/channels/personal/:recipientId', () => {
    it('should create and return personal chat', async () => {
      const response = await fetch(`${baseUrl}/channels/personal/${otherUserId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.channel).toBeDefined();
      expect(data.channel.isGroup).toBe(false);
      expect(data.channel.members).toBeDefined();
      expect(data.channel.members.length).toBe(2);
      expect(typeof data.channel.unreadCount).toBe('number');
    });

    it('should return existing personal chat on second call', async () => {
      const response1 = await fetch(`${baseUrl}/channels/personal/${otherUserId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data1 = await response1.json() as any;

      const response2 = await fetch(`${baseUrl}/channels/personal/${otherUserId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data2 = await response2.json() as any;

      expect(data1.channel.id).toBe(data2.channel.id);
    });

    it('should reject creating personal chat with self', async () => {
      const response = await fetch(`${baseUrl}/channels/personal/${userId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status).toBe(400);
    });

    it('should reject for non-existent user', async () => {
      const response = await fetch(`${baseUrl}/channels/personal/00000000-0000-0000-0000-000000000000`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/channels/personal/:recipientId/messages', () => {
    it('should return personal chat messages', async () => {
      // First ensure personal chat exists
      await fetch(`${baseUrl}/channels/personal/${otherUserId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const response = await fetch(`${baseUrl}/channels/personal/${otherUserId}/messages`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.messages).toBeDefined();
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.pagination).toBeDefined();
    });

    it('should return 404 for non-existent personal chat', async () => {
      // Create a new user with no personal chat
      const signupRes = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New User No Chat',
          email: `newuser-nochat-${Date.now()}@example.com`,
          password: 'TestPass123',
        }),
      });
      const newUser = await signupRes.json() as any;

      const response = await fetch(`${baseUrl}/channels/personal/${newUser.user.id}/messages`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status).toBe(404);
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
  });

  describe('POST /api/channels/personal/:recipientId/messages', () => {
    it('should send a direct message and create chat if needed', async () => {
      const response = await fetch(`${baseUrl}/channels/personal/${otherUserId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Hello from test!',
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(201);
      expect(data.message).toBe('Direct message sent');
      expect(data.data).toBeDefined();
      expect(data.data.text).toBe('Hello from test!');
      expect(data.data.isOwn).toBe(true);
      expect(data.data.channelId).toBeDefined();
      expect(data.channel).toBeDefined();
      expect(data.channel.isGroup).toBe(false);
    });

    it('should reject sending DM to self', async () => {
      const response = await fetch(`${baseUrl}/channels/personal/${userId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Hello to myself',
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(400);
      expect(data.error).toBe('Cannot send a message to yourself');
    });

    it('should reject empty message text', async () => {
      const response = await fetch(`${baseUrl}/channels/personal/${otherUserId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: '',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject for non-existent recipient', async () => {
      const response = await fetch(`${baseUrl}/channels/personal/00000000-0000-0000-0000-000000000000/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Hello!',
        }),
      });

      expect(response.status).toBe(404);
    });

    it('should allow recipient to see the DM', async () => {
      // Send a message from authToken user to otherUser
      await fetch(`${baseUrl}/channels/personal/${otherUserId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Can you see this?',
        }),
      });

      // Check that otherUser can see the message
      const response = await fetch(`${baseUrl}/channels/personal/${userId}/messages`, {
        headers: { Authorization: `Bearer ${otherUserToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.messages).toBeDefined();
      expect(data.messages.length).toBeGreaterThan(0);
      expect(data.messages.some((m: any) => m.text === 'Can you see this?')).toBe(true);
    });
  });
});

export { channelId, authToken };
