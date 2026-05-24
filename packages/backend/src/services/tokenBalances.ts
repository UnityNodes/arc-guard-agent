/**
 * Shared token balance fetcher - used by dashboard, chat, and user-balances.
 * Balances come from arckit's getAgentBalance (Circle) for the agent wallet on Arc.
 */

import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { getAgentBalance } from './arckit';
import { getCurrentFxRate } from './fxHedge';

export const discoveredTokens = new Map<string, { address: string; decimals: number }>();

export interface TokenWithBalance {
  symbol: string;
  name: string;
  decimals: number;
  contract: string;
  logo: string;
  price: number;
  balance: number;
  balanceUsd: number;
  isSuspicious: boolean;
}

export interface WalletBalances {
  tokens: TokenWithBalance[];
  ethBalance: number;
  ethPrice: number;
  totalUsd: number;
}

const TOKEN_META: Record<string, { name: string; decimals: number; contract: string; logo: string; pegUsd?: number }> = {
  USDC:   { name: 'USD Coin',        decimals: 6, contract: '0x3600000000000000000000000000000000000000', logo: '/tokens/usdc.svg', pegUsd: 1 },
  EURC:   { name: 'Euro Coin',       decimals: 6, contract: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', logo: '/tokens/eurc.svg' },
  USYC:   { name: 'Hashnote USYC',   decimals: 6, contract: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C', logo: '/tokens/usyc.png' },
  CIRBTC: { name: 'Circle BTC',      decimals: 8, contract: '',                                          logo: '/tokens/cirbtc.svg' },
};

async function btcPrice(): Promise<number> {
  try {
    const BTC_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
    const r = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${BTC_FEED}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return 0;
    const d = (await r.json()) as { parsed: Array<{ price: { price: string; expo: number } }> };
    const p = d.parsed[0]?.price;
    return p ? Math.abs(Number(p.price)) * Math.pow(10, p.expo) : 0;
  } catch (err) {
    logger.warn('price', 'BTC price fetch failed', err);
    return 0;
  }
}

export async function getWalletTokens(walletAddress: string): Promise<WalletBalances> {
  const wallet = await prisma.agentWallet.findFirst({
    where: { agentAddress: { equals: walletAddress, mode: 'insensitive' } },
    select: { circleWalletId: true },
  });

  const tokens: TokenWithBalance[] = [];
  let totalUsd = 0;

  if (wallet?.circleWalletId) {
    try {
      const b = await getAgentBalance(wallet.circleWalletId);
      const entries: Array<[string, string]> = [
        ['USDC', b.usdc], ['EURC', b.eurc], ['USYC', b.usyc], ['CIRBTC', b.cirbtc],
      ];
      const needBtc = parseFloat(b.cirbtc) > 0;
      const needEurc = parseFloat(b.eurc) > 0;
      const needUsyc = parseFloat(b.usyc) > 0;
      const [btc, eurcUsd, usycUsd] = await Promise.all([
        needBtc ? btcPrice() : Promise.resolve(0),
        needEurc ? getCurrentFxRate('EURC', 'USDC').then((r) => r ?? 1) : Promise.resolve(1),
        needUsyc ? getCurrentFxRate('USYC', 'USDC').then((r) => r ?? 1) : Promise.resolve(1),
      ]);
      for (const [sym, amtStr] of entries) {
        const balance = parseFloat(amtStr) || 0;
        if (balance <= 0) continue;
        const meta = TOKEN_META[sym];
        const price = sym === 'CIRBTC' ? btc : sym === 'EURC' ? eurcUsd : sym === 'USYC' ? usycUsd : (meta.pegUsd ?? 0);
        const balanceUsd = balance * price;
        totalUsd += balanceUsd;
        tokens.push({ symbol: sym, name: meta.name, decimals: meta.decimals, contract: meta.contract, logo: meta.logo, price, balance, balanceUsd, isSuspicious: false });
      }
    } catch (err) {
      logger.warn('balances', 'getAgentBalance failed', err);
    }
  }

  return { tokens, ethBalance: 0, ethPrice: 0, totalUsd };
}
