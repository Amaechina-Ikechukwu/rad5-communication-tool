export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isStrongPassword = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }
  return { valid: true };
};

export const sanitizeUser = (user: any): any => {
  const { password, resetToken, resetTokenExpiry, ...safeUser } = user.toJSON ? user.toJSON() : user;
  return safeUser;
};

export const isWithinEditWindow = (createdAt: Date): boolean => {
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
  return new Date(createdAt) > twentyMinutesAgo;
};
