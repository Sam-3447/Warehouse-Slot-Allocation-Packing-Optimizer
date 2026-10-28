const mongoose = require('mongoose');

const slotUnitSchema = new mongoose.Schema(
  {
    ref: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item'
    },
    dimensions: {
      l: { type: Number, default: 0 },
      w: { type: Number, default: 0 },
      h: { type: Number, default: 0 }
    },
    volume: {
      type: Number,
      required: true,
      min: 0,
      description: 'Volume of individual unit in litres'
    },
    weight: {
      type: Number,
      required: true,
      min: 0,
      description: 'Weight of individual unit in kg'
    },
    velocity: {
      type: String,
      enum: ['fast', 'medium', 'slow'],
      default: 'medium'
    },
    fragile: {
      type: Boolean,
      default: false
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

const slotSchema = new mongoose.Schema(
  {
    slotId: {
      type: String,
      required: [true, 'Slot identifier code is required (e.g., A-01-1)'],
      trim: true,
      uppercase: true
    },
    warehouseId: {
      type: String,
      required: [true, 'Warehouse identifier is required (e.g., WH-MOH)'],
      trim: true,
      uppercase: true,
      index: true
    },
    rackId: {
      type: String,
      required: [true, 'Rack ID letter is required (e.g., A)'],
      uppercase: true,
      trim: true
    },
    rackName: {
      type: String,
      trim: true,
      default: ''
    },
    zone: {
      type: String,
      trim: true,
      default: 'General store',
      index: true
    },
    bay: {
      type: Number,
      required: true,
      min: 1,
      max: 20,
      default: 1
    },
    level: {
      type: Number,
      required: true,
      min: 1,
      max: 10,
      default: 1
    },
    distanceFromDock: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
      description: 'Travel distance from dock doors: 1 = closest (fast-pick), 5 = deepest (reserve)'
    },
    maxVolume: {
      type: Number,
      required: [true, 'Slot maximum volume capacity in litres is required'],
      min: [1, 'Maximum volume must be greater than 0'],
      default: 900
    },
    maxWeight: {
      type: Number,
      required: [true, 'Slot maximum weight capacity in kilograms is required'],
      min: [1, 'Maximum weight must be greater than 0'],
      default: 450
    },
    currentVolume: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Current aggregate volume of stored units in litres'
    },
    currentWeight: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Current aggregate weight load in kg'
    },
    status: {
      type: String,
      enum: ['vacant', 'occupied', 'congested'],
      default: 'vacant',
      index: true
    },
    units: [slotUnitSchema]
  },
  {
    timestamps: true
  }
);

// Compound index to guarantee uniqueness of slot per warehouse
slotSchema.index({ warehouseId: 1, slotId: 1 }, { unique: true });

// Auto-recovery hook: Guarantee rackId, rackName, bay, level, maxVolume, maxWeight are NEVER missing
slotSchema.pre('validate', function () {
  if (this.slotId) {
    const parts = this.slotId.split('-');
    if (!this.rackId) {
      this.rackId = parts[0] ? parts[0].toUpperCase() : 'A';
    }
    if (!this.bay && parts[1]) {
      this.bay = Number(parts[1]) || 1;
    }
    if (!this.level && parts[2]) {
      this.level = Number(parts[2]) || 1;
    }
  }
  if (!this.rackName && this.rackId) {
    this.rackName = `Rack ${this.rackId}`;
  }
  if (!this.maxVolume) {
    this.maxVolume = (this.rackId >= 'E') ? 1300 : 800;
  }
  if (!this.maxWeight) {
    this.maxWeight = (this.rackId >= 'E') ? 800 : 400;
  }
});

// Auto-recalculate currentVolume, currentWeight, and status before saving
slotSchema.pre('save', function () {
  if (Array.isArray(this.units)) {
    this.currentVolume = Number(
      this.units.reduce((acc, u) => acc + (u.volume || 0), 0).toFixed(2)
    );
    this.currentWeight = Number(
      this.units.reduce((acc, u) => acc + (u.weight || 0), 0).toFixed(2)
    );

    const fillRatio = this.maxVolume > 0 ? this.currentVolume / this.maxVolume : 0;
    if (this.units.length === 0) {
      this.status = 'vacant';
    } else if (fillRatio >= 0.85) {
      this.status = 'congested';
    } else {
      this.status = 'occupied';
    }
  }
});

// Helper virtuals
slotSchema.virtual('freeVolume').get(function () {
  const used = this.currentVolume || (this.units && this.units.length ? this.units.reduce((acc, u) => acc + (u.volume || 0), 0) : 0);
  return Math.max(0, Number((this.maxVolume - used).toFixed(2)));
});

slotSchema.virtual('freeWeight').get(function () {
  const used = this.currentWeight || (this.units && this.units.length ? this.units.reduce((acc, u) => acc + (u.weight || 0), 0) : 0);
  return Math.max(0, Number((this.maxWeight - used).toFixed(2)));
});

slotSchema.virtual('fillPercentage').get(function () {
  if (!this.maxVolume) return 0;
  const used = this.currentVolume || (this.units && this.units.length ? this.units.reduce((acc, u) => acc + (u.volume || 0), 0) : 0);
  return Math.min(100, Math.round((used / this.maxVolume) * 100));
});

// Instance method to check if slot accepts a given unit
slotSchema.methods.acceptsUnit = function (unit) {
  if (unit.volume > this.maxVolume) {
    return { ok: false, reason: 'Unit is larger than the slot capacity' };
  }
  if ((this.currentVolume || 0) + unit.volume > this.maxVolume) {
    return { ok: false, reason: 'Not enough volume space left' };
  }
  if ((this.currentWeight || 0) + unit.weight > this.maxWeight) {
    return { ok: false, reason: 'Would exceed the slot weight limit' };
  }
  const hasFragile = this.units.some(u => u.fragile);
  if (hasFragile) {
    return { ok: false, reason: 'Slot holds a fragile unit' };
  }
  if (unit.fragile && this.units.length > 0) {
    return { ok: false, reason: 'Fragile unit needs an empty slot' };
  }
  return { ok: true };
};

const Slot = mongoose.model('Slot', slotSchema);

module.exports = Slot;
