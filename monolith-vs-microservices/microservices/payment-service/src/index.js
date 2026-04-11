require('dotenv').config();
const express = require('express');
const pool = require('./db');
const routes = require('./routes');

const app = express();
app.use(express.json());
app.use('/payments', routes);
app.get('/health', (req, res) => res.json({ service: 'payment-service', status: 'ok' }));

const PORT = process.env.PORT || 3002;

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id           SERIAL PRIMARY KEY,
      order_id     INTEGER NOT NULL,
      amount       NUMERIC(10, 2) NOT NULL,
      status       VARCHAR(50) DEFAULT 'pending',
      processed_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('payment-service DB ready');
  app.listen(PORT, () => console.log(`payment-service running on port ${PORT}`));
}

start().catch((err) => { console.error(err); process.exit(1); });
