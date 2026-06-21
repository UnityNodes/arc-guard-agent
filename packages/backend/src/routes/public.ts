import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { customFeeStatus, ARC_FEE_BPS } from '../services/customFee';
import { getLearningStats, getPopularPairs } from '../services/agentLearning';

// ── Public traction / "evidence of usage" endpoint ────────────────────────────
// No auth. Aggregates platform usage so a grant reviewer can see live numbers at
// one URL. Cached in Redis for 60s so it is not a DB-amplification vector.
// ──────────────────────────────────────────────────────────────────────────────

export const publicRouter = Router();

const CACHE_KEY = 'public:stats:v1';
const CACHE_TTL = 60;

function leadingFloat(s: string | null | undefined): number {
  if (!s) return 0;
  const m = s.match(/[\d.]+/);
  const n = m ? Number(m[0]) : 0;
  return Number.isFinite(n) ? n : 0;
}

async function computeStats() {
  // Each sub-query is independent and failure-isolated so one slow/failed read
  // never blanks the whole board.
  const [
    users,
    wallets,
    txSuccess,
    txVolume,
    jobsCompleted,
    bridgesSuccess,
    bridgeRows,
    nanopayTotal,
  ] = await Promise.all([
    prisma.user.count().catch(() => 0),
    prisma.agentWallet.count().catch(() => 0),
    prisma.agentTransaction.count({ where: { status: 'SUCCESS' } }).catch(() => 0),
    prisma.agentTransaction.aggregate({ _sum: { amountUsd: true }, where: { status: 'SUCCESS' } }).catch(() => ({ _sum: { amountUsd: 0 } })),
    prisma.job.count({ where: { status: 'COMPLETED' } }).catch(() => 0),
    prisma.bridgeTransaction.count({ where: { status: 'SUCCESS' } }).catch(() => 0),
    prisma.bridgeTransaction.findMany({ where: { status: 'SUCCESS' }, select: { amount: true } }).catch(() => [] as { amount: string }[]),
    redis.get('nanopay:infer:total').catch(() => '0'),
  ]);

  // Agent intelligence (non-sensitive platform aggregate): how reliably the
  // agent executes swaps, and which pairs it routes most.
  const [learning, popularPairs] = await Promise.all([
    getLearningStats().catch(() => ({ total: 0, successes: 0, failures: 0, successRate: '-' })),
    getPopularPairs(6).catch(() => [] as Array<{ from: string; to: string; count: number }>),
  ]);

  const txVolumeUsd = Number(txVolume?._sum?.amountUsd ?? 0);
  const bridgeVolumeUsd = bridgeRows.reduce((acc, r) => acc + leadingFloat(r.amount), 0);
  const nanopay = Number(nanopayTotal ?? 0) || 0;

  // Estimated protocol revenue: every bridge + swap carries a custom fee of
  // ARC_FEE_BPS. This is an estimate (fee = volume * bps), not a per-tx ledger.
  const feeRate = ARC_FEE_BPS / 10_000;
  const estimatedFeesUsd = (txVolumeUsd + bridgeVolumeUsd) * feeRate;

  return {
    users,
    agentWallets: wallets,
    transactionsSettled: txSuccess,
    transactionVolumeUsd: Math.round(txVolumeUsd * 100) / 100,
    bridgesSettled: bridgesSuccess,
    bridgeVolumeUsd: Math.round(bridgeVolumeUsd * 100) / 100,
    jobsCompleted,
    nanopaymentInferences: nanopay,
    intelligence: {
      swapsExecuted: learning.total,
      popularPairs: popularPairs.map((p) => ({ pair: `${p.from} to ${p.to}`, count: p.count })),
    },
    monetization: {
      model: 'Custom fee (Bridge/Swap Kit native) on every bridge and swap',
      feeBps: ARC_FEE_BPS,
      estimatedFeesUsd: Math.round(estimatedFeesUsd * 10_000) / 10_000,
      enabled: customFeeStatus().enabled,
    },
    chain: 'Arc Testnet (eip155:5042002)',
    updatedAt: new Date().toISOString(),
  };
}

publicRouter.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const cached = await redis.get(CACHE_KEY).catch(() => null);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }
    const stats = await computeStats();
    await redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_TTL).catch(() => null);
    res.json(stats);
  } catch (err) {
    logger.error('public', 'stats failed', err);
    res.status(503).json({ error: 'Stats temporarily unavailable' });
  }
});
