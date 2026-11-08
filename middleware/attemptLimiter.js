/**
 * Counts failed attempts per key in memory and blocks a key that fails too
 * often in a window. Enough for one small server: the goal is to stop a
 * script guessing a 6-character password, not to survive a restart.
 */
module.exports = function attemptLimiter({ max, windowMs }) {
  const failures = new Map();

  const live = (key) => {
    const entry = failures.get(key);
    if (entry && entry.resetAt > Date.now()) return entry;
    failures.delete(key);
    return null;
  };

  return {
    isBlocked(key) {
      const entry = live(key);
      return Boolean(entry && entry.count >= max);
    },
    fail(key) {
      const entry = live(key) || { count: 0, resetAt: Date.now() + windowMs };
      entry.count += 1;
      failures.set(key, entry);
      // Keep memory bounded if something hammers many keys.
      if (failures.size > 10000) failures.clear();
    },
    succeed(key) {
      failures.delete(key);
    },
  };
};
