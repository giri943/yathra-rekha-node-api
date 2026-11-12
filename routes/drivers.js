const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const Trip = require('../models/Trip');
const auth = require('../middleware/auth');

const DUPLICATE_NAME =
  'ഈ പേരിൽ ഒരു ഡ്രൈവർ ഇതിനകം ഉണ്ട്. വേർതിരിച്ചറിയാൻ പേരിൽ എന്തെങ്കിലും ചേർക്കുക';

const { sameName } = require('../utils/names');
const { businessNow } = require('../utils/clock');

/**
 * Whether another of this user's drivers already has [name].
 *
 * Trips now carry a driverId, but lists, bills and the salary-owed card still
 * show names: two drivers called "Kesavan" would be indistinguishable there.
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

    // Trips keep a copy of the driver's name for display; bring it up to date
    // so lists and bills show the new spelling. Trips from before driver ids
    // are matched by the old name, and claimed for this driver while at it,
    // unless another driver still has that name and they can't be told apart.
    if (name && previous.name !== driver.name) {
      await Trip.updateMany(
        { userId: req.user.id, driverId: previous._id },
        { $set: { driverName: driver.name } }
      );
      const nameShared = await Driver.exists({
        userId: req.user.id,
        _id: { $ne: previous._id },
        name: previous.name,
      });
      if (!nameShared) {
        await Trip.updateMany(
          { userId: req.user.id, driverId: null, driverName: previous.name },
          { $set: { driverName: driver.name, driverId: previous._id } }
        );
      }
    }

    res.json(driver);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// One driver's totals, for their history screen. The trips themselves come
// from GET /trips?driverId=, page by page.
//
// Counts trips with this driverId only: run backfill-trip-driver-ids.js once
// so trips saved before driver ids are included.
router.get('/:id/summary', auth, async (req, res) => {
  try {
    const driver = await Driver.findOne({ _id: req.params.id, userId: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'ഈ ഡ്രൈവറെ കണ്ടെത്തിയില്ല' });
    }

    const asOf = new Date(); // see /reports/dashboard
    const now = businessNow();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const totalsFor = (extra) => Trip.aggregate([
      { $match: { userId: driver.userId, driverId: driver._id, ...extra } },
      {
        $group: {
          _id: null,
          tripCount: { $sum: 1 },
          salary: { $sum: '$driverSalary' },
          distance: { $sum: { $ifNull: ['$distance', 0] } },
          firstTripDate: { $min: '$tripDate' },
          lastTripDate: { $max: '$tripDate' },
        },
      },
    ]).then(([row]) => ({
      tripCount: row?.tripCount || 0,
      salary: row?.salary || 0,
      distance: row?.distance || 0,
      firstTripDate: row?.firstTripDate || null,
      lastTripDate: row?.lastTripDate || null,
    }));

    const [allTime, thisMonth, unpaid] = await Promise.all([
      totalsFor({}),
      totalsFor({ tripDate: { $gte: monthStart } }),
      totalsFor({ driverSalaryPaid: false }),
    ]);

    res.json({ driver, allTime, thisMonth, unpaid, asOf });
  } catch (error) {
    res.status(500).json({ message: 'വിവരങ്ങൾ കിട്ടിയില്ല. വീണ്ടും ശ്രമിക്കുക.' });
  }
});

// Delete driver
//
// Their trips stay, with their name and driverId: the money was paid and
// earned. A new driver later given the same name gets a fresh history.
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
