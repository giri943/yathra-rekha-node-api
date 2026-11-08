/**
 * Free-text search helpers shared by the list endpoints.
 */

/** Longest query honoured; longer input is cut, not rejected. */
const MAX_QUERY = 50;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The cleaned query from a request, or null when there is nothing to search.
 * Escaped before use, so "+91" or "(KL)" are searched as typed instead of
 * being read as patterns — and a crafted pattern can't make a slow query.
 */
function queryFrom(req) {
  const q = String(req.query.q || '').trim().slice(0, MAX_QUERY);
  return q.length ? q : null;
}

/** Case-insensitive "contains" for one field. */
const containsRegex = (q) => new RegExp(escapeRegex(q), 'i');

/**
 * Vehicles of this user whose number contains the query, compared without
 * spaces or dashes: "kl07" finds "KL 07 AZ 3312".
 */
async function vehicleIdsMatching(Vehicle, userId, q) {
  const key = Vehicle.toNumberKey(q);
  if (key.length < 2) return [];
  return Vehicle.distinct('_id', {
    userId,
    numberKey: { $regex: escapeRegex(key) },
  });
}

module.exports = { queryFrom, containsRegex, vehicleIdsMatching };
