/**
 * Brings vehicle documents in line with the current Vehicle schema.
 *
 *   node scripts/migrate-vehicles.js                      # dry run: report only
 *   node scripts/migrate-vehicles.js --type KL05A8247=Jeep  # override a guess
 *   node scripts/migrate-vehicles.js --apply              # write the changes
 *
 * For every vehicle it:
 *   1. assigns a classification if it has none, guessed from the model and
 *      manufacturer (or given with --type <number>=<Type>, repeatable);
 *   2. keeps the owner's own savari rates where he set them, and clears 0s so
 *      the classification's rates apply instead;
 *   3. fills numberKey, the comparable form of the registration number.
 *
 * Then it syncs indexes: drops the old globally unique vehicleNumber index and
 * builds the per-user one. Run it after the server code that removes the old
 * index is deployed; the old server re-creates it whenever it restarts.
 *
 * Nothing is written without --apply, and --apply first saves every vehicle
 * document as it was to scripts/backups/. It refuses to apply while any
 * vehicle has no type or two of one owner's vehicles share a number.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Vehicle = require('../models/Vehicle');
const VehicleClassification = require('../models/VehicleClassification');
const User = require('../models/User');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

/** --type KL05A8247=Jeep, keyed by numberKey so spacing doesn't matter. */
const typeOverrides = {};
args.forEach((arg, i) => {
  if (arg !== '--type') return;
  const [number, type] = String(args[i + 1] || '').split('=');
  if (!number || !type) {
    console.error(`--type needs <vehicle number>=<Type>, got "${args[i + 1]}"`);
    process.exit(1);
  }
  typeOverrides[Vehicle.toNumberKey(number)] = type.trim();
});

/** First match wins, so the more specific names come first. */
const GUESSES = [
  [/pick\s*-?up|pik\s*-?up/, 'Pickup'],
  [/traveller|\bbus\b|coaster|tourister/, 'Bus'],
  [/mini\s*truck|tata\s*ace|\bace\b|dost|super\s*carry/, 'Mini Truck'],
  [/tempo|\b407\b/, 'Tempo'],
  [/bolero/, 'Bolero'],
  [/jeep|thar|gypsy|\bmajor\b/, 'Jeep'],
  [/\bauto\b|rickshaw|\bape\b/, 'Auto-Rickshaw'],
  [/eeco|omni|\bvan\b|versa/, 'Van'],
  [/innova|ertiga|xylo|marazzo|celerio|swift|dzire|alto|wagon|etios|indica|indigo|amaze|scorpio|\bcar\b|\bi10\b|\bi20\b/, 'Car'],
];

function guessType(vehicle) {
  const haystack = `${vehicle.model || ''} ${vehicle.manufacturer || ''}`.toLowerCase();
  for (const [pattern, type] of GUESSES) {
    const match = haystack.match(pattern);
    if (match) return { type, reason: `"${match[0]}" in "${vehicle.model} ${vehicle.manufacturer}"` };
  }
  return null;
}

const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const ownRate = (n) => (typeof n === 'number' && n > 0 ? n : null);

async function main() {
  // autoIndex off: otherwise loading the models builds their indexes on
  // connect, and a dry run would write to the database.
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  console.log(`Connected. ${APPLY ? 'APPLYING CHANGES.' : 'Dry run — nothing will be written.'}\n`);

  const classifications = await VehicleClassification.find().lean();
  const byType = new Map(classifications.map((c) => [c.type.toLowerCase(), c]));
  const byId = new Map(classifications.map((c) => [String(c._id), c]));

  // The raw collection, so the populate hook and setters don't reshape what
  // is actually stored.
  const collection = Vehicle.collection;
  const vehicles = await collection.find().sort({ userId: 1, createdAt: 1 }).toArray();

  const users = await User.find({ _id: { $in: [...new Set(vehicles.map((v) => v.userId))] } })
    .select('email name')
    .lean();
  const userLabel = new Map(users.map((u) => [String(u._id), u.email || u.name || String(u._id)]));

  const plans = [];
  const unresolved = [];

  for (const v of vehicles) {
    const numberKey = Vehicle.toNumberKey(v.vehicleNumber);
    const set = {};
    const notes = [];

    let classification = v.classificationId ? byId.get(String(v.classificationId)) : null;
    if (!classification) {
      const override = typeOverrides[numberKey];
      const guess = override ? { type: override, reason: 'given with --type' } : guessType(v);
      classification = guess && byType.get(guess.type.toLowerCase());
      if (!classification) {
        unresolved.push(v);
        notes.push(guess
          ? `type "${guess.type}" does not exist — known: ${classifications.map((c) => c.type).join(', ')}`
          : 'no type could be guessed — pass --type');
      } else {
        set.classificationId = classification._id;
        notes.push(`type → ${classification.type} (${guess.reason})`);
      }
    }

    if (v.numberKey !== numberKey) set.numberKey = numberKey;

    const fixed = ownRate(v.fixedRateFor5Km);
    const perKm = ownRate(v.perKmRate);
    if (v.fixedRateFor5Km !== fixed) set.fixedRateFor5Km = fixed;
    if (v.perKmRate !== perKm) set.perKmRate = perKm;

    if (classification) {
      const d = classification.savariPricing;
      if (fixed || perKm) {
        notes.push(
          `keeps his rate ${money(fixed ?? d.fixedRateFor5Km)} + ${money(perKm ?? d.perKmRate)}/km` +
          ` (type default ${money(d.fixedRateFor5Km)} + ${money(d.perKmRate)}/km)`
        );
      } else {
        notes.push(`no own rate — type default ${money(d.fixedRateFor5Km)} + ${money(d.perKmRate)}/km applies`);
      }
    }

    plans.push({ v, numberKey, set, notes });
  }

  // ------------------------------------------------------------------ report
  let currentUser = null;
  for (const { v, set, notes } of plans) {
    if (v.userId !== currentUser) {
      currentUser = v.userId;
      console.log(`\n${userLabel.get(v.userId) || v.userId}`);
    }
    const changed = Object.keys(set).length ? '' : '  (already up to date)';
    console.log(`  ${v.vehicleNumber} — ${v.manufacturer} ${v.model}${changed}`);
    notes.forEach((n) => console.log(`      ${n}`));
  }

  const seen = new Map();
  const duplicates = [];
  for (const { v, numberKey } of plans) {
    const key = `${v.userId}|${numberKey}`;
    if (seen.has(key)) duplicates.push([seen.get(key), v]);
    else seen.set(key, v);
  }

  const { toDrop, toCreate } = await Vehicle.diffIndexes();
  console.log('\nIndexes');
  console.log(`  drop:   ${toDrop.length ? toDrop.join(', ') : '—'}`);
  console.log(`  create: ${toCreate.length ? toCreate.map((i) => JSON.stringify(i)).join(', ') : '—'}`);

  const toWrite = plans.filter((p) => Object.keys(p.set).length);
  console.log(`\n${toWrite.length} of ${plans.length} vehicles need changes.`);

  if (duplicates.length) {
    console.log('\nThe same owner has these numbers twice. Delete or correct one of each first:');
    duplicates.forEach(([a, b]) => console.log(`  ${a.vehicleNumber} (${a._id})  =  ${b.vehicleNumber} (${b._id})`));
  }
  if (unresolved.length) {
    console.log(`\n${unresolved.length} vehicle(s) have no type. Pass --type "<number>=<Type>" for each.`);
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.');
    return;
  }
  if (duplicates.length || unresolved.length) {
    console.log('\nNot applying until the problems above are fixed.');
    process.exitCode = 1;
    return;
  }

  // ------------------------------------------------------------------- apply
  const backupDir = path.join(__dirname, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `vehicles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(vehicles, null, 2));
  console.log(`\nBacked up ${vehicles.length} vehicle documents to ${backupFile}`);

  for (const { v, set } of toWrite) {
    await collection.updateOne({ _id: v._id }, { $set: set });
  }
  console.log(`Updated ${toWrite.length} vehicles.`);

  const dropped = await Vehicle.syncIndexes();
  console.log(`Indexes synced${dropped.length ? `; dropped ${dropped.join(', ')}` : ''}.`);
}

main()
  .catch((error) => {
    console.error('\nMigration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
