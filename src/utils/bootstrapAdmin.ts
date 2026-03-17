import { User } from '../models';
import { createAuditLog } from './audit';

export const seedBootstrapSuperAdmin = async (): Promise<void> => {
  const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD?.trim();

  if (!email || !password) {
    return;
  }

  const name = process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim() || 'Platform Super Admin';
  const existingUser = await User.findOne({ where: { email } });

  if (existingUser) {
    await existingUser.update({
      name,
      role: 'super_admin',
      accountStatus: 'active',
      mustChangePassword: false,
      provisioningSource: 'bootstrap',
    });

    await createAuditLog({
      actorId: existingUser.id,
      action: 'user.bootstrap_promoted',
      entityType: 'user',
      entityId: existingUser.id,
      metadata: { email },
    });
    return;
  }

  const user = await User.create({
    name,
    email,
    password,
    role: 'super_admin',
    accountStatus: 'active',
    mustChangePassword: false,
    provisioningSource: 'bootstrap',
  });

  await createAuditLog({
    actorId: user.id,
    action: 'user.bootstrap_created',
    entityType: 'user',
    entityId: user.id,
    metadata: { email },
  });
};
