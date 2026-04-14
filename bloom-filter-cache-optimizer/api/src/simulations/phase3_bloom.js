/**
 * phase 3 — Bloom Filter simulation
 *
 * same load as phase 2 but now invalid IDs are blocked at the filter
 * shows: bloom rejections, false positives, DB query reduction
 *
 * Run: node src/simulations/phase3_bloom.js
 */

const BASE_URL = "http://localhost:3000";
const REQUESTS_PER_ROUND = 300;
const INVALID_RATIO = 0.7;

function buildIds(n) {
  return Array.from({ length: n }, () =>
    Math.random() < INVALID_RATIO
      ? Math.floor(Math.random() * 9000) + 1001  // invalid: > 1000
      : Math.floor(Math.random() * 1000) + 1     // valid:   1–1000
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
  const hits           = results.filter((r) => r.status === 200);
  const misses         = results.filter((r) => r.status === 404);
  const fromCache      = hits.filter((r) => r.source === "cache");
  const fromDb         = hits.filter((r) => r.source === "db");
  const bloomRejected  = misses.filter((r) => r.source === "bloom");
  const falsePositives = misses.filter((r) => r.source === "db_false_positive");
  const dbMisses       = misses.filter((r) => r.source === "db");

  const avg = (arr) =>
    arr.length
      ? (arr.reduce((s, r) => s + r.latency_ms, 0) / arr.length).toFixed(1) + "ms"
      : "N/A";

  // total DB queries that actually happened
  const dbHits = fromDb.length + falsePositives.length + dbMisses.length;

  console.log(`\n── ${label} ${"─".repeat(40 - label.length)}`);
  console.log(`  Total requests      : ${results.length}`);
  console.log(`  200 (found)         : ${hits.length}   avg: ${avg(hits)}`);
  console.log(`    ↳ from cache      : ${fromCache.length}   avg: ${avg(fromCache)}`);
  console.log(`    ↳ from db         : ${fromDb.length}   avg: ${avg(fromDb)}`);
  console.log(`  404 (not found)     : ${misses.length}`);
  console.log(`    ↳ bloom rejected  : ${bloomRejected.length}   avg: ${avg(bloomRejected)}  ← no DB cost`);
  console.log(`    ↳ false positives : ${falsePositives.length}   avg: ${avg(falsePositives)}  ← slipped through (~1%)`);
  console.log(`    ↳ db miss         : ${dbMisses.length}`);
  console.log(`\n  Actual DB queries   : ${dbHits} / ${results.length}`);

  const saved = bloomRejected.length;
  const pct   = ((saved / results.length) * 100).toFixed(1);
  console.log(`  DB queries saved    : ${saved} (${pct}% reduction)`);
}

async function run() {
  const ids = buildIds(REQUESTS_PER_ROUND);

  console.log("\nPhase 3: Bloom Filter");
  console.log(`${REQUESTS_PER_ROUND} requests, ${INVALID_RATIO * 100}% invalid IDs`);

  const round1 = await Promise.all(ids.map(fireRequest));
  printStats("Round 1 (cold cache, bloom warm)", round1);

  await new Promise((r) => setTimeout(r, 200));

  const round2 = await Promise.all(ids.map(fireRequest));
  printStats("Round 2 (warm cache, bloom warm)", round2);

  console.log("\nPhase Comparison");
  console.log("Phase 1 (baseline) : 100% of invalid IDs hit DB");
  console.log("Phase 2 (cache)    : 100% of invalid IDs hit DB (cache can't help)");
  console.log("Phase 3 (bloom)    :  ~1% of invalid IDs hit DB (99% blocked at filter)");
  console.log("\n→ Bloom filter eliminated cache penetration.\n");
}

run();
