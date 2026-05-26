import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { SwapKit, SwapChain } from '@circle-fin/swap-kit';
import { getCircleWalletsAdapter } from './circleAdapter';
import { logger } from '../lib/logger';
import { bpsFee } from './customFee';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';
const CIRCLE_KIT_KEY       = process.env.CIRCLE_KIT_KEY || '';

const SUPPORTED = new Set(['USDC', 'EURC']);

export class SwapRouteUnavailableError extends Error {
  readonly code = 'SWAP_ROUTE_UNAVAILABLE';
  constructor(public tokenIn: string, public tokenOut: string, public amountIn: string) {
    super(`Swap route temporarily unavailable for ${tokenIn} → ${tokenOut}. Circle's liquidity service has no route for this pair/size on Arc Testnet, try a different amount or swap ${tokenOut} → ${tokenIn} instead.`);
    this.name = 'SwapRouteUnavailableError';
  }
}

export function isNoRouteError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes('no route available') ||
         m.includes('input_unsupported_route') ||
         m.includes('route or resource not found') ||
         m.includes('no route found') ||
         m.includes('unsupported route');
}

export function isFxConfigured(): boolean {
  return !!(CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET && CIRCLE_KIT_KEY);
}

function requireKitKey() {
  if (!CIRCLE_KIT_KEY) {
    throw new Error('FX swap needs a free Circle Kit Key - set CIRCLE_KIT_KEY (get it at developers.circle.com/w3s/keys)');
  }
}

function getClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: CIRCLE_ENTITY_SECRET,
  });
}

async function resolveAddress(walletId: string): Promise<string> {
  const r = await getClient().getWallet({ id: walletId });
  const address = r.data?.wallet?.address;
  if (!address) throw new Error('Cannot resolve agent wallet address');
  return address;
}

function normalizePair(tokenIn: string, tokenOut: string) {
  const a = tokenIn.toUpperCase();
  const b = tokenOut.toUpperCase();
  if (!SUPPORTED.has(a) || !SUPPORTED.has(b)) throw new Error('Only USDC and EURC are supported for FX');
  if (a === b) throw new Error('tokenIn and tokenOut must differ');
  return { tokenIn: a, tokenOut: b };
}

export interface FxQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  estimatedOut: string | null;
  minOut: string | null;
  rate: string | null;
}

export async function getFxQuote(
  walletId: string,
  tokenInRaw: string,
  tokenOutRaw: string,
  amountIn: string,
  slippageBps = 100,
): Promise<FxQuote> {
  requireKitKey();
  const { tokenIn, tokenOut } = normalizePair(tokenInRaw, tokenOutRaw);
  const address = await resolveAddress(walletId);
  const kit = new SwapKit();
  let est;
  try {
    est = await kit.estimate({
      from: { adapter: getCircleWalletsAdapter() as never, chain: SwapChain.Arc_Testnet, address } as never,
      tokenIn: tokenIn as never,
      tokenOut: tokenOut as never,
      amountIn,
      config: { slippageBps, kitKey: CIRCLE_KIT_KEY } as never,
    });
  } catch (err) {
    if (isNoRouteError(err)) {
      logger.warn('fx', `No swap route from Circle for ${tokenIn}->${tokenOut} (${amountIn}): ${err instanceof Error ? err.message : String(err)}`);
      throw new SwapRouteUnavailableError(tokenIn, tokenOut, amountIn);
    }
    throw err;
  }
  const estimatedOut = (est as { estimatedOutput?: { amount?: string } }).estimatedOutput?.amount ?? null;
  const minOut = (est as { stopLimit?: { amount?: string } }).stopLimit?.amount ?? null;
  const rate = estimatedOut ? (parseFloat(estimatedOut) / parseFloat(amountIn)).toFixed(6) : null;
  return { tokenIn, tokenOut, amountIn, estimatedOut, minOut, rate };
}

export interface FxRouteCheck {
  available: boolean;
  reason?: string;
  quote?: FxQuote;
}

export async function preflightFxRoute(
  walletId: string,
  tokenInRaw: string,
  tokenOutRaw: string,
  amountIn: string,
  slippageBps = 100,
): Promise<FxRouteCheck> {
  const a = tokenInRaw.toUpperCase();
  const b = tokenOutRaw.toUpperCase();
  if (a === b) return { available: false, reason: 'tokenIn and tokenOut must differ' };
  if (!SUPPORTED.has(a) || !SUPPORTED.has(b)) {
    return { available: false, reason: `FX swap supports only USDC<->EURC. ${a} to ${b} is not an FX route.` };
  }
  try {
    const quote = await getFxQuote(walletId, a, b, amountIn, slippageBps);
    return { available: true, quote };
  } catch (err) {
    if (err instanceof SwapRouteUnavailableError) return { available: false, reason: err.message };
    logger.warn('fx', `preflight route check inconclusive for ${a}->${b} (${amountIn}): ${err instanceof Error ? err.message : String(err)}`);
    return { available: true };
  }
}

export interface FxSwapResult {
  txHash: string;
  explorerUrl?: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string | null;
}

export async function executeFxSwap(
  walletId: string,
  tokenInRaw: string,
  tokenOutRaw: string,
  amountIn: string,
  slippageBps = 100,
): Promise<FxSwapResult> {
  requireKitKey();
  const { tokenIn, tokenOut } = normalizePair(tokenInRaw, tokenOutRaw);
  const address = await resolveAddress(walletId);
  const kit = new SwapKit();
  const fromCtx = { adapter: getCircleWalletsAdapter() as never, chain: SwapChain.Arc_Testnet, address } as never;

  let stopLimitDecimal: string | undefined;
  try {
    const est = await kit.estimate({
      from: fromCtx,
      tokenIn: tokenIn as never,
      tokenOut: tokenOut as never,
      amountIn,
      config: { slippageBps, kitKey: CIRCLE_KIT_KEY } as never,
    });
    const minOut = (est as { stopLimit?: { amount?: string } }).stopLimit?.amount;
    if (minOut != null && parseFloat(minOut) > 0) {
      stopLimitDecimal = minOut;
    }
  } catch (err) {
    if (isNoRouteError(err)) {
      logger.warn('fx', `No swap route from Circle for ${tokenIn}->${tokenOut} (${amountIn}): ${err instanceof Error ? err.message : String(err)}`);
      throw new SwapRouteUnavailableError(tokenIn, tokenOut, amountIn);
    }
    logger.warn('fx', `stopLimit pre-estimate failed for ${tokenIn}->${tokenOut} (${amountIn}); falling back to slippage-only: ${err instanceof Error ? err.message : String(err)}`);
  }

  const customFee = bpsFee();
  let r;
  try {
    r = await kit.swap({
      from: fromCtx,
      tokenIn: tokenIn as never,
      tokenOut: tokenOut as never,
      amountIn,
      config: {
        slippageBps,
        kitKey: CIRCLE_KIT_KEY,
        allowanceStrategy: 'approve',
        ...(stopLimitDecimal ? { stopLimit: stopLimitDecimal } : {}),
        ...(customFee ? { customFee } : {}),
      } as never,
    });
  } catch (err) {
    if (isNoRouteError(err)) {
      logger.warn('fx', `No swap route at execution for ${tokenIn}->${tokenOut} (${amountIn}): ${err instanceof Error ? err.message : String(err)}`);
      throw new SwapRouteUnavailableError(tokenIn, tokenOut, amountIn);
    }
    throw err;
  }
  logger.info('fx', `FX swap ${amountIn} ${tokenIn}->${tokenOut} tx ${(r as { txHash: string }).txHash} stopLimit=${stopLimitDecimal ?? 'slippage-only'}`);
  return {
    txHash: (r as { txHash: string }).txHash,
    explorerUrl: (r as { explorerUrl?: string }).explorerUrl,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut: (r as { amountOut?: string }).amountOut ?? null,
  };
}
