const PDFDocument = require('pdfkit');
const Contract = require('../models/Contract');
const Trip = require('../models/Trip');
const User = require('../models/User');
const { buildContractBill } = require('./contractBill');

/**
 * One contract's bill for [start]–[end] as a PDF in memory, the same bill
 * GET /reports/contract-billing makes; for sending on Telegram.
 * Null when the contract is not this user's.
 */
async function contractBillPdf({ userId, contractId, start, end, lang = 'ml' }) {
  const contract = await Contract.findOne({ _id: contractId, userId }).populate('vehicleId');
  if (!contract) return null;

  const [trips, owner] = await Promise.all([
    Trip.find({
      contractId,
      userId,
      tripType: 'contract',
      tripDate: { $gte: start, $lte: end }
    }).populate('vehicleId').sort({ tripDate: 1 }),
    User.findById(userId).select('name phone').lean()
  ]);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  buildContractBill(doc, { contract, trips, owner, lang, startDate: start, endDate: end });
  doc.end();
  await done;

  return { contract, buffer: Buffer.concat(chunks) };
}

/** Ids of this user's contracts that had trips in [start]–[end]. */
const contractsWithTrips = (userId, start, end) => Trip.distinct('contractId', {
  userId,
  tripType: 'contract',
  tripDate: { $gte: start, $lte: end }
});

module.exports = { contractBillPdf, contractsWithTrips };
