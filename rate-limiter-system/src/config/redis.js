const Redis = require('ioredis');

/**
 * singleton redis client shared across the entire app
 * all rate limiter algorithms use this same connection
 */
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  // retry strategy — back off on repeated failures
  retryStrategy: (times) => Math.min(times * 100, 3000),
  lazyConnect: true,
});

redis.on('connect',   () => console.log('[Redis] connected'));
redis.on('error',     (err) => console.error('[Redis] error:', err.message));
redis.on('reconnecting', () => console.log('[Redis] reconnecting...'));

module.exports = redis;
