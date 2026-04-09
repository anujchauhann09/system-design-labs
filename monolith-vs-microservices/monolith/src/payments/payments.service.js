const pool = require('../utils/db');

// PAYMENTS SERVICE — mock implementation.
// In a real system this would call Stripe/PayPal etc.
//
// KEY MONOLITH INSIGHT:
// Orders module calls this function DIRECTLY (just a function import).
// No HTTP call, no network latency, no failure handling needed.
// This is fast and simple — but it means payments and orders are TIGHTLY COUPLED.
// You can't deploy or scale them independently.

async function processPayment(orderId, amount) {
  // Mock: simulate 90% success rate
  const success = Math.random() > 0.1;
  const status = success ? 'success' : 'failed';

  await pool.query(
    'INSERT INTO payments (order_id, status) VALUES ($1, $2)',
    [orderId, status]
  );

  return { orderId, status, amount };
}

module.exports = { processPayment };
