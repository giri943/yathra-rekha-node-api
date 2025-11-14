const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const auth = require('../middleware/auth');

// Get all drivers
router.get('/', auth, async (req, res) => {
  try {
    const drivers = await Driver.find({ userId: req.user.id }).sort({ name: 1 });
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add new driver
router.post('/', auth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const driver = new Driver({
      name,
      phone,
      userId: req.user.id
    });
    await driver.save();
    res.status(201).json(driver);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update driver
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const driver = await Driver.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { name, phone },
      { new: true }
    );
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    res.json(driver);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete driver
router.delete('/:id', auth, async (req, res) => {
  try {
    const driver = await Driver.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }
    res.json({ message: 'Driver deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
