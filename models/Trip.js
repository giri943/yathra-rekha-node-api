const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema({
  tripType: {
    type: String,
    required: true,
    enum: ['contract', 'savari']
  },
  contractId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contract',
    required: function() { return this.tripType === 'contract'; }
  },
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  clientName: {
    type: String,
    required: true
  },
  clientMobile: {
    type: String
  },
  // Savari discount. tripRate is what was charged, after it; these keep the
  // percentage and the fare before it. Null when no discount was given.
  discountPercent: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  fareBeforeDiscount: {
    type: Number,
    min: 0,
    default: null
  },
  // The driver, by reference. Set on every trip saved since driver ids were
  // introduced; older trips are filled by scripts/backfill-trip-driver-ids.js.
  // It stays set after the driver is deleted, so a new driver given the same
  // name starts with an empty history instead of inheriting the old one's.
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    default: null
  },
  // The driver's name when the trip was saved (kept current on rename). Still
  // what lists and bills show, and what a trip from a deleted driver keeps.
  driverName: {
    type: String,
    required: true
  },
  driverSalary: {
    type: Number,
    required: true
  },
  driverSalaryPaid: {
    type: Boolean,
    default: false
  },
  // When the salary was marked paid from the salary card, so a driver who
  // says "I didn't get it" can be answered. Null for trips marked paid by
  // hand on the trip itself.
  salaryPaidAt: {
    type: Date,
    default: null
  },
  isDriverSalaryManual: {
    type: Boolean,
    default: false
  },
  tripRate: {
    type: Number,
    required: true
  },
  ownerTakeHome: {
    type: Number,
    required: true
  },
  startKm: {
    type: Number,
    required: function() { return this.tripType === 'savari'; }
  },
  endKm: {
    type: Number,
    required: function() { return this.tripType === 'savari'; }
  },
  distance: {
    type: Number,
    required: function() { return this.tripType === 'savari'; }
  },
  fixedRateUsed: {
    type: Number
  },
  perKmRateUsed: {
    type: Number
  },
  additionalKm: {
    type: Number
  },

  // Contract trips that run past the contract's average distance. The pay is
  // fixed, so the extra km are fuel and wear the owner absorbs. The average
  // and cost per km in force when the trip was saved are kept with it, so a
  // later change to either does not rewrite the profit of past trips.
  //
  // An estimate for judging the trip and the contract. It is deliberately NOT
  // subtracted from the dashboard's monthly profit, which already counts the
  // fuel he actually bought; subtracting both would count it twice.
  averageDistanceUsed: {
    type: Number,
    min: 0
  },
  operationalCostUsed: {
    type: Number,
    min: 0
  },
  excessKm: {
    type: Number,
    min: 0
  },
  excessCost: {
    type: Number,
    min: 0
  },
  tripDate: {
    type: Date,
    required: true
  },
  notes: {
    type: String
  },
  userId: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// A driver's history screen and unpaid total.
tripSchema.index({ userId: 1, driverId: 1, tripDate: -1 });

module.exports = mongoose.model('Trip', tripSchema);