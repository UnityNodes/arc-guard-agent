import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { getTokenRegistry, type RegistryToken } from './tokenRegistry';

export interface TokenPrice {
  symbol: string;
  name: string;
  logo: string;
  coingeckoId: string;
  contractAddress: string | null;
  explorerUrl: string | null;
  price: number;
  change24h: number;
}

const KEY_PRICES = 'arc:prices:snapshot';
const TTL_PRICES = 60;

async function fetchPythPrices(tokens: RegistryToken[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const withFeeds = tokens.filter((t) => t.pythFeedId);
  if (!withFeeds.length) return result;

  try {
    const qs = withFeeds.map((t) => `ids[]=${t.pythFeedId}`).join('&');
    const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?${qs}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return result;
    const data = (await res.json()) as { parsed: Array<{ id: string; price: { price: string; expo: number } }> };
    for (const entry of data.parsed ?? []) {
      const token = withFeeds.find((t) => t.pythFeedId?.replace('0x', '') === entry.id.replace('0x', ''));
      if (!token) continue;
      result.set(token.symbol, Math.abs(Number(entry.price.price)) * Math.pow(10, entry.price.expo));
    }
  } catch (err) {
    console.warn('[priceProvider] Pyth error:', err);
  }
  return result;
}

export async function getAllPrices(forceRefresh = false): Promise<TokenPrice[]> {
  if (!forceRefresh) {
    try {
      const cached = await redis.get(KEY_PRICES);
      if (cached) return JSON.parse(cached) as TokenPrice[];
    } catch (err) {
      logger.warn('cache', 'Redis read failed for prices snapshot', err);
    }
  }
  const tokens = await getTokenRegistry();
  return refreshPrices(tokens);
}

export async function getPrice(symbol: string): Promise<number | null> {
  const all = await getAllPrices();
  return all.find((p) => p.symbol === symbol)?.price ?? null;
}

async function refreshPrices(tokens: RegistryToken[]): Promise<TokenPrice[]> {
  const pyth = await fetchPythPrices(tokens);

  const result: TokenPrice[] = [];
  for (const t of tokens) {
    const stableDefault = t.symbol === 'USDC' || t.symbol === 'USYC' ? 1 : 0;
    const price = pyth.get(t.symbol) ?? stableDefault;
    if (price <= 0) continue;
    result.push({
      symbol: t.symbol,
      name: t.name,
      logo: t.logo,
      coingeckoId: t.coingeckoId,
      contractAddress: t.contractAddress,
      explorerUrl: t.explorerUrl,
      price,
      change24h: 0,
    });
  }

  try {
    await redis.set(KEY_PRICES, JSON.stringify(result), 'EX', TTL_PRICES);
  } catch (err) {
    logger.warn('cache', 'Redis write failed for prices snapshot', err);
  }

  console.log(`[priceProvider] Refreshed ${result.length} Arc prices (Pyth:${pyth.size})`);
  return result;
}
