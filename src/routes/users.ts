import { Router } from 'express';
import { 
  getUsers, 
  getUser, 
  getCurrentUser, 
  updateProfile, 
  updatePrivacySettings, 
  updateNotificationSettings,
  getUserAvatar,
  updateAvatar,
  deleteAvatar
} from '../controllers/userController';
import { authenticate } from '../middleware/auth';
import { uploadAvatar } from '../middleware/upload';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/users
router.get('/', getUsers);

// GET /api/users/me
router.get('/me', getCurrentUser);

// PUT /api/users/profile (with avatar upload)
router.put('/profile', uploadAvatar, updateProfile);

// PUT /api/users/privacy
router.put('/privacy', updatePrivacySettings);

// PUT /api/users/notifications
router.put('/notifications', updateNotificationSettings);

// PUT /api/users/avatar - Upload/update avatar
router.put('/avatar', uploadAvatar, updateAvatar);

// DELETE /api/users/avatar - Remove avatar
router.delete('/avatar', deleteAvatar);

// GET /api/users/:id/avatar - Get user's avatar
router.get('/:id/avatar', getUserAvatar);

// GET /api/users/:id
router.get('/:id', getUser);

export default router;
