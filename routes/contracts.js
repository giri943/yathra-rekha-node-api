const express = require('express');
const router = express.Router();
const Contract = require('../models/Contract');
const Vehicle = require('../models/Vehicle');
const auth = require('../middleware/auth');

// Get contracts page data (contracts + vehicles) in single call
router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const active = req.query.active === 'true';
    const vehicleId = req.query.vehicleId;
    const status = req.query.status;
    
    // Build query filter
    const filter = { userId: req.user.id };
    if (active) {
      filter.contractEndDate = { $gt: new Date() };
    }
    if (vehicleId) {
      filter.vehicleId = vehicleId;
    }
    
    // Handle status filter
    const now = new Date();
    if (status === 'active') {
      filter.contractEndDate = { $gt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) };
    } else if (status === 'expiring') {
      filter.contractEndDate = { 
        $gt: now,
        $lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      };
    } else if (status === 'expired') {
      filter.contractEndDate = { $lt: now };
    }
    
    // Execute all queries in parallel
    const [contracts, total, vehicles] = await Promise.all([
      Contract.find(filter)
        .populate('vehicleId')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit),
      Contract.countDocuments(filter),
      Vehicle.find({ userId: req.user.id })
        .sort({ createdAt: -1 })
    ]);
    
    res.json({
      contracts,
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

// Add new contract
router.post('/', auth, async (req, res) => {
  try {
    const { contractName, rate, vehicleId, averageDistance, contractEndDate, contactPhone } = req.body;
    
    const contract = new Contract({
      contractName,
      rate,
      vehicleId,
      averageDistance,
      contractEndDate,
      contactPhone,
      userId: req.user.id
    });

    await contract.save();
    const populatedContract = await Contract.findById(contract._id).populate('vehicleId');
    res.status(201).json(populatedContract);
  } catch (error) {
    res.status(400).json({ message: 'Error creating contract', error: error.message });
  }
});

// Update contract
router.put('/:id', auth, async (req, res) => {
  try {
    const { contractName, rate, vehicleId, averageDistance, contractEndDate, contactPhone } = req.body;
    
    const contract = await Contract.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { contractName, rate, vehicleId, averageDistance, contractEndDate, contactPhone },
      { new: true }
    ).populate('vehicleId');

    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    res.json(contract);
  } catch (error) {
    res.status(400).json({ message: 'Error updating contract', error: error.message });
  }
});

// Delete contract
router.delete('/:id', auth, async (req, res) => {
  try {
    const contract = await Contract.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    
    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    res.json({ message: 'Contract deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: 'Error deleting contract', error: error.message });
  }
});

module.exports = router;