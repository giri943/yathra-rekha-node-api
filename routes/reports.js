const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const Contract = require('../models/Contract');
const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const authenticateToken = require('../middleware/auth');

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

    // Calculate totals
    const totalTrips = trips.length;
    const totalAmount = trips.reduce((sum, trip) => sum + trip.tripRate, 0);
    const totalDistance = trips.reduce((sum, trip) => sum + (trip.distance || 0), 0);

    // Create PDF
    const doc = new PDFDocument({ margin: 50 });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=contract-billing-${contract.contractName}-${Date.now()}.pdf`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(20).text('BILLING REPORT', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text('Yathra Rekha - Vehicle Management', { align: 'center' });
    doc.moveDown(2);

    // Contract Details
    doc.fontSize(14).text('Contract Details:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Contract Name: ${contract.contractName}`);
    doc.text(`Contract Rate: Rs. ${contract.rate.toFixed(2)} per trip`);
    doc.text(`Average Distance: ${contract.averageDistance.toFixed(1)} km`);
    doc.text(`Vehicle: ${contract.vehicleId?.vehicleNumber || 'N/A'} - ${contract.vehicleId?.model || 'N/A'}`);
    if (contract.contactPhone) {
      doc.text(`Contact: ${contract.contactPhone}`);
    }
    doc.text(`Contract Period: ${formatDate(contract.contractStartDate)} to ${formatDate(contract.contractEndDate)}`);
    
    if (startDate && endDate) {
      doc.text(`Billing Period: ${formatDate(new Date(startDate))} to ${formatDate(new Date(endDate))}`);
    }
    doc.moveDown(2);

    // Summary
    doc.fontSize(14).text('Summary:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Total Trips: ${totalTrips}`);
    doc.text(`Total Distance: ${totalDistance.toFixed(1)} km`);
    doc.text(`Average Distance per Trip: ${totalTrips > 0 ? (totalDistance / totalTrips).toFixed(1) : '0.0'} km`);
    doc.fontSize(13).fillColor('green').text(`Total Amount: Rs. ${totalAmount.toFixed(2)}`, { bold: true });
    doc.fillColor('black');
    doc.moveDown(2);

    // Trip Details Table
    doc.fontSize(14).text('Trip Details:', { underline: true });
    doc.moveDown(0.5);

    // Table headers
    const tableTop = doc.y;
    const col1 = 50;
    const col2 = 120;
    const col3 = 220;
    const col4 = 320;
    const col5 = 420;
    const col6 = 500;

    doc.fontSize(10).fillColor('blue');
    doc.text('Date', col1, tableTop);
    doc.text('Vehicle', col2, tableTop);
    doc.text('Driver', col3, tableTop);
    doc.text('Distance', col4, tableTop);
    doc.text('Rate', col5, tableTop);
    doc.text('Notes', col6, tableTop);
    doc.fillColor('black');

    // Draw line under headers
    doc.moveTo(col1, tableTop + 15).lineTo(570, tableTop + 15).stroke();

    let yPosition = tableTop + 25;

    // Trip rows
    trips.forEach((trip, index) => {
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }

      doc.fontSize(9);
      doc.text(formatDate(trip.tripDate), col1, yPosition, { width: 60 });
      doc.text(trip.vehicleId?.vehicleNumber || 'N/A', col2, yPosition, { width: 90 });
      doc.text(trip.driverName, col3, yPosition, { width: 90 });
      doc.text(`${(trip.distance || 0).toFixed(1)} km`, col4, yPosition, { width: 90 });
      doc.text(`Rs. ${trip.tripRate.toFixed(2)}`, col5, yPosition, { width: 70 });
      doc.text(trip.notes || '-', col6, yPosition, { width: 70 });

      yPosition += 20;
    });

    // Footer
    doc.moveDown(3);
    yPosition = doc.y;
    if (yPosition > 700) {
      doc.addPage();
      yPosition = 50;
    }

    doc.fontSize(10);
    doc.text('_'.repeat(80), 50, yPosition);
    doc.moveDown(0.5);
    doc.text(`Generated on: ${formatDate(new Date())}`, { align: 'center' });
    doc.text('Thank you for your business!', { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ message: 'Error generating PDF', error: error.message });
  }
});

// Helper function to format date
function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

module.exports = router;
