const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true
    },
    contact: {
      type: String,
      required: [true, 'Contact person name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Company email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
    },
    password: {
      type: String,
      required: function() {
        return !this.googleId;
      },
      minlength: [6, 'Password must be at least 6 characters']
    },
    googleId: {
      type: String,
      sparse: true
    },
    avatar: {
      type: String,
      default: ''
    },
    requestedWarehouses: {
      type: Number,
      default: 1,
      min: 1
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    reference: {
      type: String,
      trim: true
    },
    decidedAt: {
      type: Date
    },
    decisionNote: {
      type: String,
      trim: true
    },
    warehouses: [
      {
        id: String,
        name: String,
        city: String,
        passcode: String,
        slots: Number
      }
    ]
  },
  {
    timestamps: true
  }
);

// Hash password before saving
companySchema.pre('save', async function () {
  if (!this.password || !this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password helper
companySchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

const Company = mongoose.model('Company', companySchema);

module.exports = Company;
