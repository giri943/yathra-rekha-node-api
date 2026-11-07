const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const Trip = require('../models/Trip');
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
    const previous = await Driver.findOne({ _id: req.params.id, userId: req.user.id });
    if (!previous) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const driver = await Driver.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { name, phone },
      { new: true, runValidators: true }
    );

    // Trips record the driver by name, not by reference. Without carrying a
    // rename through, every past trip kept the old spelling: the driver's
    // history and unpaid salary split in two, and editing an old trip showed
    // an empty driver picker. Stopgap until trips carry a driverId.
    if (name && previous.name !== driver.name) {
      await Trip.updateMany(
        { userId: req.user.id, driverName: previous.name },
        { $set: { driverName: driver.name } }
      );
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
