const pool = require('./db');
const { processPayment } = require('./payment.client');

// Same flow as monolith orders.service.js — but processPayment() is now an HTTP call.
// The logic reads identically, but the failure surface is completely different.

async function createOrder(userId, item, amount) {
  const orderResult = await pool.query(
    'INSERT INTO orders (user_id, item, amount, status) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, item, amount, 'pending']
  );
  const order = orderResult.rows[0];

  // This line crosses a service boundary — network call to payment-service
  const payment = await processPayment(order.id, amount);

  const finalStatus = payment.status === 'success' ? 'confirmed' : 'payment_failed';
  await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [finalStatus, order.id]);

  return { ...order, status: finalStatus, payment };
}

async function getOrdersByUser(userId) {
  const result = await pool.query(
    'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
}

module.exports = { createOrder, getOrdersByUser };
