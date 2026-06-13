import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import { startMonitor } from './monitor';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Validate critical env vars
const REQUIRED = ['DATABASE_URL', 'REDIS_URL'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[worker] FATAL, missing env vars: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('GuardAgent Monitor Worker starting...');

// Session cleanup, delete expired sessions every hour
setInterval(async () => {
  try {
    const result = await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) console.log(`[cleanup] Deleted ${result.count} expired sessions`);
  } catch (err) {
    console.warn('[cleanup] Session cleanup failed', err);
  }
}, 60 * 60 * 1000);

let cleanup: (() => Promise<void>) | null = null;

startMonitor()
  .then((fn) => { cleanup = fn; })
  .catch((err) => {
    console.error('Worker fatal error:', err);
    process.exit(1);
  });

const shutdown = async (signal: string) => {
  console.log(`[worker] ${signal} received, shutting down...`);
  if (cleanup) await cleanup().catch(console.error);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
