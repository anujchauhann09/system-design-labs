const pool = require('./db');

// Creates all tables on startup if they don't exist.
// In a monolith this is trivial — one migration script, one DB.
// In microservices, each service owns its own DB (more complex).
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id        SERIAL PRIMARY KEY,
      email     VARCHAR(255) UNIQUE NOT NULL,
      password  VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      item        VARCHAR(255) NOT NULL,
      amount      NUMERIC(10, 2) NOT NULL,
      status      VARCHAR(50) DEFAULT 'pending',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id          SERIAL PRIMARY KEY,
      order_id    INTEGER REFERENCES orders(id),
      status      VARCHAR(50) DEFAULT 'pending',
      processed_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('Database tables ready');
}

module.exports = initDb;
