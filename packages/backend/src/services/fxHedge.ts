import { prisma } from '../lib/prisma';
import { getUsycInfo } from './arcUsyc';
import { executeSwapRoute, classifySwapRoute } from './swapRouter';
import { evaluateAction } from './guardian';
import { logAudit } from './audit';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

export interface FxRate {
  pair: string;
  rate: number;
  source: string;
}

const EURC_USDC_FEED = 'a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b';

const usdPriceCache: Record<string, { price: number; ts: number }> = {};
const USD_PRICE_TTL = 30_000;
const MAX_PRICE_AGE_SEC = 60;
const MAX_CONF_RATIO = 0.02;

async function fetchPythPrice(feedId: string): Promise<number | null> {
  try {
    const r = await fetch(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!r.ok) return null;
    const d = await r.json() as { parsed: Array<{ price: { price: string; expo: number; conf: string; publish_time: number } }> };
    const p = d.parsed?.[0]?.price;
    if (!p) return null;

    const v = Math.abs(Number(p.price)) * Math.pow(10, p.expo);
    if (!isFinite(v) || v <= 0) return null;

    const ageSec = Date.now() / 1000 - p.publish_time;
    if (!isFinite(ageSec) || ageSec > MAX_PRICE_AGE_SEC) {
      logger.warn('fx', `Pyth price ${feedId} stale (${ageSec.toFixed(0)}s old) - failing closed`);
      return null;
    }

    const conf = Math.abs(Number(p.conf)) * Math.pow(10, p.expo);
    if (isFinite(conf) && conf / v > MAX_CONF_RATIO) {
      logger.warn('fx', `Pyth price ${feedId} confidence too wide (${(conf / v * 100).toFixed(2)}%) - failing closed`);
      return null;
    }

    return v;
  } catch {
    return null;
  }
}

async function getUsdPrice(symbol: string): Promise<number | null> {
  const sym = symbol.toUpperCase();
  if (sym === 'USDC') return 1.0;

  const cached = usdPriceCache[sym];
  if (cached && Date.now() - cached.ts < USD_PRICE_TTL) return cached.price;

  let price: number | null = null;
  if (sym === 'EURC') {
    price = await fetchPythPrice(EURC_USDC_FEED);
  } else if (sym === 'USYC') {
    try {
      const info = await getUsycInfo();
      price = info.price > 0 ? info.price : null;
    } catch { price = null; }
  } else {
    logger.warn('fx', `No USD price source for ${sym}`);
  }

  if (price !== null) usdPriceCache[sym] = { price, ts: Date.now() };
  return price;
}

export async function getCurrentFxRate(fromToken: string, toToken: string): Promise<number | null> {
  const from = fromToken.toUpperCase();
  const to = toToken.toUpperCase();
  if (from === to) return 1.0;

  const [pf, pt] = await Promise.all([getUsdPrice(from), getUsdPrice(to)]);
  if (pf === null || pt === null || pt <= 0) return null;
  const rate = pf / pt;
  return isFinite(rate) && rate > 0 ? rate : null;
}

export async function getTokenUsdValue(symbol: string, amount: number): Promise<number> {
  if (!isFinite(amount) || amount <= 0) return 0;
  const rate = await getCurrentFxRate(symbol, 'USDC');
  return rate != null ? rate * amount : 0;
}

const MAX_ACTIVE_HEDGES = 20;

export async function listFxHedges(userId: string) {
  return prisma.fxHedge.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
}

export async function cancelFxHedge(id: string, userId: string): Promise<boolean> {
  const hedge = await prisma.fxHedge.findFirst({ where: { id, userId, status: 'ACTIVE' } });
  if (!hedge) return false;
  await prisma.fxHedge.update({ where: { id }, data: { status: 'CANCELLED' } });
  return true;
}

export async function createFxHedge(params: {
  userId: string;
  fromToken: string;
  toToken: string;
  amount: string;
  triggerRate: number;
  direction: 'ABOVE' | 'BELOW';
}) {
  const from = params.fromToken.toUpperCase();
  const to = params.toToken.toUpperCase();

  if (from === to) throw new Error('Hedge needs two different tokens');
  if (classifySwapRoute(from, to) === 'UNSUPPORTED') throw new Error(`No swap route for ${from} to ${to}`);

  const amount = Number(params.amount);
  if (!isFinite(amount) || amount <= 0) throw new Error('Invalid amount');

  const active = await prisma.fxHedge.count({ where: { userId: params.userId, status: 'ACTIVE' } });
  if (active >= MAX_ACTIVE_HEDGES) throw new Error(`You already have ${MAX_ACTIVE_HEDGES} armed hedges`);

  // Show the caller what Guardian would say at this size, so the UI can warn
  // before arming rather than after the hedge silently gets blocked at fill time.
  const amountUsd = await getTokenUsdValue(from, amount);
  const guard = await evaluateAction(params.userId, { action: 'SWAP', amountUsd, token: from });
  const currentRate = await getCurrentFxRate(from, to);

  const hedge = await prisma.fxHedge.create({
    data: {
      userId: params.userId,
      fromToken: from,
      toToken: to,
      amount: params.amount,
      triggerRate: params.triggerRate,
      direction: params.direction,
      status: 'ACTIVE',
    },
  });

  return {
    hedge,
    currentRate,
    guardianPreview: { decision: guard.result.decision, reasons: guard.result.reasons, amountUsd },
  };
}

const HEDGE_LOCK_KEY = 'fx:hedge:sweep';
const HEDGE_LOCK_TTL = 55;

export async function checkAndExecuteFxHedges(): Promise<void> {
  // The sweep runs on a 60s timer. A lock keeps a slow cycle from overlapping
  // the next one and filling the same hedge twice.
  const lock = await redis.set(HEDGE_LOCK_KEY, '1', 'EX', HEDGE_LOCK_TTL, 'NX').catch(() => null);
  if (!lock) return;

  const activeHedges = await prisma.fxHedge.findMany({
    where: { status: 'ACTIVE' },
    include: { user: { include: { agentWallet: true } } },
  });

  for (const hedge of activeHedges) {
    try {
      const currentRate = await getCurrentFxRate(hedge.fromToken, hedge.toToken);
      if (currentRate === null) {
        logger.warn('fx', `FX hedge ${hedge.id} skipped: no reliable ${hedge.fromToken}/${hedge.toToken} price this cycle`);
        continue;
      }
      const triggerRate = Number(hedge.triggerRate);
      const shouldTrigger =
        hedge.direction === 'BELOW' ? currentRate < triggerRate :
        hedge.direction === 'ABOVE' ? currentRate > triggerRate : false;

      if (!shouldTrigger) continue;
      if (!hedge.user.agentWallet?.circleWalletId) continue;
      if (!hedge.user.agentWallet.isActive) continue;

      const amount = Number(hedge.amount);
      const amountUsd = await getTokenUsdValue(hedge.fromToken, amount);

      // This fires with no human in the loop, so only ALLOW proceeds. A denied or
      // above-threshold hedge is parked in BLOCKED rather than left ACTIVE, which
      // would re-evaluate and re-notify every cycle forever.
      const guard = await evaluateAction(hedge.userId, { action: 'SWAP', amountUsd, token: hedge.fromToken });
      if (guard.result.decision !== 'ALLOW') {
        await logAudit({
          userId: hedge.userId,
          actor: 'agent',
          action: 'FX_HEDGE_GATED',
          detail: { hedgeId: hedge.id, decision: guard.result.decision, reasons: guard.result.reasons, amountUsd },
        });
        await prisma.fxHedge.update({
          where: { id: hedge.id },
          data: { status: 'BLOCKED', error: `Guardian ${guard.result.decision}: ${guard.result.reasons.join('; ')}` },
        });
        continue;
      }

      logger.info('fx', `FX hedge triggered: ${hedge.fromToken}->${hedge.toToken} rate=${currentRate}`);

      const slippage = hedge.user.agentWallet.slippagePercent ?? 0.5;
      const result = await executeSwapRoute(hedge.userId, hedge.fromToken, hedge.toToken, amount, slippage);

      await prisma.fxHedge.update({
        where: { id: hedge.id },
        data: { status: 'FILLED', txHash: result.txHash, filledAt: new Date(), error: null },
      });

      // Recorded so the fill counts against the daily limit and shows on the dashboard.
      await prisma.agentTransaction.create({
        data: {
          userId: hedge.userId,
          type: 'FX_HEDGE',
          tokenIn: hedge.fromToken,
          tokenOut: hedge.toToken,
          amount: String(amount),
          amountUsd,
          txHash: result.txHash,
          status: 'SUCCESS',
          network: 'arc-testnet',
        },
      }).catch(err => logger.error('fx', 'Failed to log FX hedge agentTransaction', err));

      await logAudit({
        userId: hedge.userId,
        actor: 'agent',
        action: 'FX_HEDGE_EXECUTED',
        detail: { hedgeId: hedge.id, from: hedge.fromToken, to: hedge.toToken, amount, amountUsd, rate: currentRate, route: result.route, txHash: result.txHash },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('fx', `FX hedge execution failed for ${hedge.id}`, err);
      await prisma.fxHedge.update({ where: { id: hedge.id }, data: { status: 'FAILED', error: errMsg } });
    }
  }
}
