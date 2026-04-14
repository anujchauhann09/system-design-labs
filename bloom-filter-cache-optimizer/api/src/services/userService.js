const { getUserById, createUser } = require("../db");
const { getCachedUser, setCachedUser } = require("../redis");
const { mightExist, addToBloomFilter } = require("../bloom");
const { logLookup, logWrite } = require("../logger");

/**
 * full pipeline — three-layer lookup:
 *   1. Bloom filter  → "definitely not" → reject instantly (no Redis, no DB)
 *   2. Redis cache   → hit → return immediately
 *   3. SQLite        → miss → fetch, cache, return
 *
 * returns { result, meta } where meta carries latency + source for observability
 */
async function findUser(id) {
  // step 1: Bloom filter
  // O(k) hash computations in Redis — sub-millisecond
  // if false → this ID was never added → skip everything
  const bloomStart = Date.now();
  const exists = await mightExist(id);
  const bloomLatency = Date.now() - bloomStart;

  if (!exists) {
    // definitive rejection — no cache lookup, no DB query
    // 99% of invalid IDs stop here
    const meta = { source: "bloom", bloom_latency_ms: bloomLatency };
    logLookup(id, meta);
    return { result: null, meta };
  }

  // step 2: Redis cache
  const cacheStart = Date.now();
  const cached = await getCachedUser(id);
  const cacheLatency = Date.now() - cacheStart;

  if (cached) {
    const meta = { source: "cache", bloom_latency_ms: bloomLatency, cache_latency_ms: cacheLatency };
    logLookup(id, meta);
    return { result: cached, meta };
  }

  // step 3: SQLite (only reached for valid IDs on cache miss)
  const dbStart = Date.now();
  const user = getUserById(id);
  const dbLatency = Date.now() - dbStart;

  if (!user) {
    // Bloom false positive — filter said "probably yes" but DB says no
    // happens ~1% of the time for invalid IDs... so it's harmless
    const meta = {
      source: "db_false_positive",
      bloom_latency_ms: bloomLatency,
      db_latency_ms: dbLatency,
    };
    logLookup(id, meta);
    return { result: null, meta };
  }

  await setCachedUser(id, user);

  const meta = {
    source: "db",
    bloom_latency_ms: bloomLatency,
    cache_latency_ms: cacheLatency,
    db_latency_ms: dbLatency,
  };
  logLookup(id, meta);
  return { result: user, meta };
}

/**
 * creates a user in SQLite and immediately adds them to the Bloom filter
 * these two steps must always happen together — if Bloom isn't updated,
 * the new user will get false 404s until the next server restart re-seeds
 */
async function addUser(id, name) {
  // step 1: write to DB
  const user = createUser(id, name);

  // step 2: update Bloom filter immediately
  // if this fails, next GET will be a false negative → real user gets 404
  // in production you'd wrap this in a retry or a queue
  await addToBloomFilter(id);

  logWrite(id, name);
  return user;
}

module.exports = { findUser, addUser };
