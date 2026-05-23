import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Sentry } from './lib/sentry';
import { authRouter } from './routes/auth';
import { rulesRouter } from './routes/rules';
import { alertsRouter } from './routes/alerts';
import { walletRouter } from './routes/wallet';
import { usersRouter } from './routes/users';
import { agentWalletRouter } from './routes/agentWallet';
import { chatRouter } from './routes/chat';
import { guardianRouter } from './routes/guardian';
import { agentRouter } from './routes/agent';
import { webhookRouter } from './routes/webhooks';
import { aegisRouter } from './routes/aegis';
import { eventsRouter } from './routes/events';
import { eventMonitorRouter } from './routes/eventMonitor';
import { botSwapRouter } from './routes/botSwap';
import { bridgeRouter } from './routes/bridge';
import { reputationRouter } from './routes/reputation';
import { validationRouter } from './routes/validation';
import { agentsRouter } from './routes/agents';
import { jobsRouter } from './routes/jobs';
import { internalRouter } from './routes/internal';
import { inferRouter } from './routes/infer';
import { publicRouter } from './routes/public';
import { gatewayRouter } from './routes/gateway';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3000';
if (process.env.NODE_ENV === 'production') {
  if (!process.env.FRONTEND_URL) {
    console.error('[startup] FATAL. FRONTEND_URL must be set in production');
    process.exit(1);
  }
  if (!/^https:\/\/.+/.test(FRONTEND_ORIGIN)) {
    console.error(`[startup] FATAL. FRONTEND_URL must start with https:// in production, got: ${FRONTEND_ORIGIN}`);
    process.exit(1);
  }
}
// Accept the marketing landing AND the app subdomain so auth works across
// both. FRONTEND_URL is the primary host; the comma-separated FRONTEND_ORIGINS
// is the explicit allow-list when running with a subdomain split.
const FRONTEND_ALLOW = (process.env.FRONTEND_ORIGINS || FRONTEND_ORIGIN)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (FRONTEND_ALLOW.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  maxAge: 86400,
}));
app.use(express.json({ limit: '10kb', verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; } }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/chat'),
});
app.use('/api/', limiter);

const chatGetLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const chatPostLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

app.use('/api/auth', authRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/users', usersRouter);
app.use('/api/agent-wallet', agentWalletRouter);
app.use('/api/chat', (req, res, next) => {
  if (req.method === 'GET') return chatGetLimiter(req, res, next);
  return chatPostLimiter(req, res, next);
});
app.use('/api/chat', chatRouter);
app.use('/api/guardian', guardianRouter);
app.use('/api/agent', agentRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/aegis', aegisRouter);
app.use('/api/events', eventsRouter);
app.use('/api/event-monitor', eventMonitorRouter);
app.use('/api/bot-swap', botSwapRouter);
app.use('/api/bridge', bridgeRouter);
app.use('/api/reputation', reputationRouter);
app.use('/api/validation', validationRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/infer', inferRouter);
app.use('/api/public', publicRouter);
app.use('/api/gateway', gatewayRouter);
app.use('/api/internal', internalRouter);

app.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
    healthy = false;
  }
  const dbLatency = Date.now() - dbStart;
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
    healthy = false;
  }
  let stats: Record<string, unknown> = {};
  try {
    const cached = await redis.get('guardagent:health');
    if (cached) stats = JSON.parse(cached);
  } catch { /* ignore */ }
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
    dbLatencyMs: dbLatency,
    uptime: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    ...(Object.keys(stats).length > 0 ? { monitor: stats } : {}),
  });
});

Sentry.setupExpressErrorHandler(app);

export default app;
