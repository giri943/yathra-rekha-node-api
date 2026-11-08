/**
 * Links trips saved before driver ids to their driver.
 *
 *   node scripts/backfill-trip-driver-ids.js          # dry run: report only
 *   node scripts/backfill-trip-driver-ids.js --apply  # write the changes
 *
 * For each trip with no driverId, finds the owner's driver whose name matches
 * the trip's driverName (ignoring case and extra spaces) and sets driverId.
 * Names matching no driver (deleted drivers) or several are left alone and
 * listed. Trips already linked are skipped, so running it twice changes nothing.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Trip = require('../models/Trip');
const Driver = require('../models/Driver');
const { normaliseName } = require('../utils/names');

const APPLY = process.argv.includes('--apply');

async function main() {
  // autoIndex off, so a dry run reads only.
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  console.log(`Connected. ${APPLY ? 'APPLYING CHANGES.' : 'Dry run — nothing will be written.'}\n`);

  const [trips, drivers] = await Promise.all([
    Trip.collection.find({ driverId: { $in: [null] } }, { projection: { userId: 1, driverName: 1 } }).toArray(),
    Driver.collection.find({}, { projection: { userId: 1, name: 1 } }).toArray(),
  ]);

  // userId + normalised name → driver ids with that name.
  const byName = new Map();
  for (const d of drivers) {
    const key = `${d.userId}|${normaliseName(d.name)}`;
    byName.set(key, [...(byName.get(key) || []), d._id]);
  }

  const toDriver = new Map(); // driver id → trip ids
  const unmatched = new Map(); // "user|name" → count
  const ambiguous = new Map();
  for (const trip of trips) {
    const key = `${trip.userId}|${normaliseName(trip.driverName)}`;
    const ids = byName.get(key) || [];
    if (ids.length === 1) {
      const id = String(ids[0]);
      toDriver.set(id, [...(toDriver.get(id) || []), trip._id]);
    } else {
      const bucket = ids.length ? ambiguous : unmatched;
      bucket.set(key, (bucket.get(key) || 0) + 1);
    }
  }

  const linkable = [...toDriver.values()].reduce((n, ids) => n + ids.length, 0);
  console.log(`${trips.length} trips without a driverId.`);
  console.log(`  ${linkable} can be linked, to ${toDriver.size} drivers.`);
  const report = (label, map) => {
    if (!map.size) return;
    console.log(`  ${[...map.values()].reduce((a, b) => a + b, 0)} ${label}:`);
    for (const [key, count] of map) console.log(`    "${key.split('|')[1]}": ${count} trips`);
  };
  report('left as they are, no driver with that name (deleted?)', unmatched);
  report('left as they are, several drivers with that name', ambiguous);

  if (APPLY && linkable) {
    let modified = 0;
    for (const [driverId, tripIds] of toDriver) {
      const result = await Trip.collection.updateMany(
        { _id: { $in: tripIds }, driverId: { $in: [null] } },
        { $set: { driverId: new mongoose.Types.ObjectId(driverId) } }
      );
      modified += result.modifiedCount;
    }
    console.log(`\nLinked ${modified} trips.`);
  } else if (linkable) {
    console.log('\nRun again with --apply to write these.');
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
