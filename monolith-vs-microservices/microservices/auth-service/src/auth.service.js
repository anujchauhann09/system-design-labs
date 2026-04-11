const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

// Identical logic to monolith/src/auth/auth.service.js
// The difference: this now runs in a SEPARATE PROCESS on its own port.
// Nothing else can call these functions directly — only via HTTP.

async function signup(email, password) {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) throw new Error('Email already registered');

  const hashed = await bcrypt.hash(password, 10);
  const result = await pool.query(
    'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
    [email, hashed]
  );
  return result.rows[0];
}

async function login(email, password) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];

  if (!user) throw new Error('Invalid credentials');

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new Error('Invalid credentials');

  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  return { token, user: { id: user.id, email: user.email } };
}

// NEW: verify endpoint — other services call this to validate a JWT
// In the monolith, authenticate.js did jwt.verify() locally.
// Now any service that needs to verify a token asks auth-service instead.
async function verifyToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return decoded; // { id, email }
}

module.exports = { signup, login, verifyToken };
