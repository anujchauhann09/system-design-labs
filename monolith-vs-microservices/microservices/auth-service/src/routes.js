const express = require('express');
const { signup, login, verifyToken } = require('./auth.service');

const router = express.Router();

router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const user = await signup(email, password);
    res.status(201).json({ message: 'User created', user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const data = await login(email, password);
    res.json(data);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// NEW endpoint — used by other services to validate tokens
// POST /auth/verify  { token: "..." }  → { id, email }
router.post('/verify', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const decoded = await verifyToken(token);
    res.json(decoded);
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
