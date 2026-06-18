import { Router, Request, Response } from 'express';
import { createVerify, createPublicKey } from 'node:crypto';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { logAudit } from '../services/audit';
import { getTokenUsdValue } from '../services/fxHedge';
import { logger } from '../lib/logger';

export const webhookRouter = Router();

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.guardagent.org';
const OUR_ENDPOINT = `${API_BASE}/api/webhooks/circle`;

const PLATFORM_ADMIN_WALLETS = (process.env.PLATFORM_ADMIN_WALLETS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pubKeyCache = new Map<string, string>();

function dcwClient() {
  return initiateDeveloperControlledWalletsClient({ apiKey: CIRCLE_API_KEY, entitySecret: CIRCLE_ENTITY_SECRET });
}

async function effectivePlatformAdminAddress(req: AuthRequest): Promise<string | null> {
  const { getEffectiveEvmAddress } = await import('../services/circleUcw');
  const effective = await getEffectiveEvmAddress(req.userId!);
  if (effective) return effective.toLowerCase();
  return (req.walletAddress || '').toLowerCase() || null;
}

async function isPlatformAdmin(req: AuthRequest): Promise<boolean> {
  const addr = await effectivePlatformAdminAddress(req);
  return !!addr && PLATFORM_ADMIN_WALLETS.includes(addr);
}

async function requirePlatformAdmin(req: AuthRequest, res: Response): Promise<boolean> {
  if (PLATFORM_ADMIN_WALLETS.length === 0) {
    res.status(403).json({ error: 'Subscription management is disabled (set PLATFORM_ADMIN_WALLETS)' });
    return false;
  }
  if (!(await isPlatformAdmin(req))) {
    res.status(403).json({ error: 'Platform admin only' });
    return false;
  }
  return true;
}

interface SubscriptionView {
  id: string;
  name: string | null;
  endpoint: string;
  enabled: boolean;
  restricted: boolean | null;
  notificationTypes: string[] | null;
  createDate: string | null;
  updateDate: string | null;
  isOurs: boolean;
}

function toSubscriptionView(s: {
  id: string; name?: string; endpoint: string; enabled: boolean;
  restricted?: boolean; notificationTypes?: string[]; createDate?: string; updateDate?: string;
}): SubscriptionView {
  return {
    id: s.id,
    name: s.name ?? null,
    endpoint: s.endpoint,
    enabled: s.enabled,
    restricted: s.restricted ?? null,
    notificationTypes: s.notificationTypes ?? null,
    createDate: s.createDate ?? null,
    updateDate: s.updateDate ?? null,
    isOurs: s.endpoint === OUR_ENDPOINT,
  };
}

interface NotificationSummary {
  kind: 'transaction' | 'other';
  matched: boolean;
  reconciled?: 'status_updated' | 'inbound_recorded' | 'duplicate' | 'no_match';
  txHash?: string;
  userId?: string;
}

function mapState(state: string): string | null {
  const s = state.toUpperCase();
  if (s === 'COMPLETE' || s === 'CONFIRMED') return 'SUCCESS';
  if (s === 'FAILED' || s === 'CANCELLED' || s === 'DENIED') return 'FAILED';
  return null;
}

async function processNotification(body: Record<string, unknown>): Promise<NotificationSummary> {
  const type = String(body.notificationType ?? '');
  const n = (body.notification ?? body) as Record<string, unknown>;

  if (type.startsWith('contracts.eventLogs') || type.startsWith('contracts.events') || type.startsWith('eventLogs')) {
    const eventTxHash = typeof n.txHash === 'string' ? n.txHash : undefined;
    return { kind: 'other', matched: true, reconciled: 'no_match', txHash: eventTxHash };
  }

  const txHash = typeof n.txHash === 'string' ? n.txHash : undefined;
  const state = typeof n.state === 'string' ? n.state : '';
  if (!type.startsWith('transactions') || !txHash) return { kind: 'other', matched: false };

  const existing = await prisma.agentTransaction.findFirst({ where: { txHash }, select: { id: true, status: true } });
  if (existing) {
    const mapped = mapState(state);
    if (mapped && mapped !== existing.status) {
      await prisma.agentTransaction.update({ where: { id: existing.id }, data: { status: mapped } });
      return { kind: 'transaction', matched: true, reconciled: 'status_updated', txHash };
    }
    return { kind: 'transaction', matched: true, reconciled: 'duplicate', txHash };
  }

  const direction = String(n.transactionType ?? '').toUpperCase();
  const dest = typeof n.destinationAddress === 'string' ? n.destinationAddress.toLowerCase() : '';
  if (direction === 'INBOUND' && dest && mapState(state) === 'SUCCESS') {
    const wallet = await prisma.agentWallet.findFirst({ where: { agentAddress: { equals: dest, mode: 'insensitive' } }, select: { userId: true } });
    if (!wallet) return { kind: 'transaction', matched: false, reconciled: 'no_match', txHash };
    const amounts = Array.isArray(n.amounts) ? n.amounts : [];
    const amount = amounts.length ? String(amounts[0]) : '0';
    const token = (n.token ?? {}) as { symbol?: string };
    const symbol = typeof token.symbol === 'string' ? token.symbol : 'USDC';
    const usd = await getTokenUsdValue(symbol, parseFloat(amount) || 0);
    await prisma.agentTransaction.create({
      data: { userId: wallet.userId, type: 'RECEIVE', tokenIn: symbol, tokenOut: symbol, amount, amountUsd: usd > 0 ? usd : null, txHash, status: 'SUCCESS', network: 'arc-testnet' },
    });
    return { kind: 'transaction', matched: true, reconciled: 'inbound_recorded', txHash, userId: wallet.userId };
  }

  return { kind: 'transaction', matched: false, reconciled: 'no_match', txHash };
}

async function circleVerify(rawBody: Buffer | undefined, keyId: string, signature: string): Promise<boolean> {
  if (!rawBody || !keyId || !signature || !CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) return false;
  try {
    let b64 = pubKeyCache.get(keyId);
    if (!b64) {
      const r = await dcwClient().getNotificationSignature(keyId);
      b64 = r.data?.publicKey;
      if (b64) pubKeyCache.set(keyId, b64);
    }
    if (!b64) return false;
    const pem = `-----BEGIN PUBLIC KEY-----\n${b64.replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----\n`;
    const key = createPublicKey(pem);
    return createVerify('SHA256').update(rawBody).verify(key, Buffer.from(signature, 'base64'));
  } catch (err) {
    logger.warn('webhook', 'signature verification failed', err);
    return false;
  }
}

// Public endpoint - Circle posts wallet/transaction notifications here.
webhookRouter.post('/circle', async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const type = String(body.notificationType ?? body.subscriptionId ?? 'unknown');
  const keyId = String(req.header('X-Circle-Key-Id') ?? '');
  const signature = String(req.header('X-Circle-Signature') ?? '');
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const verified = await circleVerify(rawBody, keyId, signature);
  let summary: NotificationSummary = { kind: 'other', matched: false };
  if (verified) {
    try { summary = await processNotification(body); }
    catch (err) { logger.warn('webhook', 'failed to process notification', err); }
  }
  try {
    await logAudit({ userId: summary.userId ?? null, actor: 'circle-webhook', action: `WEBHOOK_${type.toUpperCase()}`, detail: { verified, reconciled: summary.reconciled, ...body } });
  } catch (err) {
    logger.warn('webhook', 'failed to log circle notification', err);
  }
  res.status(200).json({ received: true, verified, reconciled: summary.reconciled ?? null });
});

webhookRouter.post('/register', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) {
    res.status(503).json({ error: 'Circle not configured' });
    return;
  }
  if (!(await requirePlatformAdmin(req, res))) return;
  try {
    const client = dcwClient();
    const existing = await client.listSubscriptions();
    const list = existing.data ?? [];
    const match = list.find((s) => s.endpoint === OUR_ENDPOINT);
    if (match) {
      res.json({ ok: true, endpoint: OUR_ENDPOINT, subscription: toSubscriptionView(match), reused: true });
      return;
    }
    const r = await client.createSubscription({ endpoint: OUR_ENDPOINT });
    const created = r.data;
    res.json({ ok: true, endpoint: OUR_ENDPOINT, subscription: created ? toSubscriptionView(created) : null, reused: false });
  } catch (err) {
    logger.error('webhook', 'register failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Register failed', endpoint: OUR_ENDPOINT });
  }
});

webhookRouter.get('/subscriptions', requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) {
    res.status(503).json({ error: 'Circle not configured' });
    return;
  }
  try {
    const r = await dcwClient().listSubscriptions();
    const subs = (r.data ?? []).map(toSubscriptionView);
    res.json({ subscriptions: subs, ourEndpoint: OUR_ENDPOINT });
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
                ?? (err as { status?: number })?.status;
    // Circle returns 403/404 when notification subscriptions are not enabled for
    // this account - an expected config state, not a server fault. Degrade to an
    // empty list and log at warn so it does not spam Sentry on every page load.
    if (status === 403 || status === 404) {
      logger.warn('webhook', `Circle subscriptions not available (status ${status}) - returning empty list`);
      res.json({ subscriptions: [], ourEndpoint: OUR_ENDPOINT, notice: 'Circle notification subscriptions are not enabled for this account.' });
      return;
    }
    logger.error('webhook', 'list subscriptions failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'List failed' });
  }
});

webhookRouter.patch('/subscriptions/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) { res.status(400).json({ error: 'Invalid subscription id' }); return; }
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) { res.status(503).json({ error: 'Circle not configured' }); return; }
  if (!(await requirePlatformAdmin(req, res))) return;

  const body = (req.body ?? {}) as { name?: string; enabled?: boolean };
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length === 0 || body.name.length > 80)) {
    res.status(400).json({ error: 'name must be 1-80 characters' }); return;
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be boolean' }); return;
  }
  try {
    const client = dcwClient();
    const current = await client.getSubscription(id);
    const cur = current.data;
    if (!cur) { res.status(404).json({ error: 'Subscription not found' }); return; }
    const nextName = body.name ?? cur.name;
    const nextEnabled = body.enabled ?? cur.enabled;
    const r = await client.updateSubscription({ id, name: nextName, enabled: nextEnabled });
    const updated = r.data;
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'WEBHOOK_SUBSCRIPTION_UPDATED', detail: { id, name: nextName, enabled: nextEnabled } });
    res.json({ subscription: updated ? toSubscriptionView(updated) : null });
  } catch (err) {
    logger.error('webhook', 'update subscription failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Update failed' });
  }
});

webhookRouter.delete('/subscriptions/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) { res.status(400).json({ error: 'Invalid subscription id' }); return; }
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) { res.status(503).json({ error: 'Circle not configured' }); return; }
  if (!(await requirePlatformAdmin(req, res))) return;
  try {
    await dcwClient().deleteSubscription(id);
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'WEBHOOK_SUBSCRIPTION_DELETED', detail: { id } });
    res.json({ ok: true, id });
  } catch (err) {
    logger.error('webhook', 'delete subscription failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Delete failed' });
  }
});

// Authenticated - is the push channel configured, and how live is it.
webhookRouter.get('/status', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const endpoint = `${API_BASE}/api/webhooks/circle`;
  const configured = !!(CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.auditLog.count({ where: { actor: 'circle-webhook', createdAt: { gte: since } } }).catch(() => 0);
  const last = await prisma.auditLog.findFirst({ where: { actor: 'circle-webhook' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }).catch(() => null);
  res.json({ configured, endpoint, eventsLast24h: recent, lastEventAt: last?.createdAt ?? null, userId: req.userId, isPlatformAdmin: await isPlatformAdmin(req), managementEnabled: PLATFORM_ADMIN_WALLETS.length > 0 });
});

// Authenticated - live feed of recent push events for this user plus global system events.
webhookRouter.get('/events', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
  const rows = await prisma.auditLog.findMany({
    where: { actor: 'circle-webhook', OR: [{ userId: req.userId! }, { userId: null }] },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, action: true, detail: true, createdAt: true },
  }).catch(() => []);
  const events = rows.map((r) => {
    const d = (r.detail ?? {}) as Record<string, unknown>;
    const n = (d.notification ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      at: r.createdAt,
      type: r.action.replace(/^WEBHOOK_/, '').toLowerCase(),
      verified: d.verified === true,
      reconciled: (d.reconciled as string | undefined) ?? null,
      txHash: typeof n.txHash === 'string' ? n.txHash : null,
      state: typeof n.state === 'string' ? n.state : null,
    };
  });
  res.json({ events });
});
