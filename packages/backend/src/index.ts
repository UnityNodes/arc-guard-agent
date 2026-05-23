// Make BigInt JSON-serializable globally. Circle BridgeKit + viem read
// uint256 fields (balances, gas, fees) as BigInt and call JSON.stringify on
// objects containing them, which throws "Do not know how to serialize a
// BigInt" without this shim. Has to run before any module that may touch
// chain reads.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

import { initSentry, Sentry } from './lib/sentry';
initSentry();

import path from 'path';
import dotenv from 'dotenv';
// Load from monorepo root .env (works in both dev and prod)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
// Also load local packages/backend/.env if exists (takes precedence)
dotenv.config();

// ── Validate environment variables before starting ───────────────────────────
const REQUIRED_ENV: string[] = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
];
const OPTIONAL_WARN: string[] = [
  'CIRCLE_API_KEY',
  'CIRCLE_ENTITY_SECRET',
  'CIRCLE_WALLET_SET_ID',
  'TELEGRAM_BOT_TOKEN',
  'OPENROUTER_API_KEY',
  'FRONTEND_URL',
];

const missingRequired = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingRequired.length > 0) {
  console.error(`[startup] FATAL, missing required env vars: ${missingRequired.join(', ')}`);
  process.exit(1);
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
  process.exit(1);
}
if (jwtSecret === 'change-me-in-production-min-32-chars') {
  console.error('FATAL: JWT_SECRET is still the default value. Generate a secure random secret.');
  process.exit(1);
}

const missingOptional = OPTIONAL_WARN.filter((k) => !process.env[k]);
if (missingOptional.length > 0) {
  console.warn(`[startup] WARNING, optional env vars not set (some features disabled): ${missingOptional.join(', ')}`);
}

const botSecret = process.env.BOT_SHARED_SECRET;
if (botSecret && botSecret.length < 24) {
  console.error('FATAL: BOT_SHARED_SECRET must be at least 24 characters');
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

import app from './app';
import { startMonitor, stopMonitor, startDailyReport, stopDailyReport } from './services/monitor';

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, async () => {
  console.log(`GuardAgent API running on port ${PORT}`);

  startMonitor();
  startDailyReport();

  import('./services/aegisWallet').then(({ getAegisStatus, getAegisWallets }) => {
    Promise.all([
      getAegisStatus().catch(() => null),
      getAegisWallets().catch(() => []),
    ]).then(() => console.log('[startup] Aegis cache pre-warmed'))
      .catch(() => {});
  }).catch(() => {});

  setInterval(() => {
    import('./services/aegisWallet').then(({ getAegisWallets, getAegisStatus }) => {
      getAegisWallets(true).catch(() => []);
      getAegisStatus(true).catch(() => null);
    }).catch(() => {});
  }, 50_000);

  // Reconcile bridges stuck PENDING (e.g. the backend restarted after the burn but
  // before the mint). Runs on startup and every 3 min so a lost in-process promise
  // does not leave a bridge hanging forever.
  const runBridgeReconcile = () => {
    import('./services/arcBridge')
      .then(({ reconcileStuckBridges }) => reconcileStuckBridges())
      .catch((err) => console.warn('[reconcile] stuck-bridge reconcile failed', err));
  };
  runBridgeReconcile();
  setInterval(runBridgeReconcile, 3 * 60 * 1000);

  const runLimitOrderCheck = () => {
    import('./services/limitOrders')
      .then(({ checkLimitOrders }) => checkLimitOrders())
      .catch((err) => console.warn('[orders] limit-order check failed', err));
  };
  const runDcaProcessing = () => {
    import('./services/dca')
      .then(({ processDCAOrders }) => processDCAOrders())
      .catch((err) => console.warn('[orders] DCA processing failed', err));
  };
  runLimitOrderCheck();
  runDcaProcessing();
  setInterval(runLimitOrderCheck, 30_000);
  setInterval(runDcaProcessing, 60_000);
});

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`[shutdown] ${signal} received, closing server...`);
  stopMonitor();
  stopDailyReport();
  server.close(() => {
    console.log('[shutdown] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10s if connections hang
  setTimeout(() => {
    console.error('[shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason);
});
