const express = require('express');
const { processPayment, getPaymentByOrder } = require('./payment.service');

const router = express.Router();

// Called by order-service internally (service-to-service, not by client directly)
// POST /payments/process  { orderId, amount }
router.post('/process', async (req, res) => {
  const { orderId, amount } = req.body;
  if (!orderId || !amount) return res.status(400).json({ error: 'orderId and amount required' });

  try {
    const payment = await processPayment(orderId, amount);
    res.status(201).json(payment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /payments/order/:orderId
router.get('/order/:orderId', async (req, res) => {
  try {
    const payment = await getPaymentByOrder(req.params.orderId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
