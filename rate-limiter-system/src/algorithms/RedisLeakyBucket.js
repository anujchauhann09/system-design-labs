/**
 * leaky bucket rate limiter — redis-backed
 *
 * key design : rate_limit:leaky:{ip}
 * structure  : redis hash — { queue, lastLeak }
 * TTL        : set on every request, auto-cleanup after inactivity
 *
 * race condition fix:
 *  - lua script atomically reads queue + lastLeak, drains elapsed,
 *    checks capacity, enqueues if space — all in one Redis round trip
 */
const RateLimiter = require('./RateLimiter');
const redis = require('../config/redis');

// lua: drain queue based on elapsed time, enqueue if capacity allows
// uses redis TIME for clock — consistent across all node instances
const LEAKY_BUCKET_SCRIPT = `
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local leakRate = tonumber(ARGV[2])
local ttl      = tonumber(ARGV[3])

-- Redis server clock — single source of truth for all nodes
local t   = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)

local data     = redis.call('HMGET', key, 'queue', 'lastLeak')
local queue    = tonumber(data[1]) or 0
local lastLeak = tonumber(data[2]) or now

-- Drain: remove requests that have leaked out since lastLeak
local elapsed = (now - lastLeak) / 1000
local leaked  = elapsed * leakRate
queue = math.max(0, queue - leaked)

local allowed = 0
if queue < capacity then
  queue   = queue + 1
  allowed = 1
end

redis.call('HMSET', key, 'queue', queue, 'lastLeak', now)
redis.call('PEXPIRE', key, ttl)

return { allowed, math.floor(capacity - queue), now }
`;

class RedisLeakyBucket extends RateLimiter {
  constructor({ capacity = 100, leakRate = 10 } = {}) {
    super({ capacity, leakRate });
  }

  async allowRequest(key) {
    const { capacity, leakRate } = this.options;
    const redisKey = `rate_limit:leaky:${key}`;
    const ttlMs = Math.ceil((capacity / leakRate) * 1000) * 2;

    const [allowed, remaining, now] = await redis.eval(
      LEAKY_BUCKET_SCRIPT, 1, redisKey, capacity, leakRate, ttlMs
    );

    const resetAt = now + Math.ceil((1 / leakRate) * 1000);

    return {
      allowed: allowed === 1,
      remaining,
      resetAt,
    };
  }
}

module.exports = RedisLeakyBucket;
