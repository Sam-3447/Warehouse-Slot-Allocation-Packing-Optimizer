require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { Slot, Item } = require('../models');

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

const SEED_ITEMS = [
  { sku: 'SKU-88213', name: 'Pallet wrap', length: 100, width: 80, height: 70, weight: 22, velocity: 'fast', fragile: false },
  { sku: 'SKU-40410', name: 'Carton stock', length: 80, width: 60, height: 60, weight: 14, velocity: 'fast', fragile: false },
  { sku: 'SKU-21877', name: 'Label rolls', length: 40, width: 40, height: 30, weight: 4, velocity: 'fast', fragile: false },
  { sku: 'SKU-12190', name: 'Bin flats', length: 120, width: 80, height: 40, weight: 11, velocity: 'medium', fragile: false },
  { sku: 'SKU-63155', name: 'Cold packs', length: 90, width: 70, height: 50, weight: 16, velocity: 'medium', fragile: false },
  { sku: 'SKU-47720', name: 'Returns cartons', length: 70, width: 50, height: 50, weight: 8, velocity: 'medium', fragile: false },
  { sku: 'SKU-73004', name: 'Spare motors', length: 60, width: 60, height: 60, weight: 28, velocity: 'slow', fragile: false },
  { sku: 'SKU-55021', name: 'Glass panels', length: 100, width: 70, height: 40, weight: 20, velocity: 'slow', fragile: true },
  { sku: 'SKU-30112', name: 'Retail cartons', length: 80, width: 60, height: 50, weight: 12, velocity: 'fast', fragile: false },
  { sku: 'SKU-66840', name: 'Shelf brackets', length: 90, width: 50, height: 40, weight: 19, velocity: 'medium', fragile: false },
  { sku: 'SKU-90355', name: 'Bulk sacks', length: 110, width: 90, height: 60, weight: 34, velocity: 'slow', fragile: false }
];

async function seedWarehouseData() {
  try {
    await connectDB();
    console.log('[Seed] Connected to MongoDB');

    // 1. Seed Catalog Items
    console.log('[Seed] Seeding Item catalog...');
    for (const it of SEED_ITEMS) {
      await Item.findOneAndUpdate(
        { sku: it.sku },
        { ...it, volume: Number(((it.length * it.width * it.height) / 1000).toFixed(2)) },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    const itemCount = await Item.countDocuments();
    console.log(`[Seed] Item catalog ready: ${itemCount} items registered.`);

    // 2. Seed Warehouse Grid Slots
    console.log('[Seed] Seeding Warehouse Slots...');
    let totalSlotsCreated = 0;

    for (const [whId, plan] of Object.entries(RACK_PLANS)) {
      for (const rack of plan) {
        for (let bay = 1; bay <= 4; bay++) {
          for (let level = 1; level <= 2; level++) {
            const slotId = `${rack.id}-${String(bay).padStart(2, '0')}-${level}`;
            const existing = await Slot.findOne({ warehouseId: whId, slotId: slotId });
            if (!existing) {
              await Slot.create({
                slotId: slotId,
                warehouseId: whId,
                rackId: rack.id,
                rackName: rack.name,
                zone: rack.zone,
                bay: bay,
                level: level,
                distanceFromDock: rack.distanceFromDock,
                maxVolume: rack.maxVolume,
                maxWeight: rack.maxWeight,
                currentVolume: 0,
                currentWeight: 0,
                status: 'vacant',
                units: []
              });
              totalSlotsCreated++;
            }
          }
        }
      }
    }

    const slotCount = await Slot.countDocuments();
    console.log(`[Seed] Warehouse Slots ready: ${slotCount} total slots across all warehouses (${totalSlotsCreated} newly inserted).`);
    console.log('[Seed] Warehouse data seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('[Seed Error]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  seedWarehouseData();
}

module.exports = seedWarehouseData;
