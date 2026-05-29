/**
 * Agent Self-Learning Service
 * Tracks swap outcomes, builds token reputation, adjusts slippage.
 * NOT AI/ML, simple rule-based behavior learning from results.
 */

import { prisma } from '../lib/prisma';

// ── Event Logging ────────────────────────────────────────────────────────────

type SwapEvent = 'swap_success' | 'swap_failed' | 'slippage_error' | 'token_not_found' | 'no_liquidity' | 'approval_failed';

export async function logSwapEvent(event: SwapEvent, data: {
  fromToken?: string; toToken?: string; toContract?: string;
  amount?: number; slippage?: number; error?: string;
  txHash?: string; userId?: string; context?: Record<string, unknown>;
}) {
  try {
    await prisma.agentLearning.create({
      data: {
        event,
        fromToken: data.fromToken, toToken: data.toToken,
        toContract: data.toContract, amount: data.amount,
        slippage: data.slippage, error: data.error,
        txHash: data.txHash, userId: data.userId,
        context: data.context ? JSON.stringify(data.context) : null,
      },
    });

    // Update token reputation
    if (data.toContract) {
      await updateReputation(data.toContract, data.toToken || '?', event, data.slippage);
    }
  } catch (err) {
    console.warn('[learning] Failed to log event:', err);
  }
}

// ── Token Reputation ─────────────────────────────────────────────────────────

async function updateReputation(address: string, symbol: string, event: SwapEvent, slippage?: number) {
  const addr = address.toLowerCase();

  const existing = await prisma.tokenReputation.findUnique({ where: { address: addr } });

  if (!existing) {
    await prisma.tokenReputation.create({
      data: {
        address: addr, symbol: symbol.toUpperCase(),
        successCount: event === 'swap_success' ? 1 : 0,
        failCount: event !== 'swap_success' ? 1 : 0,
        lastSlippage: slippage ?? null,
        avgSlippage: slippage ?? null,
        flags: event === 'no_liquidity' ? ['low_liquidity'] : [],
      },
    });
    return;
  }

  const newSuccess = existing.successCount + (event === 'swap_success' ? 1 : 0);
  const newFail = existing.failCount + (event !== 'swap_success' ? 1 : 0);

  // Calculate avg slippage
  let avgSlippage = existing.avgSlippage;
  if (slippage && event === 'swap_success') {
    avgSlippage = existing.avgSlippage
      ? (existing.avgSlippage * existing.successCount + slippage) / (existing.successCount + 1)
      : slippage;
  }

  // Update flags
  const flags = [...existing.flags];
  if (event === 'no_liquidity' && !flags.includes('low_liquidity')) flags.push('low_liquidity');
  if (event === 'slippage_error' && !flags.includes('high_slippage')) flags.push('high_slippage');
  if (newFail >= 5 && newSuccess === 0 && !flags.includes('scam_suspected')) flags.push('scam_suspected');

  await prisma.tokenReputation.update({
    where: { address: addr },
    data: {
      successCount: newSuccess, failCount: newFail,
      lastSlippage: slippage ?? existing.lastSlippage,
      avgSlippage, flags,
    },
  });
}

// ── Reputation Queries ───────────────────────────────────────────────────────

export async function getTokenReputation(address: string) {
  return prisma.tokenReputation.findUnique({ where: { address: address.toLowerCase() } });
}

export async function getReputationWarnings(address: string): Promise<string[]> {
  const rep = await getTokenReputation(address);
  if (!rep) return [];

  const warnings: string[] = [];
  if (rep.flags.includes('scam_suspected')) warnings.push('This token has failed all swap attempts, likely scam');
  if (rep.flags.includes('low_liquidity')) warnings.push('Low liquidity, swaps may fail');
  if (rep.flags.includes('high_slippage')) warnings.push('High slippage detected, consider increasing slippage tolerance');
  if (rep.failCount > 3 && rep.successCount === 0) warnings.push(`${rep.failCount} failed swaps, 0 successful`);
  return warnings;
}

// ── Slippage Learning ────────────────────────────────────────────────────────

export async function getSuggestedSlippage(toContract: string, defaultSlippage: number): Promise<number> {
  const rep = await getTokenReputation(toContract);
  if (!rep) return defaultSlippage;

  // If token has high slippage flag, suggest higher
  if (rep.flags.includes('high_slippage') && rep.avgSlippage) {
    return Math.min(Math.max(rep.avgSlippage * 1.5, defaultSlippage), 10); // cap at 10%
  }

  // If last slippage error, suggest 2x default
  if (rep.failCount > 0 && rep.successCount === 0) {
    return Math.min(defaultSlippage * 2, 5);
  }

  return defaultSlippage;
}

// ── Popular Routes ───────────────────────────────────────────────────────────

export async function getPopularPairs(limit = 10): Promise<Array<{ from: string; to: string; count: number }>> {
  const events = await prisma.agentLearning.groupBy({
    by: ['fromToken', 'toToken'],
    where: { event: 'swap_success', createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    _count: true,
    orderBy: { _count: { event: 'desc' } },
    take: limit,
  });

  return events.map(e => ({
    from: e.fromToken || '?',
    to: e.toToken || '?',
    count: e._count,
  }));
}

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getLearningStats() {
  const [total, successes, failures, recentErrors] = await Promise.all([
    prisma.agentLearning.count(),
    prisma.agentLearning.count({ where: { event: 'swap_success' } }),
    prisma.agentLearning.count({ where: { event: { not: 'swap_success' } } }),
    prisma.agentLearning.findMany({
      where: { event: { not: 'swap_success' } },
      orderBy: { createdAt: 'desc' }, take: 5,
      select: { event: true, toToken: true, error: true, createdAt: true },
    }),
  ]);

  return { total, successes, failures, successRate: total > 0 ? (successes / total * 100).toFixed(1) + '%' : '-', recentErrors };
}
