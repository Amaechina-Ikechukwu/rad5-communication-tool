export const USER_ROLES = ['member', 'manager', 'admin', 'super_admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ['active', 'disabled'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const PROVISIONING_SOURCES = ['self_signup', 'bootstrap', 'admin', 'csv'] as const;
export type ProvisioningSource = (typeof PROVISIONING_SOURCES)[number];

export const CHANNEL_MEMBERSHIP_POLICIES = ['open', 'invite_only', 'admin_managed'] as const;
export type ChannelMembershipPolicy = (typeof CHANNEL_MEMBERSHIP_POLICIES)[number];

const ROLE_RANK: Record<UserRole, number> = {
  member: 0,
  manager: 1,
  admin: 2,
  super_admin: 3,
};

export const hasRequiredRole = (role: UserRole, minimumRole: UserRole): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[minimumRole];

export const canManageRole = (actorRole: UserRole, targetRole: UserRole): boolean => {
  if (actorRole === 'super_admin') {
    return true;
  }

  if (actorRole === 'admin') {
    return targetRole === 'manager' || targetRole === 'member';
  }

  return false;
};

export const canAssignRole = (actorRole: UserRole, nextRole: UserRole): boolean => {
  if (actorRole === 'super_admin') {
    return true;
  }

  if (actorRole === 'admin') {
    return nextRole === 'manager' || nextRole === 'member';
  }

  return false;
};
