import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { io as createSocket, type Socket } from 'socket.io-client';
import { waitForServer, stopTestServer, baseUrl } from './setup';

const socketBaseUrl = 'http://localhost:3334';
const openSockets: Socket[] = [];

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

const waitForEvent = <T>(socket: Socket, eventName: string, action: () => Promise<unknown>) =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, 7000);

    const onEvent = (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    };

    socket.once(eventName, onEvent);

    action().catch((error) => {
      clearTimeout(timeout);
      socket.off(eventName, onEvent);
      reject(error);
    });
  });

beforeAll(async () => {
  await waitForServer();
});

afterAll(async () => {
  openSockets.forEach((socket) => {
    if (socket.connected) {
      socket.disconnect();
    }
  });

  await stopTestServer();
});

describe('Socket-backed creation events', () => {
  it('emits channel_created to invited members', async () => {
    const creator = await signupUser('socket-channel-creator');
    const member = await signupUser('socket-channel-member');
    const memberSocket = await connectSocket(member.token);

    const payload = await waitForEvent<{ channel: { id: string; name: string } }>(
      memberSocket,
      'channel_created',
      async () => {
        const response = await fetch(`${baseUrl}/channels`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${creator.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Socket Test Channel',
            description: 'Created for socket verification',
            memberIds: [member.user.id],
          }),
        });

        expect(response.status).toBe(201);
      },
    );

    expect(payload.channel.name).toBe('Socket Test Channel');
    expect(payload.channel.id).toBeDefined();
  });

  it('emits dm_created when a DM is created without a first message', async () => {
    const creator = await signupUser('socket-dm-creator');
    const recipient = await signupUser('socket-dm-recipient');
    const recipientSocket = await connectSocket(recipient.token);

    const payload = await waitForEvent<{ dm: { id: string; participant: { id: string } | null } }>(
      recipientSocket,
      'dm_created',
      async () => {
        const response = await fetch(`${baseUrl}/dms/${recipient.user.id}`, {
          headers: { Authorization: `Bearer ${creator.token}` },
        });

        expect(response.status).toBe(200);
      },
    );

    expect(payload.dm.id).toBeDefined();
    expect(payload.dm.participant?.id).toBe(creator.user.id);
  });

  it('emits channel unread_update to members even before they join the room', async () => {
    const creator = await signupUser('socket-message-creator');
    const member = await signupUser('socket-message-member');
    const memberSocket = await connectSocket(member.token);

    const createChannelResponse = await fetch(`${baseUrl}/channels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creator.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Unread Update Channel',
        memberIds: [member.user.id],
      }),
    });

    const channelData = await createChannelResponse.json() as any;
    expect(createChannelResponse.status).toBe(201);

    const payload = await waitForEvent<{ type: string; channelId: string; senderId: string; unreadCount: number }>(
      memberSocket,
      'unread_update',
      async () => {
        const response = await fetch(`${baseUrl}/channels/${channelData.channel.id}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${creator.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'Unread update test' }),
        });

        expect(response.status).toBe(201);
      },
    );

    expect(payload.type).toBe('channel');
    expect(payload.channelId).toBe(channelData.channel.id);
    expect(payload.senderId).toBe(creator.user.id);
    expect(payload.unreadCount).toBe(1);
  });

  it('emits dm unread_update with otherUserId and unreadCount', async () => {
    const sender = await signupUser('socket-dm-unread-sender');
    const recipient = await signupUser('socket-dm-unread-recipient');
    const recipientSocket = await connectSocket(recipient.token);

    const payload = await waitForEvent<{ type: string; dmId: string; senderId: string; otherUserId: string; unreadCount: number }>(
      recipientSocket,
      'unread_update',
      async () => {
        const response = await fetch(`${baseUrl}/dms/${recipient.user.id}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sender.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: 'Unread DM contract' }),
        });

        expect(response.status).toBe(201);
      },
    );

    expect(payload.type).toBe('dm');
    expect(payload.senderId).toBe(sender.user.id);
    expect(payload.otherUserId).toBe(sender.user.id);
    expect(payload.unreadCount).toBe(1);
    expect(payload.dmId).toBeDefined();
  });
});
