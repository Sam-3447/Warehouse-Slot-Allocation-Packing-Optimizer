const express = require('express');
const router = express.Router();
const { getAllCompanies, decideCompany, getPlatformStats, deletePendingCompany } = require('../controllers/adminController');

// In development / demo mode, allow console access directly, or with token if provided
router.get('/companies', getAllCompanies);
router.post('/companies/decide', decideCompany);
router.put('/companies/:identifier/decide', decideCompany);
router.delete('/companies/:identifier', deletePendingCompany);
router.delete('/companies', deletePendingCompany);
router.get('/stats', getPlatformStats);

module.exports = router;
