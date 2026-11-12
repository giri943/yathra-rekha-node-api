// The Yathra Rekha Telegram bot: linking chats to an account, the scheduled
// messages (documents and contracts 9 AM, salary 7 PM, the day at 8:30 PM,
// last month's report, bills and driver statements on the 1st), the "paid"
// button on salary messages, renewing a document from its reminder, and the
// quick-ask buttons.
//
// Wording lives in ./format.js; this file only reads and writes data and
// talks to Telegram.

const crypto = require('crypto');
const api = require('./api');
const fmt = require('./format');
const TelegramLink = require('../../models/TelegramLink');
const TelegramLinkCode = require('../../models/TelegramLinkCode');
const TelegramSettings = require('../../models/TelegramSettings');
const SalaryNotice = require('../../models/SalaryNotice');
const Trip = require('../../models/Trip');
const Vehicle = require('../../models/Vehicle');
const Contract = require('../../models/Contract');
const Driver = require('../../models/Driver');
const { buildDashboard } = require('../businessSummary');
const { contractBillPdf, contractsWithTrips } = require('../contractBillPdf');
const { businessNow } = require('../../utils/clock');
const { normaliseName } = require('../../utils/names');

const LINK_CODE_MINUTES = 15;

// ------------------------------------------------------------------ sending

/**
 * Sends to one chat. A chat that blocked the bot or was deleted is unlinked,
 * so it stops being tried and disappears from the app's list. Never throws:
 * one bad chat must not stop the others.
 */
async function safeSend(chatId, text, extra) {
  try {
    return await api.sendMessage(chatId, text, extra);
  } catch (error) {
    if (error instanceof api.TelegramError && error.chatGone) {
      await TelegramLink.deleteOne({ chatId });
      console.warn(`Telegram chat ${chatId} is gone; unlinked`);
    } else {
      console.error('Telegram send failed:', error.message);
    }
    return null;
  }
}

/** Sends to every chat; returns the copies that arrived. */
async function sendToChats(chats, text, extra) {
  const sent = [];
  for (const chat of chats) {
    const message = await safeSend(chat.chatId, text, extra);
    if (message) sent.push({ chatId: chat.chatId, messageId: message.message_id });
  }
  return sent;
}

async function safeEdit(chatId, messageId, text, extra) {
  try {
    await api.editMessageText(chatId, messageId, text, extra);
  } catch (error) {
    if (!(error instanceof api.TelegramError && error.notModified)) {
      console.error('Telegram edit failed:', error.message);
    }
  }
}

const chatsOf = (userId) => TelegramLink.find({ userId }).lean();

// ------------------------------------------------------------------ linking

/** A one-time t.me link that links whoever opens it to [userId]. */
async function createLinkCode(userId) {
  // 24 characters of [A-Za-z0-9_-], as Telegram's start parameter allows.
  const code = crypto.randomBytes(18).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60 * 1000);
  await TelegramLinkCode.create({ code, userId, expiresAt });
  return { url: `https://t.me/${api.botUsername()}?start=${code}`, expiresAt };
}

async function linkChat(code, message) {
  const chatId = message.chat.id;
  const codeDoc = await TelegramLinkCode.findOneAndDelete({
    code,
    expiresAt: { $gt: new Date() }
  });
  if (!codeDoc) return safeSend(chatId, fmt.LINK_EXPIRED);

  const userId = codeDoc.userId;
  const name = fmt.chatName(message.from || message.chat);
  const others = await TelegramLink.find({ userId, chatId: { $ne: chatId } }).lean();

  await TelegramLink.findOneAndUpdate(
    { chatId },
    { $set: { userId, name } },
    { upsert: true }
  );
  await TelegramSettings.updateOne({ userId }, { $setOnInsert: { userId } }, { upsert: true });

  await safeSend(chatId, fmt.WELCOME, { reply_markup: fmt.QUICK_KEYBOARD });
  // Everyone already linked hears about a new member: a link sent to the
  // wrong person is noticed at once.
  if (others.length > 0) await sendToChats(others, fmt.newMemberText(name));
}

// ---------------------------------------------------------------- documents

/** Vehicle documents and contracts ending, in one message. */
async function sendDocuments(userId, chats, { all = false, now = businessNow() } = {}) {
  const [vehicles, contracts] = await Promise.all([
    Vehicle.find({ userId })
      .select('vehicleNumber insuranceExpiry taxDate testDate pollutionDate')
      .setOptions({ excludeClassification: true })
      .lean(),
    Contract.find({ userId }).select('contractName contractEndDate').lean()
  ]);
  const due = fmt.documentsDue(vehicles, now, { all });
  const contractsDue = fmt.contractsDue(contracts, now, { all });
  // The morning message only when something is due; the button always answers.
  if (!all && due.length === 0 && contractsDue.length === 0) return 0;
  const keyboard = fmt.renewKeyboard(due);
  await sendToChats(
    chats,
    fmt.documentsMessage(due, { all, contracts: contractsDue }),
    keyboard ? { reply_markup: keyboard } : undefined
  );
  return due.length + contractsDue.length;
}

// ------------------------------------------------------------------- renew
//
// "പുതുക്കി" on a document → the bot asks for the new date → he types it →
// the bot repeats it spelt out and asks "ശരിയാണോ?" → on yes the vehicle is
// updated and everyone linked is told. Waiting state lives on the chat's
// TelegramLink (pending) for 30 minutes.

const RENEW_MINUTES = 30;

const renewWaiting = (link) =>
  Boolean(link.pending && link.pending.expiresAt && new Date(link.pending.expiresAt) > new Date());

const askForDate = (chatId, vehicleNumber, field) => safeSend(
  chatId,
  fmt.renewPrompt(vehicleNumber, field),
  { reply_markup: { force_reply: true, input_field_placeholder: 'ഉദാ: 17/11/2027' } }
);

async function startRenewal(link, chatId, { field, vehicleId }) {
  const vehicle = await Vehicle.findOne({ _id: vehicleId, userId: link.userId })
    .select('vehicleNumber')
    .setOptions({ excludeClassification: true })
    .lean();
  if (!vehicle) return 'ഈ വാഹനം ഇപ്പോൾ ഇല്ല';

  await TelegramLink.updateOne({ _id: link._id }, {
    $set: {
      pending: {
        vehicleId,
        field,
        date: null,
        nonce: crypto.randomBytes(4).toString('hex'),
        expiresAt: new Date(Date.now() + RENEW_MINUTES * 60 * 1000)
      }
    }
  });
  await askForDate(chatId, vehicle.vehicleNumber, field);
  return null;
}

/** He typed something while a renewal waits for its date. */
async function renewalReply(link, chatId, text) {
  if (fmt.isCancelWord(text)) {
    await TelegramLink.updateOne({ _id: link._id }, { $set: { pending: null } });
    return safeSend(chatId, fmt.RENEW_CANCELLED, { reply_markup: fmt.QUICK_KEYBOARD });
  }

  const pending = link.pending;
  const vehicle = await Vehicle.findOne({ _id: pending.vehicleId, userId: link.userId })
    .select('vehicleNumber')
    .setOptions({ excludeClassification: true })
    .lean();
  if (!vehicle) {
    await TelegramLink.updateOne({ _id: link._id }, { $set: { pending: null } });
    return safeSend(chatId, 'ഈ വാഹനം ഇപ്പോൾ ഇല്ല.', { reply_markup: fmt.QUICK_KEYBOARD });
  }

  const parsed = fmt.parseExpiryDate(text, businessNow());
  if (parsed.error) {
    return safeSend(chatId, `⚠️ ${parsed.error}`, {
      reply_markup: { force_reply: true, input_field_placeholder: 'ഉദാ: 17/11/2027' }
    });
  }

  await TelegramLink.updateOne({ _id: link._id }, { $set: { 'pending.date': parsed.date } });
  return safeSend(chatId, fmt.renewConfirmText(vehicle.vehicleNumber, pending.field, parsed.date), {
    reply_markup: fmt.renewConfirmKeyboard(pending.nonce)
  });
}

/** The confirm buttons: yes (save), change (ask again), cancel. */
async function answerRenewal(link, query, { action, nonce }) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const current = await TelegramLink.findById(link._id).lean();
  const pending = current?.pending;

  if (!pending || pending.nonce !== nonce || !renewWaiting(current)) {
    await safeEdit(chatId, messageId, fmt.RENEW_STALE);
    return fmt.RENEW_STALE;
  }

  if (action === 'cancel') {
    await TelegramLink.updateOne({ _id: link._id }, { $set: { pending: null } });
    await safeEdit(chatId, messageId, fmt.RENEW_CANCELLED);
    return null;
  }

  const vehicle = await Vehicle.findOne({ _id: pending.vehicleId, userId: link.userId })
    .select('vehicleNumber')
    .setOptions({ excludeClassification: true })
    .lean();
  if (!vehicle) {
    await TelegramLink.updateOne({ _id: link._id }, { $set: { pending: null } });
    await safeEdit(chatId, messageId, 'ഈ വാഹനം ഇപ്പോൾ ഇല്ല.');
    return null;
  }

  if (action === 'change' || !pending.date) {
    await TelegramLink.updateOne({ _id: link._id }, { $set: { 'pending.date': null } });
    await safeEdit(chatId, messageId, '✏️ ശരി, ശരിയായ തീയതി വീണ്ടും അയക്കുക.');
    await askForDate(chatId, vehicle.vehicleNumber, pending.field);
    return null;
  }

  if (!Object.values(fmt.FIELD_CODES).includes(pending.field)) {
    return 'ഇത് ഇപ്പോൾ ചെയ്യാനാവില്ല';
  }

  // Yes. Claimed by clearing the pending state, so a double tap saves once.
  const claimed = await TelegramLink.findOneAndUpdate(
    { _id: link._id, 'pending.nonce': nonce },
    { $set: { pending: null } }
  );
  if (!claimed) return fmt.RENEW_STALE;

  const value = new Date(pending.date);
  await Vehicle.updateOne(
    { _id: pending.vehicleId, userId: link.userId },
    { $set: { [pending.field]: value } }
  );

  const done = fmt.renewDoneText(vehicle.vehicleNumber, pending.field, value, fmt.chatName(query.from));
  await safeEdit(chatId, messageId, done);
  const others = (await chatsOf(link.userId)).filter((c) => c.chatId !== chatId);
  if (others.length > 0) await sendToChats(others, done);
  return 'പുതുക്കി';
}

// ------------------------------------------------------------------- salary

/** Unpaid trips up to the end of today, grouped by driver. */
async function pendingSalary(userId, now = businessNow()) {
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const trips = await Trip.find({
    userId,
    driverSalaryPaid: false,
    driverSalary: { $gt: 0 },
    tripDate: { $lte: endOfToday }
  })
    .select('tripType clientName driverId driverName driverSalary tripDate distance vehicleId')
    .populate({ path: 'vehicleId', select: 'vehicleNumber', options: { excludeClassification: true } })
    .lean();

  return fmt.groupByDriver(trips.map((trip) => ({
    ...trip,
    vehicleNumber: trip.vehicleId?.vehicleNumber || null
  })));
}

/**
 * One message per driver, each listing the trips and carrying a "paid"
 * button. [scheduled] (7 PM) sends nothing when nothing is owed; the button
 * says so.
 */
async function sendSalary(userId, chats, { scheduled = false, now = businessNow() } = {}) {
  const groups = await pendingSalary(userId, now);
  if (groups.length === 0) {
    if (!scheduled) await sendToChats(chats, fmt.NO_SALARY_PENDING);
    return 0;
  }

  const today = now;
  if (groups.length > 1) await sendToChats(chats, fmt.salaryHeader(groups));

  for (const group of groups) {
    // Saved before sending, so a button pressed at once finds it.
    const notice = await SalaryNotice.create({
      userId,
      driverId: group.driverId,
      driverName: group.driverName,
      tripIds: group.trips.map((t) => t._id),
      amount: group.amount,
      text: fmt.salaryMessage(group, today)
    });
    const messages = await sendToChats(chats, notice.text, {
      reply_markup: fmt.payKeyboard(notice)
    });
    await SalaryNotice.updateOne({ _id: notice._id }, { $set: { messages } });
  }
  return groups.length;
}

/** Updates every copy of a salary message (owner's and son's). */
async function editAllCopies(notice, text) {
  for (const copy of notice.messages || []) {
    await safeEdit(copy.chatId, copy.messageId, text);
  }
}

function settledTextFor(notice) {
  if (!notice.settledAmount) return fmt.alreadyPaidText(notice);
  return fmt.settledText(notice, {
    amount: notice.settledAmount,
    by: notice.settledBy,
    at: businessNow(new Date(notice.settledAt).getTime())
  });
}

/**
 * Marks the notice's trips paid, once: two people pressing at the same time
 * (or one pressing twice) settle it only once. Returns the reply for the
 * person who pressed.
 */
async function settleNotice(notice, by) {
  const at = new Date();
  const claimed = await SalaryNotice.findOneAndUpdate(
    { _id: notice._id, settledAt: null },
    { $set: { settledAt: at, settledBy: by || null } },
    { new: true }
  );
  if (!claimed) {
    const current = await SalaryNotice.findById(notice._id).lean();
    await editAllCopies(current, settledTextFor(current));
    return 'ഇത് നേരത്തെ രേഖപ്പെടുത്തി';
  }

  try {
    // Only trips still unpaid: any marked paid in the app meanwhile are not
    // counted again.
    const unpaid = await Trip.find({
      _id: { $in: notice.tripIds },
      userId: notice.userId,
      driverSalaryPaid: false
    }).select('_id driverSalary').lean();
    const amount = unpaid.reduce((sum, t) => sum + (t.driverSalary || 0), 0);

    if (unpaid.length > 0) {
      await Trip.updateMany(
        { _id: { $in: unpaid.map((t) => t._id) }, driverSalaryPaid: false },
        { $set: { driverSalaryPaid: true, salaryPaidAt: at } }
      );
    }
    claimed.settledAmount = amount;
    await SalaryNotice.updateOne({ _id: notice._id }, { $set: { settledAmount: amount } });
    await editAllCopies(claimed, settledTextFor(claimed));

    return unpaid.length > 0
      ? `${notice.driverName}-ന് ${fmt.money(amount)} കൊടുത്തതായി രേഖപ്പെടുത്തി`
      : 'ഇത് നേരത്തെ ആപ്പിൽ രേഖപ്പെടുത്തിയിരുന്നു';
  } catch (error) {
    // Let it be pressed again.
    await SalaryNotice.updateOne({ _id: notice._id }, { $set: { settledAt: null, settledBy: null } });
    throw error;
  }
}

async function handleCallback(query) {
  const answer = (text) => api.answerCallbackQuery(query.id, text).catch((e) =>
    console.error('Telegram answer failed:', e.message));

  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const link = chatId ? await TelegramLink.findOne({ chatId }).lean() : null;

  const renewal = fmt.parseRenewCallback(query.data);
  if (renewal && link) {
    try {
      const reply = renewal.action === 'ask'
        ? await startRenewal(link, chatId, renewal)
        : await answerRenewal(link, query, renewal);
      return answer(reply || undefined);
    } catch (error) {
      console.error('Renewal failed:', error);
      return answer('നടന്നില്ല. കുറച്ച് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കുക.');
    }
  }

  const parsed = fmt.parsePayCallback(query.data);
  if (!parsed || !link) return answer('ഇത് ഇപ്പോൾ ചെയ്യാനാവില്ല');

  const notice = await SalaryNotice.findOne({ _id: parsed.noticeId, userId: link.userId }).lean();
  if (!notice) {
    return answer('ഈ സന്ദേശം പഴയതാണ്. "ശമ്പളം ബാക്കി" അമർത്തി പുതിയത് എടുക്കുക.');
  }
  if (notice.settledAt) {
    await safeEdit(chatId, messageId, settledTextFor(notice));
    return answer('ഇത് നേരത്തെ രേഖപ്പെടുത്തി');
  }

  if (parsed.action === 'ask') {
    await safeEdit(chatId, messageId, fmt.confirmText(notice), {
      reply_markup: fmt.confirmKeyboard(notice)
    });
    return answer();
  }
  if (parsed.action === 'no') {
    await safeEdit(chatId, messageId, notice.text, { reply_markup: fmt.payKeyboard(notice) });
    return answer();
  }

  try {
    return answer(await settleNotice(notice, fmt.chatName(query.from)));
  } catch (error) {
    console.error('Salary settle failed:', error);
    return answer('രേഖപ്പെടുത്താനായില്ല. കുറച്ച് കഴിഞ്ഞ് വീണ്ടും അമർത്തുക.');
  }
}

// ------------------------------------------------------------------- month

async function sendThisMonth(userId, chats) {
  const dashboard = await buildDashboard(userId, {});
  await sendToChats(chats, fmt.monthMessage(dashboard, { soFar: true }));
}

/** Last month's figures, and each contract's bill as a PDF. */
async function sendMonthlyReport(userId, chats, now = businessNow()) {
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth(); // last month, 1-12

  const dashboard = await buildDashboard(userId, { year, month }, { now });
  const s = dashboard.summary;
  if (s.tripCount === 0 && s.otherExpense === 0) return; // Nothing happened.
  await sendToChats(chats, fmt.monthMessage(dashboard));

  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  const contractIds = await contractsWithTrips(userId, start, end);
  for (const contractId of contractIds) {
    const bill = await contractBillPdf({ userId, contractId, start, end, lang: 'ml' });
    if (!bill) continue;
    const ascii = bill.contract.contractName.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 40);
    const filename = `bill-${ascii || 'contract'}-${year}-${String(month).padStart(2, '0')}.pdf`;
    const caption = `${bill.contract.contractName} · ${fmt.monthYear(year, month)} ബിൽ`;
    for (const chat of chats) {
      try {
        await api.sendDocument(chat.chatId, bill.buffer, filename, caption);
      } catch (error) {
        console.error('Telegram bill send failed:', error.message);
      }
    }
  }

  await sendDriverStatements(userId, chats, { year, month, start, end });
}

/**
 * Each driver's month, to forward to them: one message per driver, with a
 * button that opens WhatsApp to that driver with the summary filled in.
 */
async function sendDriverStatements(userId, chats, { year, month, start, end }) {
  const [trips, drivers] = await Promise.all([
    Trip.find({ userId, tripDate: { $gte: start, $lte: end } })
      .select('tripType clientName driverId driverName driverSalary driverSalaryPaid tripDate distance')
      .lean(),
    Driver.find({ userId }).select('name phone').lean()
  ]);
  const groups = fmt.groupByDriver(trips);
  if (groups.length === 0) return 0;

  const byId = new Map(drivers.map((d) => [String(d._id), d]));
  const byName = new Map(drivers.map((d) => [normaliseName(d.name), d]));

  await sendToChats(chats, fmt.statementsHeader(year, month, groups.length));
  for (const group of groups) {
    const driver = group.driverId
      ? byId.get(String(group.driverId))
      : byName.get(normaliseName(group.driverName));
    const text = fmt.driverStatement(group, year, month);
    const keyboard = fmt.whatsAppKeyboard(driver?.phone, fmt.driverStatementShort(group, year, month));

    for (const chat of chats) {
      if (!keyboard) {
        await safeSend(chat.chatId, text);
        continue;
      }
      try {
        await api.sendMessage(chat.chatId, text, { reply_markup: keyboard });
      } catch (error) {
        // Telegram refused the button (a link it won't take): the statement
        // still matters more than the shortcut.
        console.error('Statement with WhatsApp button failed:', error.message);
        await safeSend(chat.chatId, text);
      }
    }
  }
  return groups.length;
}

// ------------------------------------------------------------------ evening

/** The day's figures at 8:30 PM, or a nudge when no trip was entered. */
async function sendEvening(userId, chats, now = businessNow()) {
  const dashboard = await buildDashboard(userId, {}, { now });
  await sendToChats(chats, fmt.eveningMessage(dashboard, now));
}

// ---------------------------------------------------------------- incoming

async function handleMessage(message) {
  // Private chats only: a bot added to a group must not post business data.
  if (message.chat?.type !== 'private') return;
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();

  const start = /^\/start(?:\s+([A-Za-z0-9_-]+))?$/.exec(text);
  if (start && start[1]) return linkChat(start[1], message);

  const link = await TelegramLink.findOne({ chatId }).lean();
  if (!link) {
    return safeSend(chatId, fmt.NOT_LINKED, { reply_markup: { remove_keyboard: true } });
  }
  if (start) return safeSend(chatId, fmt.WELCOME, { reply_markup: fmt.QUICK_KEYBOARD });

  if (text === '/stop') {
    await TelegramLink.deleteOne({ chatId });
    return safeSend(chatId, fmt.UNLINKED, { reply_markup: { remove_keyboard: true } });
  }

  const isButton = Object.values(fmt.BUTTONS).includes(text) || text.startsWith('/');
  if (!isButton && renewWaiting(link)) return renewalReply(link, chatId, text);
  // A quick button while a renewal waits: he moved on, so drop it.
  if (link.pending) await TelegramLink.updateOne({ _id: link._id }, { $set: { pending: null } });

  const chats = [link];
  if (text === fmt.BUTTONS.month || text === '/month') return sendThisMonth(link.userId, chats);
  if (text === fmt.BUTTONS.salary || text === '/salary') return sendSalary(link.userId, chats);
  if (text === fmt.BUTTONS.documents || text === '/documents') {
    return sendDocuments(link.userId, chats, { all: true });
  }
  return safeSend(chatId, fmt.HELP, { reply_markup: fmt.QUICK_KEYBOARD });
}

/** One update from Telegram's webhook. Never throws. */
async function handleUpdate(update) {
  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
  } catch (error) {
    console.error('Telegram update failed:', error);
  }
}

// ---------------------------------------------------------------- schedule

const JOBS = {
  documents: (userId, chats, now) => sendDocuments(userId, chats, { now }),
  salary: (userId, chats, now) => sendSalary(userId, chats, { scheduled: true, now }),
  monthly: (userId, chats, now) => sendMonthlyReport(userId, chats, now),
  evening: (userId, chats, now) => sendEvening(userId, chats, now)
};

let running = false;

/**
 * Sends whatever is due now, for every linked account. Called by the
 * external scheduler (cron-job.org) several times around 9 AM and 7 PM; each
 * message is claimed in the database before it is sent, so repeated or
 * overlapping calls never send twice. A failed send is released, so the next
 * call tries again.
 */
async function runDueJobs({ now = businessNow() } = {}) {
  if (running) return { skipped: true };
  running = true;
  const sent = [];
  try {
    const userIds = await TelegramLink.distinct('userId');
    for (const userId of userIds) {
      const settings = await TelegramSettings.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId } },
        { upsert: true, new: true }
      ).lean();

      for (const { job, key } of fmt.dueJobs(now, settings)) {
        const field = `sent.${job}`;
        const previous = settings.sent?.[job] ?? null;
        const claim = await TelegramSettings.updateOne(
          { userId, [field]: previous },
          { $set: { [field]: key } }
        );
        if (claim.modifiedCount === 0) continue; // Another call has it.

        try {
          const chats = await chatsOf(userId);
          if (chats.length > 0) await JOBS[job](userId, chats, now);
          sent.push(job);
        } catch (error) {
          console.error(`Telegram ${job} for ${userId} failed:`, error);
          await TelegramSettings.updateOne({ userId, [field]: key }, { $set: { [field]: previous } });
        }
      }
    }
    return { sent };
  } finally {
    running = false;
  }
}

// --------------------------------------------------------------- the app

async function status(userId) {
  const [links, settings] = await Promise.all([
    TelegramLink.find({ userId }).sort({ createdAt: 1 }).lean(),
    TelegramSettings.findOne({ userId }).lean()
  ]);
  return {
    available: api.isConfigured(),
    botUsername: api.botUsername() || null,
    links: links.map((l) => ({ id: String(l._id), name: l.name || '', linkedAt: l.createdAt })),
    settings: {
      documents: settings?.documents !== false,
      salary: settings?.salary !== false,
      monthly: settings?.monthly !== false,
      evening: settings?.evening !== false
    }
  };
}

async function updateSettings(userId, changes) {
  const $set = {};
  for (const key of ['documents', 'salary', 'monthly', 'evening']) {
    if (typeof changes[key] === 'boolean') $set[key] = changes[key];
  }
  await TelegramSettings.updateOne({ userId }, { $set, $setOnInsert: { userId } }, { upsert: true });
  return status(userId);
}

async function removeLink(userId, linkId) {
  const link = await TelegramLink.findOneAndDelete({ _id: linkId, userId }).lean();
  if (link) {
    await safeSend(link.chatId, fmt.UNLINKED, { reply_markup: { remove_keyboard: true } });
  }
  return Boolean(link);
}

async function sendTest(userId) {
  const chats = await chatsOf(userId);
  const sent = await sendToChats(chats, fmt.TEST_MESSAGE, { reply_markup: fmt.QUICK_KEYBOARD });
  return sent.length;
}

/** Everything Telegram-related for an account being deleted. */
async function deleteAccountData(userId) {
  await Promise.all([
    TelegramLink.deleteMany({ userId }),
    TelegramLinkCode.deleteMany({ userId }),
    TelegramSettings.deleteMany({ userId }),
    SalaryNotice.deleteMany({ userId })
  ]);
}

/** Points Telegram at this server's webhook. Run at start-up. */
async function registerWebhook() {
  const base = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (!api.isConfigured() || !base || !process.env.TELEGRAM_WEBHOOK_SECRET) {
    console.log('Telegram bot not configured; webhook not registered');
    return;
  }
  try {
    await api.call('setWebhook', {
      url: `${base.replace(/\/$/, '')}/api/telegram/webhook`,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query']
    });
    console.log('Telegram webhook registered');
  } catch (error) {
    console.error('Telegram webhook registration failed:', error.message);
  }
}

module.exports = {
  createLinkCode,
  handleUpdate,
  runDueJobs,
  status,
  updateSettings,
  removeLink,
  sendTest,
  deleteAccountData,
  registerWebhook,
  // For tests.
  pendingSalary
};
