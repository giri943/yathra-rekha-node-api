const mongoose = require('mongoose');

// Which Telegram messages an account gets, and what was last sent.
//
// `sent` holds the day (or month) each scheduled message last went out, in
// Kerala time: the scheduler is called more than once around each time (the
// free server may be asleep for the first call), and must send only once.
const telegramSettingsSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  documents: { type: Boolean, default: true },
  salary: { type: Boolean, default: true },
  monthly: { type: Boolean, default: true },
  evening: { type: Boolean, default: true },
  sent: {
    documents: { type: String, default: null }, // "2026-11-12"
    salary: { type: String, default: null },    // "2026-11-12"
    monthly: { type: String, default: null },   // "2026-11"
    evening: { type: String, default: null }    // "2026-11-12"
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('TelegramSettings', telegramSettingsSchema);
