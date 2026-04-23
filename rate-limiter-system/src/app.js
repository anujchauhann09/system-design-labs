require('dotenv').config();
const express     = require('express');
const redis       = require('./config/redis');
const rateLimiter = require('./middleware/rateLimiter');

const app = express();
app.use(express.json());

// tag every response with which instance handled it
app.use((_req, res, next) => {
  res.set('X-Instance', process.env.INSTANCE_ID || 'local');
  next();
});

app.get('/test', (_req, res) => {
  res.json({
    message: 'Rate limiter system is running',
    instance: process.env.INSTANCE_ID || 'local',
  });
});

// health check — verifies app + Redis are both alive
app.get('/health', async (_req, res) => {
  try {
    await redis.ping();
    res.json({
      status: 'ok',
      redis: 'connected',
      instance: process.env.INSTANCE_ID || 'local',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', redis: 'disconnected', error: err.message });
  }
});

// global rate limit — runs first, protects the entire system
app.use(rateLimiter('global'));

// in-memory routes 
app.get('/fixed-window',   rateLimiter('fixed-window'),   (_req, res) => res.json({ algorithm: 'fixed-window',   mode: 'memory' }));
app.get('/sliding-window', rateLimiter('sliding-window'), (_req, res) => res.json({ algorithm: 'sliding-window', mode: 'memory' }));
app.get('/token-bucket',   rateLimiter('token-bucket'),   (_req, res) => res.json({ algorithm: 'token-bucket',   mode: 'memory' }));
app.get('/leaky-bucket',   rateLimiter('leaky-bucket'),   (_req, res) => res.json({ algorithm: 'leaky-bucket',   mode: 'memory' }));

// redis-backed routes
app.get('/redis/fixed-window',   rateLimiter('redis-fixed-window'),   (_req, res) => res.json({ algorithm: 'fixed-window',   mode: 'redis' }));
app.get('/redis/sliding-window', rateLimiter('redis-sliding-window'), (_req, res) => res.json({ algorithm: 'sliding-window', mode: 'redis' }));
app.get('/redis/token-bucket',   rateLimiter('redis-token-bucket'),   (_req, res) => res.json({ algorithm: 'token-bucket',   mode: 'redis' }));
app.get('/redis/leaky-bucket',   rateLimiter('redis-leaky-bucket'),   (_req, res) => res.json({ algorithm: 'leaky-bucket',   mode: 'redis' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
