const express = require('express');
const router = express.Router();
const Vehicle = require('../models/Vehicle');
const auth = require('../middleware/auth');

const DUPLICATE_NUMBER = 'ഈ നമ്പറിൽ ഒരു വാഹനം ഇതിനകം ഉണ്ട്';
const BAD_RATE = 'നിരക്ക് ശരിയായ സംഖ്യയായി നൽകുക';

/**
 * The owner's own savari rates present in [body], as an update object.
 *
 * A key the client did not send is left out, so an app build that predates
 * own rates cannot wipe them by saving the vehicle. Blank or 0 means "use the
 * classification's rate" and is stored as null.
 *
 * Returns null when a value is not a usable number.
 */
function ownRatesFrom(body) {
  const rates = {};
  for (const key of ['fixedRateFor5Km', 'perKmRate']) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw === null || raw === '' || raw === undefined) {
      rates[key] = null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return null;
    rates[key] = value === 0 ? null : value;
  }
  return rates;
}

/** Duplicate-key errors from the per-user vehicle number index. */
const isDuplicateNumber = (error) =>
  error?.code === 11000 && /numberKey|vehicleNumber/.test(error.message);

// Get all vehicles for authenticated user with pagination
router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    const vehicles = await Vehicle.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit);
      
    const total = await Vehicle.countDocuments({ userId: req.user.id });
    
    res.json({
      vehicles,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add new vehicle
router.post('/', auth, async (req, res) => {
  try {
    const {
      vehicleNumber,
      model,
      manufacturer,
      insuranceExpiry,
      taxDate,
      testDate,
      pollutionDate,
      classificationId,
    } = req.body;

    if (!classificationId) {
      return res.status(400).json({ message: 'classificationId is required' });
    }

    const rates = ownRatesFrom(req.body);
    if (!rates) return res.status(400).json({ message: BAD_RATE });

    const vehicle = new Vehicle({
      vehicleNumber,
      model,
      manufacturer,
      insuranceExpiry,
      taxDate,
      testDate,
      pollutionDate,
      classificationId,
      ...rates,
      userId: req.user.id,
    });

    await vehicle.save();
    // Populate classification before responding
    await vehicle.populate('classificationId');
    res.status(201).json(vehicle);
  } catch (error) {
    if (isDuplicateNumber(error)) {
      return res.status(409).json({ message: DUPLICATE_NUMBER });
    }
    res.status(400).json({ message: 'Error creating vehicle', error: error.message });
  }
});

// Update vehicle
router.put('/:id', auth, async (req, res) => {
  try {
    const {
      vehicleNumber,
      model,
      manufacturer,
      insuranceExpiry,
      taxDate,
      testDate,
      pollutionDate,
      classificationId,
    } = req.body;

    const rates = ownRatesFrom(req.body);
    if (!rates) return res.status(400).json({ message: BAD_RATE });

    const vehicle = await Vehicle.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      {
        vehicleNumber,
        model,
        manufacturer,
        insuranceExpiry,
        taxDate,
        testDate,
        pollutionDate,
        classificationId,
        ...rates,
      },
      { new: true, runValidators: true }
    ).populate('classificationId');

    if (!vehicle) {
      return res.status(404).json({ message: 'Vehicle not found' });
    }

    res.json(vehicle);
  } catch (error) {
    if (isDuplicateNumber(error)) {
      return res.status(409).json({ message: DUPLICATE_NUMBER });
    }
    res.status(400).json({ message: 'Error updating vehicle', error: error.message });
  }
});

// Delete vehicle
router.delete('/:id', auth, async (req, res) => {
  try {
    const vehicle = await Vehicle.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    
    if (!vehicle) {
      return res.status(404).json({ message: 'Vehicle not found' });
    }

    res.json({ message: 'Vehicle deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: 'Error deleting vehicle', error: error.message });
  }
});

module.exports = router;