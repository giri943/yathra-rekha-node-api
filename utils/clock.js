// "Now", as the owner's wall clock in Kerala sees it.
//
// Dates from the app arrive without a timezone ("2026-11-09T00:00:00.000"),
// so the server stores them as that wall-clock time in ITS OWN zone. Render
// runs in UTC, which is fine for stored dates, but `new Date()` there is
// 5 h 30 m behind Kerala: between midnight and 5:30 AM the dashboard's
// "today" was still yesterday, and a contract ending yesterday still looked
// active.
//
// businessNow() returns a Date whose LOCAL fields (getDate(), getHours()...)
// are Kerala's current wall clock, i.e. the same convention the stored dates
// use. Use it for "today", "this month" and "has this expired yet"; never
// for timestamps (createdAt, token expiry), which stay real instants.
//
// Setting process.env.TZ instead would also move how every incoming date is
// parsed, shifting all records already saved by 5 h 30 m.

const KERALA_OFFSET_MINUTES = 330; // UTC+05:30, no daylight saving.

function businessNow(at = Date.now()) {
  const serverOffsetMinutes = -new Date(at).getTimezoneOffset();
  return new Date(at + (KERALA_OFFSET_MINUTES - serverOffsetMinutes) * 60000);
}

function startOfBusinessToday(at) {
  const now = businessNow(at);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

module.exports = { businessNow, startOfBusinessToday };
