const mongoose = require('mongoose');

/// Costs of running the business other than driver salary.
///
/// Driver salary is recorded on the trip itself, because it is derived from
/// that trip's rate. Everything here is a standalone cost — fuel, repairs,
/// parts, tax, insurance — that has to be subtracted before "profit" means
/// anything real.
const EXPENSE_CATEGORIES = [
  'fuel',
  'maintenance',
  'spareParts',
  'insurance',
  'tax',
  'other'
];

const expenseSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    enum: EXPENSE_CATEGORIES
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  expenseDate: {
    type: Date,
    required: true
  },
  // Optional: some costs (an accountant's fee, say) belong to the business
  // rather than to one vehicle.
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle'
  },
  // Litres for fuel, so cost per litre stays reconstructable later.
  quantity: {
    type: Number,
    min: 0
  },
  odometer: {
    type: Number,
    min: 0
  },
  notes: {
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

// The dashboard always filters by owner and date range.
expenseSchema.index({ userId: 1, expenseDate: -1 });

module.exports = mongoose.model('Expense', expenseSchema);
module.exports.CATEGORIES = EXPENSE_CATEGORIES;
