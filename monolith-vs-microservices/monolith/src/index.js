require('dotenv').config();
const express = require('express');
const initDb = require('./utils/initDb');

const authRoutes = require('./auth/auth.routes');
const orderRoutes = require('./orders/orders.routes');

const app = express();
app.use(express.json());

// Mount all modules under their respective prefixes.
// In a monolith, all routes live in the same Express app — one process, one port.
app.use('/auth', authRoutes);
app.use('/orders', orderRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;

// Initialize DB tables then start server
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Monolith running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize DB:', err);
    process.exit(1);
  });
