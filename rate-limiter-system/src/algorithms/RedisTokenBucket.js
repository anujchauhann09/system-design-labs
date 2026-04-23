/**
 * token bucket rate limiter — redis-backed
 *
 * key design : rate_limit:token:{ip}
 * structure  : redis hash — { tokens, lastRefill }
 * TTL        : set on every request, auto-cleanup after inactivity
 *
 * race condition fix:
 *  - lua script atomically reads tokens + lastRefill, computes refill,
 *    consumes 1 token, writes back — all in one redis round trip.
 */
const RateLimiter = require('./RateLimiter');
const redis = require('../config/redis');

// lua: use redis TIME for clock source — consistent across all node instances
const TOKEN_BUCKET_SCRIPT = `
local key        = KEYS[1]
local capacity   = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local ttl        = tonumber(ARGV[3])

-- Redis server clock — single source of truth for all nodes
local t   = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)  -- convert to ms

local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens     = tonumber(data[1]) or capacity
local lastRefill = tonumber(data[2]) or now

-- Refill tokens based on elapsed time, cap at capacity (no overflow)
local elapsed  = (now - lastRefill) / 1000
local refilled = elapsed * refillRate
tokens = math.min(capacity, tokens + refilled)

local allowed = 0
if tokens >= 1 then
  tokens  = tokens - 1
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
redis.call('PEXPIRE', key, ttl)

return { allowed, math.floor(tokens), now }
`;

class RedisTokenBucket extends RateLimiter {
  constructor({ capacity = 100, refillRate = 10 } = {}) {
    super({ capacity, refillRate });
  }

  async allowRequest(key) {
    const { capacity, refillRate } = this.options;
    const redisKey = `rate_limit:token:${key}`;
    const ttlMs = Math.ceil((capacity / refillRate) * 1000) * 2;

    const [allowed, remaining, now] = await redis.eval(
      TOKEN_BUCKET_SCRIPT, 1, redisKey, capacity, refillRate, ttlMs
    );

    const resetAt = allowed
      ? now
      : now + Math.ceil((1 / refillRate) * 1000);

    return {
      allowed: allowed === 1,
      remaining,
      resetAt,
    };
  }
}

module.exports = RedisTokenBucket;
