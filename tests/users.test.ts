import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { waitForServer, stopTestServer, baseUrl } from './setup';

let authToken: string;
let userId: string;

beforeAll(async () => {
  await waitForServer();
  
  // Create a test user
  const signupRes = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'User Test User',
      email: `usertest-${Date.now()}@example.com`,
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

describe('User Endpoints', () => {
  describe('GET /api/users', () => {
    it('should return users list', async () => {
      const response = await fetch(`${baseUrl}/users`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.users).toBeDefined();
      expect(Array.isArray(data.users)).toBe(true);
      expect(data.pagination).toBeDefined();
    });

    it('should reject unauthenticated request', async () => {
      const response = await fetch(`${baseUrl}/users`);
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/users/me', () => {
    it('should return current user', async () => {
      const response = await fetch(`${baseUrl}/users/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.user).toBeDefined();
      expect(data.user.id).toBe(userId);
    });
  });

  describe('GET /api/users/:id', () => {
    it('should return user by ID', async () => {
      const response = await fetch(`${baseUrl}/users/${userId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.user).toBeDefined();
      expect(data.user.id).toBe(userId);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await fetch(`${baseUrl}/users/00000000-0000-0000-0000-000000000000`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/users/profile', () => {
    it('should update user profile', async () => {
      const response = await fetch(`${baseUrl}/users/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated Name',
          bio: 'This is my bio',
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.user.name).toBe('Updated Name');
      expect(data.user.bio).toBe('This is my bio');
    });
  });

  describe('PUT /api/users/privacy', () => {
    it('should update privacy settings', async () => {
      const response = await fetch(`${baseUrl}/users/privacy`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lastSeen: 'contacts',
          profileVisibility: 'contacts',
          readReceipts: false,
          typingIndicators: false,
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.user.lastSeen).toBe('contacts');
      expect(data.user.readReceipts).toBe(false);
    });
  });

  describe('PUT /api/users/notifications', () => {
    it('should update notification settings', async () => {
      const response = await fetch(`${baseUrl}/users/notifications`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: false,
          groups: true,
          sounds: false,
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.notificationSettings.messages).toBe(false);
      expect(data.notificationSettings.sounds).toBe(false);
    });
  });
});
