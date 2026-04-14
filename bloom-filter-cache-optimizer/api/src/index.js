const express = require("express");
const { db } = require("./db");
const { initBloomFilter, seedBloomFilter } = require("./bloom");
const userRoutes = require("./routes/users");

const app = express();
app.use(express.json());

app.use("/user", userRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", phase: 5 });
});

// startup 
async function start() {
  // 1. reserve the Bloom filter in Redis
  await initBloomFilter();

  // 2. load all existing user IDs from SQLite into the filter
  //    this is a one-time bulk seed... after this, new users are added
  //    individually via addToBloomFilter() on creation
  const rows = db.prepare("SELECT id FROM users").all();
  const ids  = rows.map((r) => r.id);
  await seedBloomFilter(ids);

  // 3. start accepting traffic only after filter is ready
  //    if started before seeding, valid users would get false 404s
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[api] Listening on port ${PORT}`);
    console.log(`[api] Bloom filter loaded with ${ids.length} user IDs`);
  });
}

start().catch((err) => {
  console.error("[api] Startup failed:", err);
  process.exit(1);
});
