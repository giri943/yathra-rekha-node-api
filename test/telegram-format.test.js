const test = require('node:test');
const assert = require('node:assert/strict');
const fmt = require('../services/telegram/format');

// Kerala wall clock in local fields, as businessNow() gives it.
const at = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min);

test('money: whole rupees, Indian grouping, sign kept', () => {
  assert.equal(fmt.money(1500), '₹1,500');
  assert.equal(fmt.money(123456.6), '₹1,23,457');
  assert.equal(fmt.money(-2500), '-₹2,500');
  assert.equal(fmt.money(null), '₹0');
});

test('html in names is escaped', () => {
  assert.equal(fmt.escapeHtml('A & B <x>'), 'A &amp; B &lt;x&gt;');
});

test('document schedule matches the app (ReminderService.remindsOn)', () => {
  const reminded = [];
  for (let d = 40; d >= -30; d--) if (fmt.remindsOn(d)) reminded.push(d);
  assert.deepEqual(reminded, [
    30, 7, 6, 5, 4, 3, 2, 1, 0,
    -1, -2, -3, -4, -5, -6, -7, -14, -21, -28
  ]);
});

test('documents due: most urgent first, only on reminder days', () => {
  const today = at(2026, 11, 12, 9);
  const vehicles = [{
    vehicleNumber: 'KL-07-AB-1234',
    insuranceExpiry: at(2026, 11, 17, 0), // 5 days
    taxDate: at(2026, 11, 10, 0),          // 2 days ago
    testDate: at(2027, 3, 1, 0),           // far
    pollutionDate: at(2026, 11, 25, 0)     // 13 days: not a reminder day
  }];
  const due = fmt.documentsDue(vehicles, today);
  assert.deepEqual(due.map((d) => [d.label, d.daysLeft]), [['ടാക്സ്', -2], ['ഇൻഷുറൻസ്', 5]]);

  const message = fmt.documentsMessage(due);
  assert.match(message, /KL-07-AB-1234<\/b> · ടാക്സ്: 2 ദിവസം മുൻപ് തീർന്നു ⚠️ \(10\/11\/2026\)/);
  assert.match(message, /ഇൻഷുറൻസ്: 5 ദിവസം ബാക്കി \(17\/11\/2026\)/);

  // The button lists everything within 30 days, reminder day or not.
  const all = fmt.documentsDue(vehicles, today, { all: true });
  assert.equal(all.length, 3);
  assert.match(fmt.documentsMessage([], { all: true }), /ഒരു രേഖയും തീരുന്നില്ല/);
});

test('scheduled messages: once each, at their hour', () => {
  const fresh = { documents: true, salary: true, monthly: true, sent: {} };
  const jobs = (now, settings = fresh) => fmt.dueJobs(now, settings).map((j) => j.job);

  assert.deepEqual(jobs(at(2026, 11, 12, 8, 59)), []);
  assert.deepEqual(jobs(at(2026, 11, 12, 9, 0)), ['documents']);
  assert.deepEqual(jobs(at(2026, 11, 12, 19, 0)), ['documents', 'salary']);
  assert.deepEqual(jobs(at(2026, 12, 1, 9, 5)), ['documents', 'monthly']);

  const sentToday = { ...fresh, sent: { documents: '2026-11-12', salary: '2026-11-12' } };
  assert.deepEqual(jobs(at(2026, 11, 12, 19, 5), sentToday), []);
  assert.deepEqual(jobs(at(2026, 11, 13, 9, 0), sentToday), ['documents']);

  const salaryOff = { ...fresh, salary: false };
  assert.deepEqual(jobs(at(2026, 11, 12, 19, 0), salaryOff), ['documents']);

  const reportSent = { ...fresh, sent: { monthly: '2026-12' } };
  assert.deepEqual(jobs(at(2026, 12, 1, 9, 5), reportSent), ['documents']);
});

const trip = (overrides) => ({
  _id: Math.random().toString(16).slice(2),
  tripType: 'contract',
  clientName: 'ABC School',
  driverId: 'd1',
  driverName: 'Girish',
  driverSalary: 750,
  tripDate: at(2026, 11, 12, 0),
  vehicleNumber: 'KL-07-AB-1234',
  ...overrides
});

test('salary: grouped per driver, largest first, trips oldest first', () => {
  const groups = fmt.groupByDriver([
    trip({ driverSalary: 750 }),
    trip({ driverSalary: 500, tripDate: at(2026, 11, 10, 0), driverName: 'Giri' }),
    trip({ driverId: 'd2', driverName: 'Raju', driverSalary: 2250 }),
    // From before driver ids: grouped by name.
    trip({ driverId: null, driverName: 'Old Kumar', driverSalary: 100 })
  ]);
  assert.deepEqual(groups.map((g) => [g.driverName, g.amount, g.trips.length]), [
    ['Raju', 2250, 1],
    ['Girish', 1250, 2], // newest trip's name
    ['Old Kumar', 100, 1]
  ]);
  assert.equal(new Date(groups[1].trips[0].tripDate).getDate(), 10);
});

test('salary message lists each trip it is for', () => {
  const today = at(2026, 11, 12, 19);
  const [group] = fmt.groupByDriver([
    trip({ driverSalary: 750 }),
    trip({ tripType: 'savari', clientName: 'Ramesh', distance: 45.2, driverSalary: 500,
      tripDate: at(2026, 11, 11, 0) }),
    trip({ driverSalary: 250, tripDate: at(2026, 11, 3, 0), vehicleNumber: null })
  ]);
  const text = fmt.salaryMessage(group, today);

  assert.equal(text, [
    '💰 <b>Girish</b>: ₹1,500 ബാക്കി',
    '3 ട്രിപ്പ് (2 എണ്ണം മുമ്പത്തെ ദിവസങ്ങളിലേത്)',
    '',
    '• 03/11 · ABC School (കരാർ) — <b>₹250</b>',
    '• ഇന്നലെ · Ramesh (സവാരി, 45 കി.മീ) · KL-07-AB-1234 — <b>₹500</b>',
    '• ഇന്ന് · ABC School (കരാർ) · KL-07-AB-1234 — <b>₹750</b>'
  ].join('\n'));
});

test('a long list keeps the newest trips and sums the rest', () => {
  const today = at(2026, 11, 25, 19);
  const trips = [];
  for (let d = 1; d <= 25; d++) trips.push(trip({ tripDate: at(2026, 11, d, 0), driverSalary: 100 }));
  const [group] = fmt.groupByDriver(trips);
  const lines = fmt.salaryMessage(group, today).split('\n');

  assert.equal(lines[0], '💰 <b>Girish</b>: ₹2,500 ബാക്കി');
  assert.equal(lines[3], '• …പഴയ 5 ട്രിപ്പ് കൂടി — <b>₹500</b>');
  assert.equal(lines.length, 4 + fmt.MAX_TRIP_LINES);
  assert.match(lines[lines.length - 1], /^• ഇന്ന് /);
});

test('paid button, confirmation and the settled message', () => {
  const notice = {
    _id: '0123456789abcdef01234567',
    driverName: 'Girish',
    amount: 1500,
    text: '💰 <b>Girish</b>: ₹1,500 ബാക്കി'
  };
  const button = fmt.payKeyboard(notice).inline_keyboard[0][0];
  assert.equal(button.text, '✅ Girish-ന് ₹1,500 കൊടുത്തു');
  assert.deepEqual(fmt.parsePayCallback(button.callback_data),
    { action: 'ask', noticeId: notice._id });

  const [yes, no] = fmt.confirmKeyboard(notice).inline_keyboard[0];
  assert.equal(fmt.parsePayCallback(yes.callback_data).action, 'yes');
  assert.equal(fmt.parsePayCallback(no.callback_data).action, 'no');
  assert.ok(Buffer.byteLength(yes.callback_data) <= 64); // Telegram's limit
  assert.match(fmt.confirmText(notice), /Girish-ന് ₹1,500 കൊടുത്തോ\?/);

  const settled = fmt.settledText(notice, { amount: 1500, by: 'Girish Soman', at: at(2026, 11, 12, 19, 12) });
  assert.match(settled, /✅ <b>₹1,500 കൊടുത്തു<\/b> · 12\/11 7:12 PM · Girish Soman$/);

  const partial = fmt.settledText(notice, { amount: 750, by: null, at: at(2026, 11, 12, 9, 5) });
  assert.match(partial, /₹750 കൊടുത്തു<\/b> · 12\/11 9:05 AM\n\(ബാക്കി ട്രിപ്പുകൾ/);

  assert.equal(fmt.parsePayCallback('pay:x:0123456789abcdef01234567'), null);
  assert.equal(fmt.parsePayCallback('pay:y:not-an-id'), null);
  assert.equal(fmt.parsePayCallback(undefined), null);
});

test('month message: figures, loss worded as loss, top clients and vehicles', () => {
  const dashboard = {
    year: 2026,
    month: 10,
    today: { tripCount: 2, revenue: 3000 },
    summary: {
      tripCount: 42, contractTripCount: 30, savariTripCount: 12,
      revenue: 120000, driverSalary: 30000, otherExpense: 95000, profit: -5000
    },
    unpaidDriverSalary: { amount: 1500, tripCount: 2 },
    clients: [{ clientName: 'ABC School', revenue: 60000, tripCount: 20 }],
    vehicles: [{ vehicleNumber: 'KL-07-AB-1234', tripCount: 30, profit: 20000 }]
  };

  const report = fmt.monthMessage(dashboard);
  assert.match(report, /^📊 <b>ഒക്ടോബർ 2026<\/b>/);
  assert.match(report, /ട്രിപ്പ്: 42 \(കരാർ 30, സവാരി 12\)/);
  assert.match(report, /<b>നഷ്ടം: ₹5,000<\/b>/);
  assert.match(report, /• ABC School: ₹60,000 \(20 ട്രിപ്പ്\)/);
  assert.match(report, /• KL-07-AB-1234: 30 ട്രിപ്പ്, ലാഭം ₹20,000/);
  assert.doesNotMatch(report, /ഇന്ന്:/);
  assert.doesNotMatch(report, /ശമ്പളം ബാക്കി/);

  const soFar = fmt.monthMessage(dashboard, { soFar: true });
  assert.match(soFar, /ഒക്ടോബർ 2026 \(ഇതുവരെ\)/);
  assert.match(soFar, /ഇന്ന്: 2 ട്രിപ്പ്, ₹3,000/);
  assert.match(soFar, /ശമ്പളം ബാക്കി: ₹1,500 \(2 ട്രിപ്പ്\)/);
});

test('chat name from Telegram', () => {
  assert.equal(fmt.chatName({ first_name: 'Girish', last_name: 'Soman' }), 'Girish Soman');
  assert.equal(fmt.chatName({ username: 'giri' }), '@giri');
  assert.equal(fmt.chatName(undefined), '');
});
