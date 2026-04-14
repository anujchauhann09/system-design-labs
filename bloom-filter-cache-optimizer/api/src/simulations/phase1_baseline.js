/**
 * phase 1 — baseline (no cache, no bloom filter)
 *
 * every request hits SQLite directly
 * shows the cost of invalid IDs at scale
 *
 * run: node src/simulations/phase1_baseline.js
 */

const BASE_URL = "http://localhost:3000";
const TOTAL_REQUESTS = 500;
const INVALID_RATIO = 0.7;

async function fireRequest(id) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/user/${id}`);
    const data = await res.json();
    return {
      id,
      status: res.status,
      db_latency_ms: data.db_latency_ms ?? null,
      total_ms: Date.now() - start,
    };
  } catch (err) {
    return { id, error: err.message, total_ms: Date.now() - start };
  }
}

async function run() {
  console.log("\nPhase 1: Baseline (Direct DB)");
  console.log(`${TOTAL_REQUESTS} requests, ${INVALID_RATIO * 100}% invalid IDs\n`);

  const ids = Array.from({ length: TOTAL_REQUESTS }, () =>
    Math.random() < INVALID_RATIO
      ? Math.floor(Math.random() * 9000) + 1001
      : Math.floor(Math.random() * 1000) + 1
  );

  const wallStart = Date.now();
  const results = await Promise.all(ids.map(fireRequest));
  const wallTime = Date.now() - wallStart;

  const hits   = results.filter((r) => r.status === 200);
  const misses = results.filter((r) => r.status === 404);
  const errors = results.filter((r) => r.error);

  const avg = (arr, key) => {
    const valid = arr.filter((r) => r[key] != null);
    if (!valid.length) return "N/A";
    return (valid.reduce((s, r) => s + r[key], 0) / valid.length).toFixed(2) + "ms";
  };

  console.log("─────────────────────────────────────────");
  console.log(`Total requests  : ${TOTAL_REQUESTS}`);
  console.log(`Wall time       : ${wallTime}ms`);
  console.log(`Hits  (200)     : ${hits.length}   avg DB latency: ${avg(hits, "db_latency_ms")}`);
  console.log(`Misses (404)    : ${misses.length}   avg DB latency: ${avg(misses, "db_latency_ms")}`);
  console.log(`Errors          : ${errors.length}`);
  console.log("─────────────────────────────────────────");
  console.log(`\nEvery miss paid a full DB query. ${misses.length} wasted queries.\n`);
}

run();
