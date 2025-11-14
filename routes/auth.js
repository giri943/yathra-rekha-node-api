const express = require('express');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const fetch = require('node-fetch');
const User = require('../models/User');
const router = express.Router();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Register with email and phone
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'ഈ ഇമെയിൽ ഇതിനകം ഉപയോഗത്തിലുണ്ട്' });
    }

    // Create new user
    const user = new User({
      name,
      email,
      phone,
      password
    });

    await user.save();

    res.status(201).json({
      message: 'അക്കൗണ്ട് സൃഷ്ടിച്ചു',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Login with email or phone
router.post('/login', async (req, res) => {
  try {
    const { emailOrPhone, password } = req.body;

    // Find user by email or phone
    const user = await User.findOne({
      $or: [
        { email: emailOrPhone },
        { phone: emailOrPhone }
      ]
    });
    
    if (!user) {
      return res.status(401).json({ message: 'തെറ്റായ ഇമെയിൽ/ഫോൺ അല്ലെങ്കിൽ പാസ്വേഡ്' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'തെറ്റായ ഇമെയിൽ/ഫോൺ അല്ലെങ്കിൽ പാസ്വേഡ്' });
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Google Sign-In
router.post('/google', async (req, res) => {
  try {
    const { idToken, accessToken } = req.body;

    let payload;
    
    if (idToken) {
      // Mobile/Desktop flow with idToken
      const ticket = await client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else if (accessToken) {
      // Web flow with accessToken - get user info from Google API
      const response = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`);
      if (!response.ok) {
        throw new Error('Failed to get user info from Google');
      }
      const userInfo = await response.json();
      payload = {
        sub: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture
      };
    } else {
      return res.status(400).json({ message: 'Either idToken or accessToken is required' });
    }

    const { sub: googleId, email, name, picture } = payload;

    // Find or create user
    let user = await User.findOne({ googleId });
    
    if (!user) {
      user = new User({
        name,
        email,
        phone: '', // Empty phone for Google users
        googleId,
        avatar: picture
      });
      
      await user.save();
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        email: user.email,
        avatar: user.avatar
      }
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
});

// Test Google Sign-In (for development)
router.post('/google-test', async (req, res) => {
  try {
    const { email, name } = req.body;
    
    if (!email || !name) {
      return res.status(400).json({ message: 'Email and name required' });
    }

    const googleId = 'test_' + email;
    
    // Find or create user
    let user = await User.findOne({ googleId });
    
    if (!user) {
      const username = email.split('@')[0] + '_' + Date.now();
      
      user = new User({
        username,
        name,
        email,
        googleId,
        avatar: 'https://via.placeholder.com/150'
      });
      
      await user.save();
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        email: user.email,
        avatar: user.avatar
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get current user (protected route)
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Delete account (protected route)
router.delete('/delete', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByIdAndDelete(decoded.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'അക്കൗണ്ട് ഡിലീറ്റ് ചെയ്തു' });
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Reset password directly
router.post('/reset-password', async (req, res) => {
  try {
    const { emailOrPhone, newPassword } = req.body;

    // Find user by email or phone
    const user = await User.findOne({
      $or: [
        { email: emailOrPhone },
        { phone: emailOrPhone }
      ]
    });
    
    if (!user) {
      return res.status(404).json({ message: 'ഈ ഇമെയിൽ/ഫോൺ നമ്പർ കണ്ടെത്തിയില്ല' });
    }

    // Update password directly
    user.password = newPassword;
    await user.save();

    res.json({ message: 'പാസ്വേഡ് രീസെറ്റ് ചെയ്തു' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;