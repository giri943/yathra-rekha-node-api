const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const bot = require('../services/telegram/bot');
const api = require('../services/telegram/api');

const router = express.Router();

/** Constant-time comparison of a secret; false when either is missing. */
function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------- called by Telegram

// Telegram sends the secret given at setWebhook in this header; anything
// without it is not from Telegram. Answered at once (Telegram retries slow
// webhooks), then handled.
router.post('/webhook', (req, res) => {
  if (!sameSecret(req.get('x-telegram-bot-api-secret-token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return res.sendStatus(401);
  }
  res.sendStatus(200);
  bot.handleUpdate(req.body || {});
});

// ------------------------------------------------ called by the scheduler

// cron-job.org calls this around 9 AM and 7 PM (Kerala). The key goes in an
// "x-cron-key" header (or ?key= where headers can't be set). Answered at once:
// the scheduler gives up after 30 seconds, and the work carries on.
router.all('/run', (req, res) => {
  const key = req.get('x-cron-key') || req.query.key;
  if (!sameSecret(key, process.env.CRON_SECRET)) return res.sendStatus(401);
  if (!api.isConfigured()) return res.status(503).json({ message: 'Telegram bot not configured' });
  res.status(202).json({ started: true });
  bot.runDueJobs().catch((error) => console.error('Telegram run failed:', error));
});

// ------------------------------------------------------- called by the app

const failed = (res, error) => {
  console.error('Telegram route failed:', error);
  res.status(500).json({ message: 'Telegram: ഇപ്പോൾ നടന്നില്ല. വീണ്ടും ശ്രമിക്കുക.' });
};

const NOT_SET_UP = 'Telegram ഇതുവരെ സെർവറിൽ സജ്ജമാക്കിയിട്ടില്ല.';

// Who is linked and which messages are on.
router.get('/', auth, async (req, res) => {
  try {
    res.json(await bot.status(req.user.id));
  } catch (error) {
    failed(res, error);
  }
});

// A one-time t.me link (15 minutes) for linking a Telegram: his own, or
// sent to someone he wants to add.
router.post('/link', auth, async (req, res) => {
  try {
    if (!api.isConfigured()) return res.status(503).json({ message: NOT_SET_UP });
    res.json(await bot.createLinkCode(req.user.id));
  } catch (error) {
    failed(res, error);
  }
});

router.put('/settings', auth, async (req, res) => {
  try {
    res.json(await bot.updateSettings(req.user.id, req.body || {}));
  } catch (error) {
    failed(res, error);
  }
});

router.delete('/links/:id', auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'കണ്ടെത്തിയില്ല' });
    }
    const removed = await bot.removeLink(req.user.id, req.params.id);
    if (!removed) return res.status(404).json({ message: 'കണ്ടെത്തിയില്ല' });
    res.json(await bot.status(req.user.id));
  } catch (error) {
    failed(res, error);
  }
});

router.post('/test', auth, async (req, res) => {
  try {
    if (!api.isConfigured()) return res.status(503).json({ message: NOT_SET_UP });
    res.json({ sent: await bot.sendTest(req.user.id) });
  } catch (error) {
    failed(res, error);
  }
});

module.exports = router;
