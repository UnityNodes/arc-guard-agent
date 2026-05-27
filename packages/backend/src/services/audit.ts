import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface AuditEntry {
  orgId?: string | null;
  userId?: string | null;
  actor: string;
  action: string;
  detail?: unknown;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        orgId: entry.orgId ?? null,
        userId: entry.userId ?? null,
        actor: entry.actor,
        action: entry.action,
        detail: (entry.detail ?? undefined) as never,
      },
    });
  } catch (err) {
    logger.warn('audit', `failed to write audit log for ${entry.action}`, err);
  }
}

export function auditToCsv(rows: Array<{ createdAt: Date; actor: string; action: string; detail: unknown; orgId: string | null; userId: string | null }>): string {
  const header = 'timestamp,actor,action,orgId,userId,detail';
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const lines = rows.map((r) =>
    [r.createdAt.toISOString(), r.actor, r.action, r.orgId ?? '', r.userId ?? '', esc(r.detail)].map(esc).join(','),
  );
  return [header, ...lines].join('\n');
}
