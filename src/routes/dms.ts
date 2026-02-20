import { Router } from 'express';
import {
  getDms,
  getOrCreateDm,
  sendDm,
  getDmMessages,
  archiveDm,
  starDm,
  muteDm,
  updateDmSettings,
  markDmAsRead,
  clearDmMessages,
} from '../controllers/dmController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/dms - List all DM conversations
router.get('/', getDms);

// GET /api/dms/:recipientId - Get or create DM
router.get('/:recipientId', getOrCreateDm);

// POST /api/dms/:recipientId - Create DM
router.post('/:recipientId', getOrCreateDm);

// GET /api/dms/:recipientId/messages - Get DM messages
router.get('/:recipientId/messages', getDmMessages);

// POST /api/dms/:recipientId/messages - Send a DM
router.post('/:recipientId/messages', sendDm);

// POST /api/dms/:recipientId/archive - Toggle archive
router.post('/:recipientId/archive', archiveDm);

// POST /api/dms/:recipientId/star - Toggle star
router.post('/:recipientId/star', starDm);

// POST /api/dms/:recipientId/mute - Toggle mute
router.post('/:recipientId/mute', muteDm);

// POST /api/dms/:recipientId/read - Mark as read
router.post('/:recipientId/read', markDmAsRead);

// PATCH /api/dms/:recipientId/settings - Update settings
router.patch('/:recipientId/settings', updateDmSettings);

// DELETE /api/dms/:recipientId/messages - Clear messages
router.delete('/:recipientId/messages', clearDmMessages);

export default router;
