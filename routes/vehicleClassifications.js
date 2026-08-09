const express = require('express');
const router = express.Router();
const VehicleClassification = require('../models/VehicleClassification');
const authenticateToken = require('../middleware/auth');

/// Get all vehicle classifications, grouped by category.
/// Used by the app's onboarding and vehicle-form dropdowns.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const classifications = await VehicleClassification.find({ isActive: true })
      .sort({ displayOrder: 1 })
      .lean();

    // Group by category for the UI
    const grouped = {};
    for (const c of classifications) {
      if (!grouped[c.category]) {
        grouped[c.category] = [];
      }
      grouped[c.category].push({
        id: c._id,
        category: c.category,
        type: c.type,
        operationalCostPerKm: c.operationalCostPerKm,
        savariPricing: c.savariPricing,
        icon: c.icon,
      });
    }

    res.json(grouped);
  } catch (error) {
    console.error('Get classifications error:', error);
    res.status(500).json({ message: error.message });
  }
});

/// Get classifications for a specific category.
/// Used when the user has selected "Goods Carriers", show only those types.
router.get('/category/:category', authenticateToken, async (req, res) => {
  try {
    const { category } = req.params;

    const classifications = await VehicleClassification.find({
      category,
      isActive: true,
    }).sort({ displayOrder: 1 });

    res.json(classifications);
  } catch (error) {
    console.error('Get category classifications error:', error);
    res.status(500).json({ message: error.message });
  }
});

/// Get a single classification by ID (used when loading a vehicle's rates).
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const classification = await VehicleClassification.findById(req.params.id);
    if (!classification) {
      return res.status(404).json({ message: 'Classification not found' });
    }
    res.json(classification);
  } catch (error) {
    console.error('Get classification error:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
