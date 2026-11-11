const mongoose = require('mongoose');

// name@bank, as UPI apps show it: e.g. 9876543210@ybl, kesavan.k@okaxis.
const UPI_ID = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$/;

const driverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  // For paying salary from the app: opens the owner's UPI app with this
  // filled in. Optional; drivers without one are paid as before.
  upiId: {
    type: String,
    trim: true,
    lowercase: true,
    default: null,
    set: (value) => (value === '' ? null : value),
    validate: {
      validator: (value) => value == null || UPI_ID.test(value),
      message: 'UPI ഐഡി ശരിയല്ല. ഉദാഹരണം: 9876543210@ybl'
    }
  },
  userId: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Driver', driverSchema);
module.exports.UPI_ID = UPI_ID;
