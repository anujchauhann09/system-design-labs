# Bloom Filter Cache Optimizer — My Learning Journey

---

## How this started

I wanted to build something that actually teaches me how production backend systems handle scale. Not a tutorial. Not a todo app. Something real — where I understand every decision, every tradeoff, every line of code and why it exists.

I picked this project: a Bloom filter cache optimizer. The idea sounded intimidating at first. Bloom filter? Probabilistic data structure? I had heard the term but never actually understood it. By the end of this, I do. And I built it from scratch.

This document is my full journey. Every phase, every mistake in thinking, every "oh that's why" moment.

---

## Phase 0 — Docker First (Before Any Code)

The first thing I learned is that real engineers set up their environment before writing a single line of application code. I used to just `npm init` and start coding. That's wrong at scale.

I set up Docker Compose first. Three services:
- Node.js API
- SQLite (via volume mount)
- Redis with RedisBloom module

Why Docker? Because "works on my machine" is not a real answer. Docker gives you reproducible environments. If it runs in the container, it runs everywhere — your teammate's laptop, staging, production. No surprises.

The thing that clicked for me here was **service networking**. In Docker Compose, services talk to each other by container name, not by `localhost`. So my API reaches Redis at `redis:6379`, not `localhost:6379`. Docker handles the DNS internally. I didn't know that before.

I also learned why I used `redis/redis-stack-server` instead of plain `redis`. Standard Redis doesn't have Bloom filter commands. RedisStack bundles them — `BF.ADD`, `BF.EXISTS`, `BF.RESERVE` — as native commands. No manual module loading needed.

One important detail: I added a `healthcheck` on Redis and used `depends_on: condition: service_healthy` for the API. This means the API container waits until Redis is actually ready — not just "started". That's a real production pattern. Without it, the API would crash on startup trying to connect to a Redis that isn't ready yet.

---

## Phase 1 — The Baseline Problem (No Cache, No Filter)

Before optimizing anything, I needed to understand what I was optimizing. So I built the simplest possible thing: a `GET /user/:id` endpoint that hits SQLite directly every single time.

I seeded 1000 users (IDs 1–1000) into SQLite on startup.

The flow was:
```
Client → GET /user/:id → SQLite → user OR 404
```

I wrote a simulation script that fires 500 concurrent requests — 70% of them for IDs that don't exist (IDs above 1000).

The result: **350 wasted DB queries out of 500 requests**. Every single invalid ID hit SQLite, ran a full query, found nothing, and returned 404. SQLite doesn't know a row doesn't exist until it finishes the full index scan. The cost of a miss is the same as the cost of a hit.

At 1000 requests/sec with 70% invalid IDs, that's 700 DB queries/sec for zero value. SQLite would start queuing, then timing out. Legitimate users would start seeing failures — not because of their requests, but because bots and scrapers are hammering non-existent IDs.

This is the problem I set out to solve.

I also made a decision here to keep each phase's simulation separate. So I created `api/src/simulations/` folder with one file per phase, and a dispatcher `simulate.js` that routes to the right one:

```
node src/simulate.js 1   # baseline
node src/simulate.js 2   # cache
node src/simulate.js 3   # bloom filter
```

This way I can always go back and compare phases side by side.

---

## Phase 2 — Adding Redis Cache (Cache-Aside Pattern)

The obvious first optimization: cache valid users in Redis so repeated lookups don't hit the DB.

The pattern is called **cache-aside**:
1. Check Redis first
2. On miss: hit SQLite, store result in Redis
3. Next request: Redis hit, no DB

I added `redis.js` with `getCachedUser` and `setCachedUser`. TTL set to 60 seconds initially (later made configurable).

The simulation showed the improvement clearly:

```
Round 1 (cold cache):
  Valid IDs   → all hit DB (cache is empty)
  Invalid IDs → all hit DB

Round 2 (warm cache, same IDs):
  Valid IDs   → all served from Redis (~0.8ms avg)
  Invalid IDs → all hit DB again (same as round 1)
```

This is where I hit the critical insight that changes everything.

**Cache only stores things that exist. Non-existence leaves no footprint.**

I can't cache a 404. Well, technically I could store a "NULL" marker — but that opens a whole new problem. What if that ID gets created later? I'd serve stale 404s. And if an attacker hammers 10 million different invalid IDs, I'd fill Redis with garbage entries. Redis runs out of memory, starts evicting real cached users, and now my cache is full of junk.

So after Phase 2, valid users are fast. But the 70% invalid traffic is completely unaffected. Every single invalid ID still pays the full DB cost, every single time, forever.

Cache solved half the problem. The other half needed something different.

---

## Phase 3 — Understanding Cache Penetration (No Code, Just Thinking)

I spent a full phase just understanding the problem before touching code. This was important.

**Cache penetration** is when requests bypass your cache entirely and hit the database — not because the cache is cold, but because the data never existed in the first place.

Normal cache miss heals itself. First request pays, all future requests are free.

Cache penetration never heals. Every request for a non-existent ID starts from zero, forever.

I also learned the three classic cache failure modes:

- **Cache Penetration** — data never existed, bypasses cache every time (my problem)
- **Cache Breakdown** — data exists but cache expires under high load, thundering herd hits DB simultaneously
- **Cache Avalanche** — many keys expire at the same time, entire cache goes cold at once

I was solving penetration. The other two are different problems.

The real-world version of this: your app goes live, bots start probing `/user/1`, `/user/2`, all the way to `/user/9999999`. A single bot can fire 10,000 requests/sec. At 70% invalid IDs, that's 7,000 DB queries/sec for zero value. Your DB gets DDoS'd — not by overwhelming the network, but by exploiting the gap between your cache and your database.

---

## Phase 4 — Bloom Filter Theory (The Core Learning)

This is the phase I'm most proud of understanding.

A Bloom filter is a **probabilistic data structure**. It's a fixed-size bit array plus a set of hash functions. It answers one question: "has this element ever been added?"

**Adding an element:**
Run it through k hash functions. Each gives a position in the bit array. Set those bits to 1.

**Checking an element:**
Run through the same k hash functions. If ALL those bit positions are 1 → "probably exists". If ANY bit is 0 → "definitely does not exist".

The asymmetry is the whole point:
- **False negative** (says "not in set" but it IS) → **impossible**. You can only set bits, never unset them.
- **False positive** (says "probably in set" but it's NOT) → **possible**. Bit collisions from other elements.

For cache guarding, this is exactly what I need. I can tolerate occasionally checking the DB for an ID that doesn't exist (false positive). I cannot tolerate telling a real user they don't exist (false negative). Bloom filters guarantee exactly that.

**The math — sizing the filter correctly:**

Two inputs:
- `n` = expected number of elements (1000 users)
- `p` = acceptable false positive rate (1% = 0.01)

Optimal bit array size:
```
m = -(n × ln(p)) / (ln(2))²
m = -(1000 × -4.60517) / 0.48045
m ≈ 9586 bits (~1.2 KB)
```

Optimal number of hash functions:
```
k = (m / n) × ln(2)
k = (9586 / 1000) × 0.69315
k ≈ 7 hash functions
```

So for 1000 users with 1% false positive rate, I need a 1.2 KB bit array and 7 hash functions. For comparison, storing 1000 user IDs in a JavaScript Set would cost ~32KB minimum. The Bloom filter does the same job in 1.2KB with 1% error rate.

What does 1% false positive mean in practice? Out of every 100 requests for non-existent IDs, 99 get blocked at the filter with zero DB cost. 1 slips through, hits DB, finds nothing, returns 404. Compared to Phase 2 where 100 out of 100 hit the DB — that's a 99% reduction in wasted queries.

---

## Phase 5 — Implementing the Bloom Filter

Now I actually built it.

I created `bloom.js` with four functions:
- `initBloomFilter()` — calls `BF.RESERVE` with our calculated n and p. Safe to call on every startup — catches "already exists" error.
- `seedBloomFilter(ids)` — bulk loads all existing user IDs using `BF.MADD` (single round-trip)
- `mightExist(id)` — calls `BF.EXISTS`, returns true/false
- `addToBloomFilter(id)` — calls `BF.ADD` for new users

The startup sequence in `index.js` matters:
1. Reserve the filter
2. Seed all existing IDs from SQLite
3. Only then start accepting traffic

If I started accepting traffic before seeding, valid users would get false 404s. The order is critical.

The full request pipeline became:

```
GET /user/:id
  ↓
BF.EXISTS bloom:users id     (~0.1ms)
  ↓
"definitely not" → 404 immediately (zero Redis, zero DB)
  ↓
"probably yes" → check Redis cache
  ↓
cache miss → SQLite → store in cache → return user
```

I also added `POST /user` which creates a user in SQLite AND immediately calls `BF.ADD`. These two steps must always happen together. If I forget to update the Bloom filter when creating a user, that user gets false 404s until the next server restart re-seeds. That's a real bug I had to think through carefully.

**What about server restarts?**

Redis is ephemeral. If Redis restarts, the filter is gone. But on every API startup, `seedBloomFilter()` re-reads all users from SQLite and rebuilds it. SQLite is the source of truth. Redis is just a fast cache layer — including the Bloom filter itself.

The simulation results after Phase 5:
```
Phase 1: 350 wasted DB queries / 500 requests
Phase 2: 350 wasted DB queries / 500 requests
Phase 3:   ~3 wasted DB queries / 500 requests
```

99% reduction. The Bloom filter eliminated cache penetration.

---

## Phase 6 — Separation of Concerns (Service Layer)

At this point the route handler was doing too much — Bloom check, cache check, DB query, all in one place. I refactored.

I created `api/src/services/userService.js`. The service owns all business logic. The route becomes a thin HTTP layer — just parse, validate, call service, respond.

```
routes/users.js     → HTTP only (parse id, validate, return JSON)
services/userService.js → business logic (3-layer pipeline)
bloom.js            → Bloom filter operations
redis.js            → cache operations
db.js               → database queries
```

Each file has one job. If I ever swap Redis for Memcached, I touch only `redis.js`. If I add a fourth lookup layer, I touch only `userService.js`. Nothing else breaks.

This is what separation of concerns actually means in practice — not just a concept, but a real structural decision that makes future changes safe.

---

## Phase 7 — Why I Skipped Negative Caching

I thought about adding negative caching — storing a "NULL" marker in Redis for IDs that don't exist, so repeated lookups for the same invalid ID skip the DB.

Then I thought it through properly and realized it's the wrong solution for this system.

**The Bloom filter already IS the negative cache, but better:**

| | Negative Cache | Bloom Filter |
|---|---|---|
| Memory per invalid ID | ~50 bytes in Redis | 0 (shared bit array) |
| Handles unique spam IDs | No (each costs a write) | Yes (no per-ID storage) |
| Stale after user creation | Yes (needs invalidation) | No (BF.ADD fixes it) |

If an attacker uses unique IDs every time, negative caching doesn't help — each unique invalid ID still costs 1 DB query + 1 Redis write, and Redis fills up with garbage. The Bloom filter uses a fixed ~1.2KB regardless of how many unique invalid IDs it has seen.

Negative caching makes sense in systems without a Bloom filter, or for expensive computed results that are legitimately empty (like search queries with no results). For random ID spam, it's the wrong tool.

---

## Phase 8 — TTL Strategy and Structured Logging

**TTL tuning:**

I made the cache TTL configurable via environment variable instead of hardcoded:

```
CACHE_USER_TTL_SECONDS=300   # 5 minutes in production
CACHE_USER_TTL_SECONDS=10    # short in development for easy testing
```

Users don't change after creation in this system, so a longer TTL is safe. The risk of a longer TTL is serving stale data if a user is updated — but I don't have an update endpoint, so 5 minutes is fine.

**Structured logging:**

I added `logger.js` that outputs one JSON line per request:

```json
{"ts":"2026-04-14T10:23:01.412Z","event":"user_lookup","id":42,"source":"cache","bloom_latency_ms":0,"cache_latency_ms":1}
{"ts":"2026-04-14T10:23:01.413Z","event":"user_lookup","id":9999,"source":"bloom","bloom_latency_ms":0}
```

The `source` field tells me exactly where each request was served from. Over time this lets me answer real operational questions:
- What's my Bloom filter rejection rate? (grep `source: bloom`)
- Is my cache hit ratio dropping? (might mean TTL is too short)
- Are DB hits spiking? (might mean Bloom filter needs re-seeding)

Logging goes in the service layer, not the route. The route doesn't know or care about logging — that's the service's job.

---

## What I Actually Learned

Going in, I thought this was a project about Redis and Bloom filters. It turned out to be about something bigger.

**Every optimization has a tradeoff.** Cache reduces DB load but introduces staleness. Bloom filters reduce cache penetration but introduce false positives. Longer TTL reduces DB hits but risks stale data. There's no free lunch — the job is understanding the tradeoffs and making the right call for your specific situation.

**Understand the problem before reaching for a solution.** I spent a full phase (Phase 3) just thinking about cache penetration before writing any code. That thinking is what made Phase 5 clean. If I had jumped straight to "add Bloom filter" without understanding why, I would have implemented it wrong — wrong sizing, wrong startup sequence, missing the `POST /user` update.

**The math matters.** I actually calculated `m` and `k` from first principles. 9586 bits, 7 hash functions, 1% false positive rate. I didn't just copy a config from Stack Overflow. Understanding the math means I can tune it — if I grow to 100,000 users, I know exactly what to change and why.

**Separation of concerns is a real engineering decision, not just a pattern name.** When I refactored into a service layer, it wasn't because someone told me to. It was because the route was doing too much and I could feel it. The refactor made future changes safe. That's the actual reason the pattern exists.

**Redis is ephemeral. Always have a source of truth.** The Bloom filter lives in Redis. Redis can restart. SQLite is the source of truth. Every startup re-seeds from SQLite. This is the right mental model for any cache layer — it's a performance optimization, not storage.

---

## Final System Architecture

```
Client
  ↓
GET /user/:id
  ↓
[Input Validation]  →  400 if invalid format
  ↓
[Bloom Filter]      →  404 instantly if "definitely not" (~0.1ms, no DB, no cache)
  ↓
[Redis Cache]       →  200 if cached (~0.3ms)
  ↓
[SQLite]            →  fetch, cache, return (~1-3ms)
                    →  404 if false positive (~1% of invalids)
```

```
POST /user
  ↓
[SQLite INSERT]
  ↓
[BF.ADD to Bloom filter]   ← must happen together, always
  ↓
201 Created
```

```
Server startup:
  BF.RESERVE (skip if exists)
  BF.MADD all IDs from SQLite
  Start accepting traffic
```

---

## Numbers That Stuck With Me

- Bloom filter for 1000 users at 1% false positive rate = **1.2 KB**
- Same data in a JavaScript Set = **~32 KB minimum**
- Wasted DB queries before optimization = **350 / 500 requests (70%)**
- Wasted DB queries after Bloom filter = **~3 / 500 requests (~0.6%)**
- Reduction in wasted queries = **99%**
- False positives that slip through = **~1%** — harmless, expected, by design

---

That's the full journey. I started not knowing what a Bloom filter was. I ended up understanding the math behind it, implementing it in a production-style system, and knowing exactly when to use it and when not to.
