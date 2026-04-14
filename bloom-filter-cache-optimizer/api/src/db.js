const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../db/bloom.db");

const db = new Database(DB_PATH);

// WAL mode: allows concurrent reads while a write is happening
// Default journal mode locks the entire file on any write
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL"); // safe with WAL, faster than FULL

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id   INTEGER PRIMARY KEY,
    name TEXT    NOT NULL
  );
`);


// only seed if table is empty
const count = db.prepare("SELECT COUNT(*) as c FROM users").get();
if (count.c === 0) {
  const insert = db.prepare("INSERT INTO users (id, name) VALUES (?, ?)");

  const seedMany = db.transaction(() => {
    for (let i = 1; i <= 1000; i++) {
      insert.run(i, `User_${i}`);
    }
  });

  seedMany();
  console.log("[db] Seeded 1000 users (IDs 1–1000)");
}


function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

/**
 * insert a new user and return the created row
 * caller is responsible for also calling addToBloomFilter() after this —
 * see POST /user route which does both atomically
 */
function createUser(id, name) {
  db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run(id, name);
  return { id, name };
}

module.exports = { db, getUserById, createUser };
