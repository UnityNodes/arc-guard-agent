import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

type Condition = 'ABOVE' | 'BELOW';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const prisma = new PrismaClient();

const MONITOR_QUEUE = 'monitor';
const ALERTS_QUEUE = 'alerts';
const CHECK_INTERVAL_MS = 60_000; // 60 seconds

const queue = new Queue(MONITOR_QUEUE, { connection: redis });
const alertsQueue = new Queue(ALERTS_QUEUE, { connection: redis });

// Price cache to avoid hammering Pyth on every rule check
let priceCache: Record<string, { price: number; ts: number }> = {};
const PRICE_CACHE_TTL = 30_000; // 30s

const PRICE_FEED_IDS: Record<string, string> = {
  USDC:   '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  EURC:   '0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c',
};

const COINGECKO_IDS: Record<string, string> = {
  USDC: 'usd-coin',
  EURC: 'euro-coin',
};

async function fetchPriceFromCoinGecko(token: string): Promise<number | null> {
  const id = COINGECKO_IDS[token.toUpperCase()];
  if (!id) return null;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as Record<string, { usd: number }>;
    const price = data[id]?.usd;
    if (!price || price <= 0) return null;
    priceCache[token] = { price, ts: Date.now() };
    return price;
  } catch (err) {
    console.warn('[monitor] CoinGecko price fetch failed for', token, err);
    return null;
  }
}

async function fetchPrice(token: string): Promise<number | null> {
  const cached = priceCache[token];
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL) {
    return cached.price;
  }

  const PYTH_ENDPOINT = process.env.PYTH_ENDPOINT || 'https://hermes.pyth.network';

  const feedId = PRICE_FEED_IDS[token.toUpperCase()];
  if (!feedId) {
    // No Pyth feed, try CoinGecko
    return fetchPriceFromCoinGecko(token);
  }

  try {
    const res = await fetch(
      `${PYTH_ENDPOINT}/v2/updates/price/latest?ids[]=${feedId}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!res.ok) return fetchPriceFromCoinGecko(token);
    const data = await res.json() as { parsed: Array<{ price: { price: string; expo: number } }> };
    const item = data.parsed[0];
    if (!item) return fetchPriceFromCoinGecko(token);

    const price = parseFloat(item.price.price) * Math.pow(10, item.price.expo);
    if (!price || price <= 0 || !isFinite(price)) return fetchPriceFromCoinGecko(token);
    priceCache[token] = { price, ts: Date.now() };
    return price;
  } catch (err) {
    console.warn('[monitor] Pyth price fetch failed for', token, '- falling back to CoinGecko:', err instanceof Error ? err.message : err);
    return fetchPriceFromCoinGecko(token);
  }
}

// ─── Internal-secret helper: call backend's /api/internal/* endpoints ────────
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';
const INTERNAL_SECRET = process.env.BOT_SHARED_SECRET || '';

async function fetchUsdcBalance(address: string): Promise<number | null> {
  if (!INTERNAL_SECRET) return null;
  // Retry transient network errors (e.g. backend restarting) so a single blip
  // doesn't skip the BALANCE_USDC_GTE -> BRIDGE protective action for a whole tick.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/internal/usdc-balance?address=${address}`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { balanceUsdc?: string };
      const v = parseFloat(data.balanceUsdc ?? '');
      return isFinite(v) ? v : null;
    } catch (err) {
      if (attempt === 2) {
        console.warn('[monitor] fetchUsdcBalance failed for', address, err);
        return null;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

async function dispatchRuleAction(ruleId: string): Promise<{ executed: boolean; bridgeId?: string; decision?: string; error?: string } | null> {
  if (!INTERNAL_SECRET) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/internal/rule-action/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ ruleId }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json().catch(() => ({})) as { executed?: boolean; bridgeId?: string; decision?: string; error?: string; reasons?: string[] };
    return {
      executed: data.executed === true,
      bridgeId: data.bridgeId,
      decision: data.decision,
      error: data.error ?? ((data.reasons ?? []).join(', ') || undefined),
    };
  } catch (err) {
    console.warn('[monitor] dispatchRuleAction failed for rule', ruleId, err);
    return { executed: false, error: err instanceof Error ? err.message : 'dispatch failed' };
  }
}

async function checkRules(): Promise<void> {
  const now = new Date();
  const rules = await prisma.rule.findMany({
    where: { isActive: true },
    include: { user: { select: { telegramChatId: true, telegramLinked: true, autoMode: true, agentWallet: { select: { agentAddress: true } } } } },
  });

  // Reset price cache for fresh batch
  priceCache = {};

  for (const rule of rules) {
    // Skip if in cooldown, enforce minimum 30min cooldown regardless of user setting
    if (rule.lastTriggeredAt) {
      const effectiveCooldownMin = Math.max(rule.cooldownMin, 30);
      const cooldownMs = effectiveCooldownMin * 60 * 1000;
      if (now.getTime() - rule.lastTriggeredAt.getTime() <= cooldownMs) continue;
    }

    // ─── Branch: BALANCE_USDC_GTE trigger ──────────────────────────────
    // Worker fetches user's agent-wallet USDC balance via backend internal endpoint.
    // If balance ≥ threshold AND action === 'BRIDGE' → dispatch via /api/internal/rule-action/execute.
    if ((rule as { triggerType?: string }).triggerType === 'BALANCE_USDC_GTE') {
      const agentAddr = rule.user.agentWallet?.agentAddress;
      if (!agentAddr) continue;
      const bal = await fetchUsdcBalance(agentAddr);
      if (bal === null) continue;
      if (bal < rule.threshold) continue;

      const action = (rule as { action?: string }).action ?? 'ALERT';
      if (action === 'BRIDGE') {
        const r = await dispatchRuleAction(rule.id);
        if (r?.executed) {
          console.log(`[monitor] Autonomous bridge from rule ${rule.id} executed (bridge ${r.bridgeId})`);
          // lastTriggeredAt updated server-side in the executor
        } else {
          console.warn(`[monitor] Autonomous bridge from rule ${rule.id} not executed: decision=${r?.decision ?? '?'} error=${r?.error ?? '?'}`);
          // Still mark a soft cooldown so we don't hammer Guardian
          await prisma.rule.update({ where: { id: rule.id }, data: { lastTriggeredAt: now } }).catch(() => {});
        }
        continue; // skip the price-alert branch below for this rule
      }
      // For BALANCE_USDC_GTE with action=ALERT we could create an Alert here later. Skipping for MVP.
      continue;
    }

    // ─── Branch: PRICE trigger (legacy behaviour, unchanged) ───────────
    const price = await fetchPrice(rule.tokenSymbol);
    if (price === null) continue;

    const triggered =
      (rule.condition === 'ABOVE' && price > rule.threshold) ||
      (rule.condition === 'BELOW' && price < rule.threshold);

    if (!triggered) continue;

    const conditionStr = rule.condition === 'ABOVE' ? '▲' : '▼';
    const conditionLabel = rule.condition === 'ABOVE' ? 'above' : 'below';
    const message =
      `🚨 <b>GuardAgent Alert!</b>\n\n` +
      `<b>${rule.tokenSymbol}</b> is now ${conditionLabel} your threshold\n\n` +
      `📊 Current price: <b>$${price.toLocaleString()}</b>\n` +
      `🎯 Threshold: $${rule.threshold.toLocaleString()} ${conditionStr}\n` +
      `📋 Rule: <i>${rule.name}</i>`;

    const alert = await prisma.alert.create({
      data: {
        userId: rule.userId,
        ruleId: rule.id,
        message,
        currentPrice: price,
        threshold: rule.threshold,
        condition: rule.condition,
        status: 'PENDING',
      },
    });

    // Issue a short-lived BotSwapGrant scoped to this alert. The Telegram bot
    // can only execute a swap if the grant exists, hasn't been used, and isn't
    // expired, replaces the prior model where the bot reused a 7-day web JWT.
    // Lifetime: long enough to cover escalation (15 min) + user reaction (15 min).
    try {
      const BOT_GRANT_TTL_MIN = 30;
      await prisma.botSwapGrant.create({
        data: {
          userId: rule.userId,
          alertId: alert.id,
          expiresAt: new Date(Date.now() + BOT_GRANT_TTL_MIN * 60 * 1000),
        },
      });
    } catch (err) {
      console.warn('[monitor] BotSwapGrant creation failed for alert', alert.id, err);
    }

    await prisma.rule.update({
      where: { id: rule.id },
      data: { lastTriggeredAt: now },
    });

    const plainContent = message
      .replace(/<b>(.*?)<\/b>/g, '$1')
      .replace(/<i>(.*?)<\/i>/g, '$1')
      .replace(/<a[^>]*>(.*?)<\/a>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .trim();

    // Write alert message (no AI insight)
    await prisma.chatMessage.create({
      data: {
        userId: rule.userId,
        role: 'alert',
        content: plainContent,
        alertId: alert.id,
        actions: ['execute', 'acknowledge', 'disable_rule'],
      },
    }).catch((err) => { console.warn('[monitor] chatMessage creation failed for rule', rule.id, err); });

    // Queue Telegram notification with ruleId for inline buttons
    if (rule.user.telegramLinked && rule.user.telegramChatId) {
      // Per-user rate limit: max 1 alert per 30s to avoid message flood
      const rateLimitKey = `alert_ratelimit:${rule.userId}`;
      const limited = await redis.get(rateLimitKey);
      if (limited) {
        console.log(`Rate limited alert for user ${rule.userId} (rule ${rule.id})`);
      } else {
      await redis.set(rateLimitKey, '1', 'EX', 30);

      await alertsQueue.add('send-alert', {
        alertId: alert.id,
        chatId: rule.user.telegramChatId,
        message,
        ruleId: rule.id,
        userId: rule.userId,
        tokenSymbol: rule.tokenSymbol,
        condition: rule.condition,
        threshold: rule.threshold,
        currentPrice: price,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      } // end rate limit else
    }

    console.log(`Alert created for rule ${rule.id}: ${rule.tokenSymbol} ${conditionStr} $${rule.threshold}`);
  }
}

export async function startMonitor(): Promise<() => Promise<void>> {
  console.log(`Monitor started, checking every ${CHECK_INTERVAL_MS / 1000}s`);

  // Initial check
  await checkRules();

  // Schedule repeating job
  await queue.add(
    'monitor-tick',
    {},
    {
      repeat: { every: CHECK_INTERVAL_MS },
      removeOnComplete: 5,
      removeOnFail: 10,
    }
  );

  const worker = new Worker(
    MONITOR_QUEUE,
    async (job) => {
      if (job.name === 'monitor-tick') {
        try {
          await checkRules();
        } catch (err) {
          console.error('[monitor] checkRules crashed:', err instanceof Error ? err.message : err);
          // Don't rethrow, let the next tick retry fresh
        }
      }
    },
    { connection: redis, concurrency: 1 }
  );

  worker.on('failed', (job, err) => {
    console.error(`[monitor] Job ${job?.id} failed:`, err);
  });

  // Handle escalation checks every minute
  const escalationTimer = setInterval(async () => {
    try {
      await checkEscalations();
    } catch (err) {
      console.error('[monitor] checkEscalations crashed:', err instanceof Error ? err.message : err);
    }
  }, 60_000);

  return async () => {
    console.log('[monitor] Shutting down...');
    clearInterval(escalationTimer);
    await worker.close();
    await queue.close();
    await alertsQueue.close();
    await redis.quit();
    await prisma.$disconnect();
    console.log('[monitor] Shutdown complete');
  };
}

async function checkEscalations(): Promise<void> {
  const now = new Date();

  // Auto-close stale alerts older than 30 min that never started escalating
  await prisma.alert.updateMany({
    where: {
      status: 'SENT',
      escalation1At: null,
      sentAt: { lt: new Date(now.getTime() - 30 * 60_000) },
    },
    data: { status: 'ACKNOWLEDGED' },
  });

  const pendingAlerts = await prisma.alert.findMany({
    where: { status: { in: ['SENT', 'ESCALATED'] } },
    include: {
      user: { select: { telegramChatId: true, autoMode: true, escalation1Min: true, escalation2Min: true, escalation3Min: true, autoExecMin: true } },
      rule: { select: { id: true, tokenSymbol: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Only process ONE alert per user, the most recent
  const seenUsers = new Set<string>();

  for (const alert of pendingAlerts) {
    if (!alert.user.telegramChatId) continue;
    const sentAt = alert.sentAt;
    if (!sentAt) continue;

    // Skip if we already handled an alert for this user this cycle
    if (seenUsers.has(alert.userId)) {
      continue;
    }
    seenUsers.add(alert.userId);

    const elapsed = now.getTime() - sentAt.getTime();
    const chatId = alert.user.telegramChatId;
    // User-configurable escalation timings (defaults: 2, 5, 10, 15 min)
    const esc1Ms = (alert.user.escalation1Min ?? 2) * 60_000;
    const esc2Ms = (alert.user.escalation2Min ?? 5) * 60_000;
    const esc3Ms = (alert.user.escalation3Min ?? 10) * 60_000;
    const autoExecMs = (alert.user.autoExecMin ?? 15) * 60_000;

    // Escalation 1, first reminder
    if (!alert.escalation1At && elapsed > esc1Ms) {
      const msg = `⚠️ <b>Still unacknowledged</b>, tap below to dismiss.`;
      await alertsQueue.add('send-alert', {
        alertId: alert.id,
        chatId,
        message: msg,
        ruleId: alert.rule?.id,
      });
      await prisma.alert.update({ where: { id: alert.id }, data: { escalation1At: now, status: 'ESCALATED' } });

    // Escalation 2, second reminder
    } else if (!alert.escalation2At && elapsed > esc2Ms) {
      const msg = `🔶 <b>Second reminder</b>, final urgent reminder coming in 5 min if not acknowledged.`;
      await alertsQueue.add('send-alert', {
        alertId: alert.id,
        chatId,
        message: msg,
        ruleId: alert.rule?.id,
      });
      await prisma.alert.update({ where: { id: alert.id }, data: { escalation2At: now } });

    // Escalation 3, final urgent text reminder (was voice; voice removed)
    } else if (!alert.escalation3At && elapsed > esc3Ms) {
      const autoNote = alert.user.autoMode
        ? `\n\n⚡ <i>AutoMode is ON, the agent will execute a protective action automatically if you don't acknowledge.</i>`
        : `\n\nPlease check GuardAgent immediately.`;
      const msg = `🔴 <b>URGENT. Unacknowledged alert</b>\n\nFinal reminder.${autoNote}`;
      await alertsQueue.add('send-alert', {
        alertId: alert.id,
        chatId,
        message: msg,
        ruleId: alert.rule?.id,
      });
      await prisma.alert.update({ where: { id: alert.id }, data: { escalation3At: now } });
    }

    // Auto-execute after escalation 3 if autoMode enabled
    else if (alert.escalation3At && !alert.executedAt && alert.user.autoMode) {
      const autoExecDelay = autoExecMs - esc3Ms; // time after voice alert to auto-execute
      const exec15 = now.getTime() - alert.escalation3At.getTime() > Math.max(autoExecDelay, 60_000);
      if (exec15) {
        // Atomic check-and-set: only proceed if status is still ESCALATED (prevents double-exec)
        const updated = await prisma.alert.updateMany({
          where: { id: alert.id, status: 'ESCALATED', executedAt: null },
          data: { status: 'ACKNOWLEDGED', executedAt: now },
        });
        // If no rows updated → another worker or user already handled it
        if (updated.count === 0) continue;

        await alertsQueue.add('auto-execute', {
          alertId: alert.id,
          chatId,
          tokenSymbol: alert.rule?.tokenSymbol ?? 'Token',
          condition: alert.condition,
          threshold: alert.threshold,
          currentPrice: alert.currentPrice,
          ruleId: alert.rule?.id,
          userId: alert.userId,
        });
      }
    }
  }
}
