/**
 * fixed Window rate limiter — redis-backed
 *
 * key design : rate_limit:fixed:{ip}
 * TTL        : windowMs (auto-cleanup when window expires)
 *
 * race condition fix:
 *  - lua script runs atomically on redis — INCR + EXPIRE in one shot
 *  - no two node processes can interleave between the read and write
 */
const RateLimiter = require('./RateLimiter');
const redis = require('../config/redis');

// lua: increment counter, set TTL only on first request in window, return [count, ttl]
const FIXED_WINDOW_SCRIPT = `
local key   = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])

local count = redis.call('INCR', key)

if count == 1 then
  redis.call('PEXPIRE', key, ttl)
end

local pttl = redis.call('PTTL', key)
return { count, pttl }
`;

class RedisFixedWindow extends RateLimiter {
  constructor({ limit = 100, windowMs = 60000 } = {}) {
    super({ limit, windowMs });
  }

  async allowRequest(key) {
    const { limit, windowMs } = this.options;
    const redisKey = `rate_limit:fixed:${key}`;

    const [count, pttl] = await redis.eval(
      FIXED_WINDOW_SCRIPT, 1, redisKey, limit, windowMs
    );

    const resetAt = Date.now() + Math.max(0, pttl);

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  }
}

module.exports = RedisFixedWindow;
