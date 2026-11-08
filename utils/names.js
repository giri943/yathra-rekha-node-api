// Driver names compared the way the owner sees them: case, and runs of
// spaces, don't make two names different ("kesavan " is "Kesavan").
const normaliseName = (name) =>
  String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const sameName = (a, b) => normaliseName(a) === normaliseName(b);

module.exports = { normaliseName, sameName };
