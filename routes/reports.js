const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { buildContractBill } = require('../services/contractBill');
const { buildDashboard } = require('../services/businessSummary');
const User = require('../models/User');
const Contract = require('../models/Contract');
const Trip = require('../models/Trip');
const authenticateToken = require('../middleware/auth');

// Business dashboard: see services/businessSummary.js.
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    res.json(await buildDashboard(req.user.id, req.query));
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Generate contract billing PDF
router.get('/contract-billing/:contractId', authenticateToken, async (req, res) => {
  try {
    const { contractId } = req.params;
    const { startDate, endDate } = req.query;

    // Fetch contract details
    const contract = await Contract.findOne({ _id: contractId, userId: req.user.id })
      .populate('vehicleId');
    
    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    // Build query for trips
    const tripQuery = {
      contractId: contractId,
      userId: req.user.id,
      tripType: 'contract'
    };

    if (startDate && endDate) {
      tripQuery.tripDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Fetch trips for this contract
    const trips = await Trip.find(tripQuery)
      .populate('vehicleId')
      .sort({ tripDate: 1 });

    // The customer's language, chosen in the app when the bill is made.
    // Older app builds send nothing and keep getting the English bill.
    const lang = req.query.lang === 'ml' ? 'ml' : 'en';
    const owner = await User.findById(req.user.id).select('name phone').lean();

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');

    // HTTP headers are ISO-8859-1 only. Interpolating a Malayalam contract
    // name straight into Content-Disposition made Node throw ERR_INVALID_CHAR
    // and the whole request 500 — so the filename is ASCII, with the real
    // name carried in the RFC 5987 form that clients actually read.
    const asciiName = contract.contractName
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/["\\]/g, '')
      .trim()
      .slice(0, 40);
    const fallbackName = `billing-${asciiName || 'contract'}-${Date.now()}.pdf`;
    const unicodeName = `billing-${contract.contractName}-${Date.now()}.pdf`;

    res.setHeader(
      'Content-Disposition',
      `inline; filename="${fallbackName}"; ` +
        `filename*=UTF-8''${encodeURIComponent(unicodeName)}`
    );

    doc.pipe(res);

    buildContractBill(doc, {
      contract,
      trips,
      owner,
      lang,
      startDate: startDate && endDate ? new Date(startDate) : null,
      endDate: startDate && endDate ? new Date(endDate) : null,
    });

    doc.end();

  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ message: 'Error generating PDF', error: error.message });
  }
});


module.exports = router;
