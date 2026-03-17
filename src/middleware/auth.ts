import type { Request, Response, NextFunction } from 'express';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import { User } from '../models';
import { hasRequiredRole, type UserRole } from '../utils/adminConstants';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    team: string | null;
    department: string | null;
    accountStatus: 'active' | 'disabled';
    mustChangePassword: boolean;
    sessionVersion: number;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Access denied. No token provided.' });
      return;
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
      id: string;
      email: string;
      sessionVersion?: number;
    };

    const user = await User.findByPk(decoded.id);
    if (!user) {
      res.status(401).json({ error: 'Invalid token. User not found.' });
      return;
    }

    if (user.accountStatus !== 'active') {
      res.status(403).json({ error: 'Your account has been disabled.' });
      return;
    }

    if ((decoded.sessionVersion ?? 0) !== user.sessionVersion) {
      res.status(401).json({ error: 'Your session is no longer valid. Please log in again.' });
      return;
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      name: user.name,
      role: user.role,
      team: user.team,
      department: user.department,
      accountStatus: user.accountStatus,
      mustChangePassword: user.mustChangePassword,
      sessionVersion: user.sessionVersion,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

export const requireRole = (minimumRole: UserRole) => (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  if (!hasRequiredRole(req.user.role, minimumRole)) {
    res.status(403).json({ error: `This action requires ${minimumRole} access.` });
    return;
  }

  next();
};

export const generateToken = (user: {
  id: string;
  email: string;
  sessionVersion?: number;
}): string => {
  const secret: Secret = process.env.JWT_SECRET || 'secret';
  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'],
  };

  return jwt.sign(
    { id: user.id, email: user.email, sessionVersion: user.sessionVersion ?? 0 },
    secret,
    options,
  );
};
