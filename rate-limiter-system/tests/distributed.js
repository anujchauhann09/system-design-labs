/**
 * distributed rate limiter test
 *
 * proves that rate limiting works correctly across multiple server instances
 * all requests go through Nginx (port 80) which round-robins to app_1/app_2/app_3
 * even though requests hit different servers, the shared Redis counter enforces the limit
 *
 * run: node tests/distributed.js  (requires docker-compose up)
 */

const BASE           = 'http://localhost:80';
const TOTAL_REQUESTS = 15; // limit is 10, so last 5 should be blocked

async function run() {
  console.log('\n Distributed Rate Limiter Test');
  console.log(`   Firing ${TOTAL_REQUESTS} requests through Nginx → 3 app instances → Redis`);
  console.log(`   Tip: if all requests return 429, run: docker exec rate-limiter-system-redis-1 redis-cli FLUSHDB\n`);

  const instanceCounts = {};
  let allowed = 0;
  let blocked  = 0;

  for (let i = 1; i <= TOTAL_REQUESTS; i++) {
    const res      = await fetch(`${BASE}/redis/fixed-window`);
    const body     = await res.json();
    const instance = res.headers.get('x-instance') || body.instance || 'unknown';
    const status   = res.status;

    instanceCounts[instance] = (instanceCounts[instance] || 0) + 1;
    if (status === 200) allowed++;
    else blocked++;

    const remaining = res.headers.get('x-ratelimit-remaining') ?? '?';
    console.log(`  req ${String(i).padStart(2)}: ${status} | remaining: ${String(remaining).padStart(2)} | instance: ${instance}`);
  }

  console.log('\n Summary');
  console.log(`  Allowed : ${allowed}`);
  console.log(`  Blocked : ${blocked}`);
  console.log(`  Requests per instance:`, instanceCounts);

  if (blocked > 0) {
    console.log('\n  PASS — shared Redis counter correctly blocked requests across instances');
  } else {
    console.log('\n  FAIL — all requests passed, rate limit not enforced');
  }

  console.log();
}

run().catch(err => {
  console.error('Error:', err.message);
  console.error('Is docker-compose up? Try: docker-compose up --build -d');
  process.exit(1);
});
