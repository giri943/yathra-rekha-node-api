const mongoose = require('mongoose');

const vehicleClassificationSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ['Goods Carriers', 'Passenger Carriers', 'Commercial'],
      required: true,
      index: true,
    },

    type: {
      type: String,
      required: true,
      trim: true,
    },

    /// Fuel and wear-and-tear cost per km. Used to calculate profit impact
    /// when a trip exceeds the contract's average distance.
    operationalCostPerKm: {
      type: Number,
      required: true,
      min: 0,
    },

    /// For savari trips, the pricing model.
    savariPricing: {
      fixedRateFor5Km: {
        type: Number,
        required: true,
        min: 0,
      },
      perKmRate: {
        type: Number,
        required: true,
        min: 0,
      },
    },

    /// Display metadata
    icon: {
      type: String,
      default: 'local_shipping',
    },

    displayOrder: {
      type: Number,
      default: 999,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

/// Compound index to prevent duplicates within a category.
vehicleClassificationSchema.index({ category: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('VehicleClassification', vehicleClassificationSchema);
