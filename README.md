# RAD5 Communication Tool

A real-time communication platform API supporting messaging, channels, file sharing, and user management.

## Features

- **Authentication**: Signup (automatic "General" channel join), login, password reset with JWT tokens
- **User Management**: Profile updates, privacy settings, notification preferences, searchable user directory with unread counts and DM status tracking
- **Channels**: Group chats, 1-on-1 personal messaging (including self-messaging), admin controls, unread counts
- **Organization**: Archive, star, and mute channels with toggle or explicit setting controls
- **Messaging**: Text messages, file attachments, audio messages, polls, reactions
- **Real-time**: WebSocket support for live updates

## Installation

bash
bun install

## Environment Variables

Create a `.env` file with:

env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=rad5_comms
DB_USER=postgres
DB_PASSWORD=your_password
JWT_SECRET=your_jwt_secret
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASS=your_password
FRONTEND_URL=http://localhost:3000

## Running

bash
# Development
bun run dev

# Production
bun run start

## API Documentation

Interactive Swagger documentation is available at:

http://localhost:3000/api-docs

## API Endpoints

### Auth
- `POST /api/auth/signup` - Create a new account (automatically joins "General" channel)
- `POST /api/auth/login` - Login to existing account
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token

### Users
- `GET /api/users` - Get all users (searchable by name/email; includes unread counts and DM status indicators)
- `GET /api/users/me` - Get current user (includes total unread count)
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/profile` - Update profile
- `PUT /api/users/privacy` - Update privacy settings
- `PUT /api/users/notifications` - Update notification settings

### Channels
- `GET /api/channels` - Get user's channels (supports search and filters: starred, archived, muted, unread, groups, personal, active)
- `POST /api/channels` - Create a new channel
- `GET /api/channels/:id` - Get channel details
- `GET /api/channels/personal/:recipientId` - Get or create a 1-on-1 personal chat (supports self-chat)
- `POST /api/channels/personal/:recipientId` - Create or get a 1-on-1 personal chat
- `GET /api/channels/personal/:recipientId/messages` - Get messages from a personal chat
- `POST /api/channels/personal/:recipientId/messages` - Send a direct message (creates chat if needed)
- `POST /api/channels/personal/:recipientId/archive` - Toggle personal chat archive status
- `POST /api/channels/personal/:recipientId/star` - Toggle personal chat star status
- `POST /api/channels/personal/:recipientId/mute` - Toggle personal chat mute status
- `PATCH /api/channels/personal/:recipientId/settings` - Update personal chat settings (archive, star, mute)
- `POST /api/channels/:id/members` - Add member (admin only)
- `DELETE /api/channels/:id/members/:memberId` - Remove member (admin only)
- `POST /api/channels/:id/archive` - Toggle channel archive status
- `POST /api/channels/:id/star` - Toggle channel star status
- `POST /api/channels/:id/mute` - Toggle channel mute status
- `PATCH /api/channels/:id/settings` - Update channel settings (archive, star, mute)
- `POST /api/channels/:id/read` - Mark channel as read

### Messages
- `GET /api/channels/:channelId/messages` - Get channel messages
- `POST /api/channels/:channelId/messages` - Send a message
- `PUT /api/messages/:id` - Edit message (within 20 min)
- `DELETE /api/messages/:id` - Delete message
- `POST /api/messages/:id/reactions` - Add/toggle reaction
- `POST /api/upload` - Upload a file

### WebSocket
Connect to `ws://localhost:3000/ws` for real-time updates.

## Testing

bash
bun test

## Tech Stack

- **Runtime**: Bun
- **Framework**: Express.js
- **Database**: PostgreSQL with Sequelize ORM
- **Authentication**: JWT
- **File Storage**: Cloudinary
- **Real-time**: Socket.io
- **Documentation**: Swagger/OpenAPI