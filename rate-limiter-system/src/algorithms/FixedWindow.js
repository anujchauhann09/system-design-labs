/**
 * fixed Window rate limiter (in-memory)
 *
 * how it works:
 *  - time is divided into fixed-size windows (e.g: every 60s)
 *  - each client gets a counter per window
 *  - Counter resets hard when the window expires
 *
 * known issue (burst problem):
 *  - a client can send max requests at the END of window 1
 *    and max requests at the START of window 2 — effectively
 *    2x the limit in a very short time span
 *
 * trade-off:
 *  - very low memory — just one counter + timestamp per client
 *  - simple and fast, but vulnerable to boundary bursts
 */
const RateLimiter = require('./RateLimiter');

class FixedWindow extends RateLimiter {
  constructor({ limit = 100, windowMs = 60000 } = {}) {
    super({ limit, windowMs });
    this.store = new Map(); // { key -> { count, windowStart } }
  }

  allowRequest(key) {
    const { limit, windowMs } = this.options;
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      this.store.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
    }

    entry.count += 1;

    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      resetAt: entry.windowStart + windowMs,
    };
  }
}

module.exports = FixedWindow;
