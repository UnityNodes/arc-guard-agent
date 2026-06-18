import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { logger } from '../lib/logger';
import {
  USDC_ADDRESS, EURC_ADDRESS, MEMO_CONTRACT,
  TRANSFER_TOPIC, BLOCKLISTED_TOPIC, UNBLOCKLISTED_TOPIC, MEMO_TOPIC,
  getCombinedActivity, getBlocklistState, getBlocklistEvents,
} from '../services/arcEvents';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function parseBigIntParam(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  try { return BigInt(value); } catch { return undefined; }
}

eventsRouter.get('/contracts', (_req: AuthRequest, res: Response): void => {
  res.json({
    usdc: USDC_ADDRESS,
    eurc: EURC_ADDRESS,
    memo: MEMO_CONTRACT,
    topics: {
      transfer: TRANSFER_TOPIC,
      blocklisted: BLOCKLISTED_TOPIC,
      unblocklisted: UNBLOCKLISTED_TOPIC,
      memo: MEMO_TOPIC,
    },
    network: 'arc-testnet',
    chainId: 5042002,
  });
});

eventsRouter.get('/activity', async (req: AuthRequest, res: Response): Promise<void> => {
  const queryAddress = typeof req.query.address === 'string' ? req.query.address.trim() : '';
  let address = queryAddress;
  if (!address) {
    const wallet = await prisma.agentWallet.findUnique({
      where: { userId: req.userId! },
      select: { agentAddress: true },
    });
    if (!wallet?.agentAddress) { res.status(400).json({ error: 'No agent wallet, pass ?address=0x… explicitly' }); return; }
    address = wallet.agentAddress;
  }
  if (!ADDR_RE.test(address)) { res.status(400).json({ error: 'Invalid address' }); return; }

  const fromBlock = parseBigIntParam(req.query.fromBlock);
  const toBlock   = parseBigIntParam(req.query.toBlock);

  try {
    const activity = await getCombinedActivity(address, fromBlock, toBlock);
    const blocklist = await getBlocklistState().catch(() => ({ blocked: [] as string[], asOfBlock: '0' }));
    const blockedSet = new Set(blocklist.blocked.map((a) => a.toLowerCase()));
    const isCallerBlocked = blockedSet.has(address.toLowerCase());

    res.json({
      address: activity.address,
      range: activity.range,
      items: activity.items,
      blocklist: {
        asOfBlock: blocklist.asOfBlock,
        isCallerBlocked,
        totalBlocked: blocklist.blocked.length,
      },
    });
  } catch (err) {
    logger.error('events', 'activity failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'activity failed' });
  }
});

eventsRouter.get('/pushed', async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
  const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const rows = await prisma.auditLog.findMany({
      where: {
        actor: 'circle-webhook',
        action: { in: ['WEBHOOK_CONTRACTS.EVENTLOGS', 'WEBHOOK_CONTRACTS.EVENTS', 'WEBHOOK_EVENTLOGS', 'WEBHOOK_CONTRACTS.EVENTLOGS.INBOUND', 'WEBHOOK_CONTRACTS.EVENTLOGS.OUTBOUND'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, action: true, detail: true, createdAt: true },
    });
    const events = rows.map((r) => {
      const d = (r.detail ?? {}) as Record<string, unknown>;
      const n = (d.notification ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        at: r.createdAt,
        type: r.action.replace(/^WEBHOOK_/, '').toLowerCase(),
        verified: d.verified === true,
        contractAddress: typeof n.contractAddress === 'string' ? n.contractAddress : null,
        eventSignature: typeof n.eventSignature === 'string' ? n.eventSignature : null,
        txHash: typeof n.txHash === 'string' ? n.txHash : null,
        blockNumber: typeof n.blockNumber === 'string' || typeof n.blockNumber === 'number' ? String(n.blockNumber) : null,
        topics: Array.isArray(n.topics) ? n.topics : null,
        data: typeof n.data === 'string' ? n.data : null,
      };
    });
    res.json({ events });
  } catch (err) {
    logger.error('events', 'pushed feed failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'pushed events failed' });
  }
});

eventsRouter.get('/blocklist', async (req: AuthRequest, res: Response): Promise<void> => {
  const wantHistory = req.query.history === '1';
  try {
    if (wantHistory) {
      const fromBlock = parseBigIntParam(req.query.fromBlock);
      const toBlock   = parseBigIntParam(req.query.toBlock);
      const events = await getBlocklistEvents(fromBlock, toBlock);
      res.json({ events });
      return;
    }
    const state = await getBlocklistState();
    res.json({ state });
  } catch (err) {
    logger.error('events', 'blocklist failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'blocklist failed' });
  }
});
