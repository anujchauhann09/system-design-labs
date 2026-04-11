require('dotenv').config();
const express = require('express');
const pool = require('./db');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/', routes);
app.get('/health', (req, res) => res.json({ service: 'order-service', status: 'ok' }));

const PORT = process.env.PORT || 3003;

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      item       VARCHAR(255) NOT NULL,
      amount     NUMERIC(10, 2) NOT NULL,
      status     VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('order-service DB ready');
  app.listen(PORT, () => console.log(`order-service running on port ${PORT}`));
}

start().catch((err) => { console.error(err); process.exit(1); });
