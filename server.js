const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const app = express();

// Render sits behind one proxy; without this every request's req.ip is the
// proxy's, and per-address sign-in limits would block everyone at once.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Enable logging only in development
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));
}

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/yathra-rekha', {})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// NOTE: /api/proxy-image was removed. It fetched any URL for anyone, letting
// the server be used to reach internal addresses (SSRF). Nothing called it.

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/vehicle-classifications', require('./routes/vehicleClassifications'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/reports', require('./routes/reports'));

app.get('/', (req, res) => {
  res.json({ message: 'Yathra Rekha API Server' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});