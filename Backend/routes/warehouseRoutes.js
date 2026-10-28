const express = require('express');
const router = express.Router();
const {
  allocateStock,
  getWarehouseSlots,
  getWarehouseAllocations,
  getWarehouseFull,
  removeStock,
  transferStock,
  resetWarehouse,
  syncWarehouseState,
  renameWarehouse,
  getCompanyWarehouses
} = require('../controllers/warehouseController');

// CE2 Core Allocation Endpoint: POST /api/warehouse/allocate
router.post('/allocate', allocateStock);

// Stock transfer between slots
router.post('/transfer', transferStock);

// Rename warehouse in MongoDB
router.post('/rename', renameWarehouse);

// Fetch all warehouses for a company
router.get('/company/:companyName', getCompanyWarehouses);

// Stock removal from slot in MongoDB
router.post('/remove', removeStock);

// Warehouse reset in MongoDB
router.post('/reset', resetWarehouse);

// Live state sync to MongoDB
router.post('/sync', syncWarehouseState);

// Query slots and occupancy for a warehouse
router.get('/slots/:warehouseId', getWarehouseSlots);

// Query historical allocation records for a warehouse
router.get('/allocations/:warehouseId', getWarehouseAllocations);

// Fetch full warehouse model directly from MongoDB Atlas
router.get('/:warehouseId', getWarehouseFull);

module.exports = router;
