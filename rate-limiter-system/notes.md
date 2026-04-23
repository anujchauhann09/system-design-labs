# Distributed Rate Limiter — Learning Notes

> A full journal of everything I built, learned, and figured out while building a production-grade distributed rate limiter from scratch.

---

## Why I built this

I wanted to understand how real APIs like GitHub, Stripe, and OpenAI enforce rate limits. Not just "what is rate limiting" — but how it actually works under the hood, how it scales across multiple servers, and what makes it production-grade. So I built the whole thing myself, from a simple in-memory counter all the way to a distributed Redis-backed system running across 3 Docker containers behind a load balancer.

---

## Phase 0 — Project Setup

I started by initializing a clean Node.js project with Express, ioredis, and dotenv. I set up the folder structure intentionally before writing any logic:

```
src/
  algorithms/   ← rate limiting logic lives here
  middleware/   ← Express middleware
  services/     ← factory pattern
  config/       ← Redis client, rate limit configs
tests/          ← comparison and distributed test scripts
docker/         ← Dockerfile and nginx config
```

I also Dockerized everything from day one. The app runs in Docker with Redis as a separate container. I wrote a `docker-compose.yml` with a proper health check on Redis so the app only starts after Redis is actually ready — not just the container.

Key learning: `depends_on` alone doesn't wait for Redis to be ready. You need `condition: service_healthy` with a real `healthcheck` using `redis-cli ping`.

---

## Phase 1 — Four Algorithms in Pure Memory

Before touching Redis, I implemented all four rate limiting algorithms using JavaScript `Map` objects. This helped me understand the logic deeply before adding distributed complexity.

### Fixed Window

The simplest algorithm. I divide time into fixed buckets (e.g. every 60 seconds). Each client gets a counter. When the window expires, the counter resets.

```
Window 1 (0-60s):  req 1-10 → allowed, req 11+ → blocked
Window 2 (60-120s): counter resets → req 1-10 allowed again
```

**The burst problem I discovered:** A client can fire 10 requests at t=59s (end of window 1) and 10 more at t=61s (start of window 2). That's 20 requests in 2 seconds — double the limit. This is the boundary exploit.

### Sliding Window

I fixed the burst problem by storing a timestamp for every request instead of just a counter. On each request I filter out timestamps older than `windowMs` and count what's left. The window always looks back exactly `windowMs` from NOW — no hard boundary to exploit.

Trade-off I learned: higher memory usage. For 1 million users each making 100 requests, that's 100 million timestamps in memory. Fixed window only needs 1 counter per user.

### Token Bucket

This one clicked for me when I thought of it as a bus ticket machine:
- You start with 20 tickets (capacity)
- Each request uses 1 ticket
- Tickets refill at 5 per second
- You can burst through all 20 instantly, then you're throttled to 5/sec

The key insight: token bucket doesn't count requests in a time window. It models **throughput**. The math on every request:

```js
elapsed = (now - lastRefill) / 1000          // seconds since last request
refilled = elapsed * refillRate               // tokens earned
tokens = Math.min(capacity, tokens + refilled) // cap at max
```

### Leaky Bucket

The opposite mental model from token bucket:
- Token bucket: bursty input → bursty output allowed
- Leaky bucket: bursty input → output is always smooth/steady

I model it without an actual async queue — just track how full the bucket is and drain it mathematically based on elapsed time. If the bucket is full, reject. Otherwise enqueue.

Real world use: protecting a slow backend from traffic spikes. The backend always sees a steady stream regardless of how bursty the input is.

---

## Phase 2 — Clean Architecture Refactor

After getting all four algorithms working, I refactored everything into a proper architecture. This was a big learning moment for me.

**Before:** 4 algorithm files + 4 separate middleware files = 8 files, all with duplicated header-setting and 429 logic.

**After:**

```
RateLimiter.js (abstract base class)
    ↑ extends
FixedWindow / SlidingWindow / TokenBucket / LeakyBucket

rateLimiterFactory.js (factory + singleton cache)
    ↓ used by
rateLimiter.js (ONE unified middleware)
    ↓ reads config from
rateLimits.js (single source of truth for all limits)
```

### What I learned about the Factory Pattern

The factory (`getRateLimiter`) does two things:
1. Maps a string like `'token-bucket'` to the actual class
2. Caches instances — so `new TokenBucket()` only happens once, not on every request

```js
const registry = {
  'token-bucket': TokenBucket,
  'leaky-bucket': LeakyBucket,
  ...
};

function getRateLimiter(type, options) {
  const cacheKey = `${type}:${JSON.stringify(options)}`;
  if (instances.has(cacheKey)) return instances.get(cacheKey); // reuse
  const instance = new registry[type](options);
  instances.set(cacheKey, instance);
  return instance;
}
```

### What I learned about Abstract Classes in JS

JavaScript doesn't have real abstract classes like Java. I simulated it:

```js
class RateLimiter {
  constructor() {
    if (new.target === RateLimiter) {
      throw new Error('Abstract — cannot instantiate directly');
    }
  }
  allowRequest(key) {
    throw new Error('Must implement allowRequest()');
  }
}
```

Every algorithm extends this and must implement `allowRequest(key)` which returns `{ allowed, remaining, resetAt }`. The middleware doesn't care which algorithm it's talking to — it just calls `allowRequest`.

---

## Phase 3 — Redis Integration

This is where it got really interesting. I moved from in-memory Maps to Redis so the rate limiter works across multiple servers.

### Why Redis?

In-memory rate limiting breaks in distributed systems:

```
User fires 20 requests → Load Balancer → Server 1 (sees 10) + Server 2 (sees 10)
Server 1 counter: 10 → never blocked
Server 2 counter: 10 → never blocked
Result: 20 requests pass, limit is broken
```

Redis is a single shared store outside all Node processes. All servers write to the same counter.

### Key design

I namespaced all Redis keys:
```
rate_limit:fixed:{ip}
rate_limit:sliding:{ip}
rate_limit:token:{ip}
rate_limit:leaky:{ip}
```

This makes it easy to inspect (`KEYS rate_limit:*`), delete per-user, and avoid collisions between algorithms.

### The Race Condition Problem

Without Lua, a naive Redis implementation has a race condition:

```js
const count = await redis.incr(key);  // step 1
if (count === 1) {
  await redis.expire(key, 60);        // step 2 ← another server can sneak in here
}
```

Between step 1 and step 2, another server can also do step 1. The TTL might never get set.

### Lua Scripts — the fix

Redis runs Lua scripts atomically. The entire script is one uninterruptible operation. I wrote a Lua script for each algorithm:

```lua
-- Fixed window — atomic INCR + EXPIRE
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('PEXPIRE', key, ttl)  -- only set TTL on very first request
end
return { count, redis.call('PTTL', key) }
```

For token bucket and leaky bucket I used Redis Hashes to store multiple fields in one key:
```
rate_limit:token:192.168.1.1
  tokens    → 14.7
  lastRefill → 1714000000000
```

### Redis TIME — production detail

I learned that passing `Date.now()` from Node to Redis is wrong in a distributed system. If 3 servers have slightly different clocks (clock drift), the refill calculations will be inconsistent.

The fix: use `redis.call('TIME')` inside the Lua script. Redis has one clock, shared by everyone.

```lua
local t   = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)  -- seconds + microseconds → ms
```

### TTL = auto cleanup

Every Redis write sets a TTL. Idle users auto-expire — no cron jobs needed:
- Fixed/Sliding: TTL = window duration
- Token/Leaky: TTL = time to fully refill/drain × 2

---

## Phase 4 — Distributed System with Load Balancer

I scaled the app to 3 instances behind Nginx. This was the most satisfying part — seeing the distributed rate limiter actually work.

### Docker Compose setup

```yaml
nginx:        # port 80 exposed to outside world
app_1:        # no ports exposed — only reachable via Nginx internally
app_2:        # same
app_3:        # same
redis:        # shared state store
```

Key insight I had: same port on different containers is fine. Each container has its own network namespace. `app_1:3000`, `app_2:3000`, `app_3:3000` are all separate — they just happen to listen on the same port number inside their own isolated environment.

### Nginx round-robin

```nginx
upstream app_servers {
    server app_1:3000;
    server app_2:3000;
    server app_3:3000;
    # no directive = round-robin by default
}
```

Request 1 → app_1, request 2 → app_2, request 3 → app_3, request 4 → app_1...

### The distributed test result

I wrote `tests/distributed.js` to prove it works. The output:

```
req  1: 200 | remaining:  9 | instance: app_1
req  2: 200 | remaining:  8 | instance: app_2   ← app_2 sees 8, not 9
req  3: 200 | remaining:  7 | instance: app_3   ← app_3 sees 7, not 9
...
req 11: 429 | remaining:  0 | instance: app_2   ← blocked on different instance
req 12: 429 | remaining:  0 | instance: app_3

PASS — shared Redis counter correctly blocked requests across instances
```

`app_2` didn't start its own counter from 10. It read the shared Redis counter. That's distributed rate limiting working correctly.

---

## Phase 5 — Global Rate Limiting

I added a system-wide rate limit that runs before all per-IP limits. This protects the entire infrastructure regardless of who's making requests.

The key insight: the only difference between per-IP and global limiting is the Redis key:
- Per-IP: `rate_limit:token:192.168.1.1` (different per client)
- Global: `rate_limit:token:global` (same for everyone)

I implemented this with a `keyFn` in the config:

```js
'global': {
  algorithm: 'redis-token-bucket',
  options: { capacity: 50000, refillRate: 833 },
  keyFn: () => 'global',  // ignores req, always returns fixed key
}
```

The middleware checks for `keyFn`:
```js
const key = config.keyFn ? config.keyFn(req) : req.ip;
```

Now every request hits two Redis keys:
1. `rate_limit:token:global` — system-wide counter
2. `rate_limit:fixed:{ip}` — per-client counter

If either blocks → 429.

---

## Phase 6 — Failure Handling

I implemented configurable fail modes for when Redis goes down.

**Fail open** (default): Redis down → let requests through. Availability over security. Good for public read endpoints.

**Fail closed**: Redis down → return 503. Security over availability. Good for auth endpoints where you'd rather block than allow unlimited login attempts.

```js
'auth-limit': {
  algorithm: 'redis-fixed-window',
  options: { limit: 5, windowMs: 900000 },
  failMode: 'closed'
}
```

In the middleware catch block:
```js
catch (err) {
  if (config.failMode === 'closed') {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
  next(); // fail open by default
}
```

---

## What I learned about production rate limiting

Real production systems run multiple layers simultaneously:

| Layer | Key | Purpose |
|-------|-----|---------|
| Global | `"global"` | Protect infrastructure from DDoS |
| Per IP | `req.ip` | Block abusive anonymous traffic |
| Per User | `req.user.id` | Enforce per-account limits |
| Per Tier | `req.user.plan` | Free vs Pro vs Enterprise |
| Per Endpoint | `req.path` | Expensive endpoints get lower limits |

I built layers 1 and 2. Layers 3-5 are the same code — just different `keyFn` values.

---

## Bugs I found and fixed

**1. RedisSlidingWindow used Node clock**
I was passing `Date.now()` from Node to the Lua script. Clock drift between servers = inconsistent window boundaries. Fixed by using `redis.call('TIME')` inside Lua — same fix I already had in token bucket and leaky bucket.

**2. compare.js was hitting port 3000 directly**
This bypassed Nginx and the global rate limiter. Fixed to hit port 80 so all layers are tested.

**3. Token bucket refill rate too high for testing**
At `refillRate=2`, curl in a shell loop refills ~0.1 tokens per request. Over 15 requests that's enough to prevent the bucket from draining. Used production-appropriate numbers instead.

---

## Key commands I use

```bash
# Start everything
docker-compose up --build -d

# Run comparison test (in-memory vs Redis)
node tests/compare.js

# Run distributed test (proves Redis works across instances)
docker exec rate-limiter-system-redis-1 redis-cli FLUSHDB
node tests/distributed.js

# Inspect Redis keys
docker exec -it rate-limiter-system-redis-1 redis-cli KEYS "rate_limit:*"

# Check a specific key
docker exec -it rate-limiter-system-redis-1 redis-cli HGETALL "rate_limit:token:global"

# Unblock a specific IP
docker exec -it rate-limiter-system-redis-1 redis-cli DEL "rate_limit:fixed:::ffff:192.168.1.1"
```

---

## Final architecture

```
Client
  ↓
Nginx (port 80) — round-robin load balancer
  ↓
┌─────────────────────────────────────┐
│  app_1 / app_2 / app_3 (stateless)  │
│                                     │
│  Global middleware (runs first)     │
│    → RedisTokenBucket('global')     │
│                                     │
│  Route middleware (per endpoint)    │
│    → Redis{Algorithm}(req.ip)       │
└─────────────────────────────────────┘
  ↓
Redis (shared state — all counters live here)
  rate_limit:token:global
  rate_limit:fixed:{ip}
  rate_limit:sliding:{ip}
  rate_limit:token:{ip}
  rate_limit:leaky:{ip}
```

Every app instance is completely stateless. All state lives in Redis. Adding a 4th server requires zero code changes — just add it to `docker-compose.yml` and `nginx.conf`.

---

## What I'd add next

- Per-user rate limiting (swap `req.ip` for `req.user.id` via `keyFn`)
- Tier-based limits (look up user's plan, pick config dynamically)
- Redis Cluster support for Redis itself to be distributed
- Prometheus metrics — track how many requests are being rate limited
- Admin endpoint to manually unblock an IP or user
