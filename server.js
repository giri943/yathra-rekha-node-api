const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
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

// Image proxy route for CORS
app.get('/api/proxy-image', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }
    
    const fetch = require('node-fetch');
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    res.set({
      'Content-Type': response.headers.get('content-type'),
      'Cache-Control': 'public, max-age=86400'
    });
    
    response.body.pipe(res);
  } catch (error) {
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/reports', require('./routes/reports'));

app.get('/', (req, res) => {
  res.json({ message: 'Yathra Rekha API Server' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});