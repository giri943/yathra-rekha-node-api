const express = require('express');
const router = express.Router();
const Trip = require('../models/Trip');
const Contract = require('../models/Contract');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const auth = require('../middleware/auth');
const { queryFrom, containsRegex, vehicleIdsMatching } = require('../utils/search');
const { startOfBusinessToday } = require('../utils/clock');
const { sameName } = require('../utils/names');

const DRIVER_NOT_FOUND = 'ഈ ഡ്രൈവറെ കണ്ടെത്തിയില്ല. ഡ്രൈവറെ വീണ്ടും തിരഞ്ഞെടുക്കുക.';

/**
 * Sets driverId and driverName on [tripData] from whichever the app sent.
 *
 * With a driverId, the driver must be this user's, and the name is taken
 * from the driver record so the two can never disagree. An older app sends
 * only a name: it is matched to the one driver of that name, if there is one.
 * Returns an error message, or null.
 */
async function resolveDriver(userId, tripData) {
  if (tripData.driverId) {
    const driver = await Driver.findOne({ _id: tripData.driverId, userId }).select('name').lean()
      .catch(() => null); // A malformed id is "not found", not a 500.
    if (!driver) return DRIVER_NOT_FOUND;
    tripData.driverName = driver.name;
    return null;
  }

  delete tripData.driverId; // null or '' from the app: leave it unset.
  if (tripData.driverName) {
    const drivers = await Driver.find({ userId }).select('name').lean();
    const matches = drivers.filter((d) => sameName(d.name, tripData.driverName));
    if (matches.length === 1) tripData.driverId = matches[0]._id;
  }
  return null;
}

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
    if (req.query.driverId) {
      filter.driverId = req.query.driverId;
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

    // Free-text search: client, phone, driver, notes, vehicle number or
    // contract name. The app sends no date range with it, so it spans every
    // month — "when did I last drive Fathima?" has no month to pick.
    const q = queryFrom(req);
    if (q) {
      const rx = containsRegex(q);
      const [vehicleIds, contractIds] = await Promise.all([
        vehicleIdsMatching(Vehicle, req.user.id, q),
        Contract.distinct('_id', { userId: req.user.id, contractName: rx }),
      ]);
      filter.$or = [
        { clientName: rx },
        { clientMobile: rx },
        { driverName: rx },
        { notes: rx },
        { vehicleId: { $in: vehicleIds } },
        { contractId: { $in: contractIds } },
      ];
    }
    
    // A contract stays usable through the whole of its last day. Its end date
    // is stored as that day's midnight, so "after now" dropped it from the
    // trip form on the very day the contracts screen still showed it active.
    const startOfToday = startOfBusinessToday();

    // Execute all queries in parallel
    const [trips, total, contracts, vehicles, drivers] = await Promise.all([
      Trip.find(filter)
        .populate('contractId', 'contractName rate averageDistance')
        .populate('vehicleId', 'vehicleNumber model')
        // By the day the trip happened, not the day it was typed in: the app
        // groups this list under day headings, and a trip entered a few days
        // late used to land at the top, splitting its day into two groups.
        .sort({ tripDate: -1, createdAt: -1 })
        .skip(offset)
        .limit(limit),
      Trip.countDocuments(filter),
      Contract.find({ userId: req.user.id, contractEndDate: { $gte: startOfToday } })
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

    const driverError = await resolveDriver(req.user.id, tripData);
    if (driverError) {
      return res.status(400).json({ message: driverError });
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

// Settle a driver's outstanding salary in one go.
//
// By driverId. A name alone (an older app, or a debt made only of trips saved
// before driver ids) matches by name, as it always did. Same window as the
// dashboard's "owed" figure, so exactly the trips the owner was shown.
router.post('/settle-salary', auth, async (req, res) => {
  try {
    const { driverId, driverName, until, createdBefore } = req.body;
    const filter = { userId: req.user.id, driverSalaryPaid: false };
    if (driverId) {
      filter.driverId = driverId;
    } else if (driverName && typeof driverName === 'string') {
      filter.driverName = driverName;
    } else {
      return res.status(400).json({ message: 'driverId or driverName is required' });
    }

    if (until) {
      const end = new Date(until);
      if (Number.isNaN(end.getTime())) {
        return res.status(400).json({ message: 'until is not a valid date' });
      }
      filter.tripDate = { $lte: end };
    }

    // Only trips that existed when the amount was shown: a trip saved while
    // he was paying was not in what he paid, so it stays owed.
    if (createdBefore) {
      const asOf = new Date(createdBefore);
      if (Number.isNaN(asOf.getTime())) {
        return res.status(400).json({ message: 'createdBefore is not a valid date' });
      }
      // A trip with no createdAt (none today) is older than any screen.
      filter.$or = [{ createdAt: { $lte: asOf } }, { createdAt: { $exists: false } }];
    }

    const trips = await Trip.find(filter).select('_id driverSalary').lean();
    const amount = trips.reduce((sum, t) => sum + (t.driverSalary || 0), 0);
    const result = await Trip.updateMany(
      { _id: { $in: trips.map((t) => t._id) }, driverSalaryPaid: false },
      { $set: { driverSalaryPaid: true, salaryPaidAt: new Date() } }
    );
    res.json({ updated: result.modifiedCount, amount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update trip
router.put('/:id', auth, async (req, res) => {
  try {
    const tripData = { ...req.body };
    // Ownership is fixed at creation. Passing the body straight through let a
    // request reassign a trip to another account by sending a userId.
    delete tripData.userId;
    delete tripData._id;
    delete tripData.id;

    if ('driverId' in tripData || 'driverName' in tripData) {
      const driverError = await resolveDriver(req.user.id, tripData);
      if (driverError) {
        return res.status(400).json({ message: driverError });
      }
    }

    // Marked unpaid again: forget when it was paid, or the trip would show
    // a payment date for money still owed.
    if (tripData.driverSalaryPaid === false) {
      tripData.salaryPaidAt = null;
    }

    // Auto-calculate distance for all trips with km data
    if (tripData.startKm && tripData.endKm) {
      tripData.distance = tripData.endKm - tripData.startKm;
    }

    const trip = await Trip.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      tripData,
      // Validators on, so an edit can't save a discount over 100%.
      { new: true, runValidators: true }
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