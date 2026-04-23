/**
 * token bucket rate limiter (in-memory)
*
* how it works:
*  - each client has a "bucket" that holds up to `capacity` tokens
*  - tokens refill continuously at `refillRate` tokens per second
*  - each request consumes 1 token
*  - if the bucket is empty → request is denied
*
* burst behavior:
*  - a client can burn through all `capacity` tokens instantly (burst)
*  - after that, they're throttled to exactly `refillRate` req/s
*  - this is intentional — token bucket explicitly allows controlled bursts
*
* vs Fixed/Sliding window:
*  - windows count requests in a time range
*  - token bucket models throughput — it's about rate, not count
*/
const RateLimiter = require('./RateLimiter');

class TokenBucket extends RateLimiter {
  constructor({ capacity = 100, refillRate = 10 } = {}) {
    super({ capacity, refillRate });
    this.store = new Map(); // { key -> { tokens, lastRefill } }
  }

  allowRequest(key) {
    const { capacity, refillRate } = this.options;
    const now = Date.now();

    let entry = this.store.get(key);

    if (!entry) {
      entry = { tokens: capacity, lastRefill: now };
    } else {
      const elapsed = (now - entry.lastRefill) / 1000;
      entry.tokens = Math.min(capacity, entry.tokens + elapsed * refillRate);
      entry.lastRefill = now;
    }

    const allowed = entry.tokens >= 1;
    if (allowed) entry.tokens -= 1;
    this.store.set(key, entry);

    // resetAt = when next token will be available
    const resetAt = entry.tokens >= 1
      ? now  // still has tokens, no wait needed
      : now + Math.ceil((1 / refillRate) * 1000); // wait for 1 token to refill

    return {
      allowed,
      remaining: Math.floor(entry.tokens),
      resetAt,
    };
  }
}

module.exports = TokenBucket;
