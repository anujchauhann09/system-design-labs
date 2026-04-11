const pool = require('./db');

// payment-service owns the payments table exclusively.
// order-service calls this via HTTP POST /payments/process
// No other service touches this table directly — that's the microservice boundary.

async function processPayment(orderId, amount) {
  // Mock: 90% success rate
  const success = Math.random() > 0.1;
  const status = success ? 'success' : 'failed';

  const result = await pool.query(
    'INSERT INTO payments (order_id, amount, status) VALUES ($1, $2, $3) RETURNING *',
    [orderId, amount, status]
  );

  return result.rows[0];
}

async function getPaymentByOrder(orderId) {
  const result = await pool.query(
    'SELECT * FROM payments WHERE order_id = $1',
    [orderId]
  );
  return result.rows[0] || null;
}

module.exports = { processPayment, getPaymentByOrder };
