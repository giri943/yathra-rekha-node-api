const mongoose = require('mongoose');

// One driver's "salary pending" message on Telegram, and exactly which trips
// it listed. Its "paid" button marks those trips and no others: a trip saved
// after the message went out was not in what he paid, so it stays owed.
//
// Kept 60 days (TTL), long enough for any button anyone will still press.
const salaryNoticeSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  driverName: {
    type: String,
    required: true
  },
  tripIds: [{ type: mongoose.Schema.Types.ObjectId }],
  amount: {
    type: Number,
    required: true
  },
  // The message as sent (HTML), to rebuild it when a button is pressed.
  text: {
    type: String,
    required: true
  },
  // Every copy sent (owner and son), so all are updated once it is paid.
  messages: [{
    _id: false,
    chatId: Number,
    messageId: Number
  }],
  settledAt: { type: Date, default: null },
  settledBy: { type: String, default: null },
  settledAmount: { type: Number, default: null },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 24 * 60 * 60
  }
});

module.exports = mongoose.model('SalaryNotice', salaryNoticeSchema);
