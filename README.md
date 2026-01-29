# RAD5 Communication Tool

A real-time communication platform API supporting messaging, channels, file sharing, and user management.

## Features

- **Authentication**: Signup, login, password reset with JWT tokens
- **User Management**: Profile updates, privacy settings, notification preferences
- **Channels**: Create group chats, manage members, admin controls
- **Messaging**: Text messages, file attachments, audio messages, polls, reactions
- **Real-time**: WebSocket support for live updates

## Installation

```bash
bun install
```

## Environment Variables

Create a `.env` file with:

```env
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
```

## Running

```bash
# Development
bun run dev

# Production
bun run start
```

## API Documentation

Interactive Swagger documentation is available at:

```
http://localhost:3000/api-docs
```

## API Endpoints

### Auth
- `POST /api/auth/signup` - Create a new account
- `POST /api/auth/login` - Login to existing account
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token

### Users
- `GET /api/users` - Get all users (paginated)
- `GET /api/users/me` - Get current user
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/profile` - Update profile
- `PUT /api/users/privacy` - Update privacy settings
- `PUT /api/users/notifications` - Update notification settings

### Channels
- `GET /api/channels` - Get user's channels
- `POST /api/channels` - Create a new channel
- `GET /api/channels/:id` - Get channel details
- `POST /api/channels/:id/members` - Add member (admin only)
- `DELETE /api/channels/:id/members/:memberId` - Remove member (admin only)

### Messages
- `GET /api/channels/:channelId/messages` - Get channel messages
- `POST /api/channels/:channelId/messages` - Send a message
- `PUT /api/messages/:id` - Edit message (within 20 min)
- `DELETE /api/messages/:id` - Delete message (within 20 min)
- `POST /api/messages/:id/reactions` - Add/toggle reaction
- `POST /api/upload` - Upload a file

### WebSocket
Connect to `ws://localhost:3000/ws` for real-time updates.

## Testing

```bash
bun test
```

## Tech Stack

- **Runtime**: Bun
- **Framework**: Express.js
- **Database**: PostgreSQL with Sequelize ORM
- **Authentication**: JWT
- **File Storage**: Cloudinary
- **Real-time**: Socket.io
- **Documentation**: Swagger/OpenAPI
