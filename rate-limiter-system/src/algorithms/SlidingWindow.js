/**
 * sliding window rate limiter (in-memory)
*
* how it works:
*  - instead of fixed time buckets, we keep a log of timestamps
*    for each request a client makes
*  - on every request, we drop timestamps older than `windowMs`
*    and count what's left
*  - the window "slides" with time — no hard reset boundary
*
* fixes the fixed-window burst problem:
*  - you can never fire 2x the limit across a boundary because
*    the window always looks back exactly `windowMs` from NOW
*
* trade-off:
*  - higher memory usage — we store every timestamp per client
*/
const RateLimiter = require('./RateLimiter');

class SlidingWindow extends RateLimiter {
  constructor({ limit = 100, windowMs = 60000 } = {}) {
    super({ limit, windowMs });
    this.store = new Map(); // { key -> [timestamp, ...] }
  }

  allowRequest(key) {
    const { limit, windowMs } = this.options;
    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = (this.store.get(key) || []).filter(t => t > windowStart);
    const count = timestamps.length;
    const allowed = count < limit;

    if (allowed) timestamps.push(now);
    this.store.set(key, timestamps);

    const resetAt = timestamps.length > 0 ? timestamps[0] + windowMs : now + windowMs;

    return {
      allowed,
      remaining: Math.max(0, limit - timestamps.length),
      resetAt,
    };
  }
}

module.exports = SlidingWindow;
