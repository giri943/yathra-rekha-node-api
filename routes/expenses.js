const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const auth = require('../middleware/auth');

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

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const [expenses, total] = await Promise.all([
      Expense.find(filter)
        .populate('vehicleId', 'vehicleNumber model')
        .sort({ expenseDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Expense.countDocuments(filter)
    ]);

    res.json({
      expenses,
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
