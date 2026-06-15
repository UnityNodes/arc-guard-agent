import { Router, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { executeFxSwap } from '../services/arcFx';
import { getAgentBalance, ARC_NETWORK } from '../services/arckit';

export const botSwapRouter = Router();

const bodySchema = z.object({
  alertId: z.string().min(1).max(64),
});

function secretMatches(provided: string | undefined, expected: string): boolean {
  const a = Buffer.from(createHash('sha256').update(provided ?? '').digest());
  const b = Buffer.from(createHash('sha256').update(expected).digest());
  return timingSafeEqual(a, b);
}

botSwapRouter.post('/execute', async (req: Request, res: Response): Promise<void> => {
  const expected = process.env.BOT_SHARED_SECRET;
  if (!expected || expected.length < 24) {
    res.status(503).json({ error: 'Bot swap endpoint not configured' });
    return;
  }

  if (!secretMatches(req.headers['x-bot-secret'] as string | undefined, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const { alertId } = parsed.data;

  const grant = await prisma.botSwapGrant.findUnique({
    where: { alertId },
    include: { user: { select: { walletAddress: true } } },
  });

  if (!grant) {
    res.status(404).json({ error: 'No grant for this alert' });
    return;
  }
  if (grant.usedAt) {
    res.status(409).json({ error: 'Grant already used' });
    return;
  }
  if (grant.expiresAt < new Date()) {
    res.status(410).json({ error: 'Grant expired' });
    return;
  }

  const consumed = await prisma.botSwapGrant.updateMany({
    where: { id: grant.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) {
    res.status(409).json({ error: 'Grant already used' });
    return;
  }

  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: { rule: { select: { tokenSymbol: true, condition: true } } },
  });
  if (!alert) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }

  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: grant.userId },
    select: { circleWalletId: true, isActive: true, maxTxSizeUsd: true, dailyLimitUsd: true, slippagePercent: true, network: true },
  });

  if (!wallet?.circleWalletId) {
    res.status(404).json({ error: 'No agent wallet for user' });
    return;
  }
  if (!wallet.isActive) {
    res.status(403).json({ error: 'Agent wallet disabled' });
    return;
  }

  const lockKey = `swap-lock:${grant.userId}`;
  const lockAcquired = await redis.set(lockKey, '1', 'EX', 120, 'NX');
  if (!lockAcquired) {
    res.status(429).json({ error: 'Swap in progress' });
    return;
  }

  try {
    const tokenSymbol = alert.rule?.tokenSymbol?.toUpperCase() ?? 'USDC';
    const condition = alert.rule?.condition ?? 'BELOW';

    const fromToken = tokenSymbol === 'USDC' && condition === 'BELOW' ? 'USDC'
      : tokenSymbol === 'EURC' && condition === 'BELOW' ? 'EURC'
      : tokenSymbol === 'USDC' && condition === 'ABOVE' ? 'EURC'
      : 'USDC';
    const toToken = fromToken === 'USDC' ? 'EURC' : 'USDC';

    const balance = await getAgentBalance(wallet.circleWalletId);
    const available = fromToken === 'USDC' ? parseFloat(balance.usdc) : parseFloat(balance.eurc);
    const swapAmount = Math.min(available, wallet.maxTxSizeUsd);

    if (swapAmount < 0.01) {
      res.status(400).json({ error: `Insufficient ${fromToken} balance for protective swap` });
      return;
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayTxs = await prisma.agentTransaction.findMany({
      where: { userId: grant.userId, createdAt: { gte: todayStart }, status: 'SUCCESS' },
      select: { amountUsd: true },
    });
    const dailyTotal = todayTxs.reduce((sum, tx) => sum + (tx.amountUsd ?? 0), 0);
    if (dailyTotal + swapAmount > wallet.dailyLimitUsd) {
      res.status(400).json({ error: 'Daily limit reached' });
      return;
    }

    const slippageBps = Math.round((wallet.slippagePercent ?? 0.5) * 100);
    const result = await executeFxSwap(wallet.circleWalletId, fromToken, toToken, swapAmount.toFixed(2), slippageBps);

    const network = wallet.network || ARC_NETWORK;
    await prisma.agentTransaction.create({
      data: {
        userId: grant.userId,
        type: 'SWAP',
        tokenIn: fromToken,
        tokenOut: toToken,
        amount: swapAmount.toFixed(2),
        amountUsd: swapAmount,
        txHash: result.txHash,
        status: 'SUCCESS',
        network,
      },
    }).catch((err: unknown) => { logger.error('audit', 'Failed to log bot swap', err); });

    res.json({
      fromAmount: `${swapAmount.toFixed(2)} ${fromToken}`,
      toAmount: `${result.amountOut ?? '?'} ${toToken}`,
      txHash: result.txHash,
      network,
    });
  } catch (err) {
    const isRouteUnavailable = err instanceof Error && (err as { code?: string }).code === 'SWAP_ROUTE_UNAVAILABLE';
    if (isRouteUnavailable) logger.warn('botSwap', 'Swap route unavailable', err instanceof Error ? err.message : err);
    else logger.error('botSwap', 'Bot swap failed', err);
    res.status(isRouteUnavailable ? 503 : 500).json({ error: err instanceof Error ? err.message : 'Swap failed' });
  } finally {
    await redis.del(lockKey);
  }
});
