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

module.exports = mongoose.model('Trip', tripSchema);