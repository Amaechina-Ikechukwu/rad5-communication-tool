import { Router } from 'express';
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
  uploadFile,
  votePoll,
  updateMessageStatus,
  getChannelMedia,
} from '../controllers/messageController';
import { authenticate } from '../middleware/auth';
import { uploadMessageFiles } from '../middleware/upload';
import multer from 'multer';

const router = Router();
const uploadSingleFile = multer({ storage: multer.memoryStorage() }).single('file');

router.use(authenticate);

router.get('/channels/:channelId/messages', getMessages);
router.get('/channels/:channelId/media', getChannelMedia);
router.post('/channels/:channelId/messages', uploadMessageFiles, sendMessage);
router.put('/messages/:id', editMessage);
router.delete('/messages/:id', deleteMessage);
router.post('/messages/:id/reactions', addReaction);
router.post('/messages/:id/poll/vote', votePoll);
router.patch('/messages/:id/status', updateMessageStatus);
router.post('/messages/upload', uploadSingleFile, uploadFile);
router.post('/upload', uploadSingleFile, uploadFile);

export default router;
