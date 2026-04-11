require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// API Gateway — the single entry point for all clients.
// Clients talk to port 8080 only. They never know about individual service ports.
//
// Routing table:
//   /auth/*    → auth-service:3001
//   /orders/*  → order-service:3003
//   /payments/* → payment-service:3002

app.use('/auth', createProxyMiddleware({
  target: process.env.AUTH_SERVICE_URL || 'http://auth-service:3001',
  changeOrigin: true,
  pathRewrite: { '^/auth': '' },
}));

app.use('/orders', createProxyMiddleware({
  target: process.env.ORDER_SERVICE_URL || 'http://order-service:3003',
  changeOrigin: true,
  pathRewrite: { '^/orders': '' },
}));

app.use('/payments', createProxyMiddleware({
  target: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3002',
  changeOrigin: true,
  pathRewrite: { '^/payments': '' },
}));

app.get('/health', (req, res) => res.json({ service: 'api-gateway', status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`api-gateway running on port ${PORT}`));
