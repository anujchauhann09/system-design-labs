const { Pool } = require('pg');

// Single shared DB connection pool — this is the monolith advantage.
// All modules (auth, orders, payments) use this same pool.
// No network calls, no service boundaries — just one DB.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on('error', (err) => {
  console.error('Unexpected DB error', err);
  process.exit(-1);
});

module.exports = pool;
