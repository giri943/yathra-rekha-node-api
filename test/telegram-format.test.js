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
  assert.match(fmt.documentsMessage([], { all: true }), /ഒരു രേഖയും കരാറും തീരുന്നില്ല/);
});

test('scheduled messages: once each, at their hour', () => {
  const fresh = { documents: true, salary: true, monthly: true, evening: true, sent: {} };
  const jobs = (now, settings = fresh) => fmt.dueJobs(now, settings).map((j) => j.job);

  assert.deepEqual(jobs(at(2026, 11, 12, 8, 59)), []);
  assert.deepEqual(jobs(at(2026, 11, 12, 9, 0)), ['documents']);
  assert.deepEqual(jobs(at(2026, 11, 12, 19, 0)), ['documents', 'salary']);
  assert.deepEqual(jobs(at(2026, 12, 1, 9, 5)), ['documents', 'monthly']);

  assert.deepEqual(jobs(at(2026, 11, 12, 20, 29)), ['documents', 'salary']);
  assert.deepEqual(jobs(at(2026, 11, 12, 20, 30)), ['documents', 'salary', 'evening']);

  const sentToday = { ...fresh, sent: { documents: '2026-11-12', salary: '2026-11-12' } };
  assert.deepEqual(jobs(at(2026, 11, 12, 19, 5), sentToday), []);
  const allSent = { ...fresh, sent: { ...sentToday.sent, evening: '2026-11-12' } };
  assert.deepEqual(jobs(at(2026, 11, 12, 20, 35), allSent), []);
  assert.deepEqual(jobs(at(2026, 11, 12, 20, 30), { ...fresh, evening: false }), ['documents', 'salary']);
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

test('contracts: reminded 30 days before and the last week, never after', () => {
  const reminded = [];
  for (let d = 40; d >= -10; d--) if (fmt.contractRemindsOn(d)) reminded.push(d);
  assert.deepEqual(reminded, [30, 7, 6, 5, 4, 3, 2, 1, 0]);

  const today = at(2026, 11, 12, 9);
  const contracts = [
    { contractName: 'ABC School', contractEndDate: at(2026, 11, 19, 0) }, // 7 days
    { contractName: 'Old job', contractEndDate: at(2026, 11, 1, 0) },     // ended
    { contractName: 'Hospital', contractEndDate: at(2026, 11, 12, 0) },   // today
    { contractName: 'Later', contractEndDate: at(2026, 11, 25, 0) }       // 13 days
  ];
  assert.deepEqual(fmt.contractsDue(contracts, today).map((c) => [c.name, c.daysLeft]),
    [['Hospital', 0], ['ABC School', 7]]);
  // The button: everything ending within 30 days, still not the ended one.
  assert.deepEqual(fmt.contractsDue(contracts, today, { all: true }).map((c) => c.name),
    ['Hospital', 'ABC School', 'Later']);
});

test('the morning message: documents, then contracts; either alone', () => {
  const doc = { vehicleNumber: 'KL-07-AB-1234', label: 'ഇൻഷുറൻസ്', expiry: at(2026, 11, 17), daysLeft: 5 };
  const contract = { name: 'ABC School', endDate: at(2026, 11, 19), daysLeft: 7 };

  const both = fmt.documentsMessage([doc], { contracts: [contract] });
  assert.ok(both.startsWith('🚗 <b>രേഖകൾ ശ്രദ്ധിക്കണം</b>'));
  assert.ok(both.includes(
    '\n\n📄 <b>കരാറുകൾ തീരാറായി</b>\n\n• <b>ABC School</b>: 7 ദിവസത്തിൽ തീരും (19/11/2026)'
  ));

  const onlyContract = fmt.documentsMessage([], { contracts: [{ ...contract, daysLeft: 1 }] });
  assert.match(onlyContract, /^📄 /);
  assert.ok(onlyContract.includes('ABC School</b>: നാളെ തീരും'));
  assert.doesNotMatch(onlyContract, /🚗/);
  assert.match(fmt.documentsMessage([], { contracts: [{ ...contract, daysLeft: 0 }] }), /ഇന്ന് തീരും/);
});

test('evening: the day in figures, or a nudge when nothing was entered', () => {
  const now = at(2026, 11, 12, 20, 30);
  const day = (today, profit = 50000) => ({ today, summary: { profit } });

  const busy = fmt.eveningMessage(day({
    tripCount: 3, contractTripCount: 2, savariTripCount: 1, revenue: 6200,
    driverSalary: 600, otherExpense: 200, totalExpense: 800, profit: 5400
  }), now);
  assert.equal(busy, [
    '📋 <b>ഇന്ന് (12/11)</b>',
    '',
    'ട്രിപ്പ്: 3 (കരാർ 2, സവാരി 1)',
    'വരുമാനം: ₹6,200',
    'ചെലവ്: ₹800 (ശമ്പളം ₹600, മറ്റ് ₹200)',
    '<b>ലാഭം: ₹5,400</b>',
    '',
    'ഈ മാസം ഇതുവരെ: ലാഭം ₹50,000'
  ].join('\n'));

  const salaryOnly = fmt.eveningMessage(day({
    tripCount: 1, contractTripCount: 1, savariTripCount: 0, revenue: 1000,
    driverSalary: 750, otherExpense: 0, totalExpense: 750, profit: 250
  }, -3000), now);
  assert.ok(salaryOnly.includes('ചെലവ്: ₹750 (ഡ്രൈവർ ശമ്പളം)'));
  assert.match(salaryOnly, /ഈ മാസം ഇതുവരെ: നഷ്ടം ₹3,000$/);

  const idle = fmt.eveningMessage(day({ tripCount: 0, otherExpense: 0 }), now);
  assert.equal(idle, '❓ <b>ഇന്ന് (12/11) ട്രിപ്പ് ഒന്നും ചേർത്തിട്ടില്ല.</b>\nഓടിയെങ്കിൽ ആപ്പിൽ ചേർക്കാൻ മറക്കല്ലേ.');

  const idleWithFuel = fmt.eveningMessage(day({ tripCount: 0, otherExpense: 1500 }), now);
  assert.match(idleWithFuel, /ഇന്നത്തെ ചെലവ്: ₹1,500$/);
});

test('renew: one button per document, data within Telegram\'s 64 bytes', () => {
  const vehicleId = '0123456789abcdef01234567';
  const due = fmt.documentsDue([{
    _id: vehicleId,
    vehicleNumber: 'KL-07-AB-1234',
    insuranceExpiry: at(2026, 11, 17, 0),
    taxDate: at(2026, 11, 10, 0),
    testDate: at(2027, 6, 1, 0),
    pollutionDate: at(2027, 6, 1, 0)
  }], at(2026, 11, 12, 9));

  const rows = fmt.renewKeyboard(due).inline_keyboard;
  assert.deepEqual(rows.map((r) => r[0].text), [
    '🔄 KL-07-AB-1234 ടാക്സ് പുതുക്കി',
    '🔄 KL-07-AB-1234 ഇൻഷുറൻസ് പുതുക്കി'
  ]);
  for (const [button] of rows) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
  assert.deepEqual(fmt.parseRenewCallback(rows[0][0].callback_data),
    { action: 'ask', field: 'taxDate', vehicleId });
  assert.equal(fmt.renewKeyboard([]), null);

  const confirm = fmt.renewConfirmKeyboard('0a1b2c3d').inline_keyboard.flat();
  assert.deepEqual(confirm.map((b) => fmt.parseRenewCallback(b.callback_data).action),
    ['yes', 'change', 'cancel']);
  assert.equal(fmt.parseRenewCallback('ren:x:0123456789abcdef01234567'), null);
  assert.equal(fmt.parseRenewCallback('rny:not-hex!'), null);
  assert.equal(fmt.parseRenewCallback('pay:a:0123456789abcdef01234567'), null);
});

test('renew: the new date as he would type it', () => {
  const today = at(2026, 11, 12, 9);
  const ok = (text) => {
    const { date, error } = fmt.parseExpiryDate(text, today);
    assert.equal(error, undefined, text);
    return fmt.date(date);
  };
  assert.equal(ok('17/11/2027'), '17/11/2027');
  assert.equal(ok('17-11-27'), '17/11/2027');
  assert.equal(ok('1.2.2027'), '01/02/2027');
  assert.equal(ok(' 17 11 2027 '), '17/11/2027');
  assert.equal(ok('13/11/2026'), '13/11/2026'); // tomorrow

  const error = (text) => fmt.parseExpiryDate(text, today).error;
  assert.match(error('hello'), /മനസ്സിലായില്ല/);
  assert.match(error('2027-11-17'), /മനസ്സിലായില്ല/);
  assert.match(error('31/02/2027'), /തീയതി ഇല്ല/);
  assert.match(error('12/11/2026'), /കഴിഞ്ഞുപോയി/); // today: not a renewal
  assert.match(error('17/11/2025'), /കഴിഞ്ഞുപോയി/);
  assert.match(error('17/11/2097'), /വർഷം/);

  assert.equal(fmt.longDate(at(2027, 11, 17)), '17 നവംബർ 2027');
  assert.ok(fmt.renewConfirmText('KL-07-AB-1234', 'insuranceExpiry', at(2027, 11, 17))
    .includes('<b>17 നവംബർ 2027</b> (17/11/2027)'));
  assert.ok(fmt.renewDoneText('KL-07-AB-1234', 'taxDate', at(2027, 11, 17), 'Girish')
    .startsWith('✅ <b>KL-07-AB-1234 ടാക്സ്</b> 17/11/2027 വരെ പുതുക്കി · Girish'));
  assert.ok(fmt.isCancelWord('വേണ്ട'));
  assert.ok(fmt.isCancelWord('Cancel'));
  assert.ok(!fmt.isCancelWord('17/11/2027'));
});

test('driver statement: totals, paid and owed, each trip', () => {
  const [group] = fmt.groupByDriver([
    trip({ tripDate: at(2026, 10, 2), driverSalary: 750, driverSalaryPaid: true }),
    trip({ tripDate: at(2026, 10, 5), driverSalary: 750, driverSalaryPaid: true }),
    trip({ tripType: 'savari', clientName: 'Ramesh', distance: 40, tripDate: at(2026, 10, 30),
      driverSalary: 500, driverSalaryPaid: false })
  ]);

  assert.equal(fmt.driverStatement(group, 2026, 10), [
    '🧾 <b>Girish</b> · ഒക്ടോബർ 2026',
    '',
    'ട്രിപ്പ്: 3',
    'ആകെ ശമ്പളം: ₹2,000',
    'കൊടുത്തത്: ₹1,500',
    '<b>ബാക്കി: ₹500</b>',
    '',
    '• 02/10 · ABC School (കരാർ) — ₹750',
    '• 05/10 · ABC School (കരാർ) — ₹750',
    '• 30/10 · Ramesh (സവാരി, 40 കി.മീ) — ₹500 <i>(ബാക്കി)</i>'
  ].join('\n'));

  assert.equal(fmt.driverStatementShort(group, 2026, 10),
    'Girish · ഒക്ടോബർ 2026\nട്രിപ്പ്: 3\nആകെ ശമ്പളം: ₹2,000\nകൊടുത്തത്: ₹1,500\nബാക്കി: ₹500');

  const [allPaid] = fmt.groupByDriver([trip({ driverSalaryPaid: true })]);
  assert.ok(fmt.driverStatement(allPaid, 2026, 11).includes('ബാക്കി: ഇല്ല ✅'));

  const many = [];
  for (let i = 0; i < 45; i++) many.push(trip({ driverSalary: 100 }));
  const long = fmt.driverStatement(fmt.groupByDriver(many)[0], 2026, 11);
  assert.ok(long.endsWith('• …കൂടാതെ 5 ട്രിപ്പ്'));
  assert.ok(long.length < 4096, 'fits one Telegram message');
});

test('WhatsApp button to the driver, from a stored phone number', () => {
  assert.equal(fmt.whatsAppNumber('98765 43210'), '919876543210');
  assert.equal(fmt.whatsAppNumber('09876543210'), '919876543210');
  assert.equal(fmt.whatsAppNumber('+91 98765 43210'), '919876543210');
  assert.equal(fmt.whatsAppNumber('12345'), null);
  assert.equal(fmt.whatsAppNumber(undefined), null);

  const button = fmt.whatsAppKeyboard('9876543210', 'ബാക്കി: ₹500').inline_keyboard[0][0];
  assert.equal(button.text, 'WhatsApp-ൽ ഡ്രൈവർക്ക് അയക്കുക');
  const url = new URL(button.url);
  assert.equal(url.origin + url.pathname, 'https://wa.me/919876543210');
  assert.equal(url.searchParams.get('text'), 'ബാക്കി: ₹500');
  assert.equal(fmt.whatsAppKeyboard('', 'x'), null);
});
