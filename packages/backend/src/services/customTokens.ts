import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { ARC_EXPLORER } from '../lib/chains';

const ARC_BLOCKSCOUT_API = `${ARC_EXPLORER}/api/v2`;

export function extractContractAddress(message: string): string | null {
  const addrMatch = message.match(/\b(0x[a-fA-F0-9]{40})\b/);
  if (addrMatch) return addrMatch[1];

  const scanMatch = message.match(/arcscan\.app\/(?:token|address)\/(0x[a-fA-F0-9]{40})/i);
  if (scanMatch) return scanMatch[1];

  return null;
}

export async function verifyByAddress(address: string): Promise<{
  symbol: string; name: string; decimals: number;
  price: number; holders: number; liquidity: number; volume24h: number;
  marketCap: number; icon: string; isVerified: boolean;
} | null> {
  try {
    const res = await fetch(`${ARC_BLOCKSCOUT_API}/tokens/${address}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const t = await res.json() as {
        symbol: string; name: string; decimals: string;
        holders_count: string; circulating_market_cap: string | null;
        icon_url: string | null; exchange_rate: string | null;
      };
      const holders = parseInt(t.holders_count || '0');
      return {
        symbol: t.symbol,
        name: t.name,
        decimals: parseInt(t.decimals || '6'),
        price: parseFloat(t.exchange_rate || '0'),
        holders,
        liquidity: 0,
        volume24h: 0,
        marketCap: t.circulating_market_cap ? parseFloat(t.circulating_market_cap) : 0,
        icon: t.icon_url || '',
        isVerified: holders > 100,
      };
    }
  } catch (err) {
    logger.warn('token', `Arc explorer lookup failed for ${address}`, err);
  }
  return null;
}

export async function saveCustomToken(tokenData: {
  symbol: string; name: string; address: string; decimals: number;
  price: number; holders: number; liquidity: number; marketCap: number;
  icon: string; isVerified: boolean;
  addedBy?: string;
}) {
  return prisma.customToken.upsert({
    where: { address: tokenData.address.toLowerCase() },
    update: {
      price: tokenData.price,
      holders: tokenData.holders,
      liquidity: tokenData.liquidity,
      marketCap: tokenData.marketCap,
      icon: tokenData.icon || undefined,
      isVerified: tokenData.isVerified,
    },
    create: {
      symbol: tokenData.symbol.toUpperCase(),
      name: tokenData.name,
      address: tokenData.address.toLowerCase(),
      decimals: tokenData.decimals,
      price: tokenData.price,
      holders: tokenData.holders,
      liquidity: tokenData.liquidity,
      marketCap: tokenData.marketCap,
      icon: tokenData.icon,
      isVerified: tokenData.isVerified,
      addedBy: tokenData.addedBy,
    },
  });
}

export async function findCustomToken(symbol: string) {
  return prisma.customToken.findFirst({
    where: { symbol: symbol.toUpperCase() },
    orderBy: { holders: 'desc' },
  });
}

export async function findCustomTokenByAddress(address: string) {
  return prisma.customToken.findUnique({
    where: { address: address.toLowerCase() },
  });
}
