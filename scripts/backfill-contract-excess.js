/**
 * Fills the extra-km fields on contract trips saved before they existed.
 *
 *   node scripts/backfill-contract-excess.js          # dry run: report only
 *   node scripts/backfill-contract-excess.js --apply  # write the changes
 *
 * For each contract trip with a distance and no operationalCostUsed, it takes
 * the contract's current average distance and the vehicle's current running
 * cost per km (his own, else its type's), works out the km past the average
 * and their cost, and lowers ownerTakeHome by that cost.
 *
 * Current values are the best available for old trips; from now on each trip
 * keeps the values in force when it was saved. Trips already filled are
 * skipped, so running it twice changes nothing.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Trip = require('../models/Trip');
const Contract = require('../models/Contract');
const Vehicle = require('../models/Vehicle');
const VehicleClassification = require('../models/VehicleClassification');

const APPLY = process.argv.includes('--apply');

async function main() {
  // autoIndex off, so a dry run reads only.
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  console.log(`Connected. ${APPLY ? 'APPLYING CHANGES.' : 'Dry run — nothing will be written.'}\n`);

  const trips = await Trip.collection.find({
    tripType: 'contract',
    distance: { $gt: 0 },
    operationalCostUsed: { $in: [null] },
  }).toArray();

  const [contracts, vehicles, types] = await Promise.all([
    Contract.collection.find({ _id: { $in: [...new Set(trips.map((t) => t.contractId))] } }).toArray(),
    Vehicle.collection.find({ _id: { $in: [...new Set(trips.map((t) => t.vehicleId))] } }).toArray(),
    VehicleClassification.collection.find().toArray(),
  ]);
  const byId = (list) => new Map(list.map((d) => [String(d._id), d]));
  const contractById = byId(contracts);
  const vehicleById = byId(vehicles);
  const typeById = byId(types);

  const updates = [];
  let skipped = 0;
  for (const trip of trips) {
    const contract = contractById.get(String(trip.contractId));
    const vehicle = vehicleById.get(String(trip.vehicleId));
    const type = vehicle && typeById.get(String(vehicle.classificationId));
    const runningCost = vehicle?.operationalCostPerKm || type?.operationalCostPerKm;
    if (!contract?.averageDistance || !runningCost) {
      skipped++;
      continue;
    }

    const excessKm = Math.max(0, trip.distance - contract.averageDistance);
    const excessCost = Math.round(excessKm * runningCost);
    updates.push({
      trip,
      set: {
        averageDistanceUsed: contract.averageDistance,
        operationalCostUsed: runningCost,
        excessKm,
        excessCost,
        ownerTakeHome: trip.tripRate - trip.driverSalary - excessCost,
      },
    });
  }

  const withExcess = updates.filter((u) => u.set.excessKm > 0);
  console.log(`${trips.length} contract trips without extra-km figures.`);
  console.log(`  ${updates.length} can be filled; ${withExcess.length} of them ran past the average.`);
  if (skipped) console.log(`  ${skipped} skipped: contract or vehicle missing, or no running cost.`);
  withExcess.slice(0, 10).forEach(({ trip, set }) => console.log(
    `    ${trip.tripDate.toISOString().slice(0, 10)}  ${trip.clientName}: ` +
    `${trip.distance} km vs ${set.averageDistanceUsed} avg → ` +
    `${set.excessKm} km × ₹${set.operationalCostUsed} = ₹${set.excessCost}`
  ));
  const total = withExcess.reduce((sum, u) => sum + u.set.excessCost, 0);
  console.log(`  Total extra-km cost: ₹${total}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.');
    return;
  }
  for (const { trip, set } of updates) {
    await Trip.collection.updateOne({ _id: trip._id }, { $set: set });
  }
  console.log(`\nUpdated ${updates.length} trips.`);
}

main()
  .catch((error) => {
    console.error('\nBackfill failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
