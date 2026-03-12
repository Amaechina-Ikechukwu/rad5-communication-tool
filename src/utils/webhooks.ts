interface PresenceWebhookEvent {
  event: 'user.presence.updated';
  occurredAt: string;
  data: {
    userId: string;
    status: 'online' | 'offline';
    isOnline: boolean;
    lastActive: string;
    activeConnections: number;
  };
}

const getPresenceWebhookUrls = (): string[] => {
  const rawUrls = process.env.PRESENCE_WEBHOOK_URLS || process.env.PRESENCE_WEBHOOK_URL || '';

  return rawUrls
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

export const sendPresenceWebhook = async (input: {
  userId: string;
  status: 'online' | 'offline';
  lastActive: Date;
  activeConnections: number;
}): Promise<void> => {
  const urls = getPresenceWebhookUrls();
  if (!urls.length) {
    return;
  }

  const payload: PresenceWebhookEvent = {
    event: 'user.presence.updated',
    occurredAt: new Date().toISOString(),
    data: {
      userId: input.userId,
      status: input.status,
      isOnline: input.status === 'online',
      lastActive: input.lastActive.toISOString(),
      activeConnections: input.activeConnections,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (process.env.PRESENCE_WEBHOOK_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.PRESENCE_WEBHOOK_AUTH_TOKEN}`;
  }

  if (process.env.PRESENCE_WEBHOOK_SECRET) {
    headers['x-rad5-webhook-secret'] = process.env.PRESENCE_WEBHOOK_SECRET;
  }

  const body = JSON.stringify(payload);

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        throw new Error(`Webhook responded with ${response.status}`);
      }
    }),
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Presence webhook failed for ${urls[index]}:`, result.reason);
    }
  });
};
