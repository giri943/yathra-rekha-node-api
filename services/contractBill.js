const fs = require('fs');
const path = require('path');

/// Gayathri (Swathanthra Malayalam Computing). Chosen because fontkit — which
/// PDFKit uses for shaping — crashes on Noto Sans/Serif Malayalam, and
/// Malayalam needs real glyph reordering, not just a glyph table. It also
/// covers Latin, digits and ₹, so one font serves both languages.
const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Gayathri-Regular.ttf');

/// Every label on the bill, in both languages. A bill goes to the customer,
/// so it is in the language the customer reads, chosen when it is made.
const LABELS = {
  ml: {
    title: 'ബിൽ',
    billedTo: 'ബിൽ ചെയ്യുന്നത്',
    period: 'കാലയളവ്',
    vehicle: 'വാഹനം',
    ratePerTrip: 'ഒരു യാത്രയ്ക്ക്',
    no: 'നം.',
    date: 'തീയതി',
    distance: 'ദൂരം',
    amount: 'തുക',
    trips: 'ആകെ യാത്രകൾ',
    totalDistance: 'ആകെ ദൂരം',
    total: 'ആകെ തുക',
    km: 'കി.മീ',
    noTrips: 'ഈ കാലയളവിൽ യാത്രകൾ ഇല്ല',
    thanks: 'നന്ദി',
    generated: 'തയ്യാറാക്കിയത്',
    phone: 'ഫോൺ',
    page: 'പേജ്',
  },
  en: {
    title: 'BILL',
    billedTo: 'Billed to',
    period: 'Period',
    vehicle: 'Vehicle',
    ratePerTrip: 'Rate per trip',
    no: 'No.',
    date: 'Date',
    distance: 'Distance',
    amount: 'Amount',
    trips: 'Total trips',
    totalDistance: 'Total distance',
    total: 'Total amount',
    km: 'km',
    noTrips: 'No trips in this period',
    thanks: 'Thank you for your business',
    generated: 'Generated on',
    phone: 'Phone',
    page: 'Page',
  },
};

const INK = '#0F172A';
const MUTED = '#475569';
const RULE = '#CBD5E1';
const SHADE = '#F1F5F9';
const ACCENT = '#2F4FCD';

function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

/**
 * Lays out a contract bill on [doc] (a PDFKit document).
 *
 * Deliberately leaves out the driver and the owner's trip notes: this is the
 * customer's copy, and those were internal ("രാവിലത്തെ ട്രിപ്പ്" printed on
 * a client's bill).
 *
 * @param {object} data
 *   contract  {contractName, rate, contactPhone, vehicleId?: {vehicleNumber, model}}
 *   trips     [{tripDate, distance, tripRate, vehicleId?: {vehicleNumber}}], oldest first
 *   owner     {name, phone} — who the bill is from
 *   lang      'ml' | 'en'
 *   startDate, endDate  optional billing period
 */
function buildContractBill(doc, { contract, trips, owner, lang = 'en', startDate, endDate }) {
  const L = LABELS[lang] || LABELS.en;
  const hasFont = fs.existsSync(FONT_PATH);
  if (hasFont) doc.registerFont('bill', FONT_PATH);
  const font = hasFont ? 'bill' : 'Helvetica';
  doc.font(font);

  // Without the embedded font, Helvetica has no ₹ glyph.
  const money = (amount) => {
    const value = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount || 0);
    return hasFont ? `₹${value}` : `Rs. ${value}`;
  };
  const km = (value) => `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(value || 0)} ${L.km}`;

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottom = doc.page.height - doc.page.margins.bottom;

  // ------------------------------------------------------------- header
  const top = doc.y;
  doc.fillColor(ACCENT).fontSize(26).text(L.title, left, top);
  if (owner?.name) {
    doc.fillColor(INK).fontSize(13).text(owner.name, left, top + 2, { width, align: 'right' });
  }
  if (owner?.phone) {
    doc.fillColor(MUTED).fontSize(10).text(`${L.phone}: ${owner.phone}`, left, doc.y, { width, align: 'right' });
  }
  let y = Math.max(doc.y, top + 34) + 10;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(RULE).stroke();
  y += 16;

  // --------------------------------------------- billed to | period, vehicle
  const half = width / 2 - 10;
  // Malayalam at 9pt is hard to read; its letters need more size than Latin.
  const labelSize = lang === 'ml' ? 10.5 : 9;
  const label = (text, x, at, w) => {
    doc.fillColor(MUTED).fontSize(labelSize).text(text.toUpperCase(), x, at, { width: w });
    return doc.y + 2;
  };
  const value = (text, x, at, w, size = 12) => {
    doc.fillColor(INK).fontSize(size).text(text, x, at, { width: w });
    return doc.y;
  };

  let leftY = label(L.billedTo, left, y, half);
  leftY = value(contract.contractName, left, leftY, half, 14);
  if (contract.contactPhone) {
    doc.fillColor(MUTED).fontSize(10).text(`${L.phone}: ${contract.contactPhone}`, left, leftY + 2, { width: half });
    leftY = doc.y;
  }

  const rightX = left + width / 2 + 10;
  let rightY = y;
  if (startDate && endDate) {
    rightY = label(L.period, rightX, rightY, half);
    rightY = value(`${formatDate(startDate)} – ${formatDate(endDate)}`, rightX, rightY, half) + 8;
  }
  const vehicle = contract.vehicleId;
  if (vehicle?.vehicleNumber) {
    rightY = label(L.vehicle, rightX, rightY, half);
    rightY = value(vehicle.vehicleNumber, rightX, rightY, half) + 8;
  }
  rightY = label(L.ratePerTrip, rightX, rightY, half);
  rightY = value(money(contract.rate), rightX, rightY, half);

  y = Math.max(leftY, rightY) + 24;

  // -------------------------------------------------------------- table
  const cols = [
    { key: 'no', title: L.no, width: 40, align: 'left' },
    { key: 'date', title: L.date, width: 95, align: 'left' },
    { key: 'vehicle', title: L.vehicle, width: 150, align: 'left' },
    { key: 'distance', title: L.distance, width: 90, align: 'right' },
    { key: 'amount', title: L.amount, width: width - 375, align: 'right' },
  ];
  const pad = 8;

  const drawRow = (cells, at, { header = false, shaded = false } = {}) => {
    doc.fontSize(header ? 10 : 11);
    // Rows grow to fit wrapped text instead of overlapping the next one.
    const textHeight = Math.max(...cols.map((c) =>
      doc.heightOfString(String(cells[c.key] ?? ''), { width: c.width - pad * 2 })));
    const height = textHeight + pad * 2;
    if (header || shaded) {
      doc.rect(left, at, width, height).fill(header ? SHADE : '#FAFBFD');
    }
    let x = left;
    for (const c of cols) {
      doc.fillColor(header ? MUTED : INK)
        .text(String(cells[c.key] ?? ''), x + pad, at + pad, { width: c.width - pad * 2, align: c.align });
      x += c.width;
    }
    return at + height;
  };

  const header = Object.fromEntries(cols.map((c) => [c.key, c.title]));
  y = drawRow(header, y, { header: true });

  if (!trips.length) {
    doc.fillColor(MUTED).fontSize(11).text(L.noTrips, left, y + 12, { width, align: 'center' });
    y = doc.y + 12;
  }

  trips.forEach((trip, index) => {
    const cells = {
      no: String(index + 1),
      date: formatDate(trip.tripDate),
      vehicle: trip.vehicleId?.vehicleNumber || vehicle?.vehicleNumber || '—',
      distance: trip.distance ? km(trip.distance) : '—',
      amount: money(trip.tripRate),
    };
    if (y + 40 > bottom) {
      doc.addPage();
      doc.font(font);
      y = doc.page.margins.top;
      y = drawRow(header, y, { header: true });
    }
    y = drawRow(cells, y, { shaded: index % 2 === 1 });
  });

  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(RULE).stroke();

  // ------------------------------------------------------------- totals
  const totalAmount = trips.reduce((sum, t) => sum + (t.tripRate || 0), 0);
  const totalDistance = trips.reduce((sum, t) => sum + (t.distance || 0), 0);
  if (y + 110 > bottom) {
    doc.addPage();
    doc.font(font);
    y = doc.page.margins.top;
  }
  y += 14;
  const boxX = left + width / 2;
  const boxW = width / 2;
  const totalLine = (text, amount, size, colour) => {
    doc.fillColor(colour).fontSize(size);
    doc.text(text, boxX, y, { width: boxW / 2 });
    doc.text(amount, boxX + boxW / 2, y, { width: boxW / 2, align: 'right' });
    y = doc.y + 6;
  };
  totalLine(L.trips, String(trips.length), 11, MUTED);
  totalLine(L.totalDistance, km(totalDistance), 11, MUTED);
  doc.moveTo(boxX, y).lineTo(right, y).lineWidth(1.5).strokeColor(INK).stroke();
  y += 8;
  totalLine(L.total, money(totalAmount), 16, INK);

  // ------------------------------------------------------------- footer
  y += 30;
  if (y + 40 > bottom) {
    doc.addPage();
    doc.font(font);
    y = doc.page.margins.top;
  }
  doc.fillColor(INK).fontSize(12).text(L.thanks, left, y, { width, align: 'center' });
  doc.fillColor(MUTED).fontSize(9).text(`${L.generated}: ${formatDate(new Date())}`, left, doc.y + 4, { width, align: 'center' });

  return { totalAmount, totalDistance, tripCount: trips.length };
}

module.exports = { buildContractBill, LABELS };
