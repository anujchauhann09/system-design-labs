require('dotenv').config();
const express = require('express');
const pool = require('./db');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/', routes);
app.get('/health', (req, res) => res.json({ service: 'auth-service', status: 'ok' }));

const PORT = process.env.PORT || 3001;

// Wait for DB to be ready, then start
async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      email      VARCHAR(255) UNIQUE NOT NULL,
      password   VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('auth-service DB ready');

  app.listen(PORT, () => console.log(`auth-service running on port ${PORT}`));
}

start().catch((err) => {
  console.error('auth-service failed to start:', err);
  process.exit(1);
});
