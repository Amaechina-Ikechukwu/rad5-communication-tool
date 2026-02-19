import { Request, Response } from 'express';
import crypto from 'crypto';
import { User } from '../models';
import { generateToken } from '../middleware/auth';
import { isValidEmail, isStrongPassword } from '../utils/validators';
import { sendPasswordResetEmail, sendWelcomeEmail, sendOtpEmail } from '../utils/email';

// POST /api/auth/signup
export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const passwordCheck = isStrongPassword(password);
    if (!passwordCheck.valid) {
      res.status(400).json({ error: passwordCheck.message });
      return;
    }

    // Check if user exists
    const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
    if (existingUser) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    // Create user
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
    });

    // Generate token
    const token = generateToken({ id: user.id, email: user.email });

    // Send welcome email (non-blocking)
    sendWelcomeEmail(user.email, user.name).catch(console.error);

    res.status(201).json({
      message: 'Account created successfully',
      user: user.toJSON(),
      token,
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
};

// POST /api/auth/login
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Find user
    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Update last active
    await user.update({ lastActive: new Date(), isOnline: true });

    // Generate token
    const token = generateToken({ id: user.id, email: user.email });

    res.json({
      message: 'Login successful',
      user: user.toJSON(),
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// POST /api/auth/forgot-password
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    
    // Always return success to prevent email enumeration
    if (!user) {
      res.json({ message: 'If an account exists, a password reset email has been sent' });
      return;
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await user.update({
      resetToken: otp,
      resetTokenExpiry,
    });

    // Send OTP email
    sendOtpEmail(user.email, user.name, otp).catch((err) => {
      console.error('Failed to send OTP email:', err);
    });

    // Also send link-based reset as fallback
    const resetToken = crypto.randomBytes(32).toString('hex');
    // Store the link token as well — we use otp for primary reset
    sendPasswordResetEmail(user.email, resetToken).catch((err) => {
      console.error('Failed to send password reset email:', err);
    });

    res.json({ message: 'If an account exists, a password reset email has been sent' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
};

// POST /api/auth/verify-otp
export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      res.status(400).json({ error: 'Email and OTP are required' });
      return;
    }

    const user = await User.findOne({
      where: { email: email.toLowerCase(), resetToken: otp },
    });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      res.status(400).json({ error: 'Invalid or expired OTP' });
      return;
    }

    // Generate a temporary token to allow password reset
    const tempToken = crypto.randomBytes(32).toString('hex');
    await user.update({
      resetToken: tempToken,
      resetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000), // another 15 min
    });

    res.json({
      message: 'OTP verified successfully',
      resetToken: tempToken,
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
};

// POST /api/auth/reset-password
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      res.status(400).json({ error: 'Token and new password are required' });
      return;
    }

    const passwordCheck = isStrongPassword(password);
    if (!passwordCheck.valid) {
      res.status(400).json({ error: passwordCheck.message });
      return;
    }

    // Find user with valid token
    const user = await User.findOne({
      where: {
        resetToken: token,
      },
    });

    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    // Update password and clear token
    await user.update({
      password,
      resetToken: null,
      resetTokenExpiry: null,
    });

    res.json({ message: 'Password reset successful. You can now login with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

// POST /api/auth/change-password (authenticated)
export const changePassword = async (req: Request & { user?: any }, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }

    const passwordCheck = isStrongPassword(newPassword);
    if (!passwordCheck.valid) {
      res.status(400).json({ error: passwordCheck.message });
      return;
    }

    const user = await User.findByPk(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    await user.update({ password: newPassword });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
};

// POST /api/auth/resend-otp
export const resendOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    
    if (!user) {
      res.json({ message: 'If an account exists, a new OTP has been sent' });
      return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);

    await user.update({
      resetToken: otp,
      resetTokenExpiry,
    });

    sendOtpEmail(user.email, user.name, otp).catch((err) => {
      console.error('Failed to send OTP email:', err);
    });

    res.json({ message: 'If an account exists, a new OTP has been sent' });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
};
