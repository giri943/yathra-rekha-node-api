const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * passwordChangedAt per user, cached briefly: checking it costs a database
 * read, and every API call passes through here. A password change on this
 * server clears the entry at once (see forgetUser); the TTL only bounds how
 * long a change made elsewhere takes to apply.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function passwordChangedAt(userId) {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const user = await User.findById(userId).select('passwordChangedAt').lean();
  const value = user ? (user.passwordChangedAt || null) : undefined;
  cache.set(userId, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

const auth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  let decoded;
  try {
    // No fallback secret: a missing JWT_SECRET must fail closed, not sign
    // and accept tokens with a value published in this repository.
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ message: 'Token is not valid' });
  }

  try {
    const changedAt = await passwordChangedAt(decoded.userId);
    // undefined: the account no longer exists.
    if (changedAt === undefined) {
      return res.status(401).json({ message: 'Token is not valid' });
    }
    if (changedAt && decoded.iat * 1000 < changedAt.getTime()) {
      return res.status(401).json({ message: 'Token is not valid' });
    }
  } catch (error) {
    return res.status(500).json({ message: 'Server error' });
  }

  req.user = { id: decoded.userId };
  next();
};

/** Drops a user's cached entry after their password or account changes. */
auth.forgetUser = (userId) => cache.delete(String(userId));

module.exports = auth;
