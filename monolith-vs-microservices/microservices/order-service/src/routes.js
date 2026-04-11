const express = require('express');
const authenticate = require('./middleware');
const { createOrder, getOrdersByUser } = require('./order.service');

const router = express.Router();
router.use(authenticate);

router.post('/', async (req, res) => {
  const { item, amount } = req.body;
  if (!item || !amount) return res.status(400).json({ error: 'item and amount required' });

  try {
    const order = await createOrder(req.user.id, item, amount);
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const orders = await getOrdersByUser(req.user.id);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
