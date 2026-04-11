const { Pool } = require('pg');

// auth-service owns its own DB connection.
// It still talks to the same postgres instance for now (shared DB),
// but the connection is isolated to this process.
// In a mature setup, auth-service would have its OWN database entirely.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

module.exports = pool;
