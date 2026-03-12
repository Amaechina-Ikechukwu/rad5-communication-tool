import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { io as createSocket, type Socket } from 'socket.io-client';
import { waitForServer, stopTestServer, baseUrl } from './setup';

const socketBaseUrl = 'http://localhost:3334';
const openSockets: Socket[] = [];

type PresenceWebhookPayload = {
  event: string;
  occurredAt: string;
  data: {
    userId: string;
    status: 'online' | 'offline';
    isOnline: boolean;
    lastActive: string;
    activeConnections: number;
  };
};

const pendingWebhookWaiters: Array<{
  filter: (payload: PresenceWebhookPayload) => boolean;
  resolve: (payload: PresenceWebhookPayload) => void;
  reject: (error: Error) => void;
  timeout: Timer;
}> = [];

const completeWebhookWaiters = (payload: PresenceWebhookPayload) => {
  for (let index = pendingWebhookWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = pendingWebhookWaiters[index]!;
    if (!waiter.filter(payload)) {
      continue;
    }

    clearTimeout(waiter.timeout);
    pendingWebhookWaiters.splice(index, 1);
    waiter.resolve(payload);
  }
};

const captureRequestBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
};

const signupUser = async (namePrefix: string) => {
  const response = await fetch(`${baseUrl}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${namePrefix} User`,
      email: `${namePrefix.toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      password: 'TestPass123',
    }),
  });

  expect(response.status).toBe(201);
  return response.json() as Promise<any>;
};

const connectSocket = (token: string) =>
  new Promise<Socket>((resolve, reject) => {
    const socket = createSocket(socketBaseUrl, {
      path: '/ws',
      query: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });

    const onError = (error: Error) => {
      socket.disconnect();
      reject(error);
    };

    socket.once('connect', () => {
      socket.off('connect_error', onError);
      openSockets.push(socket);
      resolve(socket);
    });

    socket.once('connect_error', onError);
  });

const waitForWebhook = (
  filter: (payload: PresenceWebhookPayload) => boolean,
  action: () => Promise<unknown> | unknown,
) =>
  new Promise<PresenceWebhookPayload>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const index = pendingWebhookWaiters.findIndex((waiter) => waiter.resolve === resolve);
      if (index >= 0) {
        pendingWebhookWaiters.splice(index, 1);
      }
      reject(new Error('Timed out waiting for webhook'));
    }, 7000);

    pendingWebhookWaiters.push({ filter, resolve, reject, timeout });

    Promise.resolve(action()).catch((error) => {
      clearTimeout(timeout);
      const index = pendingWebhookWaiters.findIndex((waiter) => waiter.resolve === resolve);
      if (index >= 0) {
        pendingWebhookWaiters.splice(index, 1);
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });

let webhookServer: ReturnType<typeof createServer> | null = null;
let webhookPort = 0;
let originalWebhookUrls = '';

beforeAll(async () => {
  originalWebhookUrls = process.env.PRESENCE_WEBHOOK_URLS || '';

  webhookServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const rawBody = await captureRequestBody(req);
    const payload = JSON.parse(rawBody) as PresenceWebhookPayload;
    completeWebhookWaiters(payload);
    res.writeHead(204);
    res.end();
  });

  await new Promise<void>((resolve) => {
    webhookServer!.listen(0, '127.0.0.1', () => {
      webhookPort = (webhookServer!.address() as any).port;
      resolve();
    });
  });

  process.env.PRESENCE_WEBHOOK_URLS = `http://127.0.0.1:${webhookPort}/presence`;
  await waitForServer();
});

afterAll(async () => {
  openSockets.forEach((socket) => {
    if (socket.connected) {
      socket.disconnect();
    }
  });

  pendingWebhookWaiters.splice(0).forEach((waiter) => {
    clearTimeout(waiter.timeout);
    waiter.reject(new Error('Test finished before webhook arrived'));
  });

  process.env.PRESENCE_WEBHOOK_URLS = originalWebhookUrls;

  if (webhookServer) {
    await new Promise<void>((resolve) => webhookServer!.close(() => resolve()));
  }

  await stopTestServer();
});

describe('Presence webhooks', () => {
  it('posts online and offline webhook events for socket presence changes', async () => {
    const user = await signupUser('presence-webhook');

    const onlineWebhook = await waitForWebhook(
      (payload) => payload.data.userId === user.user.id && payload.data.status === 'online',
      async () => {
        await connectSocket(user.token);
      },
    );

    expect(onlineWebhook.event).toBe('user.presence.updated');
    expect(onlineWebhook.data.isOnline).toBe(true);
    expect(onlineWebhook.data.activeConnections).toBe(1);

    const socket = openSockets[openSockets.length - 1]!;
    const offlineWebhook = await waitForWebhook(
      (payload) => payload.data.userId === user.user.id && payload.data.status === 'offline',
      async () => {
        socket.disconnect();
      },
    );

    expect(offlineWebhook.event).toBe('user.presence.updated');
    expect(offlineWebhook.data.isOnline).toBe(false);
    expect(offlineWebhook.data.activeConnections).toBe(0);
  });
});
