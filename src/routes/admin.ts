import { Router } from 'express';
import {
  addAdminChannelMembers,
  createAdminChannel,
  createAdminUser,
  deleteAdminChannel,
  disableAdminUser,
  getAdminOverview,
  importAdminUsersFromCsv,
  listAdminChannels,
  listAdminUsers,
  listAuditLogs,
  reactivateAdminUser,
  removeAdminChannelMember,
  resetAdminUserSessions,
  syncAdminChannelDefaultMembership,
  updateAdminChannel,
  updateAdminUser,
} from '../controllers/adminController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/overview', requireRole('manager'), getAdminOverview);
router.get('/users', requireRole('manager'), listAdminUsers);
router.post('/users', requireRole('admin'), createAdminUser);
router.post('/users/import', requireRole('admin'), importAdminUsersFromCsv);
router.patch('/users/:id', requireRole('admin'), updateAdminUser);
router.post('/users/:id/disable', requireRole('admin'), disableAdminUser);
router.post('/users/:id/reactivate', requireRole('admin'), reactivateAdminUser);
router.post('/users/:id/reset-sessions', requireRole('admin'), resetAdminUserSessions);

router.get('/channels', requireRole('manager'), listAdminChannels);
router.post('/channels', requireRole('manager'), createAdminChannel);
router.patch('/channels/:id', requireRole('manager'), updateAdminChannel);
router.post('/channels/:id/sync-default-membership', requireRole('admin'), syncAdminChannelDefaultMembership);
router.post('/channels/:id/members', requireRole('manager'), addAdminChannelMembers);
router.delete('/channels/:id/members/:memberId', requireRole('manager'), removeAdminChannelMember);
router.delete('/channels/:id', requireRole('manager'), deleteAdminChannel);

router.get('/audit-logs', requireRole('admin'), listAuditLogs);

export default router;
