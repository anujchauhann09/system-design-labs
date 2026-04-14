/**
 * simulation runner — delegates to the correct phase script
 *
 * Usage:
 *   node src/simulate.js 1   → Phase 1: baseline (direct DB)
 *   node src/simulate.js 2   → Phase 2: cache-aside
 *   node src/simulate.js 3   → Phase 3: bloom filter (coming)
 *
 * Or run phase scripts directly:
 *   node src/simulations/phase1_baseline.js
 *   node src/simulations/phase2_cache.js
 */

const phase = process.argv[2];

const scripts = {
  1: "./simulations/phase1_baseline.js",
  2: "./simulations/phase2_cache.js",
  3: "./simulations/phase3_bloom.js",
};

if (!phase || !scripts[phase]) {
  console.log("\nUsage: node src/simulate.js <phase>");
  console.log("  1 → baseline (direct DB)");
  console.log("  2 → cache-aside (Redis)");
  console.log("  3 → bloom filter (coming in Phase 3)\n");
  process.exit(1);
}

require(scripts[phase]);
