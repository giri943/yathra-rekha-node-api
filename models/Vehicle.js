const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
  vehicleNumber: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  model: {
    type: String,
    required: true,
    trim: true
  },
  manufacturer: {
    type: String,
    required: true,
    trim: true
  },
  insuranceExpiry: {
    type: Date,
    required: true
  },
  taxDate: {
    type: Date,
    required: true
  },
  testDate: {
    type: Date,
    required: true
  },
  pollutionDate: {
    type: Date,
    required: true
  },
  userId: {
    type: String,
    required: true,
    index: true,
  },

  /// Reference to system vehicle classification (Pickup, Jeep, etc).
  /// Carries rates and operational costs.
  classificationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VehicleClassification',
    required: true,
    index: true,
  },
}, {
  timestamps: true,
});

/// Automatically populate classification when querying vehicles.
vehicleSchema.pre(/^find/, function() {
  if (!this.getOptions().excludeClassification) {
    this.populate('classificationId', 'type category operationalCostPerKm savariPricing');
  }
});

module.exports = mongoose.model('Vehicle', vehicleSchema);