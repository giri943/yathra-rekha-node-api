/**
 * Seeds predefined vehicle classifications into the database.
 * Run once on server startup or manually:
 *   node scripts/seed-classifications.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const VehicleClassification = require('../models/VehicleClassification');

const CLASSIFICATIONS = [
  // Goods Carriers
  {
    category: 'Goods Carriers',
    type: 'Pickup',
    operationalCostPerKm: 12,
    savariPricing: { fixedRateFor5Km: 200, perKmRate: 18 },
    icon: 'local_shipping',
    displayOrder: 1,
  },
  {
    category: 'Goods Carriers',
    type: 'Mini Truck',
    operationalCostPerKm: 14,
    savariPricing: { fixedRateFor5Km: 250, perKmRate: 22 },
    icon: 'local_shipping',
    displayOrder: 2,
  },
  {
    category: 'Goods Carriers',
    type: 'Tempo',
    operationalCostPerKm: 10,
    savariPricing: { fixedRateFor5Km: 150, perKmRate: 14 },
    icon: 'local_shipping',
    displayOrder: 3,
  },

  // Passenger Carriers
  {
    category: 'Passenger Carriers',
    type: 'Jeep',
    operationalCostPerKm: 15,
    savariPricing: { fixedRateFor5Km: 250, perKmRate: 22 },
    icon: 'directions_car',
    displayOrder: 10,
  },
  {
    category: 'Passenger Carriers',
    type: 'Bolero',
    operationalCostPerKm: 16,
    savariPricing: { fixedRateFor5Km: 300, perKmRate: 25 },
    icon: 'directions_car',
    displayOrder: 11,
  },
  {
    category: 'Passenger Carriers',
    type: 'Car',
    operationalCostPerKm: 14,
    savariPricing: { fixedRateFor5Km: 280, perKmRate: 20 },
    icon: 'directions_car',
    displayOrder: 12,
  },
  {
    category: 'Passenger Carriers',
    type: 'Van',
    operationalCostPerKm: 17,
    savariPricing: { fixedRateFor5Km: 320, perKmRate: 28 },
    icon: 'directions_car',
    displayOrder: 13,
  },

  // Commercial
  {
    category: 'Commercial',
    type: 'Auto-Rickshaw',
    operationalCostPerKm: 8,
    savariPricing: { fixedRateFor5Km: 100, perKmRate: 10 },
    icon: 'two_wheeler',
    displayOrder: 20,
  },
  {
    category: 'Commercial',
    type: 'Taxi',
    operationalCostPerKm: 13,
    savariPricing: { fixedRateFor5Km: 200, perKmRate: 16 },
    icon: 'directions_car',
    displayOrder: 21,
  },
  {
    category: 'Commercial',
    type: 'Bus',
    operationalCostPerKm: 20,
    savariPricing: { fixedRateFor5Km: 500, perKmRate: 40 },
    icon: 'directions_bus',
    displayOrder: 22,
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Upsert each classification so re-running doesn't duplicate
    for (const classification of CLASSIFICATIONS) {
      await VehicleClassification.updateOne(
        { category: classification.category, type: classification.type },
        classification,
        { upsert: true }
      );
    }

    console.log(`✓ Seeded ${CLASSIFICATIONS.length} vehicle classifications`);
    await mongoose.disconnect();
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
}

seed();
