const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const Vehicle = require('../models/Vehicle');
const auth = require('../middleware/auth');
const { queryFrom, containsRegex, vehicleIdsMatching } = require('../utils/search');

// List expenses, newest first, optionally scoped to a month or a vehicle.
router.get('/', auth, async (req, res) => {
  try {
    const filter = { userId: req.user.id };

    if (req.query.category) filter.category = req.query.category;
    if (req.query.vehicleId) filter.vehicleId = req.query.vehicleId;

    if (req.query.startDate || req.query.endDate) {
      filter.expenseDate = {};
      if (req.query.startDate) {
        filter.expenseDate.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        const end = new Date(req.query.endDate);
        end.setHours(23, 59, 59, 999);
        filter.expenseDate.$lte = end;
      }
    }

    // Free-text search over notes and vehicle number. Category names are in
    // Malayalam on the phone and stored as keys here, so the app matches the
    // label itself and sends the keys it hit as `categories`.
    const q = queryFrom(req);
    if (q) {
      const categories = String(req.query.categories || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      filter.$or = [
        { notes: containsRegex(q) },
        { vehicleId: { $in: await vehicleIdsMatching(Vehicle, req.user.id, q) } },
        ...(categories.length ? [{ category: { $in: categories } }] : []),
      ];
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const [expenses, total, sums] = await Promise.all([
      Expense.find(filter)
        .populate('vehicleId', 'vehicleNumber model')
        .sort({ expenseDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Expense.countDocuments(filter),
      // The total of everything matched, not just this page, so a paged
      // list can still show an honest figure.
      Expense.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: '$amount' } } }])
    ]);

    res.json({
      expenses,
      totalAmount: sums[0]?.amount || 0,
      pagination: {
        page,
        limit,
        total,
        hasNext: page * limit < total
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const data = { ...req.body, userId: req.user.id };

    // An empty string from the form is not a valid ObjectId; drop it so the
    // expense is simply recorded against no particular vehicle.
    if (!data.vehicleId) delete data.vehicleId;

    const expense = new Expense(data);
    const saved = await expense.save();

    const populated = await Expense.findById(saved._id)
      .populate('vehicleId', 'vehicleNumber model');

    res.status(201).json(populated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const data = { ...req.body };
    if (!data.vehicleId) data.vehicleId = null;

    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      data,
      { new: true, runValidators: true }
    ).populate('vehicleId', 'vehicleNumber model');

    if (!expense) {
      return res.status(404).json({ message: 'ചെലവ് കണ്ടെത്തിയില്ല' });
    }
    res.json(expense);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const expense = await Expense.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!expense) {
      return res.status(404).json({ message: 'ചെലവ് കണ്ടെത്തിയില്ല' });
    }
    res.json({ message: 'ചെലവ് നീക്കം ചെയ്തു' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
