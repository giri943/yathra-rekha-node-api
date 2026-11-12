// What the Telegram bot says, in Malayalam. Pure functions only (no database,
// no network), so the wording and the schedule can be tested on their own.
//
// Dates: stored dates and businessNow() both carry Kerala's wall clock in
// their LOCAL fields (see utils/clock.js), so everything here reads
// getFullYear()/getMonth()/getDate()/getHours(), never the UTC ones.

const MONTHS = [
  'ജനുവരി', 'ഫെബ്രുവരി', 'മാർച്ച്', 'ഏപ്രിൽ', 'മെയ്', 'ജൂൺ',
  'ജൂലൈ', 'ഓഗസ്റ്റ്', 'സെപ്റ്റംബർ', 'ഒക്ടോബർ', 'നവംബർ', 'ഡിസംബർ'
];

const DOCUMENTS = {
  insuranceExpiry: 'ഇൻഷുറൻസ്',
  taxDate: 'ടാക്സ്',
  testDate: 'ടെസ്റ്റ്',
  pollutionDate: 'പൊള്യൂഷൻ'
};

/** The reply-keyboard buttons, always at the bottom of the chat. */
const BUTTONS = {
  month: 'ഈ മാസം',
  salary: 'ശമ്പളം ബാക്കി',
  documents: 'രേഖകൾ'
};

const QUICK_KEYBOARD = {
  keyboard: [[{ text: BUTTONS.month }, { text: BUTTONS.salary }, { text: BUTTONS.documents }]],
  resize_keyboard: true,
  is_persistent: true
};

/** Most trips listed in one salary message; Telegram caps a message at 4096. */
const MAX_TRIP_LINES = 20;

const pad = (n) => String(n).padStart(2, '0');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/** ₹1,23,456: whole rupees, Indian grouping, as in the app. */
function money(amount) {
  const value = Math.round(Number(amount) || 0);
  const sign = value < 0 ? '-' : '';
  return `${sign}₹${Math.abs(value).toLocaleString('en-IN')}`;
}

const date = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const dayMonth = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
const monthYear = (year, month) => `${MONTHS[month - 1]} ${year}`;

function time(d) {
  const hours = d.getHours();
  return `${hours % 12 || 12}:${pad(d.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
}

const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** Whole calendar days from [today] to [target]; negative once past. */
function daysBetween(today, target) {
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------- schedule

/** When the evening summary goes: 8:30 PM, after the day's trips are in. */
const EVENING_MINUTES = 20 * 60 + 30;

/**
 * Which scheduled messages are due at [now] (Kerala time), given what was
 * already sent: documents and the monthly report from 9 AM, salary from
 * 7 PM, the evening summary from 8:30 PM; each once a day (the report once
 * a month).
 */
function dueJobs(now, settings) {
  const sent = settings.sent || {};
  const today = dayKey(now);
  const jobs = [];
  if (settings.documents !== false && now.getHours() >= 9 && sent.documents !== today) {
    jobs.push({ job: 'documents', key: today });
  }
  if (settings.monthly !== false && now.getDate() === 1 && now.getHours() >= 9 &&
      sent.monthly !== monthKey(now)) {
    jobs.push({ job: 'monthly', key: monthKey(now) });
  }
  if (settings.salary !== false && now.getHours() >= 19 && sent.salary !== today) {
    jobs.push({ job: 'salary', key: today });
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (settings.evening !== false && minutes >= EVENING_MINUTES && sent.evening !== today) {
    jobs.push({ job: 'evening', key: today });
  }
  return jobs;
}

// --------------------------------------------------------------- documents

/**
 * Whether a document [daysLeft] days from expiry is mentioned that morning.
 * Must match ReminderService.remindsOn in the app: 30 days before, daily in
 * the last week, daily for a week after expiry, then weekly.
 */
function remindsOn(daysLeft) {
  if (daysLeft === 30) return true;
  if (daysLeft >= 0) return daysLeft <= 7;
  const overdue = -daysLeft;
  return overdue <= 7 || overdue % 7 === 0;
}

function dueWords(daysLeft) {
  if (daysLeft > 1) return `${daysLeft} ദിവസം ബാക്കി`;
  if (daysLeft === 1) return 'നാളെ തീരും';
  if (daysLeft === 0) return 'ഇന്ന് തീരും';
  if (daysLeft === -1) return 'ഇന്നലെ തീർന്നു ⚠️';
  return `${-daysLeft} ദിവസം മുൻപ് തീർന്നു ⚠️`;
}

/** Every document to mention on [today]'s morning, most urgent first. */
function documentsDue(vehicles, today, { all = false } = {}) {
  const due = [];
  for (const vehicle of vehicles) {
    for (const [field, label] of Object.entries(DOCUMENTS)) {
      if (!vehicle[field]) continue;
      const expiry = new Date(vehicle[field]);
      const daysLeft = daysBetween(today, expiry);
      const wanted = all ? daysLeft <= 30 : remindsOn(daysLeft);
      if (wanted) {
        due.push({
          vehicleId: vehicle._id ? String(vehicle._id) : null,
          vehicleNumber: vehicle.vehicleNumber,
          field,
          label,
          expiry,
          daysLeft
        });
      }
    }
  }
  return due.sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Whether a contract [daysLeft] days from its end is mentioned that morning:
 * 30 days before, then daily in the last week up to the day it ends. Not
 * after: unlike an insurance, a contract that ended may simply be over.
 */
const contractRemindsOn = (daysLeft) => daysLeft === 30 || (daysLeft >= 0 && daysLeft <= 7);

/** Contracts to mention on [today]'s morning, soonest first. */
function contractsDue(contracts, today, { all = false } = {}) {
  const due = [];
  for (const contract of contracts) {
    if (!contract.contractEndDate) continue;
    const endDate = new Date(contract.contractEndDate);
    const daysLeft = daysBetween(today, endDate);
    const wanted = all ? daysLeft >= 0 && daysLeft <= 30 : contractRemindsOn(daysLeft);
    if (wanted) due.push({ name: contract.contractName, endDate, daysLeft });
  }
  return due.sort((a, b) => a.daysLeft - b.daysLeft);
}

function contractWords(daysLeft) {
  if (daysLeft > 1) return `${daysLeft} ദിവസത്തിൽ തീരും`;
  if (daysLeft === 1) return 'നാളെ തീരും';
  return 'ഇന്ന് തീരും';
}

/**
 * The morning message: vehicle documents, then contracts ending. [all] for
 * the "രേഖകൾ" button, which lists everything within 30 days.
 */
function documentsMessage(due, { all = false, contracts = [] } = {}) {
  if (due.length === 0 && contracts.length === 0) {
    return '✅ <b>രേഖകൾ</b>\nഅടുത്ത 30 ദിവസത്തിൽ ഒരു രേഖയും കരാറും തീരുന്നില്ല.';
  }
  const sections = [];
  if (due.length > 0) {
    sections.push([
      all ? '🚗 <b>രേഖകൾ: 30 ദിവസത്തിനുള്ളിൽ</b>' : '🚗 <b>രേഖകൾ ശ്രദ്ധിക്കണം</b>',
      '',
      ...due.map((d) =>
        `• <b>${escapeHtml(d.vehicleNumber)}</b> · ${d.label}: ${dueWords(d.daysLeft)} (${date(d.expiry)})`
      ),
      '',
      'പുതുക്കിയാൽ താഴെയുള്ള "പുതുക്കി" ബട്ടൺ അമർത്തി പുതിയ തീയതി അയക്കുക.'
    ].join('\n'));
  }
  if (contracts.length > 0) {
    sections.push([
      '📄 <b>കരാറുകൾ തീരാറായി</b>',
      '',
      ...contracts.map((c) =>
        `• <b>${escapeHtml(c.name)}</b>: ${contractWords(c.daysLeft)} (${date(c.endDate)})`
      ),
      '',
      'തുടരുമെങ്കിൽ ക്ലയന്റുമായി സംസാരിച്ച് ആപ്പിൽ കരാറിന്റെ പുതിയ അവസാന തീയതി ചേർക്കുക.'
    ].join('\n'));
  }
  return sections.join('\n\n');
}

// ------------------------------------------------------------------ renew

/** One letter per document in button data (Telegram allows 64 bytes). */
const FIELD_CODES = { i: 'insuranceExpiry', t: 'taxDate', f: 'testDate', p: 'pollutionDate' };
const CODE_FOR_FIELD = Object.fromEntries(Object.entries(FIELD_CODES).map(([c, f]) => [f, c]));
const documentLabel = (field) => DOCUMENTS[field] || '';

/** Longest a renewal may run: anything past this is a typo in the year. */
const MAX_RENEWAL_YEARS = 15;

/** A "പുതുക്കി" button per document in the morning message (at most 20). */
function renewKeyboard(due) {
  const rows = due
    .filter((d) => d.vehicleId && CODE_FOR_FIELD[d.field])
    .slice(0, 20)
    .map((d) => [{
      text: `🔄 ${d.vehicleNumber} ${d.label} പുതുക്കി`,
      callback_data: `ren:${CODE_FOR_FIELD[d.field]}:${d.vehicleId}`
    }]);
  return rows.length > 0 ? { inline_keyboard: rows } : null;
}

/**
 * Renewal buttons: "ren:<doc>:<vehicleId>" starts one; "rny:", "rnn:" and
 * "rnc:" + nonce answer the confirmation (yes, change the date, cancel).
 */
function parseRenewCallback(data) {
  const text = String(data || '');
  const start = /^ren:([itfp]):([a-f0-9]{24})$/.exec(text);
  if (start) return { action: 'ask', field: FIELD_CODES[start[1]], vehicleId: start[2] };
  const answer = /^rn([ync]):([a-f0-9]{8})$/.exec(text);
  if (answer) {
    return { action: { y: 'yes', n: 'change', c: 'cancel' }[answer[1]], nonce: answer[2] };
  }
  return null;
}

/**
 * A new expiry date as he would type it: 17/11/2027, 17-11-27, 17.11.2027
 * or 17 11 2027. It must be a real date after [today], and not absurdly far.
 * Gives { date } (local midnight, the stored convention) or { error }.
 */
function parseExpiryDate(input, today) {
  const match = /^(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4}|\d{2})$/.exec(String(input || '').trim());
  if (!match) {
    return { error: 'തീയതി മനസ്സിലായില്ല. ഇങ്ങനെ അയക്കുക: 17/11/2027' };
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const value = new Date(year, month - 1, day);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) {
    return { error: `${match[1]}/${match[2]}/${match[3]} എന്നൊരു തീയതി ഇല്ല. ദിവസവും മാസവും നോക്കുക.` };
  }
  const days = daysBetween(today, value);
  if (days <= 0) {
    return { error: 'ഈ തീയതി കഴിഞ്ഞുപോയി. പുതുക്കിയ ശേഷം രേഖ തീരുന്ന പുതിയ തീയതി അയക്കുക.' };
  }
  if (days > MAX_RENEWAL_YEARS * 366) {
    return { error: 'തീയതി ശരിയാണോ? വർഷം ഒന്ന് നോക്കുക.' };
  }
  return { date: value };
}

/** "17 നവംബർ 2027", spelt out so a wrong month is noticed. */
const longDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

const renewPrompt = (vehicleNumber, field) =>
  `🔄 <b>${escapeHtml(vehicleNumber)} ${documentLabel(field)}</b>\n\n` +
  'പുതുക്കിയ ശേഷം രേഖ തീരുന്ന പുതിയ തീയതി അയക്കുക.\nഉദാ: <b>17/11/2027</b>\n\n' +
  'വേണ്ടെങ്കിൽ "വേണ്ട" എന്ന് അയക്കുക.';

const renewConfirmText = (vehicleNumber, field, value) =>
  `🔄 <b>${escapeHtml(vehicleNumber)} ${documentLabel(field)}</b>\n\n` +
  `പുതിയ അവസാന തീയതി: <b>${longDate(value)}</b> (${date(value)})\nശരിയാണോ?`;

const renewConfirmKeyboard = (nonce) => ({
  inline_keyboard: [[
    { text: 'ഉവ്വ്, ശരിയാണ്', callback_data: `rny:${nonce}` },
    { text: 'മാറ്റണം', callback_data: `rnn:${nonce}` }
  ], [
    { text: 'വേണ്ട', callback_data: `rnc:${nonce}` }
  ]]
});

const renewDoneText = (vehicleNumber, field, value, by) =>
  `✅ <b>${escapeHtml(vehicleNumber)} ${documentLabel(field)}</b> ${date(value)} വരെ പുതുക്കി` +
  (by ? ` · ${escapeHtml(by)}` : '') +
  '\nഇനി അതിന്റെ ഓർമ്മപ്പെടുത്തൽ ആ തീയതിക്ക് മുമ്പ് മാത്രം.';

const RENEW_CANCELLED = 'ശരി, ഒന്നും മാറ്റിയില്ല.';
const RENEW_STALE = 'ഇത് പഴയതാണ്. രേഖയുടെ "പുതുക്കി" ബട്ടൺ വീണ്ടും അമർത്തുക.';

/** Words that cancel a renewal waiting for its date. */
const isCancelWord = (text) => /^(വേണ്ട|cancel|\/cancel|no)$/i.test(String(text || '').trim());

// ------------------------------------------------------------------ salary

function tripDay(tripDate, today) {
  const days = daysBetween(tripDate, today);
  if (days === 0) return 'ഇന്ന്';
  if (days === 1) return 'ഇന്നലെ';
  return dayMonth(tripDate);
}

function tripLine(trip, today) {
  const kind = trip.tripType === 'contract'
    ? 'കരാർ'
    : `സവാരി${trip.distance ? `, ${Math.round(trip.distance)} കി.മീ` : ''}`;
  const vehicle = trip.vehicleNumber ? ` · ${escapeHtml(trip.vehicleNumber)}` : '';
  return `• ${tripDay(new Date(trip.tripDate), today)} · ${escapeHtml(trip.clientName || '—')} ` +
    `(${kind})${vehicle} — <b>${money(trip.driverSalary)}</b>`;
}

/**
 * Groups unpaid trips by driver (by id; by name for trips from before driver
 * ids), largest amount first. Trips oldest first within each driver.
 */
function groupByDriver(trips) {
  const groups = new Map();
  for (const trip of trips) {
    const key = trip.driverId ? `id:${trip.driverId}` : `name:${String(trip.driverName).trim().toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, { driverId: trip.driverId || null, driverName: trip.driverName, trips: [], amount: 0 });
    }
    const group = groups.get(key);
    group.trips.push(trip);
    group.amount += trip.driverSalary || 0;
  }
  for (const group of groups.values()) {
    group.trips.sort((a, b) => new Date(a.tripDate) - new Date(b.tripDate));
    // The newest trip has the driver's current name.
    group.driverName = group.trips[group.trips.length - 1].driverName || '—';
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount);
}

/** One driver's pending salary, with every trip it is for. */
function salaryMessage(group, today) {
  const older = group.trips.filter((t) => daysBetween(new Date(t.tripDate), today) > 0).length;
  const count = `${group.trips.length} ട്രിപ്പ്` +
    (older > 0 && older < group.trips.length ? ` (${older} എണ്ണം മുമ്പത്തെ ദിവസങ്ങളിലേത്)` : '');

  const shown = group.trips.slice(-MAX_TRIP_LINES);
  const hidden = group.trips.slice(0, group.trips.length - shown.length);
  const lines = shown.map((t) => tripLine(t, today));
  if (hidden.length > 0) {
    const hiddenAmount = hidden.reduce((sum, t) => sum + (t.driverSalary || 0), 0);
    lines.unshift(`• …പഴയ ${hidden.length} ട്രിപ്പ് കൂടി — <b>${money(hiddenAmount)}</b>`);
  }

  return [
    `💰 <b>${escapeHtml(group.driverName)}</b>: ${money(group.amount)} ബാക്കി`,
    count,
    '',
    ...lines
  ].join('\n');
}

function salaryHeader(groups) {
  const total = groups.reduce((sum, g) => sum + g.amount, 0);
  return `💰 <b>ശമ്പളം ബാക്കി</b>: ${groups.length} ഡ്രൈവർ, ആകെ ${money(total)}\n` +
    'ഓരോരുത്തർക്കും കൊടുത്ത ശേഷം താഴെയുള്ള ബട്ടൺ അമർത്തുക.';
}

const NO_SALARY_PENDING = '✅ <b>ശമ്പളം</b>\nആർക്കും ശമ്പളം ബാക്കിയില്ല.';

const payButtonText = (notice) => `✅ ${notice.driverName}-ന് ${money(notice.amount)} കൊടുത്തു`;

const payKeyboard = (notice) => ({
  inline_keyboard: [[{ text: payButtonText(notice), callback_data: `pay:a:${notice._id}` }]]
});

const confirmKeyboard = (notice) => ({
  inline_keyboard: [[
    { text: 'ഉവ്വ്, കൊടുത്തു', callback_data: `pay:y:${notice._id}` },
    { text: 'ഇല്ല', callback_data: `pay:n:${notice._id}` }
  ]]
});

const confirmText = (notice) =>
  `${notice.text}\n\n❓ <b>${escapeHtml(notice.driverName)}-ന് ${money(notice.amount)} കൊടുത്തോ?</b>`;

/** The message once paid, on every copy: who marked it and when. */
function settledText(notice, { amount, by, at }) {
  const partial = amount !== notice.amount
    ? `\n(ബാക്കി ട്രിപ്പുകൾ നേരത്തെ ആപ്പിൽ കൊടുത്തതായി രേഖപ്പെടുത്തിയിരുന്നു.)`
    : '';
  return `${notice.text}\n\n✅ <b>${money(amount)} കൊടുത്തു</b> · ${dayMonth(at)} ${time(at)}` +
    (by ? ` · ${escapeHtml(by)}` : '') + partial;
}

const alreadyPaidText = (notice) =>
  `${notice.text}\n\nℹ️ ഈ ട്രിപ്പുകൾ നേരത്തെ കൊടുത്തതായി രേഖപ്പെടുത്തിയിട്ടുണ്ട്.`;

/** "pay:a:<id>" → { action: 'ask', noticeId }. Null for anything else. */
function parsePayCallback(data) {
  const match = /^pay:([any]):([a-f0-9]{24})$/.exec(String(data || ''));
  if (!match) return null;
  const action = { a: 'ask', y: 'yes', n: 'no' }[match[1]];
  return { action, noticeId: match[2] };
}

// ------------------------------------------------------------ month report

function resultLine(amount) {
  return amount < 0
    ? `<b>നഷ്ടം: ${money(-amount)}</b> 🔻`
    : `<b>ലാഭം: ${money(amount)}</b>`;
}

/**
 * A month's figures from buildDashboard. [soFar] for the running month
 * (the "ഈ മാസം" button), which also shows today.
 */
function monthMessage(dashboard, { soFar = false } = {}) {
  const s = dashboard.summary;
  const lines = [
    `📊 <b>${monthYear(dashboard.year, dashboard.month)}${soFar ? ' (ഇതുവരെ)' : ''}</b>`,
    ''
  ];

  if (soFar) {
    const t = dashboard.today;
    lines.push(`ഇന്ന്: ${t.tripCount} ട്രിപ്പ്, ${money(t.revenue)}`, '');
  }

  lines.push(
    `ട്രിപ്പ്: ${s.tripCount} (കരാർ ${s.contractTripCount}, സവാരി ${s.savariTripCount})`,
    `വരുമാനം: ${money(s.revenue)}`,
    `ഡ്രൈവർ ശമ്പളം: ${money(s.driverSalary)}`,
    `മറ്റ് ചെലവുകൾ: ${money(s.otherExpense)}`,
    resultLine(s.profit)
  );

  const unpaid = dashboard.unpaidDriverSalary;
  if (soFar && unpaid && unpaid.amount > 0) {
    lines.push('', `ശമ്പളം ബാക്കി: ${money(unpaid.amount)} (${unpaid.tripCount} ട്രിപ്പ്)`);
  }

  const clients = (dashboard.clients || []).slice(0, 3);
  if (clients.length > 0) {
    lines.push('', '<b>കൂടുതൽ വരുമാനം തന്നവർ</b>');
    for (const c of clients) {
      lines.push(`• ${escapeHtml(c.clientName)}: ${money(c.revenue)} (${c.tripCount} ട്രിപ്പ്)`);
    }
  }

  const vehicles = (dashboard.vehicles || []).slice(0, 3);
  if (vehicles.length > 0) {
    lines.push('', '<b>വാഹനങ്ങൾ</b>');
    for (const v of vehicles) {
      const word = v.profit < 0 ? 'നഷ്ടം' : 'ലാഭം';
      lines.push(`• ${escapeHtml(v.vehicleNumber)}: ${v.tripCount} ട്രിപ്പ്, ${word} ${money(Math.abs(v.profit))}`);
    }
  }

  return lines.join('\n');
}

// --------------------------------------------------------- driver statement

/** Most trips listed in a statement; the rest are counted in one line. */
const MAX_STATEMENT_LINES = 40;

/**
 * A driver's month for the owner to forward: trips, salary, paid, still owed,
 * and every trip with its salary, unpaid ones marked. [group] is one entry of
 * groupByDriver over all the month's trips, paid or not.
 */
function driverStatement(group, year, month) {
  const paid = group.trips
    .filter((t) => t.driverSalaryPaid)
    .reduce((sum, t) => sum + (t.driverSalary || 0), 0);
  const owed = group.amount - paid;

  const shown = group.trips.slice(0, MAX_STATEMENT_LINES);
  const lines = shown.map((t) => {
    const kind = t.tripType === 'contract'
      ? 'കരാർ'
      : `സവാരി${t.distance ? `, ${Math.round(t.distance)} കി.മീ` : ''}`;
    return `• ${dayMonth(new Date(t.tripDate))} · ${escapeHtml(t.clientName || '—')} (${kind}) — ` +
      `${money(t.driverSalary)}${t.driverSalaryPaid ? '' : ' <i>(ബാക്കി)</i>'}`;
  });
  if (group.trips.length > shown.length) {
    lines.push(`• …കൂടാതെ ${group.trips.length - shown.length} ട്രിപ്പ്`);
  }

  return [
    `🧾 <b>${escapeHtml(group.driverName)}</b> · ${monthYear(year, month)}`,
    '',
    `ട്രിപ്പ്: ${group.trips.length}`,
    `ആകെ ശമ്പളം: ${money(group.amount)}`,
    `കൊടുത്തത്: ${money(paid)}`,
    owed > 0 ? `<b>ബാക്കി: ${money(owed)}</b>` : 'ബാക്കി: ഇല്ല ✅',
    '',
    ...lines
  ].join('\n');
}

/**
 * The same in short plain text, for WhatsApp to the driver: the summary
 * only, as the whole message has to fit in a link.
 */
function driverStatementShort(group, year, month) {
  const paid = group.trips
    .filter((t) => t.driverSalaryPaid)
    .reduce((sum, t) => sum + (t.driverSalary || 0), 0);
  const owed = group.amount - paid;
  return [
    `${group.driverName} · ${monthYear(year, month)}`,
    `ട്രിപ്പ്: ${group.trips.length}`,
    `ആകെ ശമ്പളം: ${money(group.amount)}`,
    `കൊടുത്തത്: ${money(paid)}`,
    `ബാക്കി: ${owed > 0 ? money(owed) : 'ഇല്ല'}`
  ].join('\n');
}

const statementsHeader = (year, month, count) =>
  `🧾 <b>ഡ്രൈവർമാരുടെ ${monthYear(year, month)} കണക്ക്</b> (${count})\n` +
  'ഓരോന്നിന്റെയും താഴെയുള്ള ബട്ടൺ അമർത്തി ആ ഡ്രൈവർക്ക് WhatsApp-ൽ അയക്കാം.';

/**
 * A stored phone number as WhatsApp wants it (country code, digits only),
 * as the app's ContactActions.whatsAppNumber. Null when it can't be one.
 */
function whatsAppNumber(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) return `91${digits}`;
  if (digits.length > 10 && digits.length <= 15) return digits;
  return null;
}

/** A button opening WhatsApp to [phone] with [text] filled in; null without a number. */
function whatsAppKeyboard(phone, text) {
  const number = whatsAppNumber(phone);
  if (!number) return null;
  return {
    inline_keyboard: [[{
      text: 'WhatsApp-ൽ ഡ്രൈവർക്ക് അയക്കുക',
      url: `https://wa.me/${number}?text=${encodeURIComponent(text)}`
    }]]
  };
}

// ----------------------------------------------------------------- evening

/**
 * The day in one message at 8:30 PM, from buildDashboard's "today". With no
 * trips it asks whether he forgot to enter them.
 */
function eveningMessage(dashboard, now) {
  const t = dashboard.today;
  const day = dayMonth(now);

  if (!t.tripCount) {
    const lines = [
      `❓ <b>ഇന്ന് (${day}) ട്രിപ്പ് ഒന്നും ചേർത്തിട്ടില്ല.</b>`,
      'ഓടിയെങ്കിൽ ആപ്പിൽ ചേർക്കാൻ മറക്കല്ലേ.'
    ];
    if (t.otherExpense > 0) lines.push('', `ഇന്നത്തെ ചെലവ്: ${money(t.otherExpense)}`);
    return lines.join('\n');
  }

  const expense = t.otherExpense > 0
    ? `${money(t.totalExpense)} (ശമ്പളം ${money(t.driverSalary)}, മറ്റ് ${money(t.otherExpense)})`
    : `${money(t.totalExpense)} (ഡ്രൈവർ ശമ്പളം)`;
  const month = dashboard.summary;
  const monthWord = month.profit < 0 ? 'നഷ്ടം' : 'ലാഭം';

  return [
    `📋 <b>ഇന്ന് (${day})</b>`,
    '',
    `ട്രിപ്പ്: ${t.tripCount} (കരാർ ${t.contractTripCount}, സവാരി ${t.savariTripCount})`,
    `വരുമാനം: ${money(t.revenue)}`,
    `ചെലവ്: ${expense}`,
    resultLine(t.profit),
    '',
    `ഈ മാസം ഇതുവരെ: ${monthWord} ${money(Math.abs(month.profit))}`
  ].join('\n');
}

// ------------------------------------------------------------------- other

const WELCOME = [
  '✅ <b>Yathra Rekha ബന്ധിപ്പിച്ചു!</b>',
  '',
  'ഇനി ഇവിടെ കിട്ടും:',
  '• രാവിലെ 9 മണി: തീരാറായ വാഹന രേഖകളും കരാറുകളും',
  '• വൈകിട്ട് 7 മണി: ഡ്രൈവർമാർക്ക് കൊടുക്കാനുള്ള ശമ്പളം, ട്രിപ്പ് വിവരങ്ങളോടെ',
  '• രാത്രി 8:30: ഇന്നത്തെ കണക്ക്',
  '• മാസം 1-ന്: കഴിഞ്ഞ മാസത്തെ റിപ്പോർട്ടും കരാർ ബില്ലുകളും',
  '',
  'താഴെയുള്ള ബട്ടണുകൾ അമർത്തി എപ്പോൾ വേണമെങ്കിലും നോക്കാം.'
].join('\n');

const NOT_LINKED = [
  'ഈ Telegram ഇതുവരെ Yathra Rekha-യുമായി ബന്ധിപ്പിച്ചിട്ടില്ല.',
  '',
  'ആപ്പിൽ മെനു → <b>Telegram</b> → <b>Telegram-ൽ ബന്ധിപ്പിക്കുക</b> അമർത്തുക.'
].join('\n');

const LINK_EXPIRED = [
  'ഈ ലിങ്ക് പഴയതാണ് (15 മിനിറ്റ് മാത്രം) അല്ലെങ്കിൽ നേരത്തെ ഉപയോഗിച്ചതാണ്.',
  '',
  'ആപ്പിൽ നിന്ന് പുതിയ ലിങ്ക് എടുക്കുക.'
].join('\n');

const UNLINKED = 'ഈ Telegram-ലേക്ക് ഇനി സന്ദേശങ്ങൾ വരില്ല. വീണ്ടും വേണമെങ്കിൽ ആപ്പിൽ നിന്ന് ബന്ധിപ്പിക്കുക.';

const TEST_MESSAGE = '👋 <b>ടെസ്റ്റ് മെസ്സേജ്</b>\nYathra Rekha-യിൽ നിന്നുള്ള സന്ദേശങ്ങൾ ഇവിടെ കിട്ടും.';

const HELP = 'താഴെയുള്ള ബട്ടണുകൾ അമർത്തുക: ഈ മാസം, ശമ്പളം ബാക്കി, രേഖകൾ.';

const newMemberText = (name) =>
  `ℹ️ <b>${escapeHtml(name || 'ഒരാളെ')}</b> കൂടി ഈ അക്കൗണ്ടിന്റെ Telegram സന്ദേശങ്ങൾ കിട്ടാൻ ചേർത്തു. ` +
  'അറിയാത്ത ആളാണെങ്കിൽ ആപ്പിലെ Telegram പേജിൽ നിന്ന് നീക്കുക.';

/** "Girish Soman" from a Telegram chat or user. */
function chatName(from) {
  if (!from) return '';
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  return name || (from.username ? `@${from.username}` : '');
}

module.exports = {
  BUTTONS,
  QUICK_KEYBOARD,
  MAX_TRIP_LINES,
  escapeHtml,
  money,
  date,
  dayMonth,
  monthYear,
  time,
  dayKey,
  monthKey,
  daysBetween,
  dueJobs,
  remindsOn,
  dueWords,
  documentsDue,
  contractRemindsOn,
  contractsDue,
  documentsMessage,
  eveningMessage,
  FIELD_CODES,
  renewKeyboard,
  parseRenewCallback,
  parseExpiryDate,
  longDate,
  renewPrompt,
  renewConfirmText,
  renewConfirmKeyboard,
  renewDoneText,
  RENEW_CANCELLED,
  RENEW_STALE,
  isCancelWord,
  MAX_STATEMENT_LINES,
  driverStatement,
  driverStatementShort,
  statementsHeader,
  whatsAppNumber,
  whatsAppKeyboard,
  groupByDriver,
  salaryMessage,
  salaryHeader,
  NO_SALARY_PENDING,
  payButtonText,
  payKeyboard,
  confirmKeyboard,
  confirmText,
  settledText,
  alreadyPaidText,
  parsePayCallback,
  monthMessage,
  WELCOME,
  NOT_LINKED,
  LINK_EXPIRED,
  UNLINKED,
  TEST_MESSAGE,
  HELP,
  newMemberText,
  chatName
};
