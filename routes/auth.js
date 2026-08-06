const express = require('express');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const fetch = require('node-fetch');
const User = require('../models/User');
const authenticateToken = require('../middleware/auth');
const router = express.Router();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT token.
// Long-lived by design: this is a single-owner business app used daily on one
// personal device. A 7-day expiry logged the owner out every week with no
// recovery path, which was the app's biggest usability failure.
const TOKEN_LIFETIME = process.env.JWT_EXPIRES_IN || '365d';

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: TOKEN_LIFETIME });
};

// Verify a Google credential and return its payload, or null if invalid.
// Shared by /google (sign-in) and /reset-password (proof of email ownership).
const verifyGoogleCredential = async ({ idToken, accessToken }) => {
  if (idToken) {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    return ticket.getPayload();
  }

  if (accessToken) {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`
    );
    if (!response.ok) {
      throw new Error('Failed to get user info from Google');
    }
    const userInfo = await response.json();
    return {
      sub: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture
    };
  }

  return null;
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

    const payload = await verifyGoogleCredential({ idToken, accessToken });
    if (!payload) {
      return res.status(400).json({ message: 'Either idToken or accessToken is required' });
    }

    const { sub: googleId, email, name, picture } = payload;
    const normalisedEmail = email?.toLowerCase();

    // Match on googleId first, then fall back to email.
    //
    // The email fallback matters: the owner can sign in with either Google or a
    // password. Looking up by googleId alone created a SECOND account for the
    // same person, so their trips would vanish depending on how they signed in.
    // (In practice it failed outright, because `email` is a unique index.)
    let user = await User.findOne({ googleId });

    if (!user && normalisedEmail) {
      user = await User.findOne({ email: normalisedEmail });

      // Existing password account for this email: link Google to it so both
      // sign-in methods reach the same data.
      if (user) {
        user.googleId = googleId;
        if (picture && !user.avatar) user.avatar = picture;
        await user.save();
      }
    }

    if (!user) {
      user = new User({
        name,
        email: normalisedEmail,
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

// NOTE: a `/google-test` endpoint was removed here. It issued a valid JWT for
// any {email, name} with no verification whatsoever — a development shortcut
// that was live in production. The app never called it.

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

// Reset a forgotten password.
//
// SECURITY: this endpoint previously overwrote any user's password given only
// their email or phone number — no proof of ownership at all. It now requires a
// valid Google credential for the SAME email, which proves the caller controls
// that Google account. This avoids needing a paid SMS/OTP provider.
router.post('/reset-password', async (req, res) => {
  try {
    const { newPassword, idToken, accessToken } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        message: 'പാസ്വേഡിൽ കുറഞ്ഞത് 6 അക്ഷരം വേണം'
      });
    }

    let payload;
    try {
      payload = await verifyGoogleCredential({ idToken, accessToken });
    } catch (error) {
      payload = null;
    }

    if (!payload?.email) {
      return res.status(401).json({
        message: 'സ്ഥിരീകരിക്കാൻ കഴിഞ്ഞില്ല. Google വഴി തുടരുക.'
      });
    }

    const user = await User.findOne({ email: payload.email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ message: 'ഈ ഇമെയിൽ കണ്ടെത്തിയില്ല' });
    }

    // Keep the accounts linked so both sign-in methods stay in sync.
    if (!user.googleId) user.googleId = payload.sub;
    user.password = newPassword;
    await user.save();

    res.json({ message: 'പാസ്വേഡ് മാറ്റി' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Set or change the password while signed in.
// Lets a Google user add a password so they can use either sign-in method.
router.post('/set-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        message: 'പാസ്വേഡിൽ കുറഞ്ഞത് 6 അക്ഷരം വേണം'
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'ഉപയോക്താവിനെ കണ്ടെത്തിയില്ല' });
    }

    // If a password already exists, the current one must be supplied.
    // Accounts created via Google have none, so they can set one freely.
    if (user.password) {
      const isMatch = await user.comparePassword(currentPassword || '');
      if (!isMatch) {
        return res.status(401).json({ message: 'ഇപ്പോഴത്തെ പാസ്വേഡ് തെറ്റാണ്' });
      }
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'പാസ്വേഡ് സേവ് ചെയ്തു' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;