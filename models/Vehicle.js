const mongoose = require('mongoose');

/// The comparable form of a registration number: "KL 05 a-8247" and
/// "KL05A8247" are the same vehicle, so uniqueness is checked on this.
const toNumberKey = (vehicleNumber) =>
  String(vehicleNumber).toUpperCase().replace(/[^A-Z0-9]/g, '');

/// An owner's own savari rate. Unset (null) means the classification's applies.
const ownRate = {
  type: Number,
  min: 0,
  default: null,
};

const vehicleSchema = new mongoose.Schema({
  vehicleNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
  },

  /// Set from vehicleNumber by the hooks below; never written directly.
  /// Unique per user rather than globally: two owners can both hold a record
  /// of the same vehicle, and a global index told one account that another
  /// account had registered a number.
  numberKey: {
    type: String,
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

  /// The owner's own savari rates for this vehicle. The classification's
  /// rates are national estimates; his real prices can be far from them
  /// (₹500 + ₹15/km against a Jeep default of ₹250 + ₹22/km), so his win.
  fixedRateFor5Km: ownRate,
  perKmRate: ownRate,
}, {
  timestamps: true,
});

/// Partial, so documents written before numberKey existed (null) cannot
/// collide with each other and block the index build.
vehicleSchema.index(
  { userId: 1, numberKey: 1 },
  { unique: true, partialFilterExpression: { numberKey: { $type: 'string' } } }
);

vehicleSchema.pre('validate', function() {
  if (this.vehicleNumber != null) this.numberKey = toNumberKey(this.vehicleNumber);
});

vehicleSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function() {
  const update = this.getUpdate() || {};
  const vehicleNumber = update.vehicleNumber ?? update.$set?.vehicleNumber;
  if (vehicleNumber != null) this.set('numberKey', toNumberKey(vehicleNumber));
});

/// Automatically populate classification when querying vehicles.
vehicleSchema.pre(/^find/, function() {
  if (!this.getOptions().excludeClassification) {
    this.populate('classificationId', 'type category operationalCostPerKm savariPricing');
  }
});

vehicleSchema.statics.toNumberKey = toNumberKey;

module.exports = mongoose.model('Vehicle', vehicleSchema);