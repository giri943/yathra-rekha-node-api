const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const Trip = require('../models/Trip');
const auth = require('../middleware/auth');

const DUPLICATE_NAME =
  'ഈ പേരിൽ ഒരു ഡ്രൈവർ ഇതിനകം ഉണ്ട്. വേർതിരിച്ചറിയാൻ പേരിൽ എന്തെങ്കിലും ചേർക്കുക';

const sameName = (a, b) =>
  String(a ?? '').trim().replace(/\s+/g, ' ').toLowerCase() ===
  String(b ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Whether another of this user's drivers already has [name].
 *
 * Trips record the driver by name alone, so two drivers with one name share
 * a single trip history and unpaid-salary total, and the trip form's picker
 * could not tell them apart (it crashed on a seeded second "Kesavan").
 */
async function nameTaken(userId, name, exceptId) {
  const drivers = await Driver.find({ userId }).select('name').lean();
  return drivers.some((d) => String(d._id) !== String(exceptId) && sameName(d.name, name));
}

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
    if (await nameTaken(req.user.id, name)) {
      return res.status(409).json({ message: DUPLICATE_NAME });
    }
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
    if (name !== undefined && await nameTaken(req.user.id, name, previous._id)) {
      return res.status(409).json({ message: DUPLICATE_NAME });
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
    //
    // Skipped while another driver still has the old name: those trips can't
    // be told apart, and moving all of them would take the other's history.
    const nameShared = await Driver.exists({
      userId: req.user.id,
      _id: { $ne: previous._id },
      name: previous.name,
    });
    if (name && previous.name !== driver.name && !nameShared) {
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
