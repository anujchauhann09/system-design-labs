const FixedWindow        = require('../algorithms/FixedWindow');
const SlidingWindow      = require('../algorithms/SlidingWindow');
const TokenBucket        = require('../algorithms/TokenBucket');
const LeakyBucket        = require('../algorithms/LeakyBucket');
const RedisFixedWindow   = require('../algorithms/RedisFixedWindow');
const RedisSlidingWindow = require('../algorithms/RedisSlidingWindow');
const RedisTokenBucket   = require('../algorithms/RedisTokenBucket');
const RedisLeakyBucket   = require('../algorithms/RedisLeakyBucket');

const registry = {
  // in-memory (phase 1 — single node only)
  'fixed-window':         FixedWindow,
  'sliding-window':       SlidingWindow,
  'token-bucket':         TokenBucket,
  'leaky-bucket':         LeakyBucket,

  // redis-backed (phase 2 — distributed, race-condition safe)
  'redis-fixed-window':   RedisFixedWindow,
  'redis-sliding-window': RedisSlidingWindow,
  'redis-token-bucket':   RedisTokenBucket,
  'redis-leaky-bucket':   RedisLeakyBucket,
};

// cache instances — one per config key, not recreated per request
const instances = new Map();


function getRateLimiter(type, options = {}) {
  const cacheKey = `${type}:${JSON.stringify(options)}`;

  if (instances.has(cacheKey)) {
    return instances.get(cacheKey);
  }

  const Limiter = registry[type];
  if (!Limiter) {
    throw new Error(`Unknown rate limiter type: "${type}". Available: ${Object.keys(registry).join(', ')}`);
  }

  const instance = new Limiter(options);
  instances.set(cacheKey, instance);
  return instance;
}

module.exports = { getRateLimiter };
