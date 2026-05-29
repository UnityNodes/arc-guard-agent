import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { ARC_NETWORK, explorerTxUrl } from '../services/arckit';
import { executeFxSwap } from '../services/arcFx';
import { runAegis } from '../services/aegis';
import { getTokenUsdValue } from '../services/fxHedge';
import { evaluateAction } from '../services/guardian';

export const chatRouter = Router();
chatRouter.use(requireAuth);

type WalletCtx = {
  userId: string;
  walletAddress: string;
  agentAddress: string;
  network: 'arc-mainnet' | 'arc-testnet';
  maxTxSizeUsd: number;
  dailyLimitUsd: number;
  slippage: number;
  autoMode: boolean;
};

async function runConfirmedSwap(
  ctx: WalletCtx,
  circleWalletId: string,
  fromToken: string,
  toToken: string,
  amount: number,
  quoteKey: string,
  alertId?: string,
): Promise<{ content: string; swapCompleted: boolean; txHash?: string }> {
  const swapUsd = await getTokenUsdValue(fromToken, amount).catch(() => 0);
  if (swapUsd <= 0) {
    return { content: 'Could not determine USD value. Swap blocked for safety. Try again.', swapCompleted: false };
  }
  if (swapUsd > ctx.maxTxSizeUsd) {
    return { content: `Swap value ~$${swapUsd.toFixed(2)} exceeds your $${ctx.maxTxSizeUsd} per-transaction limit. Adjust in Settings.`, swapCompleted: false };
  }

  const guard = await evaluateAction(ctx.userId, { action: 'WITHDRAW', amountUsd: swapUsd, token: fromToken });
  if (guard.result.decision === 'DENY') {
    return { content: `Swap blocked by Guardian policy: ${guard.result.reasons?.join(', ') ?? 'policy limit'}`, swapCompleted: false };
  }
  if (guard.result.decision === 'REQUIRE_APPROVAL') {
    return { content: `This swap ($${swapUsd.toFixed(2)}) exceeds your approval threshold. Approve via Telegram or raise your threshold in Guardian settings.`, swapCompleted: false };
  }

  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayTxs = await prisma.agentTransaction.findMany({
    where: { userId: ctx.userId, createdAt: { gte: todayStart }, status: 'SUCCESS' },
    select: { amountUsd: true },
  });
  const dailyTotal = todayTxs.reduce((sum, tx) => sum + (tx.amountUsd ?? 0), 0);
  if (dailyTotal + swapUsd > ctx.dailyLimitUsd) {
    return { content: `Daily limit reached. Today: $${dailyTotal.toFixed(2)} + ~$${swapUsd.toFixed(2)} exceeds your $${ctx.dailyLimitUsd} daily limit.`, swapCompleted: false };
  }

  await redis.del(quoteKey);

  try {
    const fxResult = await executeFxSwap(circleWalletId, fromToken, toToken, String(amount), Math.round(ctx.slippage * 100));
    const txHash = fxResult.txHash;

    await prisma.agentTransaction.create({
      data: {
        userId: ctx.userId, type: 'SWAP',
        tokenIn: fromToken, tokenOut: toToken,
        amount: amount.toFixed(6), amountUsd: swapUsd,
        txHash: txHash ?? null, status: 'SUCCESS',
        network: ctx.network,
      },
    }).catch(err => logger.error('audit', 'Failed to log swap transaction', err));

    try {
      const { logSwapEvent } = await import('../services/agentLearning');
      await logSwapEvent('swap_success', { fromToken, toToken, amount, txHash, userId: ctx.userId });
    } catch (err) { logger.warn('learning', 'Failed to log swap event', err); }

    await redis.del(`agent:tokens:${ctx.agentAddress}`).catch(() => {});
    await redis.del(`agent:history:${ctx.agentAddress}`).catch(() => {});

    const txLink = txHash ? `\n[View on Arcscan](${explorerTxUrl(txHash)})` : '';
    return {
      content: `Swap executed!\n${amount} ${fromToken} → ${fxResult.amountOut ?? '?'} ${toToken}${txLink}`,
      swapCompleted: true,
      txHash,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma.agentTransaction.create({
      data: {
        userId: ctx.userId, type: 'SWAP',
        tokenIn: fromToken, tokenOut: toToken,
        amount: amount.toFixed(6), amountUsd: null,
        status: 'FAILED', network: ctx.network,
      },
    }).catch(err2 => logger.error('audit', 'Failed to log failed swap', err2));
    try {
      const { logSwapEvent } = await import('../services/agentLearning');
      await logSwapEvent('swap_failed', { fromToken, toToken, amount, error: errMsg, userId: ctx.userId });
    } catch (e) { logger.warn('learning', 'Failed to log failed swap event', e); }
    logger.error('swap', 'Swap execution failed', err);
    return { content: 'Swap failed. Please check your balance and try again.', swapCompleted: false };
  }
}

// ─── Thread routes ────────────────────────────────────────────────────────────

chatRouter.get('/threads', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const threads = await prisma.chatThread.findMany({
      where: { userId: req.userId! },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
    });
    res.json({ threads });
  } catch (err) {
    logger.error('chat', 'Failed to fetch threads', err);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

chatRouter.post('/threads', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const thread = await prisma.chatThread.create({
      data: { userId: req.userId!, title: 'New conversation' },
    });
    res.json({ thread });
  } catch (err) {
    logger.error('chat', 'Failed to create thread', err);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

chatRouter.delete('/threads/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const thread = await prisma.chatThread.findFirst({ where: { id, userId: req.userId! } });
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }
    await prisma.chatThread.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    logger.error('chat', 'Failed to delete thread', err);
    res.status(500).json({ error: 'Failed to delete thread' });
  }
});

// ─── Message routes ───────────────────────────────────────────────────────────

chatRouter.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const threadId = req.query.threadId as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    if (threadId) {
      const thread = await prisma.chatThread.findFirst({ where: { id: threadId, userId: req.userId! } });
      if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }
    }

    const messages = await prisma.chatMessage.findMany({
      where: { userId: req.userId!, threadId: threadId ?? null },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    res.json({ messages });
  } catch (err) {
    logger.error('chat', 'Failed to fetch messages', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

chatRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { content, threadId, alertId, confirmAction, swapParams: frontendSwapParams, swapWithContract } = req.body as {
    content: string;
    threadId?: string;
    alertId?: string;
    confirmAction?: 'execute_swap' | 'cancel';
    swapParams?: { fromToken: string; toToken: string; amount: number; slippage?: number };
    swapWithContract?: { fromToken: string; toToken: string; amount: number; toContract: string };
  };
  if (!content?.trim()) { res.status(400).json({ error: 'Content required' }); return; }

  let activeThreadId: string | null = threadId ?? null;

  if (activeThreadId) {
    const thread = await prisma.chatThread.findFirst({ where: { id: activeThreadId, userId: req.userId! } });
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }
  }

  await prisma.chatMessage.create({
    data: { userId: req.userId!, threadId: activeThreadId, role: 'user', content: content.trim() },
  });

  if (activeThreadId) {
    const msgCount = await prisma.chatMessage.count({ where: { threadId: activeThreadId, role: 'user' } });
    const updateData = msgCount === 1
      ? { title: content.trim().slice(0, 45) + (content.trim().length > 45 ? '…' : ''), lastMessageAt: new Date() }
      : { lastMessageAt: new Date() };
    await prisma.chatThread.update({ where: { id: activeThreadId }, data: updateData }).catch(() => {});
  }

  const wallet = await prisma.agentWallet.findUnique({
    where: { userId: req.userId! },
    select: { agentAddress: true, maxTxSizeUsd: true, dailyLimitUsd: true, slippagePercent: true, network: true, circleWalletId: true },
  });
  const userSettings = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { autoMode: true },
  });

  if (!wallet) {
    const msg = await prisma.chatMessage.create({
      data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'Please set up your agent wallet first.' },
    });
    res.json({ message: msg });
    return;
  }

  const ctx: WalletCtx = {
    userId: req.userId!,
    walletAddress: req.walletAddress!,
    agentAddress: wallet.agentAddress,
    network: (wallet.network ?? ARC_NETWORK) as 'arc-mainnet' | 'arc-testnet',
    maxTxSizeUsd: wallet.maxTxSizeUsd,
    dailyLimitUsd: wallet.dailyLimitUsd,
    slippage: wallet.slippagePercent ?? 0.5,
    autoMode: userSettings?.autoMode ?? false,
  };

  // ─── Confirm swap from frontend card button ───────────────────────────────
  if (confirmAction === 'execute_swap' && frontendSwapParams) {
    const lockKey = `swap-lock:${req.userId}`;
    const lockAcquired = await redis.set(lockKey, '1', 'EX', 120, 'NX');
    if (!lockAcquired) {
      const msg = await prisma.chatMessage.create({
        data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'A swap is already in progress. Please wait a moment.' },
      });
      res.json({ message: msg }); return;
    }
    try {
      const quoteKey = `swap-confirm:${req.userId}`;
      const storedQuote = await redis.get(quoteKey);
      if (!storedQuote) {
        const msg = await prisma.chatMessage.create({
          data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'No pending swap quote. Please request a new quote.' },
        });
        res.json({ message: msg, swapCompleted: false }); return;
      }
      const sq = JSON.parse(storedQuote);
      if (sq.fromToken !== frontendSwapParams.fromToken ||
          sq.toToken !== frontendSwapParams.toToken ||
          Math.abs(sq.amount - frontendSwapParams.amount) > 0.0001) {
        const msg = await prisma.chatMessage.create({
          data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'Swap parameters do not match the quote. Please request a new quote.' },
        });
        res.json({ message: msg, swapCompleted: false }); return;
      }
      if (!wallet.circleWalletId) {
        const msg = await prisma.chatMessage.create({
          data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'Agent wallet not configured.' },
        });
        res.json({ message: msg, swapCompleted: false }); return;
      }
      const result = await runConfirmedSwap(
        ctx, wallet.circleWalletId,
        frontendSwapParams.fromToken, frontendSwapParams.toToken,
        frontendSwapParams.amount, quoteKey, alertId,
      );
      const msg = await prisma.chatMessage.create({
        data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: result.content, alertId: alertId ?? null },
      });
      if (activeThreadId) await prisma.chatThread.update({ where: { id: activeThreadId }, data: { lastMessageAt: new Date() } }).catch(() => {});
      res.json({ message: msg, swapCompleted: result.swapCompleted });
    } finally {
      await redis.del(lockKey);
    }
    return;
  }

  if (confirmAction === 'cancel') {
    const msg = await prisma.chatMessage.create({
      data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'Cancelled. Let me know if you need anything else.' },
    });
    res.json({ message: msg });
    return;
  }

  // ─── User selected a specific token contract from the picker ─────────────
  if (swapWithContract?.toContract) {
    const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
    if (!ADDR_RE.test(swapWithContract.toContract)) {
      const errMsg = await prisma.chatMessage.create({
        data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'Invalid token contract address.' },
      });
      res.json({ message: errMsg }); return;
    }
    let picked: { address: string; decimals: number } | null = null;
    try {
      const { verifyToken } = await import('../services/arckit');
      const v = await verifyToken(swapWithContract.toToken.toUpperCase());
      const match = v.candidates?.find((c: { address: string; decimals: number }) =>
        c.address.toLowerCase() === swapWithContract.toContract.toLowerCase()
      );
      if (match) picked = { address: match.address, decimals: match.decimals };
    } catch (err) { logger.warn('aegis', 'Token candidate verification failed', err); }
    if (!picked) {
      const errMsg = await prisma.chatMessage.create({
        data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'Selected contract is not in the candidate list. Please re-search.' },
      });
      res.json({ message: errMsg }); return;
    }
    try {
      const quoteMsg = `Get quote and confirm: swap ${swapWithContract.amount} ${swapWithContract.fromToken} to ${swapWithContract.toToken}`;
      const aegisRes = await runAegis(quoteMsg, ctx);
      try {
        const key = `swap-confirm:${req.userId}`;
        const existing = await redis.get(key);
        if (existing) {
          const sq = JSON.parse(existing);
          sq.toAddress = picked.address;
          sq.toDecimals = picked.decimals;
          await redis.setex(key, 60, JSON.stringify(sq));
        }
      } catch (err) { logger.warn('aegis', 'Failed to pin user-picked contract to quote', err); }
      const msg = await prisma.chatMessage.create({
        data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: aegisRes.text, actions: aegisRes.actions ?? [] },
      });
      if (activeThreadId) await prisma.chatThread.update({ where: { id: activeThreadId }, data: { lastMessageAt: new Date() } }).catch(() => {});
      res.json({ message: msg, pendingConfirm: aegisRes.actions?.includes('confirm_swap') ? 'execute_swap' : null });
    } catch (err) {
      logger.error('aegis', 'swapWithContract quote failed', err);
      const errMsg = await prisma.chatMessage.create({
        data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'Failed to get swap quote. Please try again.' },
      });
      res.json({ message: errMsg });
    }
    return;
  }

  // ─── Fast paths (read-only, no Claude needed) ────────────────────────────
  const userMsg = content.trim().toLowerCase();

  if (/^(balance|portfolio|wallet|my balance|show balance|баланс)$/i.test(userMsg)) {
    try {
      const { getWalletTokens } = await import('../services/tokenBalances');
      const wb = await getWalletTokens(wallet.agentAddress);
      const lines: string[] = [];
      if (wb.ethBalance > 0.00001) lines.push(`**ETH:** ${wb.ethBalance.toFixed(6)} ($${(wb.ethBalance * wb.ethPrice).toFixed(2)})`);
      for (const t of wb.tokens) {
        if (t.isSuspicious) continue;
        lines.push(`**${t.symbol}:** ${t.balance < 0.01 ? t.balance.toFixed(6) : t.balance.toFixed(4)} ($${t.balanceUsd.toFixed(2)})`);
      }
      const msg = await prisma.chatMessage.create({
        data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: `Your portfolio (~$${wb.totalUsd.toFixed(2)}):\n${lines.join('\n') || 'No tokens found'}` },
      });
      if (activeThreadId) await prisma.chatThread.update({ where: { id: activeThreadId }, data: { lastMessageAt: new Date() } }).catch(() => {});
      res.json({ message: msg }); return;
    } catch (err) { logger.warn('balance', 'Balance fetch failed, falling through to Aegis', err); }
  }

  if (/^(yield|rates|apy|yields|defi rates|ставки)$/i.test(userMsg)) {
    try {
      const { getYieldRates, formatYieldsForAI } = await import('../services/yieldRates');
      const rates = await getYieldRates();
      const msg = await prisma.chatMessage.create({
        data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: `Current DeFi yields on Arc:\n\n${formatYieldsForAI(rates)}` },
      });
      if (activeThreadId) await prisma.chatThread.update({ where: { id: activeThreadId }, data: { lastMessageAt: new Date() } }).catch(() => {});
      res.json({ message: msg }); return;
    } catch (err) { logger.warn('yield', 'Yield fetch failed, falling through to Aegis', err); }
  }

  // ─── Main: Aegis handles everything else ─────────────────────────────────
  const history = await prisma.chatMessage.findMany({
    where: { userId: req.userId!, threadId: activeThreadId ?? null, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  const chatHistory = history.reverse().map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  try {
    const aegisRes = await runAegis(content.trim(), ctx, chatHistory);
    const msg = await prisma.chatMessage.create({
      data: {
        userId: req.userId!,
        threadId: activeThreadId,
        role: 'assistant',
        content: aegisRes.text,
        alertId: alertId ?? null,
        actions: aegisRes.actions ?? [],
      },
    });
    if (activeThreadId) await prisma.chatThread.update({ where: { id: activeThreadId }, data: { lastMessageAt: new Date() } }).catch(() => {});
    if (aegisRes.swapCompleted) {
      await redis.del(`agent:tokens:${ctx.agentAddress}`).catch(() => {});
      await redis.del(`agent:history:${ctx.agentAddress}`).catch(() => {});
    }
    res.json({
      message: msg,
      pendingConfirm: aegisRes.actions?.includes('confirm_swap') ? 'execute_swap' : null,
      ruleCreated: aegisRes.ruleCreated,
      settingsUpdated: aegisRes.settingsUpdated,
      swapCompleted: aegisRes.swapCompleted,
      toolsUsed: aegisRes.toolsUsed ?? null,
    });
  } catch (err) {
    logger.error('aegis', 'Aegis failed', err);
    const fallback = await prisma.chatMessage.create({
      data: { userId: req.userId!, threadId: activeThreadId, role: 'assistant', content: 'Aegis is temporarily unavailable. Try again in a moment, your alerts and rules continue working.' },
    });
    res.json({ message: fallback });
  }
});

chatRouter.post('/action', async (req: AuthRequest, res: Response): Promise<void> => {
  const { action, alertId } = req.body as { action: 'execute' | 'acknowledge' | 'disable_rule'; alertId: string };

  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: { rule: { select: { id: true, name: true, tokenSymbol: true } } },
  });
  if (!alert || alert.userId !== req.userId!) { res.status(404).json({ error: 'Alert not found' }); return; }

  if (action === 'acknowledge') {
    await prisma.alert.update({ where: { id: alertId }, data: { status: 'ACKNOWLEDGED' } });
    await prisma.chatMessage.create({
      data: { userId: req.userId!, role: 'assistant', content: `Alert acknowledged. Rule "${alert.rule?.name}" continues monitoring.`, alertId },
    });
    res.json({ success: true, action: 'acknowledged' });
    return;
  }

  if (action === 'disable_rule' && alert.rule) {
    await prisma.rule.update({ where: { id: alert.rule.id }, data: { isActive: false } });
    await prisma.alert.update({ where: { id: alertId }, data: { status: 'ACKNOWLEDGED' } });
    await prisma.chatMessage.create({
      data: { userId: req.userId!, role: 'assistant', content: `Rule "${alert.rule.name}" disabled. You can re-enable it from the Rules tab.`, alertId },
    });
    res.json({ success: true, action: 'rule_disabled' });
    return;
  }

  if (action === 'execute') {
    const wallet = await prisma.agentWallet.findUnique({ where: { userId: req.userId! } });
    if (!wallet) { res.status(404).json({ error: 'No wallet' }); return; }
    if (!wallet.circleWalletId) { res.status(400).json({ error: 'Agent wallet not configured' }); return; }

    try {
      const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
      const todayTxs = await prisma.agentTransaction.findMany({
        where: { userId: req.userId!, createdAt: { gte: todayStart }, status: 'SUCCESS' },
        select: { amountUsd: true },
      });
      const usedToday = todayTxs.reduce((sum, tx) => sum + (tx.amountUsd ?? 0), 0);
      const remaining = Math.max(0, wallet.dailyLimitUsd - usedToday);
      const swapUsd = Math.min(wallet.maxTxSizeUsd, remaining);
      if (swapUsd < 0.01) { res.status(400).json({ error: 'Daily limit reached' }); return; }

      const network = (wallet.network || ARC_NETWORK) as 'arc-mainnet' | 'arc-testnet';
      const result = await executeFxSwap(wallet.circleWalletId, 'USDC', 'EURC', String(swapUsd), Math.round((wallet.slippagePercent ?? 0.5) * 100));
      await prisma.agentTransaction.create({
        data: {
          userId: req.userId!, type: 'SWAP',
          tokenIn: 'USDC', tokenOut: 'EURC',
          amount: String(swapUsd), amountUsd: swapUsd,
          txHash: result.txHash ?? null, status: 'SUCCESS', network,
        },
      }).catch(err => logger.error('audit', 'Failed to log protective swap', err));
      await prisma.alert.update({ where: { id: alertId }, data: { status: 'ACKNOWLEDGED', executedAt: new Date() } });
      await prisma.chatMessage.create({
        data: { userId: req.userId!, role: 'assistant', content: `Protective swap executed: ${swapUsd} USDC → EURC\n[View on explorer](${explorerTxUrl(result.txHash)})`, alertId },
      });
      await redis.del(`agent:tokens:${wallet.agentAddress}`).catch(() => {});
      await redis.del(`agent:history:${wallet.agentAddress}`).catch(() => {});
      res.json({ success: true, txHash: result.txHash, swapCompleted: true });
    } catch (err) {
      const network = (wallet.network || ARC_NETWORK) as 'arc-mainnet' | 'arc-testnet';
      await prisma.agentTransaction.create({
        data: {
          userId: req.userId!, type: 'SWAP',
          tokenIn: 'USDC', tokenOut: 'EURC', amount: '0',
          amountUsd: null, status: 'FAILED', network,
        },
      }).catch(err2 => logger.error('audit', 'Failed to log failed protective swap', err2));
      logger.error('swap', 'Protective swap failed', err);
      res.status(500).json({ error: 'Swap failed. Please try again.' });
    }
    return;
  }

  res.status(400).json({ error: 'Unknown action' });
});

chatRouter.delete('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const deleted = await prisma.chatMessage.deleteMany({ where: { userId: req.userId! } });
  res.json({ ok: true, deleted: deleted.count });
});
