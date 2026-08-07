import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { evaluateAction, buildPolicyForUser } from '../services/guardian';
import { logAudit } from '../services/audit';
import { logger } from '../lib/logger';
import { GuardianAction } from '@guardagent/guardian';

import { getAgentBalance } from '../services/arckit';
import {
  isGatewayConfigured, getGatewayBalance, getGatewaySupportedChainDetails,
  gatewayDeposit, gatewaySpend, estimateGatewaySpend,
} from '../services/arcGateway';
import {
  getEarnInfo, getEarnPositionNormalized, earnDeposit, earnWithdraw,
  getEarnDepositQuote, getEarnWithdrawalQuote, claimEarnRewards,
} from '../services/arcEarn';
import { isUsycConfigured, getUsycInfo } from '../services/arcUsyc';
import { getLimitOrders, createLimitOrder, cancelLimitOrder } from '../services/limitOrders';
import { getDCAOrders, createDCAOrder, cancelDCAOrder, pauseDCAOrder, resumeDCAOrder } from '../services/dca';
import { classifySwapRoute } from '../services/swapRouter';

// ── Treasury cockpit ──────────────────────────────────────────────────────────
// One authenticated surface over services that already existed but had no REST
// route: Gateway unified balance, Earn Kit / USYC yield, and the limit-order and
// DCA schedulers. Every value-moving route returns a Guardian decision so the
// client can render one verdict component everywhere.
// ──────────────────────────────────────────────────────────────────────────────

export const treasuryRouter = Router();
treasuryRouter.use(requireAuth);

const OVERVIEW_TTL = 10;
const SDK_TIMEOUT_MS = 8_000;

type Section<T> = { ok: true; data: T } | { ok: false; error: string };

async function section<T>(label: string, fn: () => Promise<T>): Promise<Section<T>> {
  try {
    const data = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), SDK_TIMEOUT_MS)),
    ]);
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('treasury', `${label} unavailable: ${msg}`);
    return { ok: false, error: msg };
  }
}

async function spentTodayUsd(userId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.agentTransaction.findMany({
    where: { userId, createdAt: { gte: todayStart }, status: 'SUCCESS' },
    select: { amountUsd: true },
  });
  return rows.reduce((sum, r) => sum + (r.amountUsd ?? 0), 0);
}

// Runs the policy, then the action. Returns a decision on every path so the UI
// can show the same verdict chip for allow, deny and approval-required.
async function guarded(
  res: Response,
  userId: string,
  action: GuardianAction,
  amountUsd: number,
  token: string,
  auditAction: string,
  exec: () => Promise<{ txHash?: string | null; explorerUrl?: string | null } & Record<string, unknown>>,
): Promise<void> {
  const guard = await evaluateAction(userId, { action, amountUsd, token });

  if (guard.result.decision === 'DENY') {
    await logAudit({ userId, actor: 'user', action: `${auditAction}_BLOCKED`, detail: { amountUsd, token, reasons: guard.result.reasons } });
    res.status(403).json({ ok: false, decision: 'DENY', reasons: guard.result.reasons });
    return;
  }

  if (guard.result.decision === 'REQUIRE_APPROVAL') {
    const pending = await prisma.agentTransaction.create({
      data: {
        userId, type: auditAction, tokenIn: token, tokenOut: token,
        amount: String(amountUsd), amountUsd,
        status: 'PENDING_APPROVAL', network: 'arc-testnet',
      },
    });
    await logAudit({ userId, actor: 'user', action: `${auditAction}_NEEDS_APPROVAL`, detail: { amountUsd, token, txId: pending.id, reasons: guard.result.reasons } });
    res.status(202).json({
      ok: false, decision: 'REQUIRE_APPROVAL', reasons: guard.result.reasons, txId: pending.id,
      hint: 'Approve this in Telegram to execute.',
    });
    return;
  }

  const out = await exec();
  await prisma.agentTransaction.create({
    data: {
      userId, type: auditAction, tokenIn: token, tokenOut: token,
      amount: String(amountUsd), amountUsd,
      txHash: (out.txHash as string) ?? null,
      status: 'SUCCESS', network: 'arc-testnet',
    },
  }).catch(err => logger.error('treasury', 'ledger write failed', err));
  await logAudit({ userId, actor: 'user', action: `${auditAction}_EXECUTED`, detail: { amountUsd, token, ...out } });
  res.json({ ok: true, decision: 'ALLOW', ...out });
}

async function walletFor(userId: string) {
  return prisma.agentWallet.findUnique({
    where: { userId },
    select: { circleWalletId: true, agentAddress: true, isActive: true },
  });
}

// ── Overview ──────────────────────────────────────────────────────────────────

treasuryRouter.get('/overview', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId as string;
  const cacheKey = `treasury:overview:${userId}`;
  const skipCache = req.query.fresh === '1';

  try {
    if (!skipCache) {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) { res.json(JSON.parse(cached)); return; }
    }

    const wallet = await walletFor(userId);
    if (!wallet?.circleWalletId) {
      res.json({ wallet: null, sections: {} });
      return;
    }
    const wid = wallet.circleWalletId;

    const [arcBalance, gateway, earnVault, earnPosition, usyc, limitOrders, dcaOrders, bridges, policy, spentToday] =
      await Promise.all([
        section('arcBalance', () => getAgentBalance(wid)),
        section('gateway', async () => {
          if (!isGatewayConfigured()) throw new Error('Gateway not configured');
          return getGatewayBalance(wid);
        }),
        section('earnVault', () => getEarnInfo()),
        section('earnPosition', () => getEarnPositionNormalized(wid)),
        section('usyc', async () => {
          if (!isUsycConfigured()) throw new Error('USYC not configured');
          return getUsycInfo();
        }),
        section('limitOrders', () => getLimitOrders(userId)),
        section('dcaOrders', () => getDCAOrders(userId)),
        section('bridges', () => prisma.bridgeTransaction.findMany({
          where: { userId }, orderBy: { createdAt: 'desc' }, take: 8,
          select: { id: true, fromChain: true, toChain: true, amount: true, status: true, txHash: true, createdAt: true },
        })),
        section('policy', () => buildPolicyForUser(userId)),
        section('spentToday', () => spentTodayUsd(userId)),
      ]);

    const payload = {
      wallet: { address: wallet.agentAddress, isActive: wallet.isActive },
      sections: { arcBalance, gateway, earnVault, earnPosition, usyc, limitOrders, dcaOrders, bridges, policy, spentToday },
      updatedAt: new Date().toISOString(),
    };

    await redis.set(cacheKey, JSON.stringify(payload), 'EX', OVERVIEW_TTL).catch(() => null);
    res.json(payload);
  } catch (err) {
    logger.error('treasury', 'overview failed', err);
    res.status(503).json({ error: 'Treasury overview temporarily unavailable' });
  }
});

// ── Gateway ───────────────────────────────────────────────────────────────────

treasuryRouter.get('/gateway/chains', (_req: AuthRequest, res: Response): void => {
  try { res.json({ chains: getGatewaySupportedChainDetails('USDC') }); }
  catch (err) { res.status(502).json({ error: err instanceof Error ? err.message : 'failed' }); }
});

const amountSchema = z.object({ amount: z.string().regex(/^\d+(\.\d+)?$/) });

treasuryRouter.post('/gateway/deposit', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = amountSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'amount is required' }); return; }
  const wallet = await walletFor(req.userId as string);
  if (!wallet?.circleWalletId || !wallet.isActive) { res.status(400).json({ error: 'Agent wallet not configured or disabled' }); return; }

  try {
    await guarded(res, req.userId as string, 'TRANSFER', Number(parsed.data.amount), 'USDC', 'GATEWAY_DEPOSIT',
      () => gatewayDeposit(wallet.circleWalletId as string, parsed.data.amount) as Promise<any>);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Gateway deposit failed' });
  }
});

const spendSchema = z.object({
  toChain: z.string().min(1),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
});

treasuryRouter.post('/gateway/spend/estimate', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = spendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const wallet = await walletFor(req.userId as string);
  if (!wallet?.circleWalletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }
  try {
    const est = await estimateGatewaySpend(wallet.circleWalletId, parsed.data.toChain, parsed.data.recipient, parsed.data.amount);
    res.json(est);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'estimate failed' });
  }
});

treasuryRouter.post('/gateway/spend', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = spendSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const wallet = await walletFor(req.userId as string);
  if (!wallet?.circleWalletId || !wallet.isActive) { res.status(400).json({ error: 'Agent wallet not configured or disabled' }); return; }

  try {
    await guarded(res, req.userId as string, 'GATEWAY_SPEND', Number(parsed.data.amount), 'USDC', 'GATEWAY_SPEND',
      () => gatewaySpend(wallet.circleWalletId as string, parsed.data.toChain, parsed.data.recipient, parsed.data.amount) as Promise<any>);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Gateway spend failed' });
  }
});

// ── Earn Kit ──────────────────────────────────────────────────────────────────

treasuryRouter.get('/earn', async (req: AuthRequest, res: Response): Promise<void> => {
  const wallet = await walletFor(req.userId as string);
  if (!wallet?.circleWalletId) { res.json({ vault: null, position: null }); return; }
  const [vault, position] = await Promise.all([
    section('earnVault', () => getEarnInfo()),
    section('earnPosition', () => getEarnPositionNormalized(wallet.circleWalletId as string)),
  ]);
  res.json({ vault, position });
});

treasuryRouter.post('/earn/quote', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = z.object({ amount: z.string().regex(/^\d+(\.\d+)?$/), direction: z.enum(['DEPOSIT', 'WITHDRAW']) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const wallet = await walletFor(req.userId as string);
  if (!wallet?.circleWalletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }
  try {
    const q = parsed.data.direction === 'DEPOSIT'
      ? await getEarnDepositQuote(wallet.circleWalletId, parsed.data.amount)
      : await getEarnWithdrawalQuote(wallet.circleWalletId, parsed.data.amount);
    res.json(q);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'quote failed' });
  }
});

treasuryRouter.post('/earn/deposit', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = amountSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'amount is required' }); return; }
  const wallet = await walletFor(req.userId as string);
  if (!wallet?.circleWalletId || !wallet.isActive) { res.status(400).json({ error: 'Agent wallet not configured or disabled' }); return; }
  try {
    await guarded(res, req.userId as string, 'TRANSFER', Number(parsed.data.amount), 'USDC', 'EARN_DEPOSIT',
      () => earnDeposit(wallet.circleWalletId as string, parsed.data.amount) as Promise<any>);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Earn deposit failed' });
  }
});

treasuryRouter.post('/earn/withdraw', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = amountSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'amount is required' }); return; }
  const wallet = await walletFor(req.userId as string);
  if (!wallet?.circleWalletId || !wallet.isActive) { res.status(400).json({ error: 'Agent wallet not configured or disabled' }); return; }
  try {
    await guarded(res, req.userId as string, 'TRANSFER', Number(parsed.data.amount), 'USDC', 'EARN_WITHDRAW',
      () => earnWithdraw(wallet.circleWalletId as string, parsed.data.amount) as Promise<any>);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Earn withdraw failed' });
  }
});

treasuryRouter.post('/earn/claim', async (req: AuthRequest, res: Response): Promise<void> => {
  const wallet = await walletFor(req.userId as string);
  if (!wallet?.circleWalletId || !wallet.isActive) { res.status(400).json({ error: 'Agent wallet not configured or disabled' }); return; }
  try {
    const out = await claimEarnRewards(wallet.circleWalletId);
    await logAudit({ userId: req.userId as string, actor: 'user', action: 'EARN_CLAIM_EXECUTED', detail: { ...out } });
    res.json({ ok: true, decision: 'ALLOW', ...out });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Claim failed' });
  }
});

// ── Scheduled orders ──────────────────────────────────────────────────────────

treasuryRouter.get('/orders', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId as string;
  const [limit, dca] = await Promise.all([
    getLimitOrders(userId).catch(() => []),
    getDCAOrders(userId).catch(() => []),
  ]);
  res.json({ limitOrders: limit, dcaOrders: dca });
});

const limitSchema = z.object({
  fromToken: z.string().min(2),
  toToken: z.string().min(2),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  triggerPrice: z.number().positive(),
  direction: z.enum(['ABOVE', 'BELOW']),
  slippage: z.number().positive().max(50).optional(),
});

treasuryRouter.post('/orders/limit', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = limitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const { fromToken, toToken } = parsed.data;
  if (classifySwapRoute(fromToken, toToken) === 'UNSUPPORTED') {
    res.status(400).json({ error: `No swap route for ${fromToken.toUpperCase()} to ${toToken.toUpperCase()}` });
    return;
  }
  try {
    const order = await createLimitOrder({ userId: req.userId as string, ...parsed.data });
    await logAudit({ userId: req.userId as string, actor: 'user', action: 'LIMIT_ORDER_CREATED', detail: { orderId: order.id, ...parsed.data } });
    res.status(201).json(order);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Could not create limit order' });
  }
});

treasuryRouter.delete('/orders/limit/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const done = await cancelLimitOrder(req.params.id, req.userId as string);
  if (!done) { res.status(404).json({ error: 'Order not found or not active' }); return; }
  res.json({ ok: true });
});

const dcaSchema = z.object({
  fromToken: z.string().min(2),
  toToken: z.string().min(2),
  amountPerCycle: z.string().regex(/^\d+(\.\d+)?$/),
  frequency: z.enum(['HOURLY', 'DAILY', 'WEEKLY']),
  maxRuns: z.number().int().positive().max(365).optional(),
});

treasuryRouter.post('/orders/dca', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = dcaSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const { fromToken, toToken } = parsed.data;
  if (classifySwapRoute(fromToken, toToken) === 'UNSUPPORTED') {
    res.status(400).json({ error: `No swap route for ${fromToken.toUpperCase()} to ${toToken.toUpperCase()}` });
    return;
  }
  try {
    const order = await createDCAOrder({ userId: req.userId as string, ...parsed.data });
    await logAudit({ userId: req.userId as string, actor: 'user', action: 'DCA_ORDER_CREATED', detail: { orderId: order.id, ...parsed.data } });
    res.status(201).json(order);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Could not create DCA schedule' });
  }
});

treasuryRouter.post('/orders/dca/:id/pause', async (req: AuthRequest, res: Response): Promise<void> => {
  const done = await pauseDCAOrder(req.params.id, req.userId as string);
  if (!done) { res.status(404).json({ error: 'Schedule not found or not active' }); return; }
  res.json({ ok: true });
});

treasuryRouter.post('/orders/dca/:id/resume', async (req: AuthRequest, res: Response): Promise<void> => {
  const done = await resumeDCAOrder(req.params.id, req.userId as string);
  if (!done) { res.status(404).json({ error: 'Schedule not found or not paused' }); return; }
  res.json({ ok: true });
});

treasuryRouter.delete('/orders/dca/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const done = await cancelDCAOrder(req.params.id, req.userId as string);
  if (!done) { res.status(404).json({ error: 'Schedule not found' }); return; }
  res.json({ ok: true });
});
