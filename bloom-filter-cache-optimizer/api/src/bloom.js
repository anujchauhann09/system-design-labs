const { redis } = require("./redis");

const BLOOM_KEY = "bloom:users";

// n = 1000 users, p = 0.01 (1% false positive rate)
// m ≈ 9586 bits, k ≈ 7 hash functions
// RedisBloom computes m and k internally from n and p — just pass those two
const BLOOM_ERROR_RATE = 0.01; // p
const BLOOM_CAPACITY   = 1000; // n 

/**
 * initialize the Bloom filter
 * BF.RESERVE creates the filter with optimal m and k for our n and p
 */
async function initBloomFilter() {
  try {
    await redis.call("BF.RESERVE", BLOOM_KEY, BLOOM_ERROR_RATE, BLOOM_CAPACITY);
    console.log(`[bloom] Filter created — key: ${BLOOM_KEY}, error rate: ${BLOOM_ERROR_RATE}, capacity: ${BLOOM_CAPACITY}`);
  } catch (err) {
    if (err.message.includes("ERR item exists")) {
      console.log("[bloom] Filter already exists, skipping reserve");
    } else {
      throw err;
    }
  }
}

/**
 * bulk-load user IDs into the filter
 * called once at startup after initBloomFilter()
 * uses BF.MADD to add multiple items in a single round-trip.
 */
async function seedBloomFilter(ids) {
  if (!ids.length) return;

  // BF.MADD key item [item ...]
  await redis.call("BF.MADD", BLOOM_KEY, ...ids.map(String));
  console.log(`[bloom] Seeded ${ids.length} user IDs into filter`);
}

/**
 * check if an ID might exist
 * returns true  → "probably exists" → proceed to cache/DB
 * returns false → "definitely not"  → reject immediately, skip everything
 */
async function mightExist(id) {
  const result = await redis.call("BF.EXISTS", BLOOM_KEY, String(id));
  return result === 1;
}

/**
 * add a single new user ID to the filter
 * must be called whenever a new user is created in the DB
 */
async function addToBloomFilter(id) {
  await redis.call("BF.ADD", BLOOM_KEY, String(id));
}

module.exports = { initBloomFilter, seedBloomFilter, mightExist, addToBloomFilter };
