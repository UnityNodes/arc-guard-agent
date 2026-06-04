import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

const CACHE_KEY = 'arc:yields';
const CACHE_TTL = 1800;
const REFRESH_INTERVAL = 30 * 60 * 1000;

export interface YieldRate {
  protocol: string;
  token: string;
  apy: number;
  tvl: number | null;
  url: string;
  chain: string;
  type: string;
  updatedAt: string;
}

let cachedRates: YieldRate[] = [];

export async function getYieldRates(): Promise<YieldRate[]> {
  if (cachedRates.length > 0) return cachedRates;
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) { cachedRates = JSON.parse(cached); return cachedRates; }
  } catch (err) { logger.warn('yields', 'Redis read failed for yield cache', err); }
  await refreshYieldRates();
  return cachedRates;
}

async function refreshYieldRates(): Promise<void> {
  const rates: YieldRate[] = [];
  const now = new Date().toISOString();

  try {
    const res = await fetch('https://yields.llama.fi/pools', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`DeFiLlama: ${res.status}`);

    const data = await res.json() as {
      data: Array<{ chain: string; project: string; symbol: string; tvlUsd: number; apy: number; poolMeta?: string | null }>;
    };

    const arcPools = data.data.filter((p) => p.chain === 'Arc' && p.apy > 0);

    const seen = new Map<string, typeof arcPools[0]>();
    for (const pool of arcPools) {
      const key = `${pool.project}-${pool.symbol}`;
      const existing = seen.get(key);
      if (!existing || pool.tvlUsd > existing.tvlUsd) seen.set(key, pool);
    }

    for (const [, pool] of seen) {
      rates.push({
        protocol: pool.project,
        token: pool.symbol,
        apy: Math.round(pool.apy * 100) / 100,
        tvl: Math.round(pool.tvlUsd),
        url: 'https://defillama.com/chain/Arc',
        chain: 'Arc',
        type: 'lending',
        updatedAt: now,
      });
    }
  } catch (err) {
    console.warn('[yieldRates] DeFiLlama failed:', (err as Error).message);
  }

  rates.sort((a, b) => b.apy - a.apy);
  cachedRates = rates;
  try { await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(rates)); } catch (err) { logger.warn('yields', 'Redis write failed for yield cache', err); }
  console.log(`[yieldRates] Refreshed ${rates.length} Arc rates from DeFiLlama`);
}

export function formatYieldsForAI(rates: YieldRate[]): string {
  if (rates.length === 0) return 'On-chain yield data for Arc is temporarily unavailable.';

  const fmt = (r: YieldRate) =>
    `- ${r.protocol}: ${r.token} ${r.apy}% APY${r.tvl ? ` (TVL $${(r.tvl / 1e6).toFixed(1)}M)` : ''}`;

  const lines: string[] = ['Yields on Arc:'];
  rates.slice(0, 8).forEach((r) => lines.push(fmt(r)));
  lines.push(`(Updated: ${rates[0]?.updatedAt?.slice(0, 16) ?? '?'}, refreshes every 30 min)`);
  return lines.join('\n');
}

export function startYieldRatesRefresh(): void {
  refreshYieldRates().catch(() => {});
  setInterval(() => refreshYieldRates().catch(() => {}), REFRESH_INTERVAL);
}
