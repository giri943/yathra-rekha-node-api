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