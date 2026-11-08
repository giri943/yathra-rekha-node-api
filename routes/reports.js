const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { buildContractBill } = require('../services/contractBill');
const User = require('../models/User');
const Contract = require('../models/Contract');
const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const Expense = require('../models/Expense');
const authenticateToken = require('../middleware/auth');

// Business dashboard: revenue, expense and profit for a given month, plus
// today's figures and anything needing attention.
//
// Everything is computed here rather than in the app so the phone makes one
// request instead of downloading every trip and summing them client-side.
//
// Revenue = total of trip rates (what clients pay)
// Expense = driver salaries (recorded on each trip)
//         + standalone costs from the Expense collection (fuel, repairs,
//           parts, tax, insurance)
// Profit  = revenue - expense
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    // Month is 1-12 in the query; JS Date months are 0-11.
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || now.getMonth() + 1;

    const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // Sums revenue/expense/profit over a date range, split by trip type.
    const summarise = async (from, to) => {
      const rows = await Trip.aggregate([
        { $match: { userId, tripDate: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: '$tripType',
            tripCount: { $sum: 1 },
            revenue: { $sum: '$tripRate' },
            driverSalary: { $sum: '$driverSalary' },
            distance: { $sum: { $ifNull: ['$distance', 0] } }
          }
        }
      ]);

      const totals = {
        tripCount: 0,
        revenue: 0,
        driverSalary: 0,
        distance: 0,
        contractTripCount: 0,
        contractRevenue: 0,
        savariTripCount: 0,
        savariRevenue: 0
      };

      for (const row of rows) {
        totals.tripCount += row.tripCount;
        totals.revenue += row.revenue;
        totals.driverSalary += row.driverSalary;
        totals.distance += row.distance;

        if (row._id === 'contract') {
          totals.contractTripCount = row.tripCount;
          totals.contractRevenue = row.revenue;
        } else if (row._id === 'savari') {
          totals.savariTripCount = row.tripCount;
          totals.savariRevenue = row.revenue;
        }
      }

      totals.profit = totals.revenue - totals.driverSalary;
      return totals;
    };

    // Driver salary recorded but not yet handed over — money still owed.
    //
    // Broken down per driver as well as in total: "you owe Rs 1,125" is not
    // actionable on its own, because the owner still has to work out who to
    // pay and for which trips.
    const unpaidSalary = async (from, to) => {
      const match = {
        userId,
        driverSalaryPaid: false,
        tripDate: { $gte: from, $lte: to }
      };

      const [byDriver, [totals]] = await Promise.all([
        Trip.aggregate([
          { $match: match },
          {
            $group: {
              _id: '$driverName',
              amount: { $sum: '$driverSalary' },
              tripCount: { $sum: 1 },
              oldestTripDate: { $min: '$tripDate' },
              latestTripDate: { $max: '$tripDate' }
            }
          },
          // Largest debt first: that is the one to settle.
          { $sort: { amount: -1 } }
        ]),
        Trip.aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              amount: { $sum: '$driverSalary' },
              tripCount: { $sum: 1 }
            }
          }
        ])
      ]);

      return {
        amount: totals?.amount || 0,
        tripCount: totals?.tripCount || 0,
        drivers: byDriver.map((row) => ({
          driverName: row._id || '—',
          amount: row.amount,
          tripCount: row.tripCount,
          oldestTripDate: row.oldestTripDate,
          latestTripDate: row.latestTripDate
        }))
      };
    };

    // Standalone costs — fuel, repairs, parts, tax — totalled and split by
    // category. Driver salary lives on the trip, so it is counted separately
    // and added in when computing true profit.
    const otherExpenses = async (from, to) => {
      const rows = await Expense.aggregate([
        { $match: { userId, expenseDate: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: '$category',
            amount: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        },
        { $sort: { amount: -1 } }
      ]);

      return {
        total: rows.reduce((sum, row) => sum + row.amount, 0),
        count: rows.reduce((sum, row) => sum + row.count, 0),
        byCategory: rows.map((row) => ({
          category: row._id,
          amount: row.amount,
          count: row.count
        }))
      };
    };

    // Revenue per client, so the owner can see which customers are actually
    // worth keeping — a question the app previously could not answer at all.
    const perClient = async (from, to) => {
      const rows = await Trip.aggregate([
        { $match: { userId, tripDate: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: {
              // Contract work groups by contract; casual savari work groups by
              // the client's name, which is all that gets recorded for it.
              $cond: [
                { $eq: ['$tripType', 'contract'] },
                { $concat: ['contract:', { $toString: '$contractId' }] },
                { $concat: ['client:', { $toLower: '$clientName' }] }
              ]
            },
            clientName: { $first: '$clientName' },
            tripType: { $first: '$tripType' },
            contractId: { $first: '$contractId' },
            tripCount: { $sum: 1 },
            revenue: { $sum: '$tripRate' },
            driverSalary: { $sum: '$driverSalary' },
            distance: { $sum: { $ifNull: ['$distance', 0] } },
            excessKm: { $sum: { $ifNull: ['$excessKm', 0] } },
            excessCost: { $sum: { $ifNull: ['$excessCost', 0] } },
            lastTripDate: { $max: '$tripDate' }
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 20 }
      ]);

      return rows.map((row) => ({
        clientName: row.clientName || '—',
        tripType: row.tripType,
        tripCount: row.tripCount,
        revenue: row.revenue,
        driverSalary: row.driverSalary,
        distance: row.distance,
        excessKm: row.excessKm,
        excessCost: row.excessCost,
        lastTripDate: row.lastTripDate
      }));
    };

    // Per-vehicle breakdown so the owner can see which vehicle earns most.
    const perVehicle = async (from, to) => {
      const [tripRows, expenseRows, vehicles] = await Promise.all([
        Trip.aggregate([
          { $match: { userId, tripDate: { $gte: from, $lte: to } } },
          {
            $group: {
              _id: '$vehicleId',
              tripCount: { $sum: 1 },
              revenue: { $sum: '$tripRate' },
              driverSalary: { $sum: '$driverSalary' }
            }
          }
        ]),
        // Fuel and repairs are attributed to the vehicle they were spent on,
        // so per-vehicle profit reflects what that vehicle actually costs to
        // run rather than just what its driver was paid.
        Expense.aggregate([
          {
            $match: {
              userId,
              vehicleId: { $ne: null },
              expenseDate: { $gte: from, $lte: to }
            }
          },
          { $group: { _id: '$vehicleId', amount: { $sum: '$amount' } } }
        ]),
        Vehicle.find({ userId }).select('vehicleNumber model')
      ]);

      const byId = new Map(vehicles.map((v) => [v._id.toString(), v]));
      const expenseById = new Map(
        expenseRows.map((row) => [row._id?.toString(), row.amount])
      );

      // Union of vehicles that earned and vehicles that cost: a vehicle in the
      // workshop all month has expenses and no trips, and hiding it would make
      // the month look more profitable than it was.
      const ids = new Set([
        ...tripRows.map((r) => r._id?.toString()),
        ...expenseRows.map((r) => r._id?.toString())
      ]);

      const tripById = new Map(tripRows.map((r) => [r._id?.toString(), r]));

      return [...ids]
        .map((id) => {
          const vehicle = byId.get(id);
          const trips = tripById.get(id);
          const revenue = trips?.revenue || 0;
          const driverSalary = trips?.driverSalary || 0;
          const otherExpense = expenseById.get(id) || 0;

          return {
            vehicleId: id,
            vehicleNumber: vehicle?.vehicleNumber || '—',
            model: vehicle?.model || '',
            tripCount: trips?.tripCount || 0,
            revenue,
            driverSalary,
            otherExpense,
            expense: driverSalary + otherExpense,
            profit: revenue - driverSalary - otherExpense
          };
        })
        .sort((a, b) => b.revenue - a.revenue);
    };

    // Previous month, so the summary can say whether things are up or down.
    //
    // While the month on screen is still running, compare like with like: the
    // first N days of last month against the first N of this one. Measured
    // against the whole of last month, every month looked like a collapse
    // until its final week — "70% down" in red on the 7th, for an owner who
    // reads that as bad news, not as arithmetic.
    const isCurrentMonth =
      year === now.getFullYear() && month === now.getMonth() + 1;
    const previousStart = new Date(year, month - 2, 1, 0, 0, 0, 0);
    const previousMonthDays = new Date(year, month - 1, 0).getDate();
    const previousEnd = isCurrentMonth
      ? new Date(year, month - 2, Math.min(now.getDate(), previousMonthDays), 23, 59, 59, 999)
      : new Date(year, month - 1, 0, 23, 59, 59, 999);

    const [
      today,
      monthTotals,
      previousTotals,
      todayExpenses,
      monthExpenses,
      previousExpenses,
      unpaid,
      clients,
      vehicles,
      allVehicles,
      drivers
    ] = await Promise.all([
      summarise(todayStart, todayEnd),
      summarise(monthStart, monthEnd),
      summarise(previousStart, previousEnd),
      otherExpenses(todayStart, todayEnd),
      otherExpenses(monthStart, monthEnd),
      otherExpenses(previousStart, previousEnd),
      unpaidSalary(new Date(0), monthEnd),
      perClient(monthStart, monthEnd),
      perVehicle(monthStart, monthEnd),
      Vehicle.find({ userId }).select(
        'vehicleNumber insuranceExpiry taxDate testDate pollutionDate'
      ),
      Driver.find({ userId }).select('name phone')
    ]);

    // Fold standalone costs into each period so "profit" means revenue minus
    // everything the business actually spent, not just driver salary.
    const withExpenses = (totals, expenses) => ({
      ...totals,
      otherExpense: expenses.total,
      otherExpenseCount: expenses.count,
      expenseByCategory: expenses.byCategory,
      totalExpense: totals.driverSalary + expenses.total,
      profit: totals.revenue - totals.driverSalary - expenses.total
    });

    // Attach phone numbers so the owner can ring a driver straight from the
    // amount owed. Trips store the driver's name rather than a reference, so
    // this matches on name and simply omits the number when there is no match.
    const phoneByName = new Map(
      drivers.map((d) => [d.name.trim().toLowerCase(), d.phone])
    );
    unpaid.drivers = unpaid.drivers.map((entry) => ({
      ...entry,
      phone: phoneByName.get(entry.driverName.trim().toLowerCase()) || null
    }));

    // Documents already expired, or expiring within 30 days.
    // Expired entries come first — they are the urgent ones.
    const documentLabels = {
      insuranceExpiry: 'ഇൻഷുറൻസ്',
      taxDate: 'ടാക്സ്',
      testDate: 'ടെസ്റ്റ്',
      pollutionDate: 'പൊള്യൂഷൻ'
    };

    const expiringDocuments = [];
    for (const vehicle of allVehicles) {
      for (const [field, label] of Object.entries(documentLabels)) {
        const date = vehicle[field];
        if (!date) continue;

        const daysLeft = Math.floor((new Date(date) - todayStart) / 86400000);
        if (daysLeft <= 30) {
          expiringDocuments.push({
            vehicleId: vehicle._id,
            vehicleNumber: vehicle.vehicleNumber,
            documentType: label,
            date,
            daysLeft,
            expired: daysLeft < 0
          });
        }
      }
    }
    expiringDocuments.sort((a, b) => a.daysLeft - b.daysLeft);

    res.json({
      year,
      month,
      today: withExpenses(today, todayExpenses),
      summary: withExpenses(monthTotals, monthExpenses),
      previous: withExpenses(previousTotals, previousExpenses),
      // Tells the app which comparison it is showing, so it can say so.
      previousIsToDate: isCurrentMonth,
      unpaidDriverSalary: unpaid,
      clients,
      vehicles,
      expiringDocuments
    });
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
