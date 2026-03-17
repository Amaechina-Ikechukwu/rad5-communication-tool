# RAD5 Communication Tool

A real-time communication API for team chat, direct messages, channels, media sharing, polls, presence, and call signaling.

## Current capabilities

- Auth with login, OTP/password reset, JWT sessions, session invalidation, and optional public signup.
- RBAC with `super_admin`, `admin`, `manager`, and `member` roles.
- Automatic enrollment of every new user into default channels, with `General` enforced as a protected system channel.
- Group channels with member management, archive/star/mute settings, unread counts, and media/file history.
- Direct messages with unread counts, archive/star/mute settings, media support, and poll voting.
- Message delivery, read receipts, reactions, edits, deletes, and websocket fan-out.
- File/image/video/audio sharing through multipart uploads or structured attachment payloads.
- Presence updates over Socket.IO and outbound presence webhooks.
- Admin APIs for user lifecycle, CSV import, channel governance, forced default membership sync, and audit logs.

## Recent backend changes

- New users are now always added to `General`, and startup backfills missing `General` memberships for older users.
- Adding a user to a channel now returns a ready-to-render channel payload, and the added user can immediately see that channel in their sidebar.
- Channel and DM list/detail payloads consistently include unread counts.
- `GET /api/channels/:channelId/messages` and `GET /api/dms/:recipientId/messages` now return `unreadCount` alongside paginated messages.
- Channel and DM send endpoints now accept either:
  - `multipart/form-data` with `attachments`, `audio`, `poll`, `audioDuration`
  - JSON payloads that already contain normalized `attachments`, `audio`, and `poll`
- Socket-driven presence changes (`online` / `offline`) are now mirrored to webhooks.

## Install

```bash
bun install
```

## Environment

Create a `.env` file similar to this:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:password@localhost:5432/rad5_communication
DB_SSL=false

JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
ALLOW_PUBLIC_SIGNUP=false

BOOTSTRAP_SUPER_ADMIN_NAME=Platform Super Admin
BOOTSTRAP_SUPER_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_SUPER_ADMIN_PASSWORD=ChangeMe123!

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-email-password
SMTP_FROM=noreply@rad5comms.com

CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

FRONTEND_URL=http://localhost:3001
ALLOWED=http://localhost:3000,http://localhost:3001,http://localhost:5173

PRESENCE_WEBHOOK_URLS=
PRESENCE_WEBHOOK_AUTH_TOKEN=
PRESENCE_WEBHOOK_SECRET=
```

### Presence webhooks

Set `PRESENCE_WEBHOOK_URLS` to one or more comma-separated URLs to receive presence changes.

Each webhook is sent as `POST application/json` with this shape:

```json
{
  "event": "user.presence.updated",
  "occurredAt": "2026-03-12T10:00:00.000Z",
  "data": {
    "userId": "uuid",
    "status": "online",
    "isOnline": true,
    "lastActive": "2026-03-12T10:00:00.000Z",
    "activeConnections": 1
  }
}
```

Optional headers:

- `Authorization: Bearer <PRESENCE_WEBHOOK_AUTH_TOKEN>`
- `x-rad5-webhook-secret: <PRESENCE_WEBHOOK_SECRET>`

## Run

```bash
bun run dev
bun run start
```

## API docs

Swagger UI is available at [http://localhost:3000/api-docs](http://localhost:3000/api-docs).

## Endpoint notes

### Auth

- `POST /api/auth/signup`
  - Creates the user only when `ALLOW_PUBLIC_SIGNUP=true`.
  - Automatically adds the user to every default channel.
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/verify-otp`
- `POST /api/auth/reset-password`
- `POST /api/auth/resend-otp`

### Users

- `GET /api/users`
  - Returns searchable users plus DM metadata and unread counts.
- `GET /api/users/me`
  - Returns the current user plus total unread count.
- `PUT /api/users/profile`
- `PUT /api/users/privacy`
- `PUT /api/users/notifications`

### Channels

- `GET /api/channels`
  - Includes `isArchived`, `isStarred`, `isMuted`, `unreadCount`, and channel protection flags.
- `POST /api/channels`
  - Creates a group channel and emits `channel_created` to invited members.
- `GET /api/channels/:id`
  - Includes members, `unreadCount`, media, flattened file attachments, and channel protection flags.
- `POST /api/channels/:id/members`
  - Adds a member and returns the added member's channel payload.
  - Protected default/system channels must be managed through admin APIs.
- `POST /api/channels/:id/read`
- `PATCH /api/channels/:id/settings`
- `DELETE /api/channels/:id/messages`
- `DELETE /api/channels/:id`

### Admin

- `GET /api/admin/overview`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `POST /api/admin/users/import`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/disable`
- `POST /api/admin/users/:id/reactivate`
- `POST /api/admin/users/:id/reset-sessions`
- `GET /api/admin/channels`
- `POST /api/admin/channels`
- `PATCH /api/admin/channels/:id`
- `POST /api/admin/channels/:id/sync-default-membership`
- `POST /api/admin/channels/:id/members`
- `DELETE /api/admin/channels/:id/members/:memberId`
- `DELETE /api/admin/channels/:id`
- `GET /api/admin/audit-logs`

### Direct messages

- `GET /api/dms`
  - Returns DM conversations with participant info and `unreadCount`.
- `GET /api/dms/:recipientId`
  - Accepts a recipient user ID or an existing DM ID.
- `POST /api/dms/:recipientId/messages`
  - Supports text, multipart attachments/audio, or structured attachment/audio JSON, plus polls.
- `GET /api/dms/:recipientId/messages`
  - Returns paginated messages plus `unreadCount`.
- `POST /api/dms/:recipientId/read`
- `PATCH /api/dms/:recipientId/settings`
- `DELETE /api/dms/:recipientId/messages`

### Messages

- `POST /api/channels/:channelId/messages`
  - Supports text, multipart attachments/audio, or structured attachment/audio JSON, plus polls.
- `GET /api/channels/:channelId/messages`
  - Returns paginated messages plus `unreadCount`.
- `GET /api/channels/:channelId/media`
- `POST /api/messages/:id/poll/vote`
- `POST /api/messages/:id/reactions`
- `PATCH /api/messages/:id/status`
- `POST /api/messages/upload`
- `POST /api/upload`

## WebSocket

Connect with Socket.IO at `ws://<host>/ws` using `?token=<jwt>`.

Important realtime events:

- `user_presence`
- `channel_created`
- `dm_created`
- `unread_update`
- `new_message`
- `new_dm_message`
- `message_status_update`
- `dm_message_status_update`
- `poll_update`
- `reaction_update`
- `dm_reaction_update`
- call signaling events (`call_incoming`, `call_offer`, `call_answer`, `ice_candidate`, `call_ended`)

See [WEBSOCKET_INTEGRATION.md](WEBSOCKET_INTEGRATION.md) for frontend usage patterns.

## Test

```bash
bun test
```

## Stack

- Bun
- Express
- PostgreSQL + Sequelize
- Socket.IO
- Cloudinary
- Swagger UI
