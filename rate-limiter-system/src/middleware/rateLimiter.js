const { getRateLimiter } = require('../services/rateLimiterFactory');
const rateLimitConfigs  = require('../config/rateLimits');

/**
 * unified rate limiter middleware
 * works for both in-memory and Redis-backed algorithms —
 * allowRequest() may be sync or async, both are handled
 *
 */
function rateLimiter(configName) {
  const config = rateLimitConfigs[configName];
  if (!config) {
    throw new Error(`No rate limit config found for: "${configName}"`);
  }

  const limiter = getRateLimiter(config.algorithm, config.options);

  return async (req, res, next) => {
    try {
      // keyFn allows custom key extraction — defaults to IP for per-client limiting
      const key    = config.keyFn ? config.keyFn(req) : req.ip;
      const result = await limiter.allowRequest(key);

      res.set('X-RateLimit-Policy',    configName);
      res.set('X-RateLimit-Remaining', result.remaining);
      res.set('X-RateLimit-Reset',     Math.ceil(result.resetAt / 1000));

      if (!result.allowed) {
        const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
        res.set('Retry-After', retryAfter);
        return res.status(429).json({
          error: 'Too Many Requests',
          retryAfter: `${retryAfter}s`,
          policy: configName,
        });
      }

      next();
    } catch (err) {
      // redis down — behavior depends on failMode config
      // 'open'  (default): let request through — availability over security
      // 'closed': block request — security over availability
      console.error(`[RateLimiter] error for "${configName}":`, err.message);
      if (config.failMode === 'closed') {
        return res.status(503).json({
          error: 'Service temporarily unavailable',
          policy: configName,
        });
      }
      next(); // fail open by default
    }
  };
}

module.exports = rateLimiter;
