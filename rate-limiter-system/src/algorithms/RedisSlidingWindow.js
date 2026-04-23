/**
 * sliding window rate limiter — redis-backed
 *
 * key design : rate_limit:sliding:{ip}
 * structure  : redis sorted Set — member = unique request ID, score = timestamp (ms)
 * TTL        : windowMs after last request (auto-cleanup)
 *
 * race condition fix:
 *  - lua script atomically: removes expired members, counts, adds new entry, sets TTL
 *  - sorted set makes range queries by timestamp O(log N)
 */
const RateLimiter = require('./RateLimiter');
const redis = require('../config/redis');

// lua: prune old entries, check count, conditionally add, return [allowed, remaining]
// uses redis TIME for clock — consistent across all node instances
const SLIDING_WINDOW_SCRIPT = `
local key      = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit    = tonumber(ARGV[2])
local reqId    = ARGV[3]

-- Redis server clock — single source of truth for all nodes
local t   = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)

local windowStart = now - windowMs

-- Remove entries outside the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, reqId)
  redis.call('PEXPIRE', key, windowMs)
  return { 1, limit - count - 1, now }
end

return { 0, 0, now }
`;

class RedisSlidingWindow extends RateLimiter {
  constructor({ limit = 100, windowMs = 60000 } = {}) {
    super({ limit, windowMs });
  }

  async allowRequest(key) {
    const { limit, windowMs } = this.options;
    const redisKey = `rate_limit:sliding:${key}`;
    const reqId = `${Date.now()}-${Math.random()}`; // unique member per request

    const [allowed, remaining, now] = await redis.eval(
      SLIDING_WINDOW_SCRIPT, 1, redisKey, windowMs, limit, reqId
    );

    return {
      allowed: allowed === 1,
      remaining: Math.max(0, remaining),
      resetAt: now + windowMs,
    };
  }
}

module.exports = RedisSlidingWindow;
