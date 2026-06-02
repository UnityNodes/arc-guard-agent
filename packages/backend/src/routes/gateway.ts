import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { logAudit } from '../services/audit';
import { logger } from '../lib/logger';
import {
  gatewayAddDelegate,
  gatewayRemoveDelegate,
  getGatewayDelegateStatus,
} from '../services/arcGateway';

// ── Circle Gateway delegation ─────────────────────────────────────────────────
// Lets the agent wallet authorize a delegate to spend its Gateway USDC balance,
// so an agent can act for a treasury without holding the funds directly.
// ──────────────────────────────────────────────────────────────────────────────

export const gatewayRouter = Router();
gatewayRouter.use(requireAuth);

const delegateSchema = z.object({
  delegateAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'delegateAddress must be a 0x EVM address'),
  chain: z.string().min(2).max(40).optional(),
});

async function walletIdFor(userId: string): Promise<string | null> {
  const w = await prisma.agentWallet.findUnique({ where: { userId }, select: { circleWalletId: true, isActive: true } });
  if (!w?.circleWalletId || !w.isActive) return null;
  return w.circleWalletId;
}

gatewayRouter.get('/delegate/status', async (req: AuthRequest, res: Response): Promise<void> => {
  const delegateAddress = String(req.query.delegateAddress ?? '');
  if (!/^0x[a-fA-F0-9]{40}$/.test(delegateAddress)) { res.status(400).json({ error: 'delegateAddress query param required (0x EVM)' }); return; }
  const walletId = await walletIdFor(req.userId!);
  if (!walletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }
  try {
    const status = await getGatewayDelegateStatus(walletId, delegateAddress, String(req.query.chain ?? 'arc-testnet'));
    res.json(status);
  } catch (err) {
    logger.error('gateway', 'delegate status failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Status failed' });
  }
});

gatewayRouter.post('/delegate', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = delegateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }); return; }
  const walletId = await walletIdFor(req.userId!);
  if (!walletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }
  try {
    const r = await gatewayAddDelegate(walletId, parsed.data.delegateAddress, parsed.data.chain ?? 'arc-testnet');
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'GATEWAY_DELEGATE_ADDED', detail: { delegateAddress: parsed.data.delegateAddress, txHash: r.txHash } });
    res.json({ ok: true, delegate: r });
  } catch (err) {
    logger.error('gateway', 'add delegate failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Add delegate failed' });
  }
});

gatewayRouter.delete('/delegate', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = delegateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }); return; }
  const walletId = await walletIdFor(req.userId!);
  if (!walletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }
  try {
    const r = await gatewayRemoveDelegate(walletId, parsed.data.delegateAddress, parsed.data.chain ?? 'arc-testnet');
    await logAudit({ userId: req.userId!, actor: req.userId!, action: 'GATEWAY_DELEGATE_REMOVED', detail: { delegateAddress: parsed.data.delegateAddress, txHash: r.txHash } });
    res.json({ ok: true, delegate: r });
  } catch (err) {
    logger.error('gateway', 'remove delegate failed', err);
    res.status(502).json({ error: err instanceof Error ? err.message : 'Remove delegate failed' });
  }
});
