import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { executeFxSwap, getFxQuote, SwapRouteUnavailableError, type FxQuote } from './arcFx';
import { depositUSYC, redeemUSYC, isUsycConfigured } from './arcUsyc';

export type SwapRouteType = 'FX' | 'USYC_DEPOSIT' | 'USYC_REDEEM' | 'UNSUPPORTED';

const FX_TOKENS = new Set(['USDC', 'EURC']);

export function classifySwapRoute(fromToken: string, toToken: string): SwapRouteType {
  const a = fromToken.toUpperCase();
  const b = toToken.toUpperCase();
  if (a === b) return 'UNSUPPORTED';
  if (a === 'USDC' && b === 'USYC') return 'USYC_DEPOSIT';
  if (a === 'USYC' && b === 'USDC') return 'USYC_REDEEM';
  if (FX_TOKENS.has(a) && FX_TOKENS.has(b)) return 'FX';
  return 'UNSUPPORTED';
}

export interface SwapRouteCheck {
  available: boolean;
  route: SwapRouteType;
  reason?: string;
  quote?: FxQuote;
}

export async function preflightSwapRoute(
  walletId: string,
  fromToken: string,
  toToken: string,
  amountIn: string,
  slippageBps = 100,
): Promise<SwapRouteCheck> {
  const route = classifySwapRoute(fromToken, toToken);

  if (route === 'UNSUPPORTED') {
    return {
      available: false,
      route,
      reason: `No swap route for ${fromToken.toUpperCase()} to ${toToken.toUpperCase()} on Arc. Supported routes: USDC<->EURC (FX) and USDC<->USYC (treasury vault).`,
    };
  }

  if (route === 'USYC_DEPOSIT' || route === 'USYC_REDEEM') {
    if (!isUsycConfigured()) {
      return { available: false, route, reason: 'USYC vault is not configured on this deployment.' };
    }
    return { available: true, route };
  }

  // FX route, verify Circle has live liquidity for this pair/size
  try {
    const quote = await getFxQuote(walletId, fromToken, toToken, amountIn, slippageBps);
    return { available: true, route, quote };
  } catch (err) {
    if (err instanceof SwapRouteUnavailableError) return { available: false, route, reason: err.message };
    logger.warn('swapRouter', `preflight inconclusive for ${fromToken}->${toToken} (${amountIn}): ${err instanceof Error ? err.message : String(err)}`);
    return { available: true, route };
  }
}

export async function executeSwapRoute(
  userId: string,
  fromSymbol: string,
  toSymbol: string,
  amount: number,
  slippage: number,
): Promise<{ txHash: string; route: SwapRouteType }> {
  const wallet = await prisma.agentWallet.findUnique({
    where: { userId },
    select: { circleWalletId: true, agentAddress: true },
  });
  if (!wallet?.circleWalletId) throw new Error('Agent wallet not configured');

  const route = classifySwapRoute(fromSymbol, toSymbol);

  if (route === 'UNSUPPORTED') {
    throw new SwapRouteUnavailableError(fromSymbol.toUpperCase(), toSymbol.toUpperCase(), amount.toString());
  }

  if (route === 'USYC_DEPOSIT' || route === 'USYC_REDEEM') {
    if (!wallet.agentAddress) throw new Error('Agent wallet address unavailable for USYC routing');
    const fn = route === 'USYC_DEPOSIT' ? depositUSYC : redeemUSYC;
    const r = await fn(wallet.circleWalletId, wallet.agentAddress, amount.toString());
    return { txHash: r.txHash, route };
  }

  const r = await executeFxSwap(
    wallet.circleWalletId,
    fromSymbol,
    toSymbol,
    amount.toString(),
    Math.round((slippage || 0.5) * 100),
  );
  return { txHash: r.txHash, route };
}
