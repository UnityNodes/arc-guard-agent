import { prisma } from '../lib/prisma';
import { executeFxSwap } from './arcFx';
import { getUsycInfo } from './arcUsyc';
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

export async function checkAndExecuteFxHedges(): Promise<void> {
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

      logger.info('fx', `FX hedge triggered: ${hedge.fromToken}->${hedge.toToken} rate=${currentRate}`);

      const result = await executeFxSwap(
        hedge.user.agentWallet.circleWalletId,
        hedge.fromToken,
        hedge.toToken,
        String(hedge.amount),
      );

      await prisma.fxHedge.update({
        where: { id: hedge.id },
        data: { status: 'FILLED', txHash: result.txHash, filledAt: new Date(), error: null },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('fx', `FX hedge execution failed for ${hedge.id}`, err);
      await prisma.fxHedge.update({ where: { id: hedge.id }, data: { status: 'FAILED', error: errMsg } });
    }
  }
}
