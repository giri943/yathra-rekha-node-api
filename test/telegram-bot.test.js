// The bot end to end against a real MongoDB, with Telegram replaced by a fake
// that records what would have been sent.
//
// Runs only when TEST_MONGODB_URI is set, and refuses any database whose name
// does not contain "test": it deletes everything in it.
//
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27299/yathra-test node --test

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const URI = process.env.TEST_MONGODB_URI;
const skip = !URI ? 'TEST_MONGODB_URI not set' : false;

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_BOT_USERNAME = 'yathrarekha_test_bot';

const api = require('../services/telegram/api');
const bot = require('../services/telegram/bot');
const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const Contract = require('../models/Contract');
const User = require('../models/User');
const TelegramLink = require('../models/TelegramLink');
const SalaryNotice = require('../models/SalaryNotice');
const TelegramSettings = require('../models/TelegramSettings');

// ------------------------------------------------------------ fake Telegram

let outbox = [];
let nextMessageId = 1;
const blockedChats = new Set();

api.sendMessage = async (chatId, text, extra = {}) => {
  if (blockedChats.has(chatId)) {
    throw new api.TelegramError('sendMessage', 403, 'Forbidden: bot was blocked by the user');
  }
  const message = { kind: 'send', chatId, text, extra, message_id: nextMessageId++ };
  outbox.push(message);
  return message;
};
api.editMessageText = async (chatId, messageId, text, extra = {}) => {
  outbox.push({ kind: 'edit', chatId, messageId, text, extra });
};
api.answerCallbackQuery = async (id, text) => {
  outbox.push({ kind: 'answer', id, text });
};
api.sendDocument = async (chatId, buffer, filename, caption) => {
  outbox.push({ kind: 'document', chatId, filename, caption, size: buffer.length });
};

const sent = (kind = 'send') => outbox.filter((m) => m.kind === kind);

// ------------------------------------------------------------------- data

const OWNER = 111;
const SON = 222;
const STRANGER = 333;
let userId;
let vehicle;

// Kerala wall clock, as businessNow() gives it.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

const message = (chatId, text, name = 'Owner') => ({
  message: { chat: { id: chatId, type: 'private' }, from: { first_name: name }, text }
});
const press = (chatId, messageId, data, name = 'Owner') => ({
  callback_query: {
    id: `q${Math.random()}`,
    data,
    from: { first_name: name },
    message: { chat: { id: chatId }, message_id: messageId }
  }
});

async function linkWithCode(chatId, name) {
  const { url } = await bot.createLinkCode(userId);
  const code = url.split('?start=')[1];
  await bot.handleUpdate(message(chatId, `/start ${code}`, name));
  return code;
}

test('Telegram bot', { skip }, async (t) => {
  assert.match(new URL(URI).pathname, /test/i, 'test database name must contain "test"');
  await mongoose.connect(URI);
  await mongoose.connection.dropDatabase();

  const user = await User.create({ name: 'Owner', email: 'o@example.com', phone: '9999999999', password: 'secret1' });
  userId = String(user._id);
  vehicle = await Vehicle.create({
    vehicleNumber: 'KL-07-AB-1234',
    model: 'Bolero',
    manufacturer: 'Mahindra',
    insuranceExpiry: at(2026, 11, 17),
    taxDate: at(2026, 11, 10),
    testDate: at(2027, 6, 1),
    pollutionDate: at(2027, 6, 1),
    userId,
    classificationId: new mongoose.Types.ObjectId()
  });

  const driverA = new mongoose.Types.ObjectId();
  const driverB = new mongoose.Types.ObjectId();
  const contract = await Contract.create({
    contractName: 'ABC School',
    rate: 1000,
    vehicleId: vehicle._id,
    averageDistance: 20,
    contractEndDate: at(2027, 3, 31),
    userId
  });
  const baseTrip = {
    tripType: 'contract',
    contractId: contract._id,
    vehicleId: vehicle._id,
    clientName: 'ABC School',
    tripRate: 1000,
    ownerTakeHome: 250,
    userId
  };
  await Trip.create([
    { ...baseTrip, driverId: driverA, driverName: 'Girish', driverSalary: 750, tripDate: at(2026, 11, 12) },
    { ...baseTrip, driverId: driverA, driverName: 'Girish', driverSalary: 750, tripDate: at(2026, 11, 11) },
    { ...baseTrip, driverId: driverB, driverName: 'Raju', driverSalary: 500, tripDate: at(2026, 11, 12) },
    // Already paid, future-dated, and last month's: none of these are owed today.
    { ...baseTrip, driverId: driverB, driverName: 'Raju', driverSalary: 500, tripDate: at(2026, 11, 12), driverSalaryPaid: true },
    { ...baseTrip, driverId: driverB, driverName: 'Raju', driverSalary: 500, tripDate: at(2026, 11, 20) },
    { ...baseTrip, driverId: driverB, driverName: 'Raju', driverSalary: 400, tripDate: at(2026, 10, 15), driverSalaryPaid: true }
  ]);

  await t.test('a stranger gets told how to link, nothing else', async () => {
    outbox = [];
    await bot.handleUpdate(message(STRANGER, 'ശമ്പളം ബാക്കി', 'Stranger'));
    assert.equal(sent().length, 1);
    assert.match(sent()[0].text, /ബന്ധിപ്പിച്ചിട്ടില്ല/);
  });

  await t.test('linking with a one-time code; the code works once', async () => {
    outbox = [];
    const code = await linkWithCode(OWNER, 'Owner');
    assert.equal(await TelegramLink.countDocuments({ userId }), 1);
    assert.match(sent()[0].text, /ബന്ധിപ്പിച്ചു/);
    assert.ok(sent()[0].extra.reply_markup.keyboard, 'quick buttons shown');

    outbox = [];
    await bot.handleUpdate(message(STRANGER, `/start ${code}`, 'Stranger'));
    assert.match(sent()[0].text, /പഴയതാണ്/);
    assert.equal(await TelegramLink.countDocuments({ chatId: STRANGER }), 0);
  });

  await t.test('adding the son tells the owner', async () => {
    outbox = [];
    await linkWithCode(SON, 'Son');
    assert.equal(await TelegramLink.countDocuments({ userId }), 2);
    const toOwner = sent().filter((m) => m.chatId === OWNER);
    assert.equal(toOwner.length, 1);
    assert.match(toOwner[0].text, /Son<\/b> കൂടി/);
  });

  await t.test('nothing before 9 AM; documents at 9 to both', async () => {
    outbox = [];
    await bot.runDueJobs({ now: at(2026, 11, 12, 8, 30) });
    assert.equal(outbox.length, 0);

    await bot.runDueJobs({ now: at(2026, 11, 12, 9, 0) });
    assert.deepEqual(sent().map((m) => m.chatId).sort(), [OWNER, SON]);
    assert.match(sent()[0].text, /ടാക്സ്: 2 ദിവസം മുൻപ് തീർന്നു/);
    assert.match(sent()[0].text, /ഇൻഷുറൻസ്: 5 ദിവസം ബാക്കി/);

    outbox = [];
    await bot.runDueJobs({ now: at(2026, 11, 12, 9, 5) }); // the second wake-up call
    assert.equal(outbox.length, 0, 'not sent twice');
  });

  let girishCopies;
  await t.test('7 PM: one message per driver with its trips and a paid button', async () => {
    outbox = [];
    await bot.runDueJobs({ now: at(2026, 11, 12, 19, 0) });
    const toOwner = sent().filter((m) => m.chatId === OWNER);
    assert.equal(toOwner.length, 3); // header + Girish + Raju
    assert.match(toOwner[0].text, /2 ഡ്രൈവർ, ആകെ ₹2,000/);
    assert.match(toOwner[1].text, /Girish<\/b>: ₹1,500 ബാക്കി/);
    assert.match(toOwner[1].text, /• ഇന്നലെ · ABC School \(കരാർ\) · KL-07-AB-1234 — <b>₹750<\/b>/);
    assert.match(toOwner[2].text, /Raju<\/b>: ₹500 ബാക്കി\n1 ട്രിപ്പ്/); // not the paid or future ones

    girishCopies = sent().filter((m) => /Girish<\/b>/.test(m.text));
    assert.equal(girishCopies.length, 2);
    const notice = await SalaryNotice.findOne({ driverName: 'Girish' });
    assert.equal(notice.messages.length, 2);
    assert.equal(notice.tripIds.length, 2);
  });

  await t.test('paid: asks first; "no" puts the button back', async () => {
    const [ownerCopy] = girishCopies.filter((m) => m.chatId === OWNER);
    const askData = ownerCopy.extra.reply_markup.inline_keyboard[0][0].callback_data;

    outbox = [];
    await bot.handleUpdate(press(OWNER, ownerCopy.message_id, askData));
    const ask = sent('edit')[0];
    assert.match(ask.text, /Girish-ന് ₹1,500 കൊടുത്തോ\?/);
    const [yes, no] = ask.extra.reply_markup.inline_keyboard[0];

    outbox = [];
    await bot.handleUpdate(press(OWNER, ownerCopy.message_id, no.callback_data));
    assert.equal(sent('edit')[0].extra.reply_markup.inline_keyboard[0][0].callback_data, askData);
    assert.equal(await Trip.countDocuments({ driverName: 'Girish', driverSalaryPaid: true }), 0);

    // A trip added after the message is not part of it.
    await Trip.create({
      tripType: 'savari', vehicleId: vehicle._id, clientName: 'Late',
      driverId: (await SalaryNotice.findOne({ driverName: 'Girish' })).driverId,
      driverName: 'Girish', driverSalary: 300, tripRate: 900, ownerTakeHome: 600,
      startKm: 1, endKm: 11, distance: 10, tripDate: at(2026, 11, 12), userId
    });

    outbox = [];
    await bot.handleUpdate(press(OWNER, ownerCopy.message_id, yes.callback_data, 'Owner'));
    assert.equal(await Trip.countDocuments({ driverName: 'Girish', driverSalaryPaid: true }), 2);
    assert.equal(await Trip.countDocuments({ clientName: 'Late', driverSalaryPaid: false }), 1);
    const paid = await Trip.findOne({ driverName: 'Girish', driverSalaryPaid: true });
    assert.ok(paid.salaryPaidAt, 'payment time saved');

    const edits = sent('edit');
    assert.deepEqual(edits.map((e) => e.chatId).sort(), [OWNER, SON], 'both copies updated');
    assert.match(edits[0].text, /✅ <b>₹1,500 കൊടുത്തു<\/b> · 12\/11 .* · Owner$/);
    assert.match(sent('answer')[0].text, /Girish-ന് ₹1,500 കൊടുത്തതായി രേഖപ്പെടുത്തി/);
  });

  await t.test('the son pressing his old copy settles nothing again', async () => {
    const sonCopy = girishCopies.find((m) => m.chatId === SON);
    const yes = sonCopy.extra.reply_markup.inline_keyboard[0][0].callback_data.replace(':a:', ':y:');
    outbox = [];
    await bot.handleUpdate(press(SON, sonCopy.message_id, yes, 'Son'));
    assert.match(sent('answer')[0].text, /നേരത്തെ/);
    assert.equal(await Trip.countDocuments({ driverName: 'Girish', driverSalaryPaid: true }), 2);
  });

  await t.test('someone else\'s notice cannot be pressed', async () => {
    const other = await SalaryNotice.create({
      userId: 'someone-else', driverName: 'X', tripIds: [], amount: 1, text: 'x'
    });
    await TelegramLink.create({ userId: 'someone-else-2', chatId: STRANGER, name: 'S' });
    outbox = [];
    await bot.handleUpdate(press(STRANGER, 1, `pay:y:${other._id}`, 'Stranger'));
    assert.match(sent('answer')[0].text, /പഴയതാണ്/);
    assert.equal((await SalaryNotice.findById(other._id)).settledAt, null);
    await TelegramLink.deleteOne({ chatId: STRANGER });
  });

  await t.test('quick buttons answer only the one who asked', async () => {
    outbox = [];
    await bot.handleUpdate(message(SON, 'ശമ്പളം ബാക്കി', 'Son'));
    assert.ok(sent().every((m) => m.chatId === SON));
    assert.ok(sent().some((m) => /Girish<\/b>: ₹300 ബാക്കി/.test(m.text)), 'the late trip is still owed');

    outbox = [];
    await bot.handleUpdate(message(OWNER, 'രേഖകൾ'));
    assert.match(sent()[0].text, /30 ദിവസത്തിനുള്ളിൽ/);

    outbox = [];
    await bot.handleUpdate(message(OWNER, 'ഈ മാസം'));
    assert.match(sent()[0].text, /\(ഇതുവരെ\)/);
  });

  await t.test('1st of the month: report and the contract bill PDF', async () => {
    await TelegramSettings.updateOne({ userId }, { $set: { documents: false } });
    outbox = [];
    await bot.runDueJobs({ now: at(2026, 11, 1, 9, 0) });
    const reports = sent().filter((m) => m.chatId === OWNER);
    assert.equal(reports.length, 1);
    assert.match(reports[0].text, /ഒക്ടോബർ 2026/);
    const bills = sent('document');
    assert.deepEqual(bills.map((b) => b.chatId).sort(), [OWNER, SON]);
    assert.match(bills[0].filename, /^bill-ABC School-2026-10\.pdf$/);
    assert.ok(bills[0].size > 1000, 'a real PDF');
  });

  await t.test('a chat that blocked the bot is unlinked', async () => {
    blockedChats.add(SON);
    outbox = [];
    assert.equal(await bot.sendTest(userId), 1);
    assert.equal(await TelegramLink.countDocuments({ chatId: SON }), 0);
    blockedChats.delete(SON);
  });

  await t.test('the app: status, switches, removing a chat', async () => {
    let status = await bot.status(userId);
    assert.equal(status.available, true);
    assert.equal(status.links.length, 1);
    assert.deepEqual(status.settings, { documents: false, salary: true, monthly: true });

    status = await bot.updateSettings(userId, { documents: true, salary: 'yes' });
    assert.deepEqual(status.settings, { documents: true, salary: true, monthly: true });

    outbox = [];
    assert.equal(await bot.removeLink(userId, status.links[0].id), true);
    assert.match(sent()[0].text, /ഇനി സന്ദേശങ്ങൾ വരില്ല/);
    assert.equal((await bot.status(userId)).links.length, 0);
  });

  await t.test('deleting the account removes its Telegram data', async () => {
    await linkWithCode(OWNER, 'Owner');
    await bot.deleteAccountData(userId);
    assert.equal(await TelegramLink.countDocuments({ userId }), 0);
    assert.equal(await SalaryNotice.countDocuments({ userId }), 0);
    assert.equal(await TelegramSettings.countDocuments({ userId }), 0);
  });

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
