const http = require('http');

// HTTP client for calling payment-service.
// In the monolith this was: const { processPayment } = require('../payments/payments.service')
// Now it's a network call — this file is the boundary between the two services.
//
// What this adds vs monolith:
//   Network latency on every order creation
//   payment-service being down = orders fail
//   payment-service can be deployed, scaled, updated independently

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.error || 'payment-service error'));
        });
      }
    );

    req.on('error', (err) => reject(new Error('payment-service unreachable: ' + err.message)));
    req.write(data);
    req.end();
  });
}

async function processPayment(orderId, amount) {
  const url = `${process.env.PAYMENT_SERVICE_URL}/payments/process`;
  return post(url, { orderId, amount });
}

module.exports = { processPayment };
