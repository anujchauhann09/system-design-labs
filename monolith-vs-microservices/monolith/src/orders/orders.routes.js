const express = require('express');
const authenticate = require('../middlewares/authenticate');
const { createOrder, getOrdersByUser } = require('./orders.service');

const router = express.Router();

// All order routes require authentication
router.use(authenticate);

// POST /orders — create a new order (triggers payment internally)
router.post('/', async (req, res) => {
  const { item, amount } = req.body;

  if (!item || !amount) {
    return res.status(400).json({ error: 'item and amount are required' });
  }

  try {
    const order = await createOrder(req.user.id, item, amount);
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /orders — get all orders for the logged-in user
router.get('/', async (req, res) => {
  try {
    const orders = await getOrdersByUser(req.user.id);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
