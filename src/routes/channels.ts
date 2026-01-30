import { Router } from 'express';
import { 
  getChannels, 
  createChannel, 
  getChannelDetails,
  addMember,
  removeMember,
  archiveChannel,
  starChannel,
  muteChannel,
  markChannelAsRead,
  getPersonalChat,
  getPersonalChatMessages
} from '../controllers/channelController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/channels
router.get('/', getChannels);

// POST /api/channels
router.post('/', createChannel);

// Personal chat routes (must be before /:id to avoid conflict)
// GET /api/channels/personal/:recipientId
router.get('/personal/:recipientId', getPersonalChat);

// GET /api/channels/personal/:recipientId/messages
router.get('/personal/:recipientId/messages', getPersonalChatMessages);

// GET /api/channels/:id
router.get('/:id', getChannelDetails);

// POST /api/channels/:id/members
router.post('/:id/members', addMember);

// DELETE /api/channels/:id/members/:memberId
router.delete('/:id/members/:memberId', removeMember);

// POST /api/channels/:id/archive
router.post('/:id/archive', archiveChannel);

// POST /api/channels/:id/star
router.post('/:id/star', starChannel);

// POST /api/channels/:id/mute
router.post('/:id/mute', muteChannel);

// POST /api/channels/:id/read
router.post('/:id/read', markChannelAsRead);

export default router;
