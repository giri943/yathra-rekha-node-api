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
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('TelegramLink', telegramLinkSchema);
