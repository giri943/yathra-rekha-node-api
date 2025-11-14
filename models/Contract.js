const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  contractName: {
    type: String,
    required: true,
    trim: true
  },
  rate: {
    type: Number,
    required: true
  },
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  averageDistance: {
    type: Number,
    required: true
  },
  contractEndDate: {
    type: Date,
    required: true
  },
  contactPhone: {
    type: String,
    trim: true
  },
  userId: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Contract', contractSchema);