/**
 * phase 2 — cache-aside (Redis)
 *
 * round 1: cold cache  → valid IDs miss cache, hit DB
 * round 2: warm cache  → valid IDs served from redis, invalid still hit DB
 *
 * Run: node src/simulations/phase2_cache.js
 */

const BASE_URL = "http://localhost:3000";
const REQUESTS_PER_ROUND = 300;
const INVALID_RATIO = 0.7;

function buildIds(n) {
  return Array.from({ length: n }, () =>
    Math.random() < INVALID_RATIO
      ? Math.floor(Math.random() * 9000) + 1001
      : Math.floor(Math.random() * 1000) + 1
  );
}

async function fireRequest(id) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/user/${id}`);
    const data = await res.json();
    return {
      id,
      status: res.status,
      source: data.source ?? "unknown",
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return { id, error: err.message, latency_ms: Date.now() - start };
  }
}

function printStats(label, results) {
  const hits      = results.filter((r) => r.status === 200);
  const misses    = results.filter((r) => r.status === 404);
  const fromCache = hits.filter((r) => r.source === "cache");
  const fromDb    = hits.filter((r) => r.source === "db");

  const avg = (arr) =>
    arr.length
      ? (arr.reduce((s, r) => s + r.latency_ms, 0) / arr.length).toFixed(1) + "ms"
      : "N/A";

  console.log(`\n── ${label} ${"─".repeat(40 - label.length)}`);
  console.log(`  Total          : ${results.length}`);
  console.log(`  200 (found)    : ${hits.length}   avg latency: ${avg(hits)}`);
  console.log(`    ↳ from cache : ${fromCache.length}   avg latency: ${avg(fromCache)}`);
  console.log(`    ↳ from db    : ${fromDb.length}   avg latency: ${avg(fromDb)}`);
  console.log(`  404 (not found): ${misses.length}   avg latency: ${avg(misses)}`);
  console.log(`\nDB was hit for ALL ${misses.length} invalid IDs (cache can't help them)`);
}

async function run() {
  const ids = buildIds(REQUESTS_PER_ROUND);

  console.log("\nPhase 2: Cache-Aside Pattern");
  console.log(`${REQUESTS_PER_ROUND} requests, ${INVALID_RATIO * 100}% invalid IDs`);

  const round1 = await Promise.all(ids.map(fireRequest));
  printStats("Round 1 (cold cache)", round1);

  await new Promise((r) => setTimeout(r, 200));

  const round2 = await Promise.all(ids.map(fireRequest));
  printStats("Round 2 (warm cache)", round2);

  console.log("\nReflection");
  console.log("Valid IDs: Round 2 faster — Redis served them.");
  console.log("Invalid IDs: Both rounds hit DB equally. Cache solved nothing.");
}

run();
