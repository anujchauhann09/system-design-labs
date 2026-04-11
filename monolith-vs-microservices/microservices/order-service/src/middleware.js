const http = require('http');

// order-service verifies tokens by calling auth-service.
// It does NOT hold JWT_SECRET — it trusts auth-service as the authority.

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
          const result = JSON.parse(raw);
          if (res.statusCode === 200) resolve(result);
          else reject(new Error(result.error || 'Auth failed'));
        });
      }
    );

    req.on('error', (err) => reject(new Error('auth-service unreachable: ' + err.message)));
    req.write(data);
    req.end();
  });
}

async function authenticate(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  try {
    const decoded = await post(`${process.env.AUTH_SERVICE_URL}/verify`, { token });
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
}

module.exports = authenticate;
