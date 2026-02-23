# RAD5 Communication Tool — Next.js WebSocket Implementation

> **Architecture:** The server broadcasts all socket events automatically when REST endpoints are called (send, edit, delete, react, etc.). The client only needs to **listen** — no client-side relay required for messaging.
>
> Socket.IO server is at `NEXT_PUBLIC_API_URL/ws`. Auth uses JWT passed as `?token=` query param.

---

## Setup

```bash
npm install socket.io-client
```

`.env.local`
```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

---

## `lib/socket.ts`

```ts
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = (token: string): Socket => {
  if (!socket || !socket.connected) {
    socket = io(process.env.NEXT_PUBLIC_API_URL!, {
      path: '/ws',
      query: { token },
      transports: ['websocket'],
    });
  }
  return socket;
};

export const destroySocket = () => {
  socket?.disconnect();
  socket = null;
};
```

---

## `context/SocketContext.tsx`

```tsx
'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, destroySocket } from '@/lib/socket';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({
  children,
  token,
}: {
  children: React.ReactNode;
  token: string | null;
}) {
  const socketRef = useRef<Socket | null>(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!token) return;
    socketRef.current = getSocket(token);

    // Global events
    socketRef.current.on('user_presence', ({ userId, status, lastActive }) => {
      // update global online-status store here
    });

    socketRef.current.on('unread_update', ({ type, dmId, senderId }) => {
      // increment unread badge for dmId
    });

    forceUpdate(n => n + 1); // expose socket to consumers immediately
    return () => { destroySocket(); socketRef.current = null; };
  }, [token]);

  return (
    <SocketContext.Provider value={socketRef.current}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
```

Wrap your layout:
```tsx
// app/layout.tsx
<SocketProvider token={userToken}>
  {children}
</SocketProvider>
```

---

## `hooks/useChannel.ts`

```ts
'use client';
import { useEffect, useCallback } from 'react';
import { useSocket } from '@/context/SocketContext';

export function useChannel(channelId: string, onEvent: {
  onMessage?: (msg: any) => void;
  onEdited?: (messageId: string, text: string) => void;
  onDeleted?: (messageId: string) => void;
  onTyping?: (userId: string, isTyping: boolean) => void;
  onStatusUpdate?: (update: any) => void;
  onReaction?: (update: any) => void;
  onPollUpdate?: (update: any) => void;
}) {
  const socket = useSocket();

  useEffect(() => {
    if (!socket || !channelId) return;

    socket.emit('join_channel', { channelId });

    if (onEvent.onMessage)
      socket.on('new_message', ({ message }) => {
        onEvent.onMessage!(message);
        socket.emit('messages_delivered', { channelId, messageIds: [message.id] });
      });

    if (onEvent.onEdited)
      socket.on('message_edited', ({ messageId, text }) => onEvent.onEdited!(messageId, text));

    if (onEvent.onDeleted)
      socket.on('message_deleted', ({ messageId }) => onEvent.onDeleted!(messageId));

    if (onEvent.onTyping)
      socket.on('typing', ({ userId, isTyping }) => onEvent.onTyping!(userId, isTyping));

    if (onEvent.onStatusUpdate)
      socket.on('message_status_update', onEvent.onStatusUpdate);

    if (onEvent.onReaction)
      socket.on('reaction_update', onEvent.onReaction);

    if (onEvent.onPollUpdate)
      socket.on('poll_update', onEvent.onPollUpdate);

    return () => {
      socket.emit('leave_channel', { channelId });
      socket.off('new_message');
      socket.off('message_edited');
      socket.off('message_deleted');
      socket.off('typing');
      socket.off('message_status_update');
      socket.off('reaction_update');
      socket.off('poll_update');
    };
  }, [socket, channelId]);

  // Typing is the only client-initiated socket event (not REST-backed)
  const sendTyping = useCallback((isTyping: boolean) => {
    socket?.emit('typing', { channelId, isTyping });
  }, [socket, channelId]);

  const markRead = useCallback((messageIds: string[]) => {
    socket?.emit('messages_read', { channelId, messageIds });
  }, [socket, channelId]);

  return { sendTyping, markRead };
}
```

---

## `hooks/useDm.ts`

```ts
'use client';
import { useEffect, useCallback } from 'react';
import { useSocket } from '@/context/SocketContext';

export function useDm(dmId: string, onEvent: {
  onMessage?: (msg: any) => void;
  onEdited?: (messageId: string, text: string) => void;
  onDeleted?: (messageId: string) => void;
  onTyping?: (userId: string, isTyping: boolean) => void;
  onStatusUpdate?: (update: any) => void;
  onReaction?: (update: any) => void;
}) {
  const socket = useSocket();

  useEffect(() => {
    if (!socket || !dmId) return;

    socket.emit('join_dm', { dmId });

    if (onEvent.onMessage)
      socket.on('new_dm_message', ({ message }) => {
        onEvent.onMessage!(message);
        socket.emit('dm_messages_delivered', { dmId, messageIds: [message.id] });
      });

    if (onEvent.onEdited)
      socket.on('dm_message_edited', ({ messageId, text }) => onEvent.onEdited!(messageId, text));

    if (onEvent.onDeleted)
      socket.on('dm_message_deleted', ({ messageId }) => onEvent.onDeleted!(messageId));

    if (onEvent.onTyping)
      socket.on('dm_typing', ({ userId, isTyping }) => onEvent.onTyping!(userId, isTyping));

    if (onEvent.onStatusUpdate)
      socket.on('dm_message_status_update', onEvent.onStatusUpdate);

    if (onEvent.onReaction)
      socket.on('dm_reaction_update', onEvent.onReaction);

    return () => {
      socket.emit('leave_dm', { dmId });
      socket.off('new_dm_message');
      socket.off('dm_message_edited');
      socket.off('dm_message_deleted');
      socket.off('dm_typing');
      socket.off('dm_message_status_update');
      socket.off('dm_reaction_update');
    };
  }, [socket, dmId]);

  // Typing is the only client-initiated socket event (not REST-backed)
  const sendTyping = useCallback((isTyping: boolean) => {
    socket?.emit('dm_typing', { dmId, isTyping });
  }, [socket, dmId]);

  const markRead = useCallback((messageIds: string[]) => {
    socket?.emit('dm_messages_read', { dmId, messageIds });
  }, [socket, dmId]);

  return { sendTyping, markRead };
}
```

---

## `hooks/useCall.ts`

```ts
'use client';
import { useEffect, useCallback, useRef } from 'react';
import { useSocket } from '@/context/SocketContext';

export function useCall(onEvent: {
  onIncoming?: (call: { callId: string; callerId: string; type: 'audio' | 'video'; channelId?: string }) => void;
  onAccepted?: (callId: string, acceptedBy: string) => void;
  onRejected?: (callId: string, reason: string) => void;
  onEnded?: (callId: string, endedBy: string, reason?: string) => void;
  onOffer?: (callId: string, offer: RTCSessionDescriptionInit, callerId: string) => void;
  onAnswer?: (callId: string, answer: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (callId: string, candidate: RTCIceCandidateInit, from: string) => void;
  onMediaToggled?: (callId: string, userId: string, mediaType: 'audio' | 'video', enabled: boolean) => void;
}) {
  const socket = useSocket();
  const activeCallId = useRef<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    socket.on('call_incoming', onEvent.onIncoming ?? (() => {}));
    socket.on('call_accepted', ({ callId, acceptedBy }) => onEvent.onAccepted?.(callId, acceptedBy));
    socket.on('call_rejected', ({ callId, reason }) => onEvent.onRejected?.(callId, reason));
    socket.on('call_ended', ({ callId, endedBy, reason }) => {
      activeCallId.current = null;
      onEvent.onEnded?.(callId, endedBy, reason);
    });
    socket.on('call_offer', ({ callId, offer, callerId }) => onEvent.onOffer?.(callId, offer, callerId));
    socket.on('call_answer', ({ callId, answer }) => onEvent.onAnswer?.(callId, answer));
    socket.on('ice_candidate', ({ callId, candidate, from }) => onEvent.onIceCandidate?.(callId, candidate, from));
    socket.on('call_media_toggled', ({ callId, userId, mediaType, enabled }) =>
      onEvent.onMediaToggled?.(callId, userId, mediaType, enabled));

    return () => {
      socket.off('call_incoming');
      socket.off('call_accepted');
      socket.off('call_rejected');
      socket.off('call_ended');
      socket.off('call_offer');
      socket.off('call_answer');
      socket.off('ice_candidate');
      socket.off('call_media_toggled');
    };
  }, [socket]);

  const initiateCall = useCallback((receiverId: string, type: 'audio' | 'video', channelId?: string) => {
    socket?.emit('call_initiate', { receiverId, type, channelId });
    socket?.once('call_initiated', ({ callId }) => { activeCallId.current = callId; });
  }, [socket]);

  const acceptCall = useCallback((callId: string) => {
    activeCallId.current = callId;
    socket?.emit('call_accept', { callId });
  }, [socket]);

  const rejectCall = useCallback((callId: string, reason?: string) => {
    socket?.emit('call_reject', { callId, reason });
  }, [socket]);

  const endCall = useCallback(() => {
    if (activeCallId.current) {
      socket?.emit('call_end', { callId: activeCallId.current });
      activeCallId.current = null;
    }
  }, [socket]);

  const sendOffer = useCallback((offer: RTCSessionDescriptionInit) => {
    socket?.emit('call_offer', { callId: activeCallId.current, offer });
  }, [socket]);

  const sendAnswer = useCallback((answer: RTCSessionDescriptionInit) => {
    socket?.emit('call_answer', { callId: activeCallId.current, answer });
  }, [socket]);

  const sendIceCandidate = useCallback((candidate: RTCIceCandidateInit) => {
    socket?.emit('ice_candidate', { callId: activeCallId.current, candidate });
  }, [socket]);

  const toggleMedia = useCallback((mediaType: 'audio' | 'video', enabled: boolean) => {
    socket?.emit('call_toggle_media', { callId: activeCallId.current, mediaType, enabled });
  }, [socket]);

  return { initiateCall, acceptCall, rejectCall, endCall, sendOffer, sendAnswer, sendIceCandidate, toggleMedia };
}
```

---

## Usage Example — Channel Page

```tsx
'use client';
import { useEffect, useState, useRef } from 'react';
import { useChannel } from '@/hooks/useChannel';

export default function ChannelPage({ channelId }: { channelId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const typingTimeout = useRef<NodeJS.Timeout>();

  const { sendTyping, markRead } = useChannel(channelId, {
    onMessage: (msg) => setMessages(prev => [...prev, msg]),
    onEdited: (id, text) => setMessages(prev => prev.map(m => m.id === id ? { ...m, text } : m)),
    onDeleted: (id) => setMessages(prev => prev.filter(m => m.id !== id)),
    onTyping: (userId, isTyping) => { /* show typing indicator */ },
    onStatusUpdate: (update) => { /* update message tick status */ },
    onReaction: (update) => { /* update reaction counts */ },
    onPollUpdate: (update) => { /* update poll votes */ },
  });

  // Fetch initial messages on mount
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/channels/${channelId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        setMessages(data.messages);
        markRead(data.messages.map((m: any) => m.id));
      });
  }, [channelId]);

  const handleSend = async (text: string) => {
    // Just POST to REST — server broadcasts to socket room automatically
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const { data } = await res.json();
    // Optimistically add sender's own message (or wait for the socket event)
    setMessages(prev => [...prev, data]);
  };

  const handleTyping = () => {
    sendTyping(true);
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => sendTyping(false), 1500);
  };

  // ...render
}
```

---

## Usage Example — DM Page

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useDm } from '@/hooks/useDm';

export default function DmPage({ recipientId }: { recipientId: string }) {
  const [dmId, setDmId] = useState<string>('');
  const [messages, setMessages] = useState<any[]>([]);

  // Fetch or create the DM conversation first to get dmId
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/dms/${recipientId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => setDmId(data.dm.id));
  }, [recipientId]);

  const { sendTyping, markRead } = useDm(dmId, {
    onMessage: (msg) => setMessages(prev => [...prev, msg]),
    onEdited: (id, text) => setMessages(prev => prev.map(m => m.id === id ? { ...m, text } : m)),
    onDeleted: (id) => setMessages(prev => prev.filter(m => m.id !== id)),
  });

  const handleSend = async (text: string) => {
    // Just POST to REST — server broadcasts `new_dm_message` automatically
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/dms/${recipientId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const { data } = await res.json();
    setMessages(prev => [...prev, data]);
  };

  // ...render
}
```

---

## Key Rules

1. **`join_channel` / `join_dm` must be emitted before receiving real-time events** — the server only pushes to joined rooms.
2. **Just call the REST endpoint** — the server automatically broadcasts socket events (`new_message`, `new_dm_message`, `message_edited`, `message_deleted`, `reaction_update`, `dm_message_edited`, `dm_message_deleted`, `dm_reaction_update`, `message_status_update`, `dm_message_status_update`, `poll_update`). No client-side relay is needed.
3. **`dmId` ≠ `recipientId`** — fetch `GET /api/dms/:recipientId` first; use the returned `dm.id` for socket room joins.
4. **Clean up listeners on unmount** — all hooks above do this in the `useEffect` cleanup.
5. **Typing** is the only event that goes client→socket (not REST-backed). Debounce with a 1.5s timeout for `isTyping: false`.
6. **Mark as read** — emit `messages_read` / `dm_messages_read` via socket when the user views the conversation. This persists to the DB and notifies the sender.
