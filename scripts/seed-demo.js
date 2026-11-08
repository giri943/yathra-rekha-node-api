/**
 * Seeds realistic demo data for one user so every screen can be exercised.
 *
 *   node scripts/seed-demo.js --email soman@gmail.com
 *   node scripts/seed-demo.js --email soman@gmail.com --undo
 *
 * Only ever ADDS documents, and records every created _id in
 * scripts/seed-demo-ids.json so --undo can remove exactly what it created and
 * nothing else. It never deletes or edits pre-existing records.
 *
 * Dates are generated relative to today, so the current month always has data.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const VehicleClassification = require('../models/VehicleClassification');
const Contract = require('../models/Contract');
const Driver = require('../models/Driver');
const Trip = require('../models/Trip');
const Expense = require('../models/Expense');

const ID_FILE = path.join(__dirname, 'seed-demo-ids.json');

const args = process.argv.slice(2);
const emailArg = args.indexOf('--email');
const EMAIL = (emailArg !== -1 ? args[emailArg + 1] : 'soman@gmail.com').toLowerCase();
const UNDO = args.includes('--undo');

const day = 24 * 60 * 60 * 1000;
const today = new Date();

/** A date `n` days from today, at midday to dodge timezone edges. */
const daysFromNow = (n) => {
  const d = new Date(today.getTime() + n * day);
  d.setHours(12, 0, 0, 0);
  return d;
};

/**
 * A date inside the month `monthsBack` before this one, never after today.
 * In the running month the day is clamped to today: trips dated next week
 * would inflate "this month" and break the month-to-date comparison.
 */
const inMonth = (monthsBack, dayOfMonth) => {
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() - monthsBack + 1, 0).getDate();
  const lastDay = monthsBack === 0 ? today.getDate() : daysInMonth;
  return new Date(
    today.getFullYear(), today.getMonth() - monthsBack, Math.min(dayOfMonth, lastDay), 12, 0, 0
  );
};

/**
 * The day for item `i` of `count`, spread evenly over the days the month has
 * had so far: the whole month for past months, up to today for this one.
 */
const spreadDay = (monthsBack, i, count) => {
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() - monthsBack + 1, 0).getDate();
  const days = monthsBack === 0 ? today.getDate() : daysInMonth;
  return 1 + Math.floor((i * days) / Math.max(count, 1));
};

const round = (n) => Math.round(n);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  if (UNDO) return undo();
  return seed();
}

async function undo() {
  if (!fs.existsSync(ID_FILE)) {
    console.log('Nothing to undo: no seed-demo-ids.json found.');
    return;
  }

  const ids = JSON.parse(fs.readFileSync(ID_FILE, 'utf8'));
  const models = { Vehicle, Contract, Driver, Trip, Expense };

  for (const [name, list] of Object.entries(ids.created || {})) {
    if (!list.length) continue;
    const result = await models[name].deleteMany({ _id: { $in: list } });
    console.log(`${name}: removed ${result.deletedCount}`);
  }

  fs.unlinkSync(ID_FILE);
  console.log('\nDemo data removed. Pre-existing records were untouched.');
}

async function seed() {
  const user = await User.findOne({ email: EMAIL });
  if (!user) {
    console.error(`No user with email ${EMAIL}. Register in the app first.`);
    process.exitCode = 1;
    return;
  }

  const userId = user._id.toString();
  console.log(`Seeding for ${user.name || EMAIL} (${userId})\n`);

  const created = { Vehicle: [], Contract: [], Driver: [], Trip: [], Expense: [] };

  // ---------------------------------------------------------------- vehicles
  // Document dates are spread deliberately so the dashboard shows all three
  // states at once: expired, expiring soon, and fine.
  const vehicleSpecs = [
    {
      vehicleNumber: 'KL 07 AZ 3312',
      model: 'Innova Crysta',
      type: 'Car',
      manufacturer: 'Toyota',
      insuranceExpiry: daysFromNow(-18), // expired
      taxDate: daysFromNow(12), // due soon
      testDate: daysFromNow(210),
      pollutionDate: daysFromNow(95),
      fixedRateFor5Km: 350,
      perKmRate: 22
    },
    {
      vehicleNumber: 'KL 07 BX 7788',
      model: 'Traveller 26S',
      type: 'Bus',
      manufacturer: 'Force',
      insuranceExpiry: daysFromNow(140),
      taxDate: daysFromNow(24), // due soon
      testDate: daysFromNow(60),
      pollutionDate: daysFromNow(-5), // expired
      fixedRateFor5Km: 600,
      perKmRate: 35
    },
    {
      vehicleNumber: 'KL 07 CD 1045',
      model: 'Eeco',
      type: 'Van',
      manufacturer: 'Maruti',
      insuranceExpiry: daysFromNow(300),
      taxDate: daysFromNow(280),
      testDate: daysFromNow(190),
      pollutionDate: daysFromNow(160),
      // No own rate: savari trips use the Van type's default.
    }
  ];

  const vehicles = [];
  /** vehicle _id → the rates a savari trip is priced at: his own, else the type's. */
  const savariRates = new Map();
  for (const { type, ...spec } of vehicleSpecs) {
    // vehicleNumber is unique per user, so reuse an existing row rather than
    // failing the whole seed.
    let vehicle = await Vehicle.findOne({
      userId,
      numberKey: Vehicle.toNumberKey(spec.vehicleNumber),
    });
    if (vehicle) {
      console.log(`  vehicle ${spec.vehicleNumber} already exists — reusing`);
    } else {
      const classification = await VehicleClassification.findOne({ type });
      if (!classification) {
        throw new Error(`No "${type}" classification — run scripts/seed-classifications.js first`);
      }
      vehicle = await Vehicle.create({ ...spec, classificationId: classification._id, userId });
      created.Vehicle.push(vehicle._id);
    }
    const type = await VehicleClassification.findById(vehicle.classificationId);
    savariRates.set(vehicle._id.toString(), {
      fixed: vehicle.fixedRateFor5Km || type.savariPricing.fixedRateFor5Km,
      perKm: vehicle.perKmRate || type.savariPricing.perKmRate,
      runningCost: vehicle.operationalCostPerKm || type.operationalCostPerKm,
    });
    vehicles.push(vehicle);
  }
  console.log(`Vehicles: ${vehicles.length}`);

  // --------------------------------------------------------------- contracts
  const contractSpecs = [
    {
      contractName: 'സെന്റ് മേരീസ് സ്കൂൾ',
      rate: 1800,
      vehicleId: vehicles[1]._id,
      averageDistance: 42,
      contractEndDate: daysFromNow(240),
      contactPhone: '9846512378'
    },
    {
      contractName: 'ഗ്രീൻ വാലി റിസോർട്ട്',
      rate: 2600,
      vehicleId: vehicles[0]._id,
      averageDistance: 65,
      contractEndDate: daysFromNow(21), // ending soon
      contactPhone: '9895543210'
    },
    {
      contractName: 'കൊച്ചിൻ ടെക് പാർക്ക്',
      rate: 1500,
      vehicleId: vehicles[2]._id,
      averageDistance: 30,
      contractEndDate: daysFromNow(-40), // expired
      contactPhone: '9847001122'
    }
  ];

  const contracts = [];
  for (const spec of contractSpecs) {
    const contract = await Contract.create({ ...spec, userId });
    created.Contract.push(contract._id);
    contracts.push(contract);
  }
  console.log(`Contracts: ${contracts.length}`);

  // ----------------------------------------------------------------- drivers
  // Ten-digit numbers so the call and WhatsApp buttons are usable.
  const driverSpecs = [
    { name: 'Kesavan', phone: '9846123456' },
    { name: 'Pramod', phone: '9895234567' },
    { name: 'Suresh Kumar', phone: '9847345678' },
    { name: 'Anil', phone: '9744456789' },
    { name: 'Vinod', phone: '9605567890' }
  ];

  const drivers = [];
  for (const spec of driverSpecs) {
    const driver = await Driver.create({ ...spec, userId });
    created.Driver.push(driver._id);
    drivers.push(driver);
  }
  console.log(`Drivers: ${drivers.length}`);

  // ------------------------------------------------------------------- trips
  const savariClients = [
    'രമേശൻ',
    'ഫാത്തിമ ബീവി',
    'ജോസഫ് വർഗീസ്',
    'ലക്ഷ്മി അമ്മ',
    'അബ്ദുൾ റഹിമാൻ',
    'ശ്രീജിത്ത്'
  ];

  const trips = [];

  // Three months of history so the month stepper has somewhere to go.
  for (let monthsBack = 0; monthsBack <= 2; monthsBack++) {
    // Volume tapers off in older months, so the dashboard's month-on-month
    // comparison has a real change to report instead of a flat line.
    const contractTrips = 9 - monthsBack;
    const savariTrips = 7 - monthsBack * 2;

    // Contract trips.
    for (let i = 0; i < contractTrips; i++) {
      const tripDate = inMonth(monthsBack, spreadDay(monthsBack, i, contractTrips));
      // A trip can't be on a contract that had already ended.
      const running = contracts.filter((c) => c.contractEndDate >= tripDate);
      const contract = running[i % running.length];
      const vehicle = vehicles.find(
        (v) => v._id.toString() === contract.vehicleId.toString()
      );
      const driver = drivers[i % drivers.length];

      const startKm = 12000 + monthsBack * 900 + i * 60;
      const distance = round(contract.averageDistance + (i % 3) * 6 - 4);
      const rate = contract.rate;
      const salary = round(rate * 0.25);
      // Km past the contract's average cost fuel and wear the fixed rate
      // doesn't cover; the app deducts them from the trip's profit.
      const runningCost = savariRates.get(vehicle._id.toString()).runningCost;
      const excessKm = Math.max(0, distance - contract.averageDistance);
      const excessCost = round(excessKm * runningCost);

      trips.push({
        tripType: 'contract',
        contractId: contract._id,
        vehicleId: vehicle._id,
        clientName: contract.contractName,
        clientMobile: contract.contactPhone,
        driverName: driver.name,
        driverSalary: salary,
        // Older months settled; some of this month still outstanding.
        driverSalaryPaid: monthsBack > 0 || i % 3 !== 0,
        isDriverSalaryManual: false,
        tripRate: rate,
        ownerTakeHome: rate - salary - excessCost,
        startKm,
        endKm: startKm + distance,
        distance,
        averageDistanceUsed: contract.averageDistance,
        operationalCostUsed: runningCost,
        excessKm,
        excessCost,
        tripDate,
        notes: i % 4 === 0 ? 'രാവിലത്തെ ട്രിപ്പ്' : undefined,
        userId
      });
    }

    // Savari trips, priced from the vehicle's own rates.
    for (let i = 0; i < savariTrips; i++) {
      const vehicle = vehicles[i % vehicles.length];
      const rates = savariRates.get(vehicle._id.toString());
      const driver = drivers[(i + 2) % drivers.length];

      const startKm = 30000 + monthsBack * 700 + i * 45;
      const distance = 4 + i * 3;
      const additionalKm = distance > 5 ? distance - 5 : 0;
      const rate = round(rates.fixed + additionalKm * rates.perKm);
      const salary = round(rate * 0.25);

      trips.push({
        tripType: 'savari',
        vehicleId: vehicle._id,
        clientName: savariClients[(i + monthsBack) % savariClients.length],
        clientMobile: `98${46000000 + i * 13571 + monthsBack * 907}`.slice(0, 10),
        driverName: driver.name,
        driverSalary: salary,
        driverSalaryPaid: monthsBack > 0 || i % 4 !== 0,
        isDriverSalaryManual: false,
        tripRate: rate,
        ownerTakeHome: rate - salary,
        startKm,
        endKm: startKm + distance,
        distance,
        fixedRateUsed: rates.fixed,
        perKmRateUsed: rates.perKm,
        additionalKm,
        tripDate: inMonth(monthsBack, spreadDay(monthsBack, i, savariTrips)),
        userId
      });
    }
  }

  const savedTrips = await Trip.insertMany(trips);
  created.Trip.push(...savedTrips.map((t) => t._id));
  console.log(`Trips: ${savedTrips.length}`);

  // ---------------------------------------------------------------- expenses
  const expenses = [];
  for (let monthsBack = 0; monthsBack <= 2; monthsBack++) {
    // Fuel a few times a month. Kept to roughly a quarter of revenue so the
    // demo shows a plausible margin — an over-fuelled month would read as a
    // bug in the profit calculation rather than as data.
    for (let i = 0; i < 3; i++) {
      const vehicle = vehicles[i % vehicles.length];
      const litres = 14 + i * 5;

      expenses.push({
        category: 'fuel',
        amount: round(litres * 101),
        quantity: litres,
        odometer: 30500 + monthsBack * 800 + i * 130,
        vehicleId: vehicle._id,
        expenseDate: inMonth(monthsBack, 3 + i * 7),
        userId
      });
    }

    // Not every month: repairs are lumpy, and a flat monthly figure would
    // hide that the month-on-month comparison actually works.
    if (monthsBack !== 1) {
      expenses.push({
        category: 'maintenance',
        amount: 1800 + monthsBack * 300,
        vehicleId: vehicles[0]._id,
        notes: 'ഓയിൽ മാറ്റം, ബ്രേക്ക് പരിശോധന',
        expenseDate: inMonth(monthsBack, 12),
        userId
      });
    }

    if (monthsBack === 2) {
      expenses.push({
        category: 'spareParts',
        amount: 1650,
        vehicleId: vehicles[1]._id,
        notes: 'ടയർ',
        expenseDate: inMonth(monthsBack, 18),
        userId
      });
    }

    // Annual costs land in one month only — that is what makes them worth
    // seeing separately from fuel.
    if (monthsBack === 2) {
      expenses.push({
        category: 'insurance',
        amount: 8400,
        vehicleId: vehicles[1]._id,
        expenseDate: inMonth(2, 8),
        userId
      });
      expenses.push({
        category: 'tax',
        amount: 3600,
        vehicleId: vehicles[0]._id,
        expenseDate: inMonth(2, 20),
        userId
      });
    }
  }

  expenses.push({
    category: 'other',
    amount: 900,
    notes: 'ഓഫീസ് ചെലവ്',
    expenseDate: inMonth(0, 6),
    userId
  });

  const savedExpenses = await Expense.insertMany(expenses);
  created.Expense.push(...savedExpenses.map((e) => e._id));
  console.log(`Expenses: ${savedExpenses.length}`);

  fs.writeFileSync(
    ID_FILE,
    JSON.stringify({ email: EMAIL, seededAt: new Date(), created }, null, 2)
  );

  console.log('\nDone. Undo with:  node scripts/seed-demo.js --undo');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
