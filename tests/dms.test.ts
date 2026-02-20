import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { waitForServer, stopTestServer, baseUrl } from './setup';

let authToken: string;
let userId: string;
let otherUserToken: string;
let otherUserId: string;

beforeAll(async () => {
  await waitForServer();

  // Create primary test user
  const signupRes = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'DM Test User',
      email: `dmtest-${Date.now()}@example.com`,
      password: 'TestPass123',
    }),
  });
  const data = await signupRes.json() as any;
  authToken = data.token;
  userId = data.user.id;

  // Create secondary test user
  const otherSignupRes = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'DM Other User',
      email: `dmother-${Date.now()}@example.com`,
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

describe('Direct Messages Endpoints', () => {
  describe('GET /api/dms/:recipientId (Get or Create DM)', () => {
    it('should create and return a DM', async () => {
      const response = await fetch(`${baseUrl}/dms/${otherUserId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.dm).toBeDefined();
      expect(data.dm.id).toBeDefined();
      expect(data.dm.participant).toBeDefined();
      expect(data.dm.participant.id).toBe(otherUserId);
    });

    it('should return the same DM on second call', async () => {
      const res1 = await fetch(`${baseUrl}/dms/${otherUserId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data1 = await res1.json() as any;

      const res2 = await fetch(`${baseUrl}/dms/${otherUserId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data2 = await res2.json() as any;

      expect(data1.dm.id).toBe(data2.dm.id);
    });

    it('should reject DM with non-existent user', async () => {
      const response = await fetch(`${baseUrl}/dms/00000000-0000-0000-0000-000000000000`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/dms/:recipientId/messages (Send DM)', () => {
    it('should send a direct message', async () => {
      const response = await fetch(`${baseUrl}/dms/${otherUserId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Hello from DM test!' }),
      });
      const data = await response.json() as any;

      expect(response.status).toBe(201);
      expect(data.message).toBe('Direct message sent');
      expect(data.data).toBeDefined();
      expect(data.data.text).toBe('Hello from DM test!');
      expect(data.dm).toBeDefined();
      expect(data.dm.id).toBeDefined();
    });

    it('should reject empty message text', async () => {
      const response = await fetch(`${baseUrl}/dms/${otherUserId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: '' }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject for non-existent recipient', async () => {
      const response = await fetch(`${baseUrl}/dms/00000000-0000-0000-0000-000000000000/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Hello!' }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/dms/:recipientId/messages (Get DM Messages)', () => {
    it('should return DM messages', async () => {
      // Send a message first
      await fetch(`${baseUrl}/dms/${otherUserId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Message for retrieval test' }),
      });

      const response = await fetch(`${baseUrl}/dms/${otherUserId}/messages`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.messages).toBeDefined();
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.messages.length).toBeGreaterThan(0);
      expect(data.pagination).toBeDefined();
    });

    it('should allow recipient to see the DM', async () => {
      // Send a message from authToken user to otherUser
      await fetch(`${baseUrl}/dms/${otherUserId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Can you see this DM?' }),
      });

      // Now read as the other user
      const response = await fetch(`${baseUrl}/dms/${userId}/messages`, {
        headers: { Authorization: `Bearer ${otherUserToken}` },
      });
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.messages).toBeDefined();
      expect(data.messages.some((m: any) => m.text === 'Can you see this DM?')).toBe(true);
    });
  });

  describe('GET /api/dms (List DMs)', () => {
    it('should return user DM conversations', async () => {
      const response = await fetch(`${baseUrl}/dms`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.dms).toBeDefined();
      expect(Array.isArray(data.dms)).toBe(true);
      expect(data.dms.length).toBeGreaterThan(0);
    });

    it('should include participant info in DM list', async () => {
      const response = await fetch(`${baseUrl}/dms`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json() as any;
      const dm = data.dms[0];

      expect(dm.participant).toBeDefined();
      expect(dm.participant.id).toBeDefined();
      expect(dm.participant.name).toBeDefined();
    });
  });

  describe('DM Settings', () => {
    describe('POST /api/dms/:recipientId/archive', () => {
      it('should toggle archive status', async () => {
        const response = await fetch(`${baseUrl}/dms/${otherUserId}/archive`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json() as any;

        expect(response.status).toBe(200);
        expect(data.isArchived).toBe(true);
      });

      it('should unarchive when toggled again', async () => {
        const response = await fetch(`${baseUrl}/dms/${otherUserId}/archive`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json() as any;

        expect(response.status).toBe(200);
        expect(data.isArchived).toBe(false);
      });
    });

    describe('POST /api/dms/:recipientId/star', () => {
      it('should toggle star status', async () => {
        const response = await fetch(`${baseUrl}/dms/${otherUserId}/star`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json() as any;

        expect(response.status).toBe(200);
        expect(data.isStarred).toBe(true);
      });

      it('should unstar when toggled again', async () => {
        const response = await fetch(`${baseUrl}/dms/${otherUserId}/star`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json() as any;

        expect(response.status).toBe(200);
        expect(data.isStarred).toBe(false);
      });
    });

    describe('POST /api/dms/:recipientId/mute', () => {
      it('should toggle mute status', async () => {
        const response = await fetch(`${baseUrl}/dms/${otherUserId}/mute`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json() as any;

        expect(response.status).toBe(200);
        expect(data.isMuted).toBe(true);
      });

      it('should unmute when toggled again', async () => {
        const response = await fetch(`${baseUrl}/dms/${otherUserId}/mute`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json() as any;

        expect(response.status).toBe(200);
        expect(data.isMuted).toBe(false);
      });
    });

    describe('POST /api/dms/:recipientId/read', () => {
      it('should mark DM as read', async () => {
        const response = await fetch(`${baseUrl}/dms/${otherUserId}/read`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json() as any;

        expect(response.status).toBe(200);
        expect(data.message).toBe('DM marked as read');
        expect(data.lastReadAt).toBeDefined();
      });
    });

    describe('PATCH /api/dms/:recipientId/settings', () => {
      it('should update multiple DM settings at once', async () => {
        const response = await fetch(`${baseUrl}/dms/${otherUserId}/settings`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            isArchived: true,
            isStarred: true,
            isMuted: true,
          }),
        });
        const data = await response.json() as any;

        expect(response.status).toBe(200);
        expect(data.settings).toBeDefined();
        expect(data.settings.isArchived).toBe(true);
        expect(data.settings.isStarred).toBe(true);
        expect(data.settings.isMuted).toBe(true);
      });

      it('should reject when no valid settings provided', async () => {
        const response = await fetch(`${baseUrl}/dms/${otherUserId}/settings`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        expect(response.status).toBe(400);
      });
    });
  });

  describe('DELETE /api/dms/:recipientId/messages (Clear DM)', () => {
    it('should clear DM messages', async () => {
      // First ensure a DM with messages exists
      await fetch(`${baseUrl}/dms/${otherUserId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Message to be cleared' }),
      });

      const response = await fetch(`${baseUrl}/dms/${otherUserId}/messages`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.message).toBeDefined();
    });
  });
});
