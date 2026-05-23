/**
 * Structured logger for GuardAgent backend.
 * Replaces ad-hoc console.log with leveled, tagged logging.
 *
 * Usage:
 *   import { logger } from '../lib/logger';
 *   logger.info('swap', 'Swap executed', { txHash, amount });
 *   logger.warn('price', 'Pyth unreachable, using fallback');
 *   logger.error('swap', 'Swap failed', err);
 */

import { Sentry } from './sentry';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatMeta(meta?: unknown): string {
  if (!meta) return '';
  if (meta instanceof Error) return ` | ${meta.message}${meta.stack ? '\n' + meta.stack : ''}`;
  if (typeof meta === 'object') {
    try { return ' | ' + JSON.stringify(meta); } catch { return ' | [unserializable]'; }
  }
  return ' | ' + String(meta);
}

function log(level: LogLevel, tag: string, message: string, meta?: unknown) {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] [${tag}] ${message}${formatMeta(meta)}`;

  // Report errors to Sentry
  if (level === 'error' && meta instanceof Error) {
    try { Sentry.captureException(meta); } catch {}
  } else if (level === 'error') {
    try { Sentry.captureMessage(`[${tag}] ${message}`, 'error'); } catch {}
  }

  switch (level) {
    case 'error': console.error(line); break;
    case 'warn':  console.warn(line);  break;
    default:      console.log(line);   break;
  }
}

export const logger = {
  debug: (tag: string, msg: string, meta?: unknown) => log('debug', tag, msg, meta),
  info:  (tag: string, msg: string, meta?: unknown) => log('info',  tag, msg, meta),
  warn:  (tag: string, msg: string, meta?: unknown) => log('warn',  tag, msg, meta),
  error: (tag: string, msg: string, meta?: unknown) => log('error', tag, msg, meta),
};
