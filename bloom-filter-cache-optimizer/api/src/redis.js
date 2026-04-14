const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const redis = new Redis(REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
});

redis.on("connect", () => console.log("[redis] Connected"));
redis.on("error", (err) => console.error("[redis] Error:", err.message));


const TTL = {
  // how long a found user stays cached
  USER: parseInt(process.env.CACHE_USER_TTL_SECONDS, 10) || 300,
};

// try to get a user from cache
async function getCachedUser(id) {
  const raw = await redis.get(`user:${id}`);
  return raw ? JSON.parse(raw) : null;
}

// store a user in cache with TTL
// only caching users that actually exist — not caching 404s
async function setCachedUser(id, user) {
  await redis.set(`user:${id}`, JSON.stringify(user), "EX", TTL.USER);
}

module.exports = { redis, getCachedUser, setCachedUser, TTL };
