/**
 * leaky bucket rate limiter (in-memory)
 *
 * how it works:
 *  - each client has a "bucket" (queue) with a max capacity
 *  - requests drip OUT at a fixed leakRate per second — steady outflow
 *  - incoming requests fill the bucket (queue up)
 *  - if the bucket is full → request is rejected (overflow)
 *
 * vs Token Bucket:
 *  - token bucket: bursty input allowed, bursty output allowed
 *  - leaky bucket: bursty input allowed (up to capacity), but OUTPUT is always smooth/steady
 *
 * Trade-off:
 *  - great for protecting slow downstream systems from traffic spikes
 *  - requests don't get an instant response during a burst — they're queued
 *  - real world: network traffic shaping, API gateways in front of slow backends
 */
const RateLimiter = require('./RateLimiter');

class LeakyBucket extends RateLimiter {
  constructor({ capacity = 100, leakRate = 10 } = {}) {
    super({ capacity, leakRate });
    this.store = new Map(); // { key -> { queue, lastLeak } }
  }

  allowRequest(key) {
    const { capacity, leakRate } = this.options;
    const now = Date.now();

    let entry = this.store.get(key);

    if (!entry) {
      entry = { queue: 0, lastLeak: now };
    } else {
      const elapsed = (now - entry.lastLeak) / 1000;
      entry.queue = Math.max(0, entry.queue - elapsed * leakRate);
      entry.lastLeak = now;
    }

    const allowed = entry.queue < capacity;
    if (allowed) entry.queue += 1;
    this.store.set(key, entry);

    const resetAt = now + Math.ceil(entry.queue / leakRate) * 1000;

    return {
      allowed,
      remaining: Math.floor(capacity - entry.queue),
      resetAt,
    };
  }
}

module.exports = LeakyBucket;
