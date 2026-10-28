const mongoose = require('mongoose');

const placedUnitSchema = new mongoose.Schema(
  {
    unitRef: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    sku: {
      type: String,
      required: true,
      trim: true
    },
    name: {
      type: String,
      default: ''
    },
    slotId: {
      type: String,
      required: true,
      trim: true
    },
    rackId: {
      type: String,
      default: ''
    },
    rackName: {
      type: String,
      default: ''
    },
    zone: {
      type: String,
      default: ''
    },
    distanceFromDock: {
      type: Number,
      default: 1
    },
    volume: {
      type: Number,
      required: true
    },
    weight: {
      type: Number,
      required: true
    },
    ruleApplied: {
      type: String,
      enum: ['Velocity', 'Tightest fit', 'Fallback', 'Manual Transfer'],
      default: 'Tightest fit'
    },
    explanation: {
      type: String,
      default: ''
    },
    queuePosition: {
      type: Number,
      default: 1
    },
    placedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const rejectedUnitSchema = new mongoose.Schema(
  {
    unitRef: {
      type: String,
      required: true,
      trim: true
    },
    sku: {
      type: String,
      required: true
    },
    name: {
      type: String,
      default: ''
    },
    reason: {
      type: String,
      required: true,
      default: 'No slot available'
    },
    volume: {
      type: Number,
      required: true
    },
    weight: {
      type: Number,
      required: true
    },
    queuePosition: {
      type: Number,
      default: 1
    }
  },
  { _id: false }
);

const allocationSchema = new mongoose.Schema(
  {
    allocationRef: {
      type: String,
      required: [true, 'Allocation reference identifier is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    warehouseId: {
      type: String,
      required: [true, 'Warehouse identifier is required (e.g., WH-MOH)'],
      trim: true,
      uppercase: true,
      index: true
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
    },
    batchInput: {
      sku: { type: String, required: true, trim: true },
      name: { type: String, required: true, trim: true },
      quantity: { type: Number, required: true, min: 1 },
      length: { type: Number, required: true },
      width: { type: Number, required: true },
      height: { type: Number, required: true },
      volumePerUnit: { type: Number, required: true },
      weightPerUnit: { type: Number, required: true },
      velocity: { type: String, enum: ['fast', 'medium', 'slow'], default: 'medium' },
      fragile: { type: Boolean, default: false }
    },
    placedUnits: [placedUnitSchema],
    rejectedUnits: [rejectedUnitSchema],
    summary: {
      requestedQty: {
        type: Number,
        default: 0
      },
      placedQty: {
        type: Number,
        default: 0
      },
      rejectedQty: {
        type: Number,
        default: 0
      },
      totalVolumePlaced: {
        type: Number,
        default: 0
      },
      totalWeightPlaced: {
        type: Number,
        default: 0
      },
      status: {
        type: String,
        enum: ['full', 'partial', 'failed'],
        default: 'full'
      }
    },
    performedBy: {
      email: {
        type: String,
        default: 'supervisor@nexvault.internal'
      },
      role: {
        type: String,
        default: 'supervisor'
      }
    }
  },
  {
    timestamps: true
  }
);

// Auto-derive summary totals before saving
allocationSchema.pre('validate', function () {
  const placed = this.placedUnits ? this.placedUnits.length : 0;
  const rejected = this.rejectedUnits ? this.rejectedUnits.length : 0;
  const requested = (this.batchInput && this.batchInput.quantity) || (placed + rejected);

  this.summary = this.summary || {};
  this.summary.requestedQty = requested;
  this.summary.placedQty = placed;
  this.summary.rejectedQty = rejected;
  this.summary.totalVolumePlaced = Number(
    (this.placedUnits || []).reduce((acc, u) => acc + (u.volume || 0), 0).toFixed(2)
  );
  this.summary.totalWeightPlaced = Number(
    (this.placedUnits || []).reduce((acc, u) => acc + (u.weight || 0), 0).toFixed(2)
  );

  if (placed === requested) {
    this.summary.status = 'full';
  } else if (placed > 0) {
    this.summary.status = 'partial';
  } else {
    this.summary.status = 'failed';
  }
});

const Allocation = mongoose.model('Allocation', allocationSchema);

module.exports = Allocation;
