import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { customFeeStatus, ARC_FEE_BPS } from '../services/customFee';
import { getLearningStats, getPopularPairs } from '../services/agentLearning';
import { AEGIS_TOOL_COUNT, AEGIS_TOOL_NAMES } from '../services/aegis';

// ── Public traction / "evidence of usage" endpoint ────────────────────────────
// No auth. Aggregates platform usage so a grant reviewer can see live numbers at
// one URL. Cached in Redis for 60s so it is not a DB-amplification vector.
// ──────────────────────────────────────────────────────────────────────────────

export const publicRouter = Router();

const CACHE_KEY = 'public:stats:v2';
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
    swapVolume,
  ] = await Promise.all([
    prisma.user.count().catch(() => 0),
    prisma.agentWallet.count().catch(() => 0),
    prisma.agentTransaction.count({ where: { status: 'SUCCESS' } }).catch(() => 0),
    prisma.agentTransaction.aggregate({ _sum: { amountUsd: true }, where: { status: 'SUCCESS' } }).catch(() => ({ _sum: { amountUsd: 0 } })),
    prisma.job.count({ where: { status: 'COMPLETED' } }).catch(() => 0),
    prisma.bridgeTransaction.count({ where: { status: 'SUCCESS' } }).catch(() => 0),
    prisma.bridgeTransaction.findMany({ where: { status: 'SUCCESS' }, select: { amount: true } }).catch(() => [] as { amount: string }[]),
    redis.get('nanopay:infer:total').catch(() => '0'),
    // Only swaps carry a Swap Kit customFee. BRIDGE-typed rows are excluded because
    // bridge volume is measured from BridgeTransaction below and would double-count.
    prisma.agentTransaction
      .aggregate({ _sum: { amountUsd: true }, where: { status: 'SUCCESS', type: { in: ['SWAP', 'FX_HEDGE'] } } })
      .catch(() => ({ _sum: { amountUsd: 0 } })),
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

  // The custom fee is applied natively inside Bridge Kit and Swap Kit, so only
  // bridge and swap volume is fee-bearing. Sends, earn deposits and gateway
  // spends carry no fee and are excluded. Still a derivation (volume * bps)
  // rather than a per-tx ledger, which is why the field says estimated.
  const swapVolumeUsd = Number(swapVolume?._sum?.amountUsd ?? 0);
  const feeBearingVolumeUsd = swapVolumeUsd + bridgeVolumeUsd;
  const feeRate = ARC_FEE_BPS / 10_000;
  const estimatedFeesUsd = feeBearingVolumeUsd * feeRate;

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
      swapsExecuted: learning.successes,
      swapsAttempted: learning.total,
      swapSuccessRate: learning.successRate,
      popularPairs: popularPairs.map((p) => ({ pair: `${p.from} to ${p.to}`, count: p.count })),
    },
    agent: {
      toolCount: AEGIS_TOOL_COUNT,
      tools: AEGIS_TOOL_NAMES,
    },
    monetization: {
      model: 'Custom fee (Bridge/Swap Kit native) on every bridge and swap',
      feeBps: ARC_FEE_BPS,
      feeBearingVolumeUsd: Math.round(feeBearingVolumeUsd * 100) / 100,
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
