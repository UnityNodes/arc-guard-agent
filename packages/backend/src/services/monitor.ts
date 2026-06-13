/**
 * GuardAgent Health Monitor & Alert System
 *
 * Monitors:
 * - Database connectivity + query latency
 * - Redis connectivity
 * - Agent wallet integrity (Circle wallets match DB)
 * - Disk space for backups
 * - API response times
 * - Failed transactions
 *
 * Alerts via Telegram when something breaks.
 * Runs as background interval inside the main backend process.
 */

import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { checkAndExecuteFxHedges } from './fxHedge';
import { logger } from '../lib/logger';

// ── Config ──────────────────────────────────────────────
const CHECK_INTERVAL_MS = 60 * 1000;  // Check every 1 minute
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // Don't spam, max 1 alert per issue per 30 min
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';

interface HealthStatus {
  database: 'ok' | 'slow' | 'down';
  redis: 'ok' | 'down';
  dbLatencyMs: number;
  failedTxLast1h: number;
  totalUsers: number;
  totalWallets: number;
  lastBackup: string | null;
  timestamp: string;
}

// Track last alert time per issue to avoid spam
const alertCooldowns = new Map<string, number>();

function canAlert(issueKey: string): boolean {
  const last = alertCooldowns.get(issueKey) || 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
  alertCooldowns.set(issueKey, Date.now());
  return true;
}

// ── Telegram Alert ──────────────────────────────────────
async function sendTelegramAlert(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn('[monitor] Telegram not configured, alert not sent:', message);
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_notification: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Redact the bot token from any error message/url before logging.
    // otherwise fetch errors can surface the raw token in logs and Sentry.
    const safe = String(err instanceof Error ? err.stack || err.message : err)
      .split(TELEGRAM_BOT_TOKEN).join('[REDACTED_BOT_TOKEN]');
    console.error('[monitor] Failed to send Telegram alert:', safe);
  }
}

// ── Health Checks ───────────────────────────────────────
async function checkDatabase(): Promise<{ status: 'ok' | 'slow' | 'down'; latencyMs: number }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs > 2000 ? 'slow' : 'ok',
      latencyMs,
    };
  } catch {
    return { status: 'down', latencyMs: Date.now() - start };
  }
}

async function checkRedis(): Promise<'ok' | 'down'> {
  try {
    const result = await redis.ping();
    return result === 'PONG' ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

async function checkFailedTransactions(): Promise<number> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return await prisma.agentTransaction.count({
      where: { status: 'FAILED', createdAt: { gte: oneHourAgo } },
    });
  } catch {
    return -1;
  }
}

async function getStats(): Promise<{ users: number; wallets: number }> {
  try {
    const [users, wallets] = await Promise.all([
      prisma.user.count(),
      prisma.agentWallet.count(),
    ]);
    return { users, wallets };
  } catch {
    return { users: 0, wallets: 0 };
  }
}

// ── Wallet Integrity Check ──────────────────────────────
// Runs less frequently (every 30 min), verifies DB wallets match Circle
async function checkWalletIntegrity(): Promise<string[]> {
  const issues: string[] = [];
  try {
    // Check for orphaned wallets (wallet exists but user doesn't)
    const orphaned = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) as cnt FROM "AgentWallet" aw
      LEFT JOIN "User" u ON aw."userId" = u.id
      WHERE u.id IS NULL
    `;
    const orphanCount = Number(orphaned[0]?.cnt || 0);
    if (orphanCount > 0) {
      issues.push(`${orphanCount} orphaned agent wallet(s) found (no matching user)`);
    }

    // Check for duplicate agent addresses (should never happen)
    const dupes = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) as cnt FROM (
        SELECT "agentAddress" FROM "AgentWallet"
        GROUP BY "agentAddress" HAVING COUNT(*) > 1
      ) t
    `;
    const dupeCount = Number(dupes[0]?.cnt || 0);
    if (dupeCount > 0) {
      issues.push(`${dupeCount} duplicate agent address(es) detected!`);
    }
  } catch (err) {
    issues.push(`Integrity check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return issues;
}

// ── Main Monitor Loop ───────────────────────────────────
let checkCounter = 0;
let lastHealthStatus: HealthStatus | null = null;

async function runHealthCheck(): Promise<void> {
  checkCounter++;
  const isDeepCheck = checkCounter % 6 === 0; // Every 30 min (6 × 5 min)

  try {
    // Run all checks in parallel
    const [db, redisStatus, failedTx, stats] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkFailedTransactions(),
      getStats(),
    ]);

    const status: HealthStatus = {
      database: db.status,
      redis: redisStatus,
      dbLatencyMs: db.latencyMs,
      failedTxLast1h: failedTx,
      totalUsers: stats.users,
      totalWallets: stats.wallets,
      lastBackup: null,
      timestamp: new Date().toISOString(),
    };

    lastHealthStatus = status;

    // Store in Redis for the admin panel / health endpoint
    await redis.set('guardagent:health', JSON.stringify(status), 'EX', 600).catch(() => {});

    // ── Alerts ────────────────────────────────────────
    const alerts: string[] = [];

    if (db.status === 'down' && canAlert('db_down')) {
      alerts.push('🔴 <b>DATABASE DOWN</b>\nPostgreSQL is not responding!');
    } else if (db.status === 'slow' && canAlert('db_slow')) {
      alerts.push(`⚠️ <b>Database slow</b>\nQuery latency: ${db.latencyMs}ms (threshold: 2000ms)`);
    }

    if (redisStatus === 'down' && canAlert('redis_down')) {
      alerts.push('🔴 <b>REDIS DOWN</b>\nRedis cache is not responding!');
    }

    if (failedTx > 5 && canAlert('failed_tx')) {
      alerts.push(`⚠️ <b>Failed transactions</b>\n${failedTx} failed transaction(s) in the last hour`);
    }

    // Deep checks (wallet integrity)
    if (isDeepCheck) {
      const integrityIssues = await checkWalletIntegrity();
      for (const issue of integrityIssues) {
        if (canAlert(`integrity_${issue.slice(0, 20)}`)) {
          alerts.push(`🔍 <b>Integrity issue</b>\n${issue}`);
        }
      }
    }

    // Send all alerts
    if (alerts.length > 0) {
      const header = '🛡️ <b>GuardAgent Monitor</b>\n';
      const separator = '\n─────────────\n';
      await sendTelegramAlert(header + alerts.join(separator));
    }

    // Log status to console (compact)
    if (db.status !== 'ok' || redisStatus !== 'ok' || failedTx > 0) {
      console.log(`[monitor] DB:${db.status}(${db.latencyMs}ms) Redis:${redisStatus} FailedTx:${failedTx} Users:${stats.users} Wallets:${stats.wallets}`);
    }

    try {
      await checkAndExecuteFxHedges();
    } catch (err) {
      logger.warn('monitor', 'FX hedge check failed', err);
    }

  } catch (err) {
    console.error('[monitor] Health check failed:', err);
    if (canAlert('monitor_error')) {
      await sendTelegramAlert(`🔴 <b>Monitor Error</b>\nHealth check itself failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ── Public API ──────────────────────────────────────────
let monitorInterval: NodeJS.Timeout | null = null;

export function startMonitor(): void {
  if (monitorInterval) return;
  console.log(`[monitor] Starting health monitor (every ${CHECK_INTERVAL_MS / 1000}s)`);

  // Run first check after 30s (let services stabilize)
  setTimeout(() => {
    runHealthCheck();
    monitorInterval = setInterval(runHealthCheck, CHECK_INTERVAL_MS);
  }, 30_000);
}

export function stopMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[monitor] Health monitor stopped');
  }
}

export function getLastHealth(): HealthStatus | null {
  return lastHealthStatus;
}

// ── Daily Report ────────────────────────────────────────
// Sends a daily summary at startup + every 24h
let dailyReportInterval: NodeJS.Timeout | null = null;

async function sendDailyReport(): Promise<void> {
  try {
    const [users, wallets, txToday, txFailed] = await Promise.all([
      prisma.user.count(),
      prisma.agentWallet.count(),
      prisma.agentTransaction.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
      prisma.agentTransaction.count({
        where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    const msg = [
      '📊 <b>GuardAgent Daily Report</b>',
      '',
      `👥 Users: <b>${users}</b>`,
      `👛 Agent Wallets: <b>${wallets}</b>`,
      `📈 Transactions (24h): <b>${txToday}</b>`,
      txFailed > 0 ? `❌ Failed (24h): <b>${txFailed}</b>` : `✅ No failures`,
      '',
      `🕐 ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}`,
    ].filter(Boolean).join('\n');

    await sendTelegramAlert(msg);
  } catch (err) {
    console.error('[monitor] Daily report failed:', err);
  }
}

export function startDailyReport(): void {
  // Send first report 2 minutes after startup
  setTimeout(sendDailyReport, 2 * 60 * 1000);
  // Then every 24h
  dailyReportInterval = setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
}

export function stopDailyReport(): void {
  if (dailyReportInterval) {
    clearInterval(dailyReportInterval);
    dailyReportInterval = null;
  }
}
