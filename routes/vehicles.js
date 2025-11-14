const express = require('express');
const router = express.Router();
const Vehicle = require('../models/Vehicle');
const auth = require('../middleware/auth');

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
    const { vehicleNumber, model, manufacturer, insuranceExpiry, taxDate, testDate, pollutionDate } = req.body;
    
    const vehicle = new Vehicle({
      vehicleNumber,
      model,
      manufacturer,
      insuranceExpiry,
      taxDate,
      testDate,
      pollutionDate,
      userId: req.user.id
    });

    await vehicle.save();
    res.status(201).json(vehicle);
  } catch (error) {
    res.status(400).json({ message: 'Error creating vehicle', error: error.message });
  }
});

// Update vehicle
router.put('/:id', auth, async (req, res) => {
  try {
    const { vehicleNumber, 
      model, 
      manufacturer, 
      insuranceExpiry, 
      taxDate, 
      testDate, 
      pollutionDate,
      fixedRateFor5Km,
      perKmRate
     } = req.body;
    
    const vehicle = await Vehicle.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { vehicleNumber, 
        model, 
        manufacturer, 
        insuranceExpiry, 
        taxDate, 
        testDate, 
        pollutionDate,
        fixedRateFor5Km,
        perKmRate
      },
      { new: true }
    );

    if (!vehicle) {
      return res.status(404).json({ message: 'Vehicle not found' });
    }

    res.json(vehicle);
  } catch (error) {
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