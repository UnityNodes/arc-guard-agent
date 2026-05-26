import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

const PYTH_ENDPOINT = process.env.PYTH_ENDPOINT || 'https://hermes.pyth.network';

// Price feed IDs from Pyth Network (mainnet)
const PRICE_FEED_IDS: Record<string, string> = {
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  USDC: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  USDT: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  LINK: '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
  UNI: '0x78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501',
};

interface PriceData {
  token: string;
  price: number;
  confidence: number;
  publishTime: number;
}

// ── Circuit breaker for Pyth ─────────────────────────────────
let pythFailCount = 0;
let pythCircuitOpenUntil = 0;
const CIRCUIT_THRESHOLD = 5;     // open after 5 consecutive failures
const CIRCUIT_COOLDOWN   = 60_000; // stay open for 60s

function isPythCircuitOpen(): boolean {
  if (pythCircuitOpenUntil && Date.now() < pythCircuitOpenUntil) return true;
  if (pythCircuitOpenUntil && Date.now() >= pythCircuitOpenUntil) {
    // Half-open: allow one request to test recovery
    pythCircuitOpenUntil = 0;
  }
  return false;
}

function recordPythSuccess() {
  pythFailCount = 0;
  pythCircuitOpenUntil = 0;
}

function recordPythFailure() {
  pythFailCount++;
  if (pythFailCount >= CIRCUIT_THRESHOLD) {
    pythCircuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN;
    console.warn(`[pyth] circuit breaker OPEN: ${pythFailCount} consecutive failures, cooldown ${CIRCUIT_COOLDOWN / 1000}s`);
  }
}

// ── Redis cache key for prices ───────────────────────────────
const PRICE_CACHE_KEY = 'prices:pyth';
const PRICE_CACHE_TTL = 15; // seconds, 1000 users all get same cache

export async function getPrices(tokens: string[]): Promise<Record<string, PriceData>> {
  // Try Redis cache first (shared across all concurrent requests)
  try {
    const cached = await redis.get(PRICE_CACHE_KEY);
    if (cached) {
      const all = JSON.parse(cached) as Record<string, PriceData>;
      const result: Record<string, PriceData> = {};
      for (const t of tokens) {
        const key = t.toUpperCase();
        if (all[key]) result[key] = all[key];
      }
      if (Object.keys(result).length > 0) return result;
    }
  } catch (err) { logger.warn('cache', 'Redis read failed for price cache', err); }

  // Circuit breaker check
  if (isPythCircuitOpen()) {
    console.warn('[pyth] circuit breaker open, returning empty');
    return {};
  }

  const feedIds = tokens
    .map((t) => t.toUpperCase())
    .filter((t) => PRICE_FEED_IDS[t])
    .map((t) => PRICE_FEED_IDS[t]);

  if (feedIds.length === 0) return {};

  try {
    const params = feedIds.map((id) => `ids[]=${id}`).join('&');
    const res = await fetch(`${PYTH_ENDPOINT}/v2/updates/price/latest?${params}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) throw new Error(`Pyth error: ${res.status}`);

    const data = await res.json() as { parsed: Array<{
      id: string;
      price: { price: string; expo: number; conf: string; publish_time: number };
    }> };

    const result: Record<string, PriceData> = {};
    const idToToken = Object.fromEntries(
      Object.entries(PRICE_FEED_IDS).map(([token, id]) => [id.toLowerCase(), token])
    );

    for (const item of data.parsed) {
      const token = idToToken[`0x${item.id}`.toLowerCase()];
      if (!token) continue;
      const expo = item.price.expo;
      const price = parseFloat(item.price.price) * Math.pow(10, expo);
      const confidence = parseFloat(item.price.conf) * Math.pow(10, expo);
      result[token] = { token, price, confidence, publishTime: item.price.publish_time };
    }

    recordPythSuccess();

    // Cache in Redis for all concurrent users
    try {
      await redis.set(PRICE_CACHE_KEY, JSON.stringify(result), 'EX', PRICE_CACHE_TTL);
    } catch (err) { logger.warn('cache', 'Redis write failed for price cache', err); }

    return result;
  } catch (err) {
    recordPythFailure();
    console.error('[pyth] price fetch error:', err instanceof Error ? err.message : err);
    return {};
  }
}
