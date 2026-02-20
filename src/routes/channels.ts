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
  updateChannelSettings,
  leaveChannel,
  deleteChannel,
  clearChannelMessages,
} from '../controllers/channelController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/channels
router.get('/', getChannels);

// POST /api/channels
router.post('/', createChannel);

// GET /api/channels/:id
router.get('/:id', getChannelDetails);

// POST /api/channels/:id/members
router.post('/:id/members', addMember);

// DELETE /api/channels/:id/members/:memberId
router.delete('/:id/members/:memberId', removeMember);

// POST /api/channels/:id/leave
router.post('/:id/leave', leaveChannel);

// POST /api/channels/:id/archive
router.post('/:id/archive', archiveChannel);

// POST /api/channels/:id/star
router.post('/:id/star', starChannel);

// POST /api/channels/:id/mute
router.post('/:id/mute', muteChannel);

// POST /api/channels/:id/read
router.post('/:id/read', markChannelAsRead);

// PATCH /api/channels/:id/settings - Update channel settings explicitly
router.patch('/:id/settings', updateChannelSettings);

// DELETE /api/channels/:id/messages - Clear channel messages
router.delete('/:id/messages', clearChannelMessages);

// DELETE /api/channels/:id - Delete a group channel
router.delete('/:id', deleteChannel);

export default router;
