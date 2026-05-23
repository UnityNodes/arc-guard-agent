import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  enableOfflineQueue: true,
  enableReadyCheck: true,
  retryStrategy(times) {
    if (times > 10) return null;           // stop after 10 retries
    return Math.min(times * 200, 5_000);   // exponential backoff, max 5s
  },
  reconnectOnError(err) {
    return err.message.includes('READONLY'); // reconnect on failover
  },
});

redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});
redis.on('reconnecting', (ms: number) => {
  console.warn(`[redis] reconnecting in ${ms}ms`);
});
