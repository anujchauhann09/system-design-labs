/**
 * rate limiter comparison script
 * fires burst traffic at all algorithms (in-memory + Redis) and prints a comparison table
 * run: node tests/compare.js  (requires docker-compose to be up)
 */

const BASE           = 'http://localhost:80'; // through Nginx → global limiter applies
const TOTAL_REQUESTS = 30;

const groups = [
  {
    label: 'In-Memory',
    endpoints: [
      { name: 'Fixed Window',   path: '/fixed-window'   },
      { name: 'Sliding Window', path: '/sliding-window' },
      { name: 'Token Bucket',   path: '/token-bucket'   },
      { name: 'Leaky Bucket',   path: '/leaky-bucket'   },
    ],
  },
  {
    label: 'Redis-Backed',
    endpoints: [
      { name: 'Fixed Window',   path: '/redis/fixed-window'   },
      { name: 'Sliding Window', path: '/redis/sliding-window' },
      { name: 'Token Bucket',   path: '/redis/token-bucket'   },
      { name: 'Leaky Bucket',   path: '/redis/leaky-bucket'   },
    ],
  },
];

async function fireRequests(endpoint) {
  let allowed = 0;
  let blocked = 0;
  const latencies = [];

  for (let i = 0; i < TOTAL_REQUESTS; i++) {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE}${endpoint.path}`);
      const latency = Date.now() - start;
      latencies.push(latency);
      if (res.status === 200) allowed++;
      else blocked++;
    } catch (err) {
      if (i === 0) {
        console.error(`\n  Cannot reach ${BASE} — is docker-compose up?\n`);
        process.exit(1);
      }
      blocked++;
    }
  }

  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const min = latencies.length ? Math.min(...latencies) : 0;
  const max = latencies.length ? Math.max(...latencies) : 0;

  return { allowed, blocked, avgMs: avg.toFixed(1), minMs: min, maxMs: max };
}

const COL = [22, 9, 9, 10, 10, 10];
const HEADER = ['Algorithm', 'Allowed', 'Blocked', 'Avg (ms)', 'Min (ms)', 'Max (ms)'];
const pad = (str, w) => String(str).padEnd(w);
const divider = COL.map(w => '-'.repeat(w)).join('-+-');

function printTable(label, results) {
  console.log(`\n${label} — ${TOTAL_REQUESTS} burst requests\n`);
  console.log(HEADER.map((h, i) => pad(h, COL[i])).join(' | '));
  console.log(divider);
  for (const row of results) {
    console.log([
      pad(row.name,    COL[0]),
      pad(row.allowed, COL[1]),
      pad(row.blocked, COL[2]),
      pad(row.avgMs,   COL[3]),
      pad(row.minMs,   COL[4]),
      pad(row.maxMs,   COL[5]),
    ].join(' | '));
  }
  console.log(divider);
}

function buildMarkdown(memResults, redisResults) {
  const row = (r) =>
    `| ${r.name} | ${r.allowed} | ${r.blocked} | ${r.avgMs}ms | ${r.minMs}ms | ${r.maxMs}ms |`;

  return [
    `## Rate Limiter Comparison`,
    ``,
    `> ${TOTAL_REQUESTS} burst requests fired at each algorithm.`,
    ``,
    `### In-Memory`,
    `| Algorithm | Allowed | Blocked | Avg Latency | Min | Max |`,
    `|-----------|---------|---------|-------------|-----|-----|`,
    ...memResults.map(row),
    ``,
    `### Redis-Backed`,
    `| Algorithm | Allowed | Blocked | Avg Latency | Min | Max |`,
    `|-----------|---------|---------|-------------|-----|-----|`,
    ...redisResults.map(row),
    ``,
    `### Key Observations`,
    `- **Fixed Window**: Hard reset at boundary — burst exploit possible across window edge`,
    `- **Sliding Window**: Accurate rolling count — no boundary exploit, higher memory use`,
    `- **Token Bucket**: Allows full burst up to capacity, then steady refill rate`,
    `- **Leaky Bucket**: Accepts burst into queue, output is always smooth/steady`,
    `- **Redis vs Memory**: Redis adds ~1-5ms latency per request but works across multiple servers`,
  ].join('\n');
}

(async () => {
  console.log(`\nFiring ${TOTAL_REQUESTS} requests at each endpoint...\n`);

  const allResults = [];

  for (const group of groups) {
    const results = [];
    for (const ep of group.endpoints) {
      process.stdout.write(`  [${group.label}] ${ep.name}...`);
      const stats = await fireRequests(ep);
      results.push({ name: ep.name, ...stats });
      console.log(' done');
    }
    allResults.push({ label: group.label, results });
  }

  for (const { label, results } of allResults) {
    printTable(label, results);
  }

  console.log('\n Done\n');
  console.log('--- Markdown (paste into README) ---\n');
  console.log(buildMarkdown(allResults[0].results, allResults[1].results));
})();
