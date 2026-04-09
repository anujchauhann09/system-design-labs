const pool = require('../utils/db');
const { processPayment } = require('../payments/payments.service');

// ORDERS SERVICE — directly imports and calls payments service.
//
// This is the core of monolith coupling:
//   createOrder() → processPayment() → same DB transaction space
//
// Advantages here:
//   Simple — just a function call
//   Fast — no network hop
//   Easy to debug — single stack trace
//
// Where this hurts later:
//   Can't deploy orders without deploying payments
//   Can't scale payments independently if it's the bottleneck
//   A bug in payments can crash the entire app

async function createOrder(userId, item, amount) {
  // Step 1: Create the order with 'pending' status
  const orderResult = await pool.query(
    'INSERT INTO orders (user_id, item, amount, status) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, item, amount, 'pending']
  );
  const order = orderResult.rows[0];

  // Step 2: Internally call payments — no HTTP, just a function call
  const payment = await processPayment(order.id, amount);

  // Step 3: Update order status based on payment result
  const finalStatus = payment.status === 'success' ? 'confirmed' : 'payment_failed';
  await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [finalStatus, order.id]);

  return { ...order, status: finalStatus, payment };
}

async function getOrdersByUser(userId) {
  const result = await pool.query(
    `SELECT o.*, p.status AS payment_status
     FROM orders o
     LEFT JOIN payments p ON p.order_id = o.id
     WHERE o.user_id = $1
     ORDER BY o.created_at DESC`,
    [userId]
  );
  return result.rows;
}

module.exports = { createOrder, getOrdersByUser };
