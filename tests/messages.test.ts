import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { waitForServer, stopTestServer, baseUrl } from './setup';
import { Message } from '../src/models';

let authToken: string;
let userId: string;
let channelId: string;
let messageId: string;

beforeAll(async () => {
  await waitForServer();
  
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
  userId = userData.user.id;

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

  describe('POST /api/channels/:channelId/messages - multipart media', () => {
    it('should send channel media, files, audio, and polls in one request', async () => {
      const formData = new FormData();
      formData.set('text', 'Multipart channel payload');
      formData.set('poll', JSON.stringify({ options: ['Ship it', 'Hold'] }));
      formData.set('audioDuration', '12');
      formData.append('attachments', new Blob(['image-bytes'], { type: 'image/png' }), 'photo.png');
      formData.append('attachments', new Blob(['file-bytes'], { type: 'application/pdf' }), 'brief.pdf');
      formData.append('audio', new Blob(['audio-bytes'], { type: 'audio/webm' }), 'note.webm');

      const response = await fetch(`${baseUrl}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      const data = await response.json() as any;

      expect(response.status).toBe(201);
      expect(data.data.attachments).toHaveLength(2);
      expect(data.data.attachments.some((attachment: any) => attachment.type === 'image')).toBe(true);
      expect(data.data.attachments.some((attachment: any) => attachment.type === 'file')).toBe(true);
      expect(data.data.audio.type).toBe('audio');
      expect(data.data.audio.duration).toBe(12);
      expect(data.data.poll.options).toEqual(['Ship it', 'Hold']);
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

    it('should return rich attachment metadata in message and media payloads', async () => {
      const seededMessage = await Message.create({
        channelId,
        senderId: userId,
        text: 'Attachment metadata seed',
        attachments: [
          {
            name: 'photo.jpg',
            url: 'https://example.com/photo.jpg',
            type: 'image',
            mimeType: 'image/jpeg',
            size: 2048,
            duration: null,
            thumbnailUrl: 'https://example.com/photo.jpg',
          },
          {
            name: 'spec.pdf',
            url: 'https://example.com/spec.pdf',
            type: 'file',
            mimeType: 'application/pdf',
            size: 4096,
            duration: null,
            thumbnailUrl: null,
          },
        ],
        audio: {
          name: 'note.webm',
          url: 'https://example.com/note.webm',
          type: 'audio',
          mimeType: 'audio/webm',
          size: 1024,
          duration: 14,
          thumbnailUrl: null,
        },
      } as any);

      const messagesResponse = await fetch(`${baseUrl}/channels/${channelId}/messages`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const messagesData = await messagesResponse.json() as any;
      const targetMessage = messagesData.messages.find((item: any) => item.id === seededMessage.id);

      expect(messagesResponse.status).toBe(200);
      expect(targetMessage.attachments[0].mimeType).toBe('image/jpeg');
      expect(targetMessage.attachments[1].type).toBe('file');
      expect(targetMessage.audio.duration).toBe(14);
      expect(targetMessage.hasImage).toBe(true);
      expect(targetMessage.hasAudio).toBe(true);

      const mediaResponse = await fetch(`${baseUrl}/channels/${channelId}/media`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const mediaData = await mediaResponse.json() as any;
      const mediaMessage = mediaData.media.find((item: any) => item.id === seededMessage.id);

      expect(mediaResponse.status).toBe(200);
      expect(mediaMessage.attachments[0].thumbnailUrl).toBe('https://example.com/photo.jpg');
      expect(mediaMessage.audio.mimeType).toBe('audio/webm');
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

