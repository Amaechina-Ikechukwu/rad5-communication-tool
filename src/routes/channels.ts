import { Router } from 'express';
import { 
  getChannels, 
  createChannel, 
  getChannelDetails,
  addMember,
  removeMember
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

export default router;
