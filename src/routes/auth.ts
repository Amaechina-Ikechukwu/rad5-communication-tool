import { Router } from 'express';
import { signup, login, forgotPassword, resetPassword, verifyOtp, changePassword, resendOtp } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

// POST /api/auth/signup
router.post('/signup', signup);

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPassword);

// POST /api/auth/verify-otp
router.post('/verify-otp', verifyOtp);

// POST /api/auth/resend-otp
router.post('/resend-otp', resendOtp);

// POST /api/auth/reset-password
router.post('/reset-password', resetPassword);

// POST /api/auth/change-password (requires auth)
router.post('/change-password', authenticate, changePassword);

export default router;
