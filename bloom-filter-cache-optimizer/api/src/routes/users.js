const express = require("express");
const { findUser, addUser } = require("../services/userService");

const router = express.Router();

/**
 * GET /user/:id
 *
 * full pipeline:
 *   1. Bloom filter  → "definitely not" → 404 instantly (no Redis, no DB)
 *   2. Redis cache   → hit → return immediately
 *   3. SQLite        → miss → fetch, cache, return
 */
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  const { result, meta } = await findUser(id);

  if (!result) {
    return res.status(404).json({ error: "User not found", id, ...meta });
  }

  return res.json({ user: result, ...meta });
});

/**
 * POST /user
 * body: { id: number, name: string }
 *
 * creates a user in SQLite and immediately adds them to the Bloom filter
 * these two steps must always happen together — if Bloom isn't updated,
 * the new user will get false 404s until the next server restart re-seeds
 */
router.post("/", async (req, res) => {
  const { id, name } = req.body;

  if (!id || !name || isNaN(parseInt(id))) {
    return res.status(400).json({ error: "id (number) and name (string) required" });
  }

  const userId = parseInt(id, 10);

  try {
    const user = await addUser(userId, name);
    return res.status(201).json({ user, bloom_updated: true });
  } catch (err) {
    if (err.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "User ID already exists" });
    }
    throw err;
  }
});

module.exports = router;
