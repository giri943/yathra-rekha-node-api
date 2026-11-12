const mongoose = require('mongoose');

// A Telegram chat that receives this account's messages: the owner's, and
// anyone he added (his son). Made only from a one-time code issued to the
// signed-in app (TelegramLinkCode), so nobody can attach themselves.
const telegramLinkSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  // One chat belongs to one account: linking it again moves it.
  chatId: {
    type: Number,
    required: true,
    unique: true
  },
  // The Telegram name, so the app can show who is linked.
  name: {
    type: String,
    trim: true,
    default: ''
  },
  // A document renewal started from a "പുതുക്കി" button, waiting for its new
  // date (then for "yes"). The nonce ties the confirm buttons to this one
  // renewal, so an old message's buttons can't apply a newer date.
  pending: {
    type: {
      _id: false,
      vehicleId: mongoose.Schema.Types.ObjectId,
      field: String,
      date: Date,
      nonce: String,
      expiresAt: Date
    },
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('TelegramLink', telegramLinkSchema);
