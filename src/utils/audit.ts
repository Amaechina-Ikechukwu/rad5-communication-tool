import { AuditLog } from '../models';

export const createAuditLog = async (params: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> => {
  try {
    await AuditLog.create({
      actorId: params.actorId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
};
