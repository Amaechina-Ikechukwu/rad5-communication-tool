import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { waitForServer, stopTestServer, baseUrl } from './setup';

interface TestUser {
  token?: string;
  id?: string;
  email: string;
  password: string;
  name: string;
}

const testUser: TestUser = {
  name: 'Test User',
  email: `test-${Date.now()}@example.com`,
  password: 'TestPass123',
};

let authToken: string;
let userId: string;

beforeAll(async () => {
  await waitForServer();
});

afterAll(async () => {
  await stopTestServer();
});

describe('Auth Endpoints', () => {
  describe('POST /api/auth/signup', () => {
    it('should create a new user', async () => {
      const response = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testUser),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(201);
      expect(data.user).toBeDefined();
      expect(data.token).toBeDefined();
      expect(data.user.email).toBe(testUser.email.toLowerCase());

      authToken = data.token;
      userId = data.user.id;

      /*
      // Verify user is added to General channel
      const channelsRes = await fetch(`${baseUrl}/channels`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const channelsData = await channelsRes.json() as any;
      
      expect(channelsRes.status).toBe(200);
      expect(channelsData.channels).toBeDefined();
      const generalChannel = channelsData.channels.find((c: any) => c.name === 'General');
      expect(generalChannel).toBeDefined();
      expect(generalChannel.isGroup).toBe(true);
      */
    });

    it('should reject duplicate email', async () => {
      const response = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testUser),
      });

      expect(response.status).toBe(409);
    });

    it('should reject weak password', async () => {
      const response = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Weak User',
          email: `weak-${Date.now()}@example.com`,
          password: 'weak',
        }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject invalid email', async () => {
      const response = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Invalid Email',
          email: 'not-an-email',
          password: 'ValidPass123',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testUser.email,
          password: testUser.password,
        }),
      });

      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.token).toBeDefined();
      expect(data.user.email).toBe(testUser.email.toLowerCase());

      authToken = data.token;
    });

    it('should reject invalid password', async () => {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testUser.email,
          password: 'WrongPassword123',
        }),
      });

      expect(response.status).toBe(401);
    });

    it('should reject non-existent user', async () => {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'SomePass123',
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should accept valid email', async () => {
      const response = await fetch(`${baseUrl}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testUser.email }),
      });

      expect(response.status).toBe(200);
    });

    it('should accept non-existent email (security)', async () => {
      const response = await fetch(`${baseUrl}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@example.com' }),
      });

      expect(response.status).toBe(200);
    });
  });
});

export { authToken, userId, testUser };
