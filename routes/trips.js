const express = require('express');
const router = express.Router();
const Trip = require('../models/Trip');
const Contract = require('../models/Contract');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const auth = require('../middleware/auth');

// Get trips page data (trips + contracts + vehicles) in single call
router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    // Build filter query
    const filter = { userId: req.user.id };
    if (req.query.tripType) {
      filter.tripType = req.query.tripType;
    }
    if (req.query.vehicleId) {
      filter.vehicleId = req.query.vehicleId;
    }
    if (req.query.contractId) {
      filter.contractId = req.query.contractId;
    }
    if (req.query.salaryPaid) {
      filter.driverSalaryPaid = req.query.salaryPaid === 'true';
    }
    if (req.query.startDate || req.query.endDate) {
      filter.tripDate = {};
      if (req.query.startDate) {
        filter.tripDate.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        endDate.setHours(23, 59, 59, 999);
        filter.tripDate.$lte = endDate;
      }
    }
    
    // Execute all queries in parallel
    const [trips, total, contracts, vehicles, drivers] = await Promise.all([
      Trip.find(filter)
        .populate('contractId', 'contractName rate averageDistance')
        .populate('vehicleId', 'vehicleNumber model')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
      Trip.countDocuments(filter),
      Contract.find({ userId: req.user.id, contractEndDate: { $gt: new Date() } })
        .populate('vehicleId', 'vehicleNumber model')
        .sort({ createdAt: -1 }),
      Vehicle.find({ userId: req.user.id })
        .sort({ createdAt: -1 }),
      Driver.find({ userId: req.user.id })
        .sort({ name: 1 })
    ]);
    
    res.json({
      trips,
      contracts,
      vehicles,
      drivers,
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
    res.status(500).json({ message: error.message });
  }
});

// Add new trip
router.post('/', auth, async (req, res) => {
  try {
    const tripData = {
      ...req.body,
      userId: req.user.id
    };

    // Remove contractId if it's null or "null" string for savari trips
    if (tripData.tripType === 'savari' || !tripData.contractId || tripData.contractId === 'null') {
      delete tripData.contractId;
    }

    // Auto-calculate distance for all trips with km data
    if (tripData.startKm && tripData.endKm) {
      tripData.distance = tripData.endKm - tripData.startKm;
    }

    const trip = new Trip(tripData);
    const savedTrip = await trip.save();
    
    const populatedTrip = await Trip.findById(savedTrip._id)
      .populate('contractId', 'contractName rate averageDistance')
      .populate('vehicleId', 'vehicleNumber model');
    
    res.status(201).json(populatedTrip);
  } catch (error) {
    console.log(error);
    
    res.status(400).json({ message: error.message });
  }
});

// Update trip
router.put('/:id', auth, async (req, res) => {
  try {
    const tripData = { ...req.body };
    
    // Auto-calculate distance for all trips with km data
    if (tripData.startKm && tripData.endKm) {
      tripData.distance = tripData.endKm - tripData.startKm;
    }

    const trip = await Trip.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      tripData,
      { new: true }
    ).populate('contractId', 'contractName rate averageDistance')
     .populate('vehicleId', 'vehicleNumber model');
    
    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }
    res.json(trip);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete trip
router.delete('/:id', auth, async (req, res) => {
  try {
    const trip = await Trip.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }
    res.json({ message: 'Trip deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get contract details for trip creation
router.get('/contract/:contractId', auth, async (req, res) => {
  try {
    const contract = await Contract.findOne({ 
      _id: req.params.contractId, 
      userId: req.user.id 
    }).populate('vehicleId', 'vehicleNumber model');    
    
    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }
    res.json(contract);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;