import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { logger } from '../lib/logger';
import {
  isScpConfigured,
  listEventMonitors,
  createEventMonitor,
  updateEventMonitor,
  deleteEventMonitor,
  ensureDefaultMonitors,
  defaultArcMonitors,
} from '../services/arcEventMonitor';
import { getEffectiveEvmAddress } from '../services/circleUcw';
import { logAudit } from '../services/audit';

export const eventMonitorRouter = Router();
eventMonitorRouter.use(requireAuth);

const PLATFORM_ADMIN_WALLETS = (process.env.PLATFORM_ADMIN_WALLETS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function isPlatformAdmin(req: AuthRequest): Promise<boolean> {
  if (PLATFORM_ADMIN_WALLETS.length === 0) return false;
  const effective = await getEffectiveEvmAddress(req.userId!);
  const addr = (effective ?? req.walletAddress ?? '').toLowerCase();
  return !!addr && PLATFORM_ADMIN_WALLETS.includes(addr);
}

async function requireAdmin(req: AuthRequest, res: Response): Promise<boolean> {
  if (PLATFORM_ADMIN_WALLETS.length === 0) {
    res.status(403).json({ error: 'Event monitor management disabled (set PLATFORM_ADMIN_WALLETS)' });
    return false;
  }
  if (!(await isPlatformAdmin(req))) {
    res.status(403).json({ error: 'Platform admin only' });
    return false;
  }
  return true;
}

const createSchema = z.object({
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  eventSignature:  z.string().min(8).max(200).refine((s) => !/\s/.test(s), 'must not contain spaces'),
});

const updateSchema = z.object({
  isEnabled: z.boolean(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

eventMonitorRouter.get('/status', async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({
    configured: isScpConfigured(),
    managementEnabled: PLATFORM_ADMIN_WALLETS.length > 0,
    isPlatformAdmin: await isPlatformAdmin(req),
    defaults: defaultArcMonitors(),
  });
});

eventMonitorRouter.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  if (!isScpConfigured()) { res.status(503).json({ error: 'SCP not configured' }); return; }
  try {
    const monitors = await listEventMonitors();
    res.json({ monitors });
  } catch (err) {
    logger.error('eventMonitor', 'list failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'List failed' });
  }
});

eventMonitorRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const m = await createEventMonitor(parsed.data.contractAddress, parsed.data.eventSignature);
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'EVENT_MONITOR_CREATED', detail: { id: m.id, contractAddress: m.contractAddress, eventSignature: m.eventSignature } });
    res.json({ monitor: m });
  } catch (err) {
    logger.error('eventMonitor', 'create failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Create failed' });
  }
});

eventMonitorRouter.post('/ensure-defaults', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const r = await ensureDefaultMonitors();
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'EVENT_MONITOR_ENSURE_DEFAULTS', detail: { createdCount: r.created.length, reusedCount: r.reused.length } });
    res.json(r);
  } catch (err) {
    logger.error('eventMonitor', 'ensure-defaults failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Ensure-defaults failed' });
  }
});

eventMonitorRouter.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const id = req.params.id;
  if (!UUID_RE.test(id)) { res.status(400).json({ error: 'Invalid monitor id' }); return; }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const m = await updateEventMonitor(id, parsed.data.isEnabled);
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'EVENT_MONITOR_UPDATED', detail: { id, isEnabled: parsed.data.isEnabled } });
    res.json({ monitor: m });
  } catch (err) {
    logger.error('eventMonitor', 'update failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

eventMonitorRouter.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!(await requireAdmin(req, res))) return;
  const id = req.params.id;
  if (!UUID_RE.test(id)) { res.status(400).json({ error: 'Invalid monitor id' }); return; }
  try {
    await deleteEventMonitor(id);
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'EVENT_MONITOR_DELETED', detail: { id } });
    res.json({ ok: true, id });
  } catch (err) {
    logger.error('eventMonitor', 'delete failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Delete failed' });
  }
});
