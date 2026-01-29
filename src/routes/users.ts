import { Router } from 'express';
import { 
  getUsers, 
  getUser, 
  getCurrentUser, 
  updateProfile, 
  updatePrivacySettings, 
  updateNotificationSettings 
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

// GET /api/users/:id
router.get('/:id', getUser);

// PUT /api/users/profile (with avatar upload)
router.put('/profile', uploadAvatar, updateProfile);

// PUT /api/users/privacy
router.put('/privacy', updatePrivacySettings);

// PUT /api/users/notifications
router.put('/notifications', updateNotificationSettings);

export default router;
