const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: [true, 'SKU identifier is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    length: {
      type: Number,
      required: [true, 'Length in cm is required'],
      min: [1, 'Length must be at least 1 cm']
    },
    width: {
      type: Number,
      required: [true, 'Width in cm is required'],
      min: [1, 'Width must be at least 1 cm']
    },
    height: {
      type: Number,
      required: [true, 'Height in cm is required'],
      min: [1, 'Height must be at least 1 cm']
    },
    volume: {
      type: Number,
      min: 0,
      description: 'Volume in litres (L)'
    },
    weight: {
      type: Number,
      required: [true, 'Weight in kg is required'],
      min: [0.01, 'Weight must be at least 0.01 kg']
    },
    velocity: {
      type: String,
      enum: {
        values: ['fast', 'medium', 'slow'],
        message: 'Velocity must be fast, medium, or slow'
      },
      default: 'medium',
      required: [true, 'Picking velocity rating is required'],
      index: true
    },
    fragile: {
      type: Boolean,
      default: false
    },
    category: {
      type: String,
      trim: true,
      default: 'General'
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      index: true
    },
    companyName: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// Auto-calculate volume in litres before saving: (L * W * H) / 1000
itemSchema.pre('validate', function () {
  if (this.length && this.width && this.height) {
    this.volume = Number(((this.length * this.width * this.height) / 1000).toFixed(2));
  }
});

const Item = mongoose.model('Item', itemSchema);

module.exports = Item;
