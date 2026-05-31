import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/auth';
import {
  getSupportedChainDetails,
  getBridgeQuote,
  executeBridge,
  getBridgeProgress,
} from '../services/arcBridge';
import { evaluateAction } from '../services/guardian';
import { logAudit } from '../services/audit';
import { redis } from '../lib/redis';

export const bridgeRouter = Router();
bridgeRouter.use(requireAuth);

const quoteSchema = z.object({
  fromChain: z.string().default('arc-testnet'),
  toChain: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/, 'amount must be a positive decimal string'),
  transferSpeed: z.enum(['FAST', 'SLOW']).optional(),
});

const executeSchema = quoteSchema.extend({
  destinationAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

bridgeRouter.get('/chains', (_req: AuthRequest, res: Response): void => {
  res.json({ from: 'arc-testnet', chains: getSupportedChainDetails() });
});

bridgeRouter.post('/quote', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { circleWalletId: true },
  });
  if (!wallet?.circleWalletId) {
    res.status(400).json({ error: 'Agent wallet not configured' });
    return;
  }
  try {
    const quote = await getBridgeQuote(
      wallet.circleWalletId,
      parsed.data.fromChain,
      parsed.data.toChain,
      parsed.data.amount,
      parsed.data.transferSpeed ?? 'FAST',
    );
    res.json(quote);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Quote failed' });
  }
});

bridgeRouter.post('/execute', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = executeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  const userId = req.userId!;
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId },
    select: { circleWalletId: true, agentAddress: true, isActive: true },
  });
  if (!wallet?.circleWalletId) {
    res.status(400).json({ error: 'Agent wallet not configured' });
    return;
  }
  if (!wallet.isActive) {
    res.status(400).json({ error: 'Agent wallet disabled' });
    return;
  }
  const destination = parsed.data.destinationAddress ?? wallet.agentAddress;
  if (!destination) {
    res.status(400).json({ error: 'No destination address available' });
    return;
  }

  const amountNum = parseFloat(parsed.data.amount);
  const guard = await evaluateAction(userId, { action: 'BRIDGE', amountUsd: amountNum, token: 'USDC' });

  if (guard.result.decision === 'DENY') {
    await logAudit({
      userId,
      actor: 'user',
      action: 'BRIDGE_BLOCKED',
      detail: { amount: amountNum, toChain: parsed.data.toChain, reasons: guard.result.reasons },
    });
    res.status(403).json({ blocked: true, decision: 'DENY', reasons: guard.result.reasons });
    return;
  }

  if (guard.result.decision === 'REQUIRE_APPROVAL') {
    res.status(202).json({
      pending: true,
      decision: 'REQUIRE_APPROVAL',
      reasons: guard.result.reasons,
      hint: 'Use chat or /api/agent/pending-tx flow to approve high-value bridges',
    });
    return;
  }

  try {
    const result = await executeBridge(
      wallet.circleWalletId,
      userId,
      parsed.data.fromChain,
      parsed.data.toChain,
      parsed.data.amount,
      destination,
      parsed.data.transferSpeed ?? 'FAST',
    );
    await logAudit({
      userId,
      actor: 'user',
      action: 'BRIDGE_SUBMITTED',
      detail: { bridgeId: result.id, toChain: parsed.data.toChain, amount: parsed.data.amount },
    });
    // Invalidate the transactions history cache so the bridge appears
    // immediately in Recent Activity without waiting 60s for cache expiry.
    const agentWallet = await prisma.agentWallet.findUnique({
      where: { userId },
      select: { agentAddress: true },
    });
    if (agentWallet?.agentAddress) {
      await redis.del(`agent:history:${agentWallet.agentAddress}`).catch(() => {});
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Bridge execution failed' });
  }
});

bridgeRouter.get('/:id/progress', async (req: AuthRequest, res: Response): Promise<void> => {
  const bridgeId = req.params.id;
  const record = await prisma.bridgeTransaction.findUnique({ where: { id: bridgeId }, select: { userId: true } });
  if (!record || record.userId !== req.userId) {
    res.status(404).json({ error: 'Bridge not found' });
    return;
  }
  const events = await getBridgeProgress(bridgeId);
  res.json({ bridgeId, events });
});

bridgeRouter.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const record = await prisma.bridgeTransaction.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, userId: true, fromChain: true, toChain: true,
      fromToken: true, toToken: true, amount: true,
      status: true, txHash: true, destinationTxHash: true,
      error: true, createdAt: true, updatedAt: true,
    },
  });
  if (!record || record.userId !== req.userId) {
    res.status(404).json({ error: 'Bridge not found' });
    return;
  }
  res.json(record);
});

bridgeRouter.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const records = await prisma.bridgeTransaction.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, fromChain: true, toChain: true, amount: true,
      status: true, txHash: true, destinationTxHash: true,
      error: true, createdAt: true,
    },
  });
  res.json({ bridges: records });
});
