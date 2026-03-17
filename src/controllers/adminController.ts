import crypto from 'crypto';
import type { Response } from 'express';
import { Op } from 'sequelize';
import { AuditLog, Channel, ChannelMember, Message, Reaction, User } from '../models';
import type { AuthRequest } from '../middleware/auth';
import {
  USER_ROLES,
  canAssignRole,
  canManageRole,
  hasRequiredRole,
  type UserRole,
} from '../utils/adminConstants';
import { createAuditLog } from '../utils/audit';
import { parseCsvRecords } from '../utils/csv';
import {
  ensureUserInDefaultChannels,
  isProtectedChannel,
  syncDefaultChannelMemberships,
} from '../utils/initializeGeneralChannel';
import { isStrongPassword, isValidEmail } from '../utils/validators';

const parseBooleanQuery = (value: unknown): boolean | undefined => {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
};

const normalizeOptionalString = (value: unknown): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && USER_ROLES.includes(value as UserRole);

const generateTemporaryPassword = (): string => `Tmp!${crypto.randomBytes(6).toString('hex')}9`;

const sanitizeUserForAdmin = (user: User) => user.toJSON();

const ensureManagedUserAccess = (req: AuthRequest, res: Response, targetUser: User): boolean => {
  const actor = req.user!;

  if (actor.id === targetUser.id) {
    res.status(400).json({ error: 'This action cannot be performed on your own account.' });
    return false;
  }

  if (!canManageRole(actor.role, targetUser.role)) {
    res.status(403).json({ error: 'You do not have permission to manage this user.' });
    return false;
  }

  return true;
};

const buildChannelAdminPayload = async (channelId: string) => {
  const channel = await Channel.findByPk(channelId, {
    include: [
      {
        model: User,
        as: 'members',
        attributes: ['id', 'name', 'email', 'role', 'team', 'department', 'accountStatus'],
        through: { attributes: ['role', 'joinedAt'] },
      },
      {
        model: User,
        as: 'creator',
        attributes: ['id', 'name', 'email', 'role'],
      },
    ],
  });

  if (!channel) {
    return null;
  }

  const members = ((channel as any).members || []).map((member: any) => ({
    ...member.toJSON(),
    channelRole: member.ChannelMember?.role ?? member.channelMember?.role ?? 'member',
  }));

  return {
    ...channel.toJSON(),
    members,
    memberCount: members.length,
    creator: (channel as any).creator?.toJSON?.() ?? null,
    membershipEnforced: channel.isDefault,
  };
};

// GET /api/admin/overview
export const getAdminOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [users, channels, recentAuditLogs] = await Promise.all([
      User.findAll({
        attributes: ['id', 'role', 'accountStatus', 'team', 'department'],
      }),
      Channel.findAll({
        attributes: ['id', 'isSystem', 'isDefault'],
      }),
      AuditLog.findAll({
        limit: 10,
        order: [['createdAt', 'DESC']],
        include: [
          {
            model: User,
            as: 'actor',
            attributes: ['id', 'name', 'email', 'role'],
          },
        ],
      }),
    ]);

    const usersByRole = USER_ROLES.reduce<Record<UserRole, number>>((acc, role) => {
      acc[role] = users.filter((user) => user.role === role).length;
      return acc;
    }, { member: 0, manager: 0, admin: 0, super_admin: 0 });

    const teams = [...new Set(users.map((user) => user.team).filter(Boolean))].sort();
    const departments = [...new Set(users.map((user) => user.department).filter(Boolean))].sort();

    res.json({
      overview: {
        users: {
          total: users.length,
          active: users.filter((user) => user.accountStatus === 'active').length,
          disabled: users.filter((user) => user.accountStatus === 'disabled').length,
          byRole: usersByRole,
          teams,
          departments,
        },
        channels: {
          total: channels.length,
          system: channels.filter((channel) => channel.isSystem).length,
          default: channels.filter((channel) => channel.isDefault).length,
        },
        recentAuditLogs: recentAuditLogs.map((log: any) => ({
          ...log.toJSON(),
          actor: log.actor?.toJSON?.() ?? null,
        })),
      },
    });
  } catch (error) {
    console.error('Get admin overview error:', error);
    res.status(500).json({ error: 'Failed to load admin overview' });
  }
};

// GET /api/admin/users
export const listAdminUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, role, status, page = 1, limit = 25 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const whereClause: any = {};

    if (search && typeof search === 'string') {
      const searchTerm = search.trim();
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${searchTerm}%` } },
        { email: { [Op.iLike]: `%${searchTerm}%` } },
        { team: { [Op.iLike]: `%${searchTerm}%` } },
        { department: { [Op.iLike]: `%${searchTerm}%` } },
      ];
    }

    if (isUserRole(role)) {
      whereClause.role = role;
    }

    if (status === 'active' || status === 'disabled') {
      whereClause.accountStatus = status;
    }

    const { count, rows } = await User.findAndCountAll({
      where: whereClause,
      attributes: [
        'id',
        'name',
        'email',
        'role',
        'accountStatus',
        'team',
        'department',
        'mustChangePassword',
        'provisioningSource',
        'avatar',
        'isOnline',
        'lastActive',
        'createdAt',
        'updatedAt',
      ],
      order: [['createdAt', 'DESC']],
      limit: Number(limit),
      offset,
    });

    res.json({
      users: rows.map((user) => sanitizeUserForAdmin(user)),
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(count / Number(limit)),
      },
    });
  } catch (error) {
    console.error('List admin users error:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
};

// POST /api/admin/users
export const createAdminUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = req.user!;
    const { name, email, password, role, team, department } = req.body;

    if (!name || !email) {
      res.status(400).json({ error: 'Name and email are required.' });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      res.status(400).json({ error: 'Invalid email format.' });
      return;
    }

    const requestedRole: UserRole = isUserRole(role) ? role : 'member';
    if (!canAssignRole(actor.role, requestedRole)) {
      res.status(403).json({ error: 'You do not have permission to assign that role.' });
      return;
    }

    const existingUser = await User.findOne({ where: { email: normalizedEmail } });
    if (existingUser) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    let resolvedPassword = typeof password === 'string' ? password : '';
    let temporaryPassword: string | null = null;
    let mustChangePassword = false;

    if (!resolvedPassword.trim()) {
      temporaryPassword = generateTemporaryPassword();
      resolvedPassword = temporaryPassword;
      mustChangePassword = true;
    }

    const passwordCheck = isStrongPassword(resolvedPassword);
    if (!passwordCheck.valid) {
      res.status(400).json({ error: passwordCheck.message });
      return;
    }

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password: resolvedPassword,
      role: requestedRole,
      accountStatus: 'active',
      team: normalizeOptionalString(team) ?? null,
      department: normalizeOptionalString(department) ?? null,
      mustChangePassword,
      provisioningSource: 'admin',
    });

    const defaultChannels = await ensureUserInDefaultChannels(user.id);

    await createAuditLog({
      actorId: actor.id,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      metadata: {
        role: user.role,
        team: user.team,
        department: user.department,
        provisioningSource: user.provisioningSource,
      },
    });

    res.status(201).json({
      message: 'User created successfully.',
      user: sanitizeUserForAdmin(user),
      temporaryPassword,
      defaultChannelsAdded: defaultChannels.length,
    });
  } catch (error) {
    console.error('Create admin user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// POST /api/admin/users/import
export const importAdminUsersFromCsv = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = req.user!;
    const { csv, defaultRole, defaultTeam, defaultDepartment } = req.body;

    if (typeof csv !== 'string' || !csv.trim()) {
      res.status(400).json({ error: 'CSV content is required.' });
      return;
    }

    const requestedDefaultRole: UserRole = isUserRole(defaultRole) ? defaultRole : 'member';
    if (!canAssignRole(actor.role, requestedDefaultRole)) {
      res.status(403).json({ error: 'You do not have permission to assign that default role.' });
      return;
    }

    const rows = parseCsvRecords(csv);
    if (!rows.length) {
      res.status(400).json({ error: 'No CSV rows were found.' });
      return;
    }

    const created: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const name = row.name?.trim();
      const email = row.email?.trim().toLowerCase();

      if (!name || !email) {
        skipped.push({ row: rowNumber, reason: 'Missing required name or email.' });
        continue;
      }

      if (!isValidEmail(email)) {
        skipped.push({ row: rowNumber, email, reason: 'Invalid email format.' });
        continue;
      }

      const requestedRole = isUserRole(row.role) ? row.role : requestedDefaultRole;
      if (!canAssignRole(actor.role, requestedRole)) {
        skipped.push({ row: rowNumber, email, reason: `Role '${requestedRole}' is not allowed for your account.` });
        continue;
      }

      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        skipped.push({ row: rowNumber, email, reason: 'Account already exists.' });
        continue;
      }

      let resolvedPassword = row.password?.trim();
      let temporaryPassword: string | null = null;
      let mustChangePassword = false;

      if (!resolvedPassword) {
        temporaryPassword = generateTemporaryPassword();
        resolvedPassword = temporaryPassword;
        mustChangePassword = true;
      }

      const passwordCheck = isStrongPassword(resolvedPassword);
      if (!passwordCheck.valid) {
        skipped.push({ row: rowNumber, email, reason: passwordCheck.message });
        continue;
      }

      const user = await User.create({
        name,
        email,
        password: resolvedPassword,
        role: requestedRole,
        accountStatus: 'active',
        team: normalizeOptionalString(row.team) ?? normalizeOptionalString(defaultTeam) ?? null,
        department: normalizeOptionalString(row.department) ?? normalizeOptionalString(defaultDepartment) ?? null,
        mustChangePassword,
        provisioningSource: 'csv',
      });

      await ensureUserInDefaultChannels(user.id);

      created.push({
        id: user.id,
        email: user.email,
        role: user.role,
        team: user.team,
        department: user.department,
        temporaryPassword,
      });
    }

    await createAuditLog({
      actorId: actor.id,
      action: 'user.csv_imported',
      entityType: 'user',
      metadata: {
        createdCount: created.length,
        skippedCount: skipped.length,
      },
    });

    res.status(201).json({
      message: 'CSV import processed.',
      summary: {
        createdCount: created.length,
        skippedCount: skipped.length,
      },
      created,
      skipped,
    });
  } catch (error) {
    console.error('Import admin users error:', error);
    res.status(500).json({ error: 'Failed to import users' });
  }
};

// PATCH /api/admin/users/:id
export const updateAdminUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = req.user!;
    const targetUserId = String(req.params.id);
    const targetUser = await User.findByPk(targetUserId);

    if (!targetUser) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (actor.id !== targetUser.id && !canManageRole(actor.role, targetUser.role)) {
      res.status(403).json({ error: 'You do not have permission to manage this user.' });
      return;
    }

    const updates: Record<string, unknown> = {};
    const auditMetadata: Record<string, unknown> = {};

    if (req.body.role !== undefined) {
      if (actor.id === targetUser.id) {
        res.status(400).json({ error: 'You cannot change your own role.' });
        return;
      }

      if (!isUserRole(req.body.role)) {
        res.status(400).json({ error: 'Invalid role value.' });
        return;
      }

      if (!canAssignRole(actor.role, req.body.role)) {
        res.status(403).json({ error: 'You do not have permission to assign that role.' });
        return;
      }

      updates.role = req.body.role;
      auditMetadata.role = req.body.role;
    }

    const nextTeam = normalizeOptionalString(req.body.team);
    if (nextTeam !== undefined) {
      updates.team = nextTeam;
      auditMetadata.team = nextTeam;
    }

    const nextDepartment = normalizeOptionalString(req.body.department);
    if (nextDepartment !== undefined) {
      updates.department = nextDepartment;
      auditMetadata.department = nextDepartment;
    }

    if (typeof req.body.mustChangePassword === 'boolean') {
      updates.mustChangePassword = req.body.mustChangePassword;
      auditMetadata.mustChangePassword = req.body.mustChangePassword;
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: 'No valid fields were provided.' });
      return;
    }

    await targetUser.update(updates);

    await createAuditLog({
      actorId: actor.id,
      action: 'user.updated',
      entityType: 'user',
      entityId: targetUser.id,
      metadata: auditMetadata,
    });

    res.json({
      message: 'User updated successfully.',
      user: sanitizeUserForAdmin(targetUser),
    });
  } catch (error) {
    console.error('Update admin user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

// POST /api/admin/users/:id/disable
export const disableAdminUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = String(req.params.id);
    const targetUser = await User.findByPk(targetUserId);

    if (!targetUser) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (!ensureManagedUserAccess(req, res, targetUser)) {
      return;
    }

    await targetUser.update({
      accountStatus: 'disabled',
      isOnline: false,
      sessionVersion: targetUser.sessionVersion + 1,
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'user.disabled',
      entityType: 'user',
      entityId: targetUser.id,
      metadata: { role: targetUser.role },
    });

    res.json({
      message: 'User disabled successfully.',
      user: sanitizeUserForAdmin(targetUser),
    });
  } catch (error) {
    console.error('Disable admin user error:', error);
    res.status(500).json({ error: 'Failed to disable user' });
  }
};

// POST /api/admin/users/:id/reactivate
export const reactivateAdminUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = String(req.params.id);
    const targetUser = await User.findByPk(targetUserId);

    if (!targetUser) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (req.user!.id !== targetUser.id && !canManageRole(req.user!.role, targetUser.role)) {
      res.status(403).json({ error: 'You do not have permission to manage this user.' });
      return;
    }

    await targetUser.update({
      accountStatus: 'active',
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'user.reactivated',
      entityType: 'user',
      entityId: targetUser.id,
      metadata: { role: targetUser.role },
    });

    res.json({
      message: 'User reactivated successfully.',
      user: sanitizeUserForAdmin(targetUser),
    });
  } catch (error) {
    console.error('Reactivate admin user error:', error);
    res.status(500).json({ error: 'Failed to reactivate user' });
  }
};

// POST /api/admin/users/:id/reset-sessions
export const resetAdminUserSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const targetUserId = String(req.params.id);
    const targetUser = await User.findByPk(targetUserId);

    if (!targetUser) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    if (req.user!.id !== targetUser.id && !canManageRole(req.user!.role, targetUser.role)) {
      res.status(403).json({ error: 'You do not have permission to manage this user.' });
      return;
    }

    await targetUser.update({
      sessionVersion: targetUser.sessionVersion + 1,
      isOnline: false,
    });

    await createAuditLog({
      actorId: req.user!.id,
      action: 'user.sessions_reset',
      entityType: 'user',
      entityId: targetUser.id,
      metadata: { role: targetUser.role },
    });

    res.json({
      message: 'User sessions reset successfully.',
      user: sanitizeUserForAdmin(targetUser),
    });
  } catch (error) {
    console.error('Reset admin user sessions error:', error);
    res.status(500).json({ error: 'Failed to reset user sessions' });
  }
};

// GET /api/admin/channels
export const listAdminChannels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, isSystem, isDefault } = req.query;
    const whereClause: any = {
      isGroup: true,
    };

    if (search && typeof search === 'string') {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { description: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    const systemFilter = parseBooleanQuery(isSystem);
    if (systemFilter !== undefined) {
      whereClause.isSystem = systemFilter;
    }

    const defaultFilter = parseBooleanQuery(isDefault);
    if (defaultFilter !== undefined) {
      whereClause.isDefault = defaultFilter;
    }

    const channels = await Channel.findAll({
      where: whereClause,
      order: [['name', 'ASC']],
    });

    const payload = [];
    for (const channel of channels) {
      const hydratedChannel = await buildChannelAdminPayload(channel.id);
      if (hydratedChannel) {
        payload.push(hydratedChannel);
      }
    }

    res.json({ channels: payload });
  } catch (error) {
    console.error('List admin channels error:', error);
    res.status(500).json({ error: 'Failed to load channels' });
  }
};

// POST /api/admin/channels
export const createAdminChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = req.user!;
    const { name, description, memberIds, isDefault, isSystem, membershipPolicy } = req.body;

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Channel name is required.' });
      return;
    }

    if (isSystem && actor.role !== 'super_admin') {
      res.status(403).json({ error: 'Only super admins can create system channels.' });
      return;
    }

    if ((isDefault || membershipPolicy === 'admin_managed') && !hasRequiredRole(actor.role, 'admin')) {
      res.status(403).json({ error: 'Only admins can create default or admin-managed channels.' });
      return;
    }

    const resolvedMembershipPolicy =
      isDefault === true ? 'admin_managed' : (membershipPolicy || 'invite_only');

    const channel = await Channel.create({
      name: String(name).trim(),
      description: normalizeOptionalString(description) ?? null,
      isGroup: true,
      isSystem: Boolean(isSystem),
      isDefault: Boolean(isDefault),
      membershipPolicy: resolvedMembershipPolicy,
      createdBy: actor.id,
    });

    await ChannelMember.create({
      channelId: channel.id,
      userId: actor.id,
      role: 'admin',
      lastReadAt: new Date(),
    });

    if (channel.isDefault) {
      await syncDefaultChannelMemberships(channel.id);
    } else if (Array.isArray(memberIds) && memberIds.length > 0) {
      const uniqueIds = [...new Set(memberIds.filter((memberId: string) => memberId !== actor.id))];

      for (const memberId of uniqueIds) {
        const user = await User.findByPk(memberId);
        if (!user) {
          continue;
        }

        await ChannelMember.findOrCreate({
          where: { channelId: channel.id, userId: memberId },
          defaults: {
            channelId: channel.id,
            userId: memberId,
            role: 'member',
            lastReadAt: new Date(),
          },
        });
      }
    }

    await createAuditLog({
      actorId: actor.id,
      action: 'channel.created',
      entityType: 'channel',
      entityId: channel.id,
      metadata: {
        isSystem: channel.isSystem,
        isDefault: channel.isDefault,
        membershipPolicy: channel.membershipPolicy,
      },
    });

    const payload = await buildChannelAdminPayload(channel.id);

    res.status(201).json({
      message: 'Channel created successfully.',
      channel: payload,
    });
  } catch (error) {
    console.error('Create admin channel error:', error);
    res.status(500).json({ error: 'Failed to create channel' });
  }
};

// PATCH /api/admin/channels/:id
export const updateAdminChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = req.user!;
    const channelId = String(req.params.id);
    const channel = await Channel.findByPk(channelId);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found.' });
      return;
    }

    if (channel.isSystem && actor.role !== 'super_admin') {
      const protectedFields = ['isSystem', 'isDefault', 'membershipPolicy', 'name', 'description']
        .filter((field) => req.body[field] !== undefined);

      if (protectedFields.length > 0) {
        res.status(403).json({ error: 'Only super admins can update system channels.' });
        return;
      }
    }

    const updates: Record<string, unknown> = {};
    const auditMetadata: Record<string, unknown> = {};

    if (req.body.name !== undefined) {
      const nextName = String(req.body.name).trim();
      if (!nextName) {
        res.status(400).json({ error: 'Channel name cannot be empty.' });
        return;
      }

      updates.name = nextName;
      auditMetadata.name = nextName;
    }

    const nextDescription = normalizeOptionalString(req.body.description);
    if (nextDescription !== undefined) {
      updates.description = nextDescription;
      auditMetadata.description = nextDescription;
    }

    if (req.body.isSystem !== undefined) {
      if (actor.role !== 'super_admin') {
        res.status(403).json({ error: 'Only super admins can change the system flag.' });
        return;
      }

      updates.isSystem = Boolean(req.body.isSystem);
      auditMetadata.isSystem = Boolean(req.body.isSystem);
    }

    if (req.body.isDefault !== undefined) {
      if (!hasRequiredRole(actor.role, 'admin')) {
        res.status(403).json({ error: 'Only admins can change the default membership flag.' });
        return;
      }

      updates.isDefault = Boolean(req.body.isDefault);
      auditMetadata.isDefault = Boolean(req.body.isDefault);
    }

    if (req.body.membershipPolicy !== undefined) {
      if (!['open', 'invite_only', 'admin_managed'].includes(req.body.membershipPolicy)) {
        res.status(400).json({ error: 'Invalid membership policy.' });
        return;
      }

      if (req.body.membershipPolicy === 'admin_managed' && !hasRequiredRole(actor.role, 'admin')) {
        res.status(403).json({ error: 'Only admins can set admin-managed membership.' });
        return;
      }

      updates.membershipPolicy = req.body.membershipPolicy;
      auditMetadata.membershipPolicy = req.body.membershipPolicy;
    }

    if ((updates.isDefault === true || channel.isDefault) && updates.membershipPolicy === undefined && updates.isDefault !== false) {
      updates.membershipPolicy = 'admin_managed';
      auditMetadata.membershipPolicy = 'admin_managed';
    }

    if (!Object.keys(updates).length) {
      res.status(400).json({ error: 'No valid channel fields were provided.' });
      return;
    }

    await channel.update(updates);

    if (channel.isDefault) {
      await syncDefaultChannelMemberships(channel.id);
    }

    await createAuditLog({
      actorId: actor.id,
      action: 'channel.updated',
      entityType: 'channel',
      entityId: channel.id,
      metadata: auditMetadata,
    });

    const payload = await buildChannelAdminPayload(channel.id);

    res.json({
      message: 'Channel updated successfully.',
      channel: payload,
    });
  } catch (error) {
    console.error('Update admin channel error:', error);
    res.status(500).json({ error: 'Failed to update channel' });
  }
};

// POST /api/admin/channels/:id/sync-default-membership
export const syncAdminChannelDefaultMembership = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const channelId = String(req.params.id);
    const channel = await Channel.findByPk(channelId);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found.' });
      return;
    }

    if (!channel.isDefault) {
      res.status(400).json({ error: 'Only default channels can force membership sync.' });
      return;
    }

    const results = await syncDefaultChannelMemberships(channel.id);
    const result = results[0] || { addedCount: 0, creatorPromoted: false };

    await createAuditLog({
      actorId: req.user!.id,
      action: 'channel.default_membership_synced',
      entityType: 'channel',
      entityId: channel.id,
      metadata: result,
    });

    res.json({
      message: 'Default membership sync complete.',
      result,
    });
  } catch (error) {
    console.error('Sync admin channel membership error:', error);
    res.status(500).json({ error: 'Failed to sync channel membership' });
  }
};

// POST /api/admin/channels/:id/members
export const addAdminChannelMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = req.user!;
    const channelId = String(req.params.id);
    const { userIds } = req.body;
    const channel = await Channel.findByPk(channelId);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found.' });
      return;
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      res.status(400).json({ error: 'userIds must be a non-empty array.' });
      return;
    }

    if (channel.isDefault) {
      res.status(400).json({ error: 'Default channels enforce membership automatically. Use the sync action instead.' });
      return;
    }

    if (isProtectedChannel(channel) && !hasRequiredRole(actor.role, 'admin')) {
      res.status(403).json({ error: 'Only admins can add members to protected channels.' });
      return;
    }

    const addedUserIds: string[] = [];

    for (const userId of [...new Set(userIds)]) {
      const user = await User.findByPk(userId);
      if (!user) {
        continue;
      }

      const [membership, created] = await ChannelMember.findOrCreate({
        where: { channelId: channel.id, userId },
        defaults: {
          channelId: channel.id,
          userId,
          role: 'member',
          lastReadAt: new Date(),
        },
      });

      if (created) {
        addedUserIds.push(membership.userId);
      }
    }

    await createAuditLog({
      actorId: actor.id,
      action: 'channel.members_added',
      entityType: 'channel',
      entityId: channel.id,
      metadata: { addedUserIds },
    });

    const payload = await buildChannelAdminPayload(channel.id);

    res.status(201).json({
      message: 'Members processed successfully.',
      addedUserIds,
      channel: payload,
    });
  } catch (error) {
    console.error('Add admin channel members error:', error);
    res.status(500).json({ error: 'Failed to add channel members' });
  }
};

// DELETE /api/admin/channels/:id/members/:memberId
export const removeAdminChannelMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = req.user!;
    const channelId = String(req.params.id);
    const memberId = String(req.params.memberId);
    const channel = await Channel.findByPk(channelId);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found.' });
      return;
    }

    if (channel.isDefault) {
      res.status(400).json({ error: 'Default channels enforce membership. Turn off the default flag before removing members.' });
      return;
    }

    if (channel.isSystem && actor.role !== 'super_admin') {
      res.status(403).json({ error: 'Only super admins can remove members from system channels.' });
      return;
    }

    if (isProtectedChannel(channel) && !hasRequiredRole(actor.role, 'admin')) {
      res.status(403).json({ error: 'Only admins can remove members from protected channels.' });
      return;
    }

    const membership = await ChannelMember.findOne({
      where: { channelId: channel.id, userId: memberId },
    });

    if (!membership) {
      res.status(404).json({ error: 'Member not found in this channel.' });
      return;
    }

    await membership.destroy();

    await createAuditLog({
      actorId: actor.id,
      action: 'channel.member_removed',
      entityType: 'channel',
      entityId: channel.id,
      metadata: { memberId },
    });

    const payload = await buildChannelAdminPayload(channel.id);

    res.json({
      message: 'Member removed successfully.',
      channel: payload,
    });
  } catch (error) {
    console.error('Remove admin channel member error:', error);
    res.status(500).json({ error: 'Failed to remove channel member' });
  }
};

// DELETE /api/admin/channels/:id
export const deleteAdminChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const actor = req.user!;
    const channelId = String(req.params.id);
    const channel = await Channel.findByPk(channelId);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found.' });
      return;
    }

    if (channel.isSystem && actor.role !== 'super_admin') {
      res.status(403).json({ error: 'Only super admins can delete system channels.' });
      return;
    }

    if (channel.isDefault && !hasRequiredRole(actor.role, 'admin')) {
      res.status(403).json({ error: 'Only admins can delete default channels.' });
      return;
    }

    const messageIds = (
      await Message.findAll({
        where: { channelId: channel.id },
        attributes: ['id'],
      })
    ).map((message) => message.id);

    if (messageIds.length > 0) {
      await Reaction.destroy({
        where: { messageId: { [Op.in]: messageIds } },
      });
    }

    await Message.destroy({ where: { channelId: channel.id } });
    await ChannelMember.destroy({ where: { channelId: channel.id } });
    await channel.destroy();

    await createAuditLog({
      actorId: actor.id,
      action: 'channel.deleted',
      entityType: 'channel',
      entityId: channelId,
      metadata: {
        isSystem: channel.isSystem,
        isDefault: channel.isDefault,
      },
    });

    res.json({ message: 'Channel deleted successfully.' });
  } catch (error) {
    console.error('Delete admin channel error:', error);
    res.status(500).json({ error: 'Failed to delete channel' });
  }
};

// GET /api/admin/audit-logs
export const listAuditLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { action, entityType, page = 1, limit = 25 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const whereClause: any = {};

    if (action && typeof action === 'string') {
      whereClause.action = { [Op.iLike]: `%${action.trim()}%` };
    }

    if (entityType && typeof entityType === 'string') {
      whereClause.entityType = entityType.trim();
    }

    const { count, rows } = await AuditLog.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'actor',
          attributes: ['id', 'name', 'email', 'role'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: Number(limit),
      offset,
    });

    res.json({
      auditLogs: rows.map((row: any) => ({
        ...row.toJSON(),
        actor: row.actor?.toJSON?.() ?? null,
      })),
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(count / Number(limit)),
      },
    });
  } catch (error) {
    console.error('List audit logs error:', error);
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
};
