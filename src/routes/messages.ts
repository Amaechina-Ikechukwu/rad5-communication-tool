import { Router } from 'express';
import { 
  getMessages, 
  sendMessage, 
  editMessage, 
  deleteMessage, 
  addReaction,
  uploadFile 
} from '../controllers/messageController';
import { authenticate } from '../middleware/auth';
import { uploadMessageFiles, uploadAttachments } from '../middleware/upload';
import multer from 'multer';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/channels/:channelId/messages
router.get('/channels/:channelId/messages', getMessages);

// POST /api/channels/:channelId/messages (with file uploads)
router.post('/channels/:channelId/messages', uploadMessageFiles, sendMessage);

// PUT /api/messages/:id (edit)
router.put('/messages/:id', editMessage);

// DELETE /api/messages/:id
router.delete('/messages/:id', deleteMessage);

// POST /api/messages/:id/reactions
router.post('/messages/:id/reactions', addReaction);

// POST /api/upload (generic file upload)
router.post('/upload', multer({ storage: multer.memoryStorage() }).single('file'), uploadFile);

export default router;
