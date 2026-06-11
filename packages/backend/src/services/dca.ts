import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { executeSwapRoute } from './swapRouter';
import { logSwapEvent } from './agentLearning';
import { getWalletTokens } from './tokenBalances';

async function executeOrderSwap(userId: string, fromSymbol: string, toSymbol: string, amount: number, slippage: number): Promise<{ txHash: string }> {
  const r = await executeSwapRoute(userId, fromSymbol, toSymbol, amount, slippage);
  return { txHash: r.txHash };
}

type Frequency = 'HOURLY' | 'DAILY' | 'WEEKLY';

// ── Next run calculator ───────────────────────────────────────────────────────
function nextRunTime(frequency: Frequency, from: Date = new Date()): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'HOURLY': d.setHours(d.getHours() + 1); break;
    case 'DAILY':  d.setDate(d.getDate() + 1); break;
    case 'WEEKLY': d.setDate(d.getDate() + 7); break;
  }
  // Jitter ±5 minutes to avoid thundering herd when many orders share same schedule
  const jitterMs = (Math.random() * 10 - 5) * 60 * 1000;
  return new Date(d.getTime() + jitterMs);
}

// ── Telegram notify ───────────────────────────────────────────────────────────
async function notifyUser(userId: string, message: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
    if (!user?.telegramChatId || !process.env.TELEGRAM_BOT_TOKEN) return;
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: user.telegramChatId, text: `GuardAgent DCA: ${message}` }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch { /* non-critical */ }
}

// ── Check if user has sufficient funds ───────────────────────────────────────
async function hasSufficientFunds(
  agentAddress: string,
  fromToken: string,
  amount: number,
): Promise<boolean> {
  try {
    const wb = await getWalletTokens(agentAddress);
    if (fromToken.toUpperCase() === 'ETH') return wb.ethBalance >= amount;
    const token = wb.tokens.find(t => t.symbol.toUpperCase() === fromToken.toUpperCase());
    return (token?.balance ?? 0) >= amount;
  } catch {
    return false;
  }
}

// ── Process single DCA order ──────────────────────────────────────────────────
async function processSingleDCA(order: any, walletAddress: string, network: string): Promise<void> {
  const amount = parseFloat(order.amountPerCycle);

  const agentWallet = await prisma.agentWallet.findUnique({ where: { userId: order.userId } });
  const agentAddress = agentWallet?.agentAddress;

  if (!agentAddress) {
    logger.warn('dca', `Order ${order.id}: no agent wallet found for user ${order.userId}`);
    return;
  }

  // Check funds, skip this cycle rather than retry (DCA semantics: best-effort)
  const sufficient = await hasSufficientFunds(agentAddress, order.fromToken, amount);
  if (!sufficient) {
    logger.warn('dca', `Order ${order.id}: insufficient ${order.fromToken}, skipping cycle`);
    await notifyUser(order.userId, `DCA skipped: insufficient ${order.fromToken} for ${amount} ${order.fromToken}→${order.toToken} swap.`);

    const nextRun = nextRunTime(order.frequency as Frequency);
    await prisma.dCAOrder.update({
      where: { id: order.id },
      data: { nextRunAt: nextRun },
    });
    return;
  }

  // Enforce AgentWallet spending limits before executing
  if (agentWallet) {
    const { getPrices } = await import('./pyth');
    try {
      const prices = await getPrices([order.fromToken.toUpperCase()]);
      const price = prices[order.fromToken.toUpperCase()]?.price ?? 0;
      if (price > 0) {
        const swapUsd = amount * price;
        if (swapUsd > agentWallet.maxTxSizeUsd) {
          logger.warn('dca', `Order ${order.id} blocked: $${swapUsd.toFixed(2)} exceeds maxTxSizeUsd $${agentWallet.maxTxSizeUsd}`);
          await notifyUser(order.userId, `DCA cycle blocked: amount exceeds your max transaction limit. Update limits in Settings.`);
          const nextRun = nextRunTime(order.frequency as Frequency);
          await prisma.dCAOrder.update({ where: { id: order.id }, data: { nextRunAt: nextRun } });
          return;
        }
        const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
        const dailyTotal = await prisma.agentTransaction.aggregate({
          where: { userId: order.userId, createdAt: { gte: todayStart }, status: 'SUCCESS' },
          _sum: { amountUsd: true },
        });
        const usedToday = dailyTotal._sum.amountUsd ?? 0;
        if (usedToday + swapUsd > agentWallet.dailyLimitUsd) {
          logger.warn('dca', `Order ${order.id} blocked: daily limit reached`);
          await notifyUser(order.userId, `DCA cycle skipped: daily spending limit reached. Update limits in Settings.`);
          const nextRun = nextRunTime(order.frequency as Frequency);
          await prisma.dCAOrder.update({ where: { id: order.id }, data: { nextRunAt: nextRun } });
          return;
        }
      }
    } catch { /* non-critical, proceed if price unavailable */ }
  }

  try {
    const result = await executeOrderSwap(
      order.userId,
      order.fromToken,
      order.toToken,
      amount,
      agentWallet?.slippagePercent ?? 0.5,
    );

    const newTotalRuns = order.totalRuns + 1;
    const completed = order.maxRuns !== null && newTotalRuns >= order.maxRuns;
    const nextRun = nextRunTime(order.frequency as Frequency);

    await prisma.dCAOrder.update({
      where: { id: order.id },
      data: {
        totalRuns: newTotalRuns,
        lastTxHash: result.txHash ?? null,
        nextRunAt: nextRun,
        status: completed ? 'COMPLETED' : 'ACTIVE',
      },
    });

    await prisma.agentTransaction.create({
      data: {
        userId: order.userId,
        type: 'SWAP',
        tokenIn: order.fromToken,
        tokenOut: order.toToken,
        amount: String(amount),
        amountUsd: null,
        txHash: result.txHash ?? null,
        status: 'SUCCESS',
        network: agentWallet?.network ?? 'arc-testnet',
      },
    }).catch(err => logger.error('dca', 'Failed to log agentTransaction', err));

    await logSwapEvent('swap_success', {
      fromToken: order.fromToken, toToken: order.toToken, amount,
      txHash: result.txHash, userId: order.userId,
      context: { source: 'dca', orderId: order.id, run: newTotalRuns },
    });

    const msg = completed
      ? `DCA completed after ${newTotalRuns} runs: ${order.fromToken}→${order.toToken}`
      : `DCA cycle ${newTotalRuns}${order.maxRuns ? `/${order.maxRuns}` : ''} executed: ${amount} ${order.fromToken}→${order.toToken}. Next: ${nextRun.toLocaleString()}`;
    await notifyUser(order.userId, msg);
    logger.info('dca', `Order ${order.id} cycle ${newTotalRuns} executed, tx: ${result.txHash}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('dca', `Order ${order.id} failed: ${errMsg}`);

    await logSwapEvent('swap_failed', {
      fromToken: order.fromToken, toToken: order.toToken, amount,
      error: errMsg, userId: order.userId,
      context: { source: 'dca', orderId: order.id },
    });

    // DCA: on failure, skip this cycle and schedule next (don't mark as FAILED permanently)
    const nextRun = nextRunTime(order.frequency as Frequency);
    await prisma.dCAOrder.update({ where: { id: order.id }, data: { nextRunAt: nextRun } });
    await notifyUser(order.userId, `DCA cycle failed for ${order.fromToken}→${order.toToken}. Next attempt: ${nextRun.toLocaleString()}`);
  }
}

// ── Main polling function (called every 60s by backend scheduler, index.ts) ───
export async function processDCAOrders(): Promise<void> {
  let orders: any[];
  try {
    orders = await prisma.dCAOrder.findMany({
      where: {
        status: 'ACTIVE',
        nextRunAt: { lte: new Date() },
      },
      include: { user: { select: { walletAddress: true } } },
    });
  } catch (err) {
    logger.warn('dca', 'DB query failed', err);
    return;
  }

  if (orders.length === 0) return;

  for (const order of orders) {
    const agentWallet = await prisma.agentWallet.findUnique({ where: { userId: order.userId } });
    const network = agentWallet?.network || 'arc-testnet';

    // Run async, don't block polling loop. Each order is independent.
    processSingleDCA(order, order.user.walletAddress, network)
      .catch(err => logger.error('dca', `Unhandled error for DCA order ${order.id}`, err));
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function createDCAOrder(params: {
  userId: string;
  fromToken: string;
  toToken: string;
  amountPerCycle: string;
  frequency: Frequency;
  maxRuns?: number;
  startAt?: Date;
}): Promise<any> {
  const firstRun = params.startAt ?? new Date();

  return prisma.dCAOrder.create({
    data: {
      userId: params.userId,
      fromToken: params.fromToken.toUpperCase(),
      toToken: params.toToken.toUpperCase(),
      amountPerCycle: params.amountPerCycle,
      frequency: params.frequency,
      nextRunAt: firstRun,
      maxRuns: params.maxRuns ?? null,
    },
  });
}

export async function getDCAOrders(userId: string): Promise<any[]> {
  return prisma.dCAOrder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function pauseDCAOrder(id: string, userId: string): Promise<boolean> {
  const order = await prisma.dCAOrder.findFirst({ where: { id, userId, status: 'ACTIVE' } });
  if (!order) return false;
  await prisma.dCAOrder.update({ where: { id }, data: { status: 'PAUSED' } });
  return true;
}

export async function resumeDCAOrder(id: string, userId: string): Promise<boolean> {
  const order = await prisma.dCAOrder.findFirst({ where: { id, userId, status: 'PAUSED' } });
  if (!order) return false;
  const nextRun = nextRunTime(order.frequency as Frequency);
  await prisma.dCAOrder.update({ where: { id }, data: { status: 'ACTIVE', nextRunAt: nextRun } });
  return true;
}

export async function cancelDCAOrder(id: string, userId: string): Promise<boolean> {
  const order = await prisma.dCAOrder.findFirst({ where: { id, userId, status: { in: ['ACTIVE', 'PAUSED'] } } });
  if (!order) return false;
  await prisma.dCAOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  return true;
}
