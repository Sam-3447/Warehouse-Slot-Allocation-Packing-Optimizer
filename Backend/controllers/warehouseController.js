const { Slot, Item, Allocation, Company } = require('../models');

// Helper to calculate volume in litres: (L * W * H in cm) / 1000
function volumeOf(l, w, h) {
  return Number(((l * w * h) / 1000).toFixed(2));
}

// Generate unique reference ID
function makeRef(prefix = 'U') {
  return prefix + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Safety checks for slot candidate
function slotAccepts(slot, unit) {
  const currentVol = slot.currentVolume || (slot.units || []).reduce((sum, u) => sum + (u.volume || 0), 0);
  const currentWt = slot.currentWeight || (slot.units || []).reduce((sum, u) => sum + (u.weight || 0), 0);

  if (unit.volume > slot.maxVolume) {
    return { ok: false, reason: 'Unit is larger than the slot capacity' };
  }
  if (currentVol + unit.volume > slot.maxVolume) {
    return { ok: false, reason: 'Not enough volume space left' };
  }
  if (currentWt + unit.weight > slot.maxWeight) {
    return { ok: false, reason: 'Would exceed the slot weight limit' };
  }
  const hasFragile = (slot.units || []).some(u => u.fragile);
  if (hasFragile) {
    return { ok: false, reason: 'Slot holds a fragile unit' };
  }
  if (unit.fragile && (slot.units || []).length > 0) {
    return { ok: false, reason: 'Fragile unit needs an empty slot' };
  }
  return { ok: true };
}

// Slot ranking: velocity dock distance + tie-break tightest fit
function rankSlots(candidates, unit) {
  const distances = candidates.map(s => s.distanceFromDock);
  const middle = (Math.min(...distances) + Math.max(...distances)) / 2;

  return candidates.slice().sort((a, b) => {
    const da = a.distanceFromDock;
    const db = b.distanceFromDock;

    if (unit.velocity === 'fast' && da !== db) {
      return da - db; // nearest dock first
    }
    if (unit.velocity === 'slow' && da !== db) {
      return db - da; // deepest first
    }
    if (unit.velocity === 'medium') {
      const offsetA = Math.abs(da - middle);
      const offsetB = Math.abs(db - middle);
      if (offsetA !== offsetB) return offsetA - offsetB;
    }

    // Tie-break: least free space left over
    const freeA = a.maxVolume - (a.currentVolume || 0);
    const freeB = b.maxVolume - (b.currentVolume || 0);
    return (freeA - unit.volume) - (freeB - unit.volume);
  });
}

// Rule explanation for decision transparency
function explainChoice(ranked, unit) {
  const chosen = ranked[0];
  const distances = ranked.map(s => s.distanceFromDock);
  const spread = Array.from(new Set(distances)).sort((a, b) => a - b);
  const leftover = Math.round((chosen.maxVolume - (chosen.currentVolume || 0)) - unit.volume);

  let rule = 'Tightest fit';
  let text = '';

  if (spread.length > 1 && unit.velocity === 'fast') {
    rule = 'Velocity';
    text = `Fast mover: nearest rack with room selected (${chosen.rackName || 'Rack ' + chosen.rackId} at distance ${chosen.distanceFromDock} from dock).`;
  } else if (spread.length > 1 && unit.velocity === 'slow') {
    rule = 'Velocity';
    text = `Slow mover: stored deep (${chosen.rackName || 'Rack ' + chosen.rackId} at distance ${chosen.distanceFromDock}) to leave fast pick path open.`;
  } else if (spread.length > 1 && unit.velocity === 'medium') {
    rule = 'Velocity';
    const middle = (Math.min(...distances) + Math.max(...distances)) / 2;
    text = `Medium mover: allocated toward floor center (${middle} from dock).`;
  } else {
    text = `All candidate slots had equal distance from dock; tie-break chose the tightest volume fit.`;
  }

  const tied = ranked.filter(s => s.distanceFromDock === chosen.distanceFromDock).length;
  if (rule === 'Velocity' && tied > 1) {
    text += ` ${tied} slots tied at distance ${chosen.distanceFromDock}; tightest fit resolved the tie.`;
  }

  return {
    rule,
    text,
    leftover,
    considered: ranked.length
  };
}

// Find most common refusal reason across warehouse
function whyNothingFits(slots, unit) {
  const reasons = slots.map(s => slotAccepts(s, unit).reason).filter(Boolean);
  if (reasons.length === 0) return 'No slot available';
  const tally = {};
  reasons.forEach(r => { tally[r] = (tally[r] || 0) + 1; });
  return Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
}

/**
 * @desc    Allocate inbound stock batch across warehouse slots using First-Fit Decreasing heuristic
 * @route   POST /api/warehouse/allocate
 * @access  Public / Supervisor / Protected
 */
exports.allocateStock = async (req, res, next) => {
  try {
    const { warehouseId = 'WH-MOH', item, companyName: reqCompanyName } = req.body;

    if (!item) {
      return res.status(400).json({
        success: false,
        message: 'Inbound item details are required in req.body.item'
      });
    }

    const sku = (item.sku || ('SKU-' + Math.floor(10000 + Math.random() * 90000))).toUpperCase().trim();
    const name = (item.name || 'Stock item').trim();
    const length = Number(item.l || item.length || 60);
    const width = Number(item.w || item.width || 40);
    const height = Number(item.h || item.height || 35);
    const weight = Number(item.weight || 14);
    const velocity = (item.velocity || 'medium').toLowerCase();
    const fragile = Boolean(item.fragile);
    const quantity = Math.max(1, Math.min(100, Number(item.qty || item.quantity || 1)));

    const unitVolume = volumeOf(length, width, height);

    // Resolve company identity
    let companyName = reqCompanyName || (item && item.companyName);
    if (!companyName) {
      const ownerCompany = await Company.findOne({ 'warehouses.id': warehouseId.toUpperCase() });
      companyName = ownerCompany ? ownerCompany.name : '';
    }

    // 1. Ensure Catalog Item exists in MongoDB
    let dbItem = await Item.findOne({ sku });
    if (!dbItem) {
      dbItem = await Item.create({
        sku,
        name,
        length,
        width,
        height,
        volume: unitVolume,
        weight,
        velocity,
        fragile,
        companyName: companyName || ''
      });
    } else if (companyName && !dbItem.companyName) {
      dbItem.companyName = companyName;
      await dbItem.save();
    }

    // 2. Fetch all slots for this warehouse from MongoDB
    let slots = await Slot.find({ warehouseId: warehouseId.toUpperCase() }).sort({ rackId: 1, bay: 1, level: 1 });

    // Fallback: If slots are not yet seeded in MongoDB, auto-seed default racks for this warehouse
    if (!slots || slots.length === 0) {
      const defaultRacks = [
        { id: 'A', name: 'Rack A', zone: 'Fast-pick', distanceFromDock: 1, maxVolume: 900, maxWeight: 450 },
        { id: 'F', name: 'Rack F', zone: 'Outbound stage', distanceFromDock: 1, maxVolume: 600, maxWeight: 300 },
        { id: 'C', name: 'Rack C', zone: 'Cold zone', distanceFromDock: 2, maxVolume: 800, maxWeight: 400 },
        { id: 'B', name: 'Rack B', zone: 'Bulk overrun', distanceFromDock: 3, maxVolume: 1400, maxWeight: 900 },
        { id: 'E', name: 'Rack E', zone: 'Returns staging', distanceFromDock: 4, maxVolume: 700, maxWeight: 350 },
        { id: 'D', name: 'Rack D', zone: 'Reserve cage', distanceFromDock: 5, maxVolume: 1200, maxWeight: 700 }
      ];
      const createdSlots = [];
      for (const r of defaultRacks) {
        for (let bay = 1; bay <= 4; bay++) {
          for (let level = 1; level <= 2; level++) {
            createdSlots.push({
              slotId: `${r.id}-${String(bay).padStart(2, '0')}-${level}`,
              warehouseId: warehouseId.toUpperCase(),
              rackId: r.id,
              rackName: r.name,
              zone: r.zone,
              bay,
              level,
              distanceFromDock: r.distanceFromDock,
              maxVolume: r.maxVolume,
              maxWeight: r.maxWeight,
              currentVolume: 0,
              currentWeight: 0,
              status: 'vacant',
              units: []
            });
          }
        }
      }
      slots = await Slot.insertMany(createdSlots);
    }

    // 3. Prepare units queue for First-Fit Decreasing algorithm
    const queue = [];
    for (let i = 0; i < quantity; i++) {
      queue.push({
        ref: makeRef('U'),
        sku,
        name,
        itemId: dbItem._id,
        dimensions: { l: length, w: width, h: height },
        volume: unitVolume,
        weight,
        velocity,
        fragile,
        addedAt: new Date()
      });
    }

    // Sort decreasing by volume (largest first)
    queue.sort((a, b) => b.volume - a.volume);

    const placed = [];
    const rejected = [];
    const touchedSlots = new Map();

    // 4. Server-Side First-Fit Decreasing Allocation Loop
    queue.forEach((unit, index) => {
      // Find candidate slots that accept unit
      const candidates = slots.filter(s => slotAccepts(s, unit).ok);

      if (candidates.length > 0) {
        const ranked = rankSlots(candidates, unit);
        const target = ranked[0];
        const why = explainChoice(ranked, unit);

        unit.slotId = target.slotId;
        target.units.push(unit);
        target.currentVolume = Number(((target.currentVolume || 0) + unit.volume).toFixed(2));
        target.currentWeight = Number(((target.currentWeight || 0) + unit.weight).toFixed(2));

        const fillRatio = target.maxVolume > 0 ? target.currentVolume / target.maxVolume : 0;
        target.status = fillRatio >= 0.85 ? 'congested' : 'occupied';

        touchedSlots.set(target.slotId, target);

        placed.push({
          unitRef: unit.ref,
          sku: unit.sku,
          name: unit.name,
          slotId: target.slotId,
          rackId: target.rackId,
          rackName: target.rackName,
          zone: target.zone,
          distanceFromDock: target.distanceFromDock,
          volume: unit.volume,
          weight: unit.weight,
          ruleApplied: why.rule,
          explanation: why.text,
          queuePosition: index + 1,
          totalQueueSize: queue.length
        });
      } else {
        rejected.push({
          unitRef: unit.ref,
          sku: unit.sku,
          name: unit.name,
          reason: whyNothingFits(slots, unit),
          volume: unit.volume,
          weight: unit.weight,
          queuePosition: index + 1
        });
      }
    });

    // 5. Bulk save updated slots to MongoDB
    for (const [_, slotDoc] of touchedSlots.entries()) {
      await Slot.updateOne(
        { _id: slotDoc._id },
        {
          $set: {
            units: slotDoc.units,
            currentVolume: slotDoc.currentVolume,
            currentWeight: slotDoc.currentWeight,
            status: slotDoc.status
          }
        }
      );
    }

    // 6. Record transaction in Allocation collection
    const allocationRef = 'ALC-' + Math.floor(100000 + Math.random() * 900000);
    const allocationDoc = await Allocation.create({
      allocationRef,
      warehouseId: warehouseId.toUpperCase(),
      companyName: companyName || '',
      batchInput: {
        sku,
        name,
        quantity,
        length,
        width,
        height,
        volumePerUnit: unitVolume,
        weightPerUnit: weight,
        velocity,
        fragile
      },
      placedUnits: placed,
      rejectedUnits: rejected,
      summary: {
        requestedQty: quantity,
        placedQty: placed.length,
        rejectedQty: rejected.length,
        totalVolumePlaced: Number(placed.reduce((acc, u) => acc + u.volume, 0).toFixed(2)),
        totalWeightPlaced: Number(placed.reduce((acc, u) => acc + u.weight, 0).toFixed(2)),
        status: placed.length === quantity ? 'full' : placed.length > 0 ? 'partial' : 'failed'
      },
      performedBy: {
        email: (req.user && req.user.email) || 'supervisor@nexvault.internal',
        role: (req.user && req.user.role) || 'supervisor'
      }
    });

    // Return detailed response
    return res.status(200).json({
      success: true,
      allocationRef,
      warehouseId: warehouseId.toUpperCase(),
      placed,
      rejected,
      summary: allocationDoc.summary,
      message: placed.length === quantity
        ? `Successfully allocated all ${placed.length} units of ${sku}`
        : placed.length > 0
          ? `Partially allocated ${placed.length} units; ${rejected.length} units queued`
          : `Could not allocate ${sku}: capacity reached`
    });
  } catch (error) {
    next(error);
  }
};

const RACK_PLANS = {
  'WH-MOH': [
    { id: 'A', name: 'Rack A', zone: 'Fast-pick', distanceFromDock: 1, maxVolume: 900, maxWeight: 450 },
    { id: 'F', name: 'Rack F', zone: 'Outbound stage', distanceFromDock: 1, maxVolume: 600, maxWeight: 300 },
    { id: 'C', name: 'Rack C', zone: 'Cold zone', distanceFromDock: 2, maxVolume: 800, maxWeight: 400 },
    { id: 'B', name: 'Rack B', zone: 'Bulk overrun', distanceFromDock: 3, maxVolume: 1400, maxWeight: 900 },
    { id: 'E', name: 'Rack E', zone: 'Returns staging', distanceFromDock: 4, maxVolume: 700, maxWeight: 350 },
    { id: 'D', name: 'Rack D', zone: 'Reserve cage', distanceFromDock: 5, maxVolume: 1200, maxWeight: 700 }
  ],
  'WH-CHD': [
    { id: 'A', name: 'Rack A', zone: 'Fast-pick', distanceFromDock: 1, maxVolume: 800, maxWeight: 400 },
    { id: 'B', name: 'Rack B', zone: 'Outbound stage', distanceFromDock: 2, maxVolume: 700, maxWeight: 350 },
    { id: 'C', name: 'Rack C', zone: 'General store', distanceFromDock: 3, maxVolume: 1100, maxWeight: 650 },
    { id: 'D', name: 'Rack D', zone: 'Reserve cage', distanceFromDock: 4, maxVolume: 1000, maxWeight: 600 },
    { id: 'E', name: 'Rack E', zone: 'Deep store', distanceFromDock: 5, maxVolume: 1300, maxWeight: 800 }
  ],
  'WH-PAT': [
    { id: 'A', name: 'Rack A', zone: 'Fast-pick', distanceFromDock: 1, maxVolume: 700, maxWeight: 350 },
    { id: 'B', name: 'Rack B', zone: 'Bulk overrun', distanceFromDock: 2, maxVolume: 1500, maxWeight: 950 },
    { id: 'C', name: 'Rack C', zone: 'Deep store', distanceFromDock: 4, maxVolume: 1400, maxWeight: 900 },
    { id: 'D', name: 'Rack D', zone: 'Reserve cage', distanceFromDock: 5, maxVolume: 1200, maxWeight: 700 }
  ]
};

const WAREHOUSE_DIRECTORY = {
  'WH-MOH': { name: 'Mohali — Phase 8 Yard', city: 'Mohali' },
  'WH-CHD': { name: 'Chandigarh — Industrial Area', city: 'Chandigarh' },
  'WH-PAT': { name: 'Patiala — Rajpura Road', city: 'Patiala' }
};

/**
 * @desc    Get full warehouse floor model from MongoDB Atlas
 * @route   GET /api/warehouse/:warehouseId
 * @access  Public / Supervisor
 */
exports.getWarehouseFull = async (req, res, next) => {
  try {
    const warehouseId = (req.params.warehouseId || 'WH-MOH').toUpperCase();
    let slots = await Slot.find({ warehouseId }).sort({ rackId: 1, bay: 1, level: 1 });

    if (!slots || slots.length === 0) {
      const plan = RACK_PLANS[warehouseId] || RACK_PLANS['WH-MOH'];
      const toCreate = [];
      for (const rack of plan) {
        for (let bay = 1; bay <= 4; bay++) {
          for (let level = 1; level <= 2; level++) {
            toCreate.push({
              slotId: `${rack.id}-${String(bay).padStart(2, '0')}-${level}`,
              warehouseId,
              rackId: rack.id,
              rackName: rack.name,
              zone: rack.zone,
              bay,
              level,
              distanceFromDock: rack.distanceFromDock,
              maxVolume: rack.maxVolume,
              maxWeight: rack.maxWeight,
              currentVolume: 0,
              currentWeight: 0,
              status: 'vacant',
              units: []
            });
          }
        }
      }
      slots = await Slot.insertMany(toCreate);
    }

    const racksMap = new Map();
    slots.forEach(s => {
      const parts = (s.slotId || '').split('-');
      const rackId = s.rackId || parts[0] || 'A';
      const rackName = s.rackName || `Rack ${rackId}`;
      const zone = s.zone || 'General store';
      const distanceFromDock = Number(s.distanceFromDock) || 1;
      const bay = Number(s.bay) || Number(parts[1]) || 1;
      const level = Number(s.level) || Number(parts[2]) || 1;
      const maxVolume = Number(s.maxVolume) || (rackId >= 'E' ? 1300 : 800);
      const maxWeight = Number(s.maxWeight) || (rackId >= 'E' ? 800 : 400);

      if (!racksMap.has(rackId)) {
        racksMap.set(rackId, {
          id: rackId,
          name: rackName,
          zone: zone,
          distanceFromDock: distanceFromDock,
          slots: []
        });
      }
      racksMap.get(rackId).slots.push({
        id: s.slotId,
        bay: bay,
        level: level,
        maxVolume: maxVolume,
        maxWeight: maxWeight,
        currentVolume: s.currentVolume || 0,
        currentWeight: s.currentWeight || 0,
        status: s.status,
        units: (s.units || []).map(u => ({
          ref: u.ref,
          sku: u.sku,
          name: u.name,
          volume: u.volume,
          weight: u.weight,
          velocity: u.velocity,
          fragile: u.fragile,
          addedAt: u.addedAt
        }))
      });
    });

    const info = WAREHOUSE_DIRECTORY[warehouseId] || { name: warehouseId, city: 'Site' };
    const allocations = await Allocation.find({ warehouseId }).sort({ createdAt: -1 }).limit(10);
    const log = allocations.map(a => ({
      text: `Allocated ${a.summary ? a.summary.placedQty : 0} units of ${a.batchInput ? a.batchInput.sku : 'inventory'}`,
      at: new Date(a.createdAt).getTime()
    }));

    return res.status(200).json({
      success: true,
      warehouse: {
        id: warehouseId,
        name: info.name,
        sector: info.city,
        racks: Array.from(racksMap.values()),
        pending: [],
        log
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove stock from slot in MongoDB Atlas
 * @route   POST /api/warehouse/remove
 * @access  Public / Supervisor
 */
exports.removeStock = async (req, res, next) => {
  try {
    const { warehouseId = 'WH-MOH', slotId, sku, quantity = 1 } = req.body;
    if (!slotId || !sku) {
      return res.status(400).json({ success: false, message: 'slotId and sku are required' });
    }

    const slot = await Slot.findOne({
      warehouseId: warehouseId.toUpperCase(),
      slotId: slotId.toUpperCase().trim()
    });

    if (!slot) {
      return res.status(404).json({ success: false, message: `Slot ${slotId} not found in ${warehouseId}` });
    }

    const wanted = sku.toUpperCase().trim();
    const matching = (slot.units || []).filter(u => u.sku.toUpperCase() === wanted);

    if (matching.length === 0) {
      return res.status(400).json({ success: false, message: `Slot ${slotId} does not contain SKU ${sku}` });
    }

    const count = Math.min(Number(quantity) || 1, matching.length);
    const toRemoveRefs = new Set(matching.slice(0, count).map(u => u.ref));

    slot.units = slot.units.filter(u => !toRemoveRefs.has(u.ref));
    slot.currentVolume = Number(slot.units.reduce((sum, u) => sum + (u.volume || 0), 0).toFixed(2));
    slot.currentWeight = Number(slot.units.reduce((sum, u) => sum + (u.weight || 0), 0).toFixed(2));

    const fillRatio = slot.maxVolume > 0 ? slot.currentVolume / slot.maxVolume : 0;
    slot.status = slot.units.length === 0 ? 'vacant' : fillRatio >= 0.85 ? 'congested' : 'occupied';

    await slot.save();

    return res.status(200).json({
      success: true,
      message: `Removed ${count} units of ${sku} from ${slotId}`,
      removed: count,
      slot
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Transfer stock from one slot to another with volume, weight, and fragility constraints
 * @route   POST /api/warehouse/transfer
 * @access  Public / Supervisor
 */
exports.transferStock = async (req, res, next) => {
  try {
    const { warehouseId = 'WH-MOH', fromSlotId, toSlotId, sku, quantity = 1 } = req.body;
    if (!fromSlotId || !toSlotId || !sku) {
      return res.status(400).json({
        success: false,
        message: 'fromSlotId, toSlotId, and sku are required'
      });
    }

    const whId = warehouseId.toUpperCase().trim();
    const fromId = fromSlotId.toUpperCase().trim();
    const toId = toSlotId.toUpperCase().trim();

    if (fromId === toId) {
      return res.status(400).json({
        success: false,
        message: 'Source and destination slot cannot be the same'
      });
    }

    const fromSlot = await Slot.findOne({ warehouseId: whId, slotId: fromId });
    if (!fromSlot) {
      return res.status(404).json({ success: false, message: `Source slot ${fromId} not found in ${whId}` });
    }

    const toSlot = await Slot.findOne({ warehouseId: whId, slotId: toId });
    if (!toSlot) {
      return res.status(404).json({ success: false, message: `Destination slot ${toId} not found in ${whId}` });
    }

    const wanted = sku.toUpperCase().trim();
    const matching = (fromSlot.units || []).filter(u => u.sku.toUpperCase() === wanted);

    if (matching.length === 0) {
      return res.status(400).json({ success: false, message: `Slot ${fromId} does not contain SKU ${sku}` });
    }

    const count = Math.min(Number(quantity) || 1, matching.length);
    const unitsToMove = matching.slice(0, count);

    // Validate destination capacity & constraints
    const totalMoveVol = Number(unitsToMove.reduce((sum, u) => sum + (u.volume || 0), 0).toFixed(2));
    const totalMoveWt = Number(unitsToMove.reduce((sum, u) => sum + (u.weight || 0), 0).toFixed(2));

    const toCurrentVol = toSlot.currentVolume || (toSlot.units || []).reduce((sum, u) => sum + (u.volume || 0), 0);
    const toCurrentWt = toSlot.currentWeight || (toSlot.units || []).reduce((sum, u) => sum + (u.weight || 0), 0);

    if (toCurrentVol + totalMoveVol > toSlot.maxVolume) {
      return res.status(400).json({
        success: false,
        message: `Destination slot ${toId} has insufficient volume (needs ${totalMoveVol} L, available ${(toSlot.maxVolume - toCurrentVol).toFixed(1)} L)`
      });
    }

    if (toCurrentWt + totalMoveWt > toSlot.maxWeight) {
      return res.status(400).json({
        success: false,
        message: `Destination slot ${toId} would exceed weight limit (needs ${totalMoveWt} kg, available ${toSlot.maxWeight - toCurrentWt} kg)`
      });
    }

    // Fragility checks
    const hasFragileInDestination = (toSlot.units || []).some(u => u.fragile);
    const isMovingFragile = unitsToMove.some(u => u.fragile);

    if (hasFragileInDestination && (toSlot.units || []).length > 0) {
      return res.status(400).json({
        success: false,
        message: `Destination slot ${toId} holds fragile units and cannot accept mixed inventory`
      });
    }

    if (isMovingFragile && (toSlot.units || []).length > 0) {
      return res.status(400).json({
        success: false,
        message: `Fragile units require a dedicated vacant slot; destination slot ${toId} already has units`
      });
    }

    // Move units from source to destination
    const moveRefs = new Set(unitsToMove.map(u => u.ref));
    fromSlot.units = fromSlot.units.filter(u => !moveRefs.has(u.ref));
    fromSlot.currentVolume = Number(fromSlot.units.reduce((sum, u) => sum + (u.volume || 0), 0).toFixed(2));
    fromSlot.currentWeight = Number(fromSlot.units.reduce((sum, u) => sum + (u.weight || 0), 0).toFixed(2));
    const fromFill = fromSlot.maxVolume > 0 ? fromSlot.currentVolume / fromSlot.maxVolume : 0;
    fromSlot.status = fromSlot.units.length === 0 ? 'vacant' : fromFill >= 0.85 ? 'congested' : 'occupied';

    unitsToMove.forEach(u => {
      toSlot.units.push({
        ref: u.ref,
        sku: u.sku,
        name: u.name,
        itemId: u.itemId,
        dimensions: u.dimensions,
        volume: u.volume,
        weight: u.weight,
        velocity: u.velocity,
        fragile: u.fragile,
        addedAt: new Date()
      });
    });

    toSlot.currentVolume = Number(toSlot.units.reduce((sum, u) => sum + (u.volume || 0), 0).toFixed(2));
    toSlot.currentWeight = Number(toSlot.units.reduce((sum, u) => sum + (u.weight || 0), 0).toFixed(2));
    const toFill = toSlot.maxVolume > 0 ? toSlot.currentVolume / toSlot.maxVolume : 0;
    toSlot.status = toFill >= 0.85 ? 'congested' : 'occupied';

    await fromSlot.save();
    await toSlot.save();

    // Log transaction in Allocation ledger
    const transferRef = 'TRF-' + Math.floor(100000 + Math.random() * 900000);
    await Allocation.create({
      allocationRef: transferRef,
      warehouseId: whId,
      companyName: (req.user && req.user.company) || '',
      batchInput: {
        sku: wanted,
        name: unitsToMove[0] ? unitsToMove[0].name : sku,
        quantity: count,
        length: (unitsToMove[0] && unitsToMove[0].dimensions && (unitsToMove[0].dimensions.l || unitsToMove[0].dimensions.length)) || 60,
        width: (unitsToMove[0] && unitsToMove[0].dimensions && (unitsToMove[0].dimensions.w || unitsToMove[0].dimensions.width)) || 40,
        height: (unitsToMove[0] && unitsToMove[0].dimensions && (unitsToMove[0].dimensions.h || unitsToMove[0].dimensions.height)) || 35,
        volumePerUnit: unitsToMove[0] ? unitsToMove[0].volume : 0,
        weightPerUnit: unitsToMove[0] ? unitsToMove[0].weight : 0,
        velocity: unitsToMove[0] ? unitsToMove[0].velocity : 'medium',
        fragile: isMovingFragile
      },
      placedUnits: unitsToMove.map(u => ({
        unitRef: u.ref,
        sku: u.sku,
        name: u.name,
        slotId: toId,
        rackId: toSlot.rackId,
        rackName: toSlot.rackName,
        zone: toSlot.zone,
        distanceFromDock: toSlot.distanceFromDock,
        volume: u.volume,
        weight: u.weight,
        ruleApplied: 'Manual Transfer',
        explanation: `Relocated ${count} unit(s) of ${sku} from ${fromId} to ${toId}`
      })),
      rejectedUnits: [],
      summary: {
        requestedQty: count,
        placedQty: count,
        rejectedQty: 0,
        totalVolumePlaced: totalMoveVol,
        totalWeightPlaced: totalMoveWt,
        status: 'full'
      },
      performedBy: {
        email: (req.user && req.user.email) || 'supervisor@nexvault.internal',
        role: 'supervisor'
      }
    });

    return res.status(200).json({
      success: true,
      message: `Successfully transferred ${count} unit(s) of ${sku} from ${fromId} to ${toId}`,
      transferRef,
      transferredCount: count,
      fromSlot,
      toSlot
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reset warehouse slots in MongoDB Atlas back to vacant
 * @route   POST /api/warehouse/reset
 * @access  Public / Supervisor
 */
exports.resetWarehouse = async (req, res, next) => {
  try {
    const warehouseId = (req.body.warehouseId || req.params.warehouseId || 'WH-MOH').toUpperCase();
    await Slot.updateMany(
      { warehouseId },
      { $set: { units: [], currentVolume: 0, currentWeight: 0, status: 'vacant' } }
    );
    return res.status(200).json({
      success: true,
      message: `Reset warehouse ${warehouseId} slots in MongoDB Atlas to vacant`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Sync entire warehouse floor state from client into MongoDB Atlas
 * @route   POST /api/warehouse/sync
 * @access  Public / Supervisor
 */
exports.syncWarehouseState = async (req, res, next) => {
  try {
    const { warehouseId = 'WH-MOH', racks, companyName } = req.body;
    if (!racks || !Array.isArray(racks)) {
      return res.status(400).json({ success: false, message: 'racks array is required' });
    }

    const whId = warehouseId.toUpperCase();
    const isPrimary = ['WH-MOH', 'WH-CHD', 'WH-PAT'].includes(whId);

    // If dynamic warehouse, verify its company exists before saving slots
    if (!isPrimary && companyName) {
      const company = await Company.findOne({ name: companyName.trim() });
      if (!company) {
        return res.status(200).json({ success: false, message: 'Skipped sync for removed company' });
      }
      if (!company.warehouses.some(w => w.id === whId)) {
        const totalSlots = racks.reduce((acc, r) => acc + (r.slots ? r.slots.length : 0), 0);
        company.warehouses.push({
          id: whId,
          name: `${company.name} Yard (${whId})`,
          passcode: '1101',
          slots: totalSlots || 48
        });
        await company.save();
      }
    } else if (companyName && isPrimary) {
      const company = await Company.findOne({ name: companyName.trim() });
      if (company && !company.warehouses.some(w => w.id === whId)) {
        company.warehouses.push({
          id: whId,
          name: `${company.name} (${whId})`,
          passcode: '1101',
          slots: racks.reduce((acc, r) => acc + (r.slots ? r.slots.length : 0), 0) || 48
        });
        await company.save();
      }
    }

    for (const rack of racks) {
      const rackId = rack.id || (rack.slots && rack.slots[0] ? rack.slots[0].id.split('-')[0] : 'A');
      const rackName = rack.name || `Rack ${rackId}`;
      const zone = rack.zone || 'General store';
      const distanceFromDock = Number(rack.distanceFromDock) || 1;

      if (rack.slots && Array.isArray(rack.slots)) {
        for (const s of rack.slots) {
          const parts = (s.id || '').split('-');
          const slotRackId = parts[0] || rackId;
          const bay = Number(s.bay) || Number(parts[1]) || 1;
          const level = Number(s.level) || Number(parts[2]) || 1;
          const maxVolume = Number(s.maxVolume) || (slotRackId >= 'E' ? 1300 : 800);
          const maxWeight = Number(s.maxWeight) || (slotRackId >= 'E' ? 800 : 400);

          const currentVol = Number((s.units || []).reduce((sum, u) => sum + (u.volume || 0), 0).toFixed(2));
          const currentWt = Number((s.units || []).reduce((sum, u) => sum + (u.weight || 0), 0).toFixed(2));
          const fill = maxVolume > 0 ? currentVol / maxVolume : 0;
          const status = (s.units || []).length === 0 ? 'vacant' : fill >= 0.85 ? 'congested' : 'occupied';

          await Slot.updateOne(
            { warehouseId: warehouseId.toUpperCase(), slotId: s.id },
            {
              $set: {
                rackId: slotRackId,
                rackName: rackName,
                zone: zone,
                distanceFromDock: distanceFromDock,
                bay: bay,
                level: level,
                maxVolume: maxVolume,
                maxWeight: maxWeight,
                units: s.units || [],
                currentVolume: currentVol,
                currentWeight: currentWt,
                status
              }
            },
            { upsert: true }
          );
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Synchronized ${warehouseId} floor state to MongoDB Atlas`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all slots and current occupancy for a warehouse
 * @route   GET /api/warehouse/slots/:warehouseId
 * @access  Public / Supervisor
 */
exports.getWarehouseSlots = async (req, res, next) => {
  try {
    const warehouseId = (req.params.warehouseId || 'WH-MOH').toUpperCase();
    const slots = await Slot.find({ warehouseId }).sort({ rackId: 1, bay: 1, level: 1 });
    return res.status(200).json({
      success: true,
      warehouseId,
      count: slots.length,
      slots
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get recent allocation history for a warehouse
 * @route   GET /api/warehouse/allocations/:warehouseId
 * @access  Public / Supervisor
 */
exports.getWarehouseAllocations = async (req, res, next) => {
  try {
    const warehouseId = (req.params.warehouseId || 'WH-MOH').toUpperCase();
    const allocations = await Allocation.find({ warehouseId }).sort({ createdAt: -1 }).limit(20);
    return res.status(200).json({
      success: true,
      warehouseId,
      count: allocations.length,
      allocations
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Rename a warehouse in MongoDB Atlas
 * @route   POST /api/warehouse/rename
 * @access  Public / Company Admin
 */
exports.renameWarehouse = async (req, res, next) => {
  try {
    const { warehouseId, newName, newCity } = req.body;
    if (!warehouseId || !newName) {
      return res.status(400).json({ success: false, message: 'warehouseId and newName are required.' });
    }

    const whId = warehouseId.toUpperCase().trim();
    const cleanName = newName.trim();
    const cleanCity = newCity ? newCity.trim() : null;

    const company = await Company.findOne({ 'warehouses.id': whId });
    if (!company) {
      return res.status(404).json({ success: false, message: `Warehouse ${whId} not found in company records.` });
    }

    const targetWh = company.warehouses.find(w => w.id === whId);
    if (targetWh) {
      targetWh.name = cleanName;
      if (cleanCity) targetWh.city = cleanCity;
      company.markModified('warehouses');
      await company.save();
    }

    return res.status(200).json({
      success: true,
      message: `Warehouse ${whId} renamed to '${cleanName}'`,
      warehouse: targetWh
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all warehouses belonging to a company from MongoDB Atlas
 * @route   GET /api/warehouse/company/:companyName
 * @access  Public / Company Admin
 */
exports.getCompanyWarehouses = async (req, res, next) => {
  try {
    const companyName = req.params.companyName;
    const company = await Company.findOne({ name: companyName.trim() });
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }
    return res.status(200).json({
      success: true,
      company: company.name,
      count: (company.warehouses || []).length,
      warehouses: company.warehouses || []
    });
  } catch (error) {
    next(error);
  }
};
