import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { getPrices } from './pyth';
import { isNoRouteError } from './arcFx';
import { executeSwapRoute } from './swapRouter';
import { logSwapEvent } from './agentLearning';

async function executeOrderSwap(userId: string, fromSymbol: string, toSymbol: string, amount: number, slippage: number): Promise<{ txHash: string }> {
  const r = await executeSwapRoute(userId, fromSymbol, toSymbol, amount, slippage);
  return { txHash: r.txHash };
}

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'USDbC']);

// ── Price resolver ───────────────────────────────────────────────────────────
async function getTokenUsdPrice(symbol: string): Promise<number | null> {
  try {
    const prices = await getPrices([symbol.toUpperCase()]);
    const p = prices[symbol.toUpperCase()];
    if (p && p.price > 0) return p.price;
  } catch { /* fall through */ }

  try {
    const { getAllPrices } = await import('./priceProvider');
    const all = await getAllPrices();
    const found = (all as any[]).find((t: any) => t.symbol.toUpperCase() === symbol.toUpperCase());
    if (found && found.price > 0) return found.price;
  } catch { /* ignore */ }

  return null;
}

// ── Exponential backoff ──────────────────────────────────────────────────────
function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30_000);
}

// ── Telegram notify ──────────────────────────────────────────────────────────
async function notifyUser(userId: string, message: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });
    if (!user?.telegramChatId || !process.env.TELEGRAM_BOT_TOKEN) return;
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: user.telegramChatId, text: `GuardAgent: ${message}` }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch { /* non-critical */ }
}

// ── Execute single limit order with retry ────────────────────────────────────
async function executeLimitOrder(
  order: { id: string; userId: string; fromToken: string; toToken: string; amount: string; slippage: any; retries: number; maxRetries: number },
  walletAddress: string,
  network: string,
): Promise<void> {
  const slippage = parseFloat(order.slippage.toString());
  const amount = parseFloat(order.amount);

  // Enforce AgentWallet spending limits before executing
  const agentWallet = await prisma.agentWallet.findUnique({
    where: { userId: order.userId },
    select: { maxTxSizeUsd: true, dailyLimitUsd: true },
  });
  if (agentWallet) {
    const price = await getTokenUsdPrice(order.fromToken);
    if (price && price > 0) {
      const swapUsd = amount * price;
      if (swapUsd > agentWallet.maxTxSizeUsd) {
        logger.warn('limitOrders', `Order ${order.id} blocked: $${swapUsd.toFixed(2)} exceeds maxTxSizeUsd $${agentWallet.maxTxSizeUsd}`);
        await prisma.limitOrder.update({ where: { id: order.id }, data: { status: 'FAILED' } });
        await notifyUser(order.userId, `Limit order blocked: swap value exceeds your max transaction limit. Update limits in Settings.`);
        return;
      }
      const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
      const dailyTotal = await prisma.agentTransaction.aggregate({
        where: { userId: order.userId, createdAt: { gte: todayStart }, status: 'SUCCESS' },
        _sum: { amountUsd: true },
      });
      const usedToday = dailyTotal._sum.amountUsd ?? 0;
      if (usedToday + swapUsd > agentWallet.dailyLimitUsd) {
        logger.warn('limitOrders', `Order ${order.id} blocked: daily limit reached ($${usedToday.toFixed(2)} + $${swapUsd.toFixed(2)})`);
        await prisma.limitOrder.update({ where: { id: order.id }, data: { status: 'FAILED' } });
        await notifyUser(order.userId, `Limit order blocked: daily spending limit reached. Update limits in Settings.`);
        return;
      }
    }
  }

  for (let attempt = order.retries; attempt <= order.maxRetries; attempt++) {
    if (attempt > order.retries) {
      await prisma.limitOrder.update({ where: { id: order.id }, data: { retries: attempt } });
      await new Promise(r => setTimeout(r, backoffMs(attempt)));
    }

    try {
      const result = await executeOrderSwap(
        order.userId,
        order.fromToken,
        order.toToken,
        amount,
        slippage,
      );

      await prisma.limitOrder.update({
        where: { id: order.id },
        data: { status: 'FILLED', txHash: result.txHash ?? null, retries: attempt },
      });

      const price = await getTokenUsdPrice(order.fromToken).catch(() => null);
      await prisma.agentTransaction.create({
        data: {
          userId: order.userId,
          type: 'SWAP',
          tokenIn: order.fromToken,
          tokenOut: order.toToken,
          amount: String(amount),
          amountUsd: price ? amount * price : null,
          txHash: result.txHash ?? null,
          status: 'SUCCESS',
          network,
        },
      }).catch(err => logger.error('limitOrders', 'Failed to log agentTransaction', err));

      await logSwapEvent('swap_success', {
        fromToken: order.fromToken, toToken: order.toToken, amount, slippage,
        txHash: result.txHash, userId: order.userId,
        context: { source: 'limit_order', orderId: order.id },
      });

      await notifyUser(order.userId, `Limit order filled: ${order.fromToken}→${order.toToken} (${order.amount} ${order.fromToken}). Tx: ${result.txHash}`);
      logger.info('limitOrders', `Order ${order.id} filled, tx: ${result.txHash}`);
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn('limitOrders', `Order ${order.id} attempt ${attempt + 1} failed: ${errMsg}`);
      await logSwapEvent('swap_failed', {
        fromToken: order.fromToken, toToken: order.toToken, amount, slippage,
        error: errMsg, userId: order.userId,
        context: { source: 'limit_order', orderId: order.id, attempt },
      });

      if (isNoRouteError(err)) {
        await prisma.limitOrder.update({ where: { id: order.id }, data: { status: 'FAILED', retries: attempt } });
        await notifyUser(order.userId, `Limit order failed: no swap route available for ${order.fromToken}→${order.toToken} right now. Retrying won't help, try a smaller amount or the other direction.`);
        logger.error('limitOrders', `Order ${order.id}, no swap route, marked FAILED without retry`);
        return;
      }

      if (attempt === order.maxRetries) {
        await prisma.limitOrder.update({ where: { id: order.id }, data: { status: 'FAILED', retries: attempt } });
        await notifyUser(order.userId, `Limit order failed after ${order.maxRetries + 1} attempts: ${order.fromToken}→${order.toToken}. Check the app for details.`);
        logger.error('limitOrders', `Order ${order.id} exhausted retries. FAILED`);
      }
    }
  }
}

// ── Polling (called every 30s by backend scheduler, index.ts) ────────────────
export async function checkLimitOrders(): Promise<void> {
  let orders: any[];
  try {
    orders = await prisma.limitOrder.findMany({
      where: { status: 'ACTIVE' },
      include: { user: { select: { walletAddress: true, id: true } } },
    });
  } catch (err) {
    logger.warn('limitOrders', 'DB query failed', err);
    return;
  }

  if (orders.length === 0) return;

  // Batch price fetch
  const uniqueTokens = [...new Set(orders.map((o: any) => o.watchToken.toUpperCase() as string))];
  const prices: Record<string, number> = {};
  for (const token of uniqueTokens) {
    const price = await getTokenUsdPrice(token);
    if (price !== null) prices[token] = price;
  }

  for (const order of orders) {
    // Expire check
    if (order.expiresAt && new Date() > new Date(order.expiresAt)) {
      await prisma.limitOrder.update({ where: { id: order.id }, data: { status: 'EXPIRED' } });
      continue;
    }

    const watchPrice = prices[order.watchToken.toUpperCase()];
    if (!watchPrice) continue;

    const trigger = parseFloat(order.triggerPrice.toString());
    const triggered =
      order.direction === 'ABOVE' ? watchPrice >= trigger :
      order.direction === 'BELOW' ? watchPrice <= trigger : false;

    if (!triggered) continue;

    // Per-wallet mutex lock, prevents race condition when multiple orders fire simultaneously
    const lockKey = `limit-order-lock:${order.userId}`;
    const acquired = await redis.set(lockKey, '1', 'EX', 120, 'NX');
    if (!acquired) continue;

    // Mark TRIGGERED immediately, prevents double-fire on next poll cycle
    await prisma.limitOrder.update({ where: { id: order.id }, data: { status: 'TRIGGERED' } });

    const agentWallet = await prisma.agentWallet.findUnique({ where: { userId: order.userId } });
    const network = agentWallet?.network || 'arc-testnet';

    logger.info('limitOrders', `Order ${order.id} triggered. ${order.watchToken} $${watchPrice} ${order.direction} $${trigger}`);

    executeLimitOrder(order, order.user.walletAddress, network)
      .finally(() => redis.del(lockKey))
      .catch(err => logger.error('limitOrders', `Unhandled error for order ${order.id}`, err));
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function createLimitOrder(params: {
  userId: string;
  fromToken: string;
  toToken: string;
  amount: string;
  triggerPrice: number;
  direction: 'ABOVE' | 'BELOW';
  slippage?: number;
  expiresAt?: Date;
}): Promise<any> {
  const watchToken = STABLECOINS.has(params.fromToken.toUpperCase())
    ? params.toToken.toUpperCase()
    : params.fromToken.toUpperCase();

  return prisma.limitOrder.create({
    data: {
      userId: params.userId,
      fromToken: params.fromToken.toUpperCase(),
      toToken: params.toToken.toUpperCase(),
      watchToken,
      amount: params.amount,
      triggerPrice: params.triggerPrice,
      direction: params.direction,
      slippage: params.slippage ?? 0.5,
      expiresAt: params.expiresAt ?? null,
    },
  });
}

export async function getLimitOrders(userId: string): Promise<any[]> {
  return prisma.limitOrder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function cancelLimitOrder(id: string, userId: string): Promise<boolean> {
  const order = await prisma.limitOrder.findFirst({ where: { id, userId, status: 'ACTIVE' } });
  if (!order) return false;
  await prisma.limitOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  return true;
}
