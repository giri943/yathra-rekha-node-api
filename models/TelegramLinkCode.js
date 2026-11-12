const mongoose = require('mongoose');

// A one-time code in a t.me/<bot>?start=<code> link, made by the signed-in
// app. Used once, and gone after 15 minutes (TTL index), so a link forwarded
// or found later cannot attach a stranger's Telegram to the account.
const telegramLinkCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  }
});

telegramLinkCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('TelegramLinkCode', telegramLinkCodeSchema);
