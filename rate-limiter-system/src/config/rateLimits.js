/**
 * central config for all rate limiter instances
 * each key maps to an algorithm type + its options
 * add a new entry here to create a new limiter — no other files need to change
 */
module.exports = {
  // global (system-wide protection, runs before per-IP limits) 
  'global': {
    algorithm: 'redis-token-bucket',
    options: { capacity: 50000, refillRate: 833 },
    keyFn: () => 'global',
    failMode: 'open',      // system-wide — better to serve than block everyone
  },

  // in-memory (single node) 
  'fixed-window': {
    algorithm: 'fixed-window',
    options: { limit: 10, windowMs: 60000 },
  },
  'sliding-window': {
    algorithm: 'sliding-window',
    options: { limit: 10, windowMs: 60000 },
  },
  'token-bucket': {
    algorithm: 'token-bucket',
    options: { capacity: 20, refillRate: 5 },
  },
  'leaky-bucket': {
    algorithm: 'leaky-bucket',
    options: { capacity: 20, leakRate: 5 },
  },

  // redis-backed (distributed, race-condition safe)
  'redis-fixed-window': {
    algorithm: 'redis-fixed-window',
    options: { limit: 10, windowMs: 60000 },
    failMode: 'open',      // public route — fail open
  },
  'redis-sliding-window': {
    algorithm: 'redis-sliding-window',
    options: { limit: 10, windowMs: 60000 },
    failMode: 'open',
  },
  'redis-token-bucket': {
    algorithm: 'redis-token-bucket',
    options: { capacity: 20, refillRate: 5 },
    failMode: 'open',
  },
  'redis-leaky-bucket': {
    algorithm: 'redis-leaky-bucket',
    options: { capacity: 20, leakRate: 5 },
    failMode: 'open',
  },
};
