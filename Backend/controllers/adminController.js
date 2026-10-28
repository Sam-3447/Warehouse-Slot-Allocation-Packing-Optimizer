const Company = require('../models/Company');
const Slot = require('../models/Slot');
const { sendApprovalEmail, sendRejectionEmail } = require('../utils/emailService');

/**
 * @route   GET /api/admin/companies
 * @desc    Get all company accounts (pending, approved, rejected)
 * @access  Private (Platform Admin) or Public for Admin Console sync
 */
const getAllCompanies = async (req, res, next) => {
  try {
    const companies = await Company.find()
      .select('-password')
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      count: companies.length,
      companies
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/admin/companies/decide
 * @route   PUT /api/admin/companies/:identifier/decide
 * @desc    Approve or reject a company registration and send SMTP notification
 * @access  Platform Admin
 */
const decideCompany = async (req, res, next) => {
  try {
    const identifier = req.params.identifier || req.body.email || req.body.id;
    const { decision, reason } = req.body;

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Company identifier (id or email) is required.'
      });
    }

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: "Decision must be either 'approved' or 'rejected'."
      });
    }

    // Find by either MongoDB _id or by email
    const query = identifier.match(/^[0-9a-fA-F]{24}$/)
      ? { _id: identifier }
      : { email: identifier.trim().toLowerCase() };

    const company = await Company.findOne(query);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found.'
      });
    }

    company.status = decision;
    company.decidedAt = new Date();
    if (reason) company.decisionNote = reason;

    // Auto-generate requested warehouses upon approval if company has none yet
    if (decision === 'approved' && (!company.warehouses || company.warehouses.length === 0)) {
      const count = Math.max(1, Math.min(10, company.requestedWarehouses || 1));
      const cleanPrefix = company.name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'FAC';
      const defaultHubs = [
        { city: 'Central Hub', zone: 'Primary Distribution' },
        { city: 'North Depot', zone: 'Regional Inbound' },
        { city: 'South Terminal', zone: 'Fulfillment Center' },
        { city: 'East Gateway', zone: 'Cross-dock Facility' },
        { city: 'West Yard', zone: 'Overrun Storage' },
        { city: 'Metro Depot', zone: 'Fast Pick Facility' },
        { city: 'Express Center', zone: 'Parcel Terminal' },
        { city: 'Logistics Park', zone: 'Bulk Overrun' },
        { city: 'City Station', zone: 'Urban Logistics' },
        { city: 'Airport Terminal', zone: 'Air Cargo Transfer' }
      ];

      const newWarehouses = [];
      const slotsToCreate = [];

      for (let i = 1; i <= count; i++) {
        const whId = `WH-${cleanPrefix}${i}`;
        const hubInfo = defaultHubs[i - 1] || { city: `Facility ${i}`, zone: 'General Storage' };
        const whName = `${company.name} — ${hubInfo.city}`;
        const passcode = String(1100 + i);

        newWarehouses.push({
          id: whId,
          name: whName,
          city: hubInfo.city,
          passcode,
          slots: 32
        });

        // 4 racks (A, B, C, D) × 4 bays × 2 levels = 32 slots per warehouse
        const rackPlan = [
          { id: 'A', name: 'Rack A', zone: 'Fast-pick', distanceFromDock: 1, maxVolume: 800, maxWeight: 400 },
          { id: 'B', name: 'Rack B', zone: 'Outbound stage', distanceFromDock: 2, maxVolume: 800, maxWeight: 400 },
          { id: 'C', name: 'Rack C', zone: 'General store', distanceFromDock: 3, maxVolume: 1200, maxWeight: 700 },
          { id: 'D', name: 'Rack D', zone: 'Reserve cage', distanceFromDock: 4, maxVolume: 1400, maxWeight: 900 }
        ];

        for (const r of rackPlan) {
          for (let bay = 1; bay <= 4; bay++) {
            for (let level = 1; level <= 2; level++) {
              slotsToCreate.push({
                slotId: `${r.id}-${String(bay).padStart(2, '0')}-${level}`,
                warehouseId: whId,
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
      }

      company.warehouses = newWarehouses;
      if (slotsToCreate.length > 0) {
        await Slot.deleteMany({ warehouseId: { $in: newWarehouses.map(w => w.id) } });
        await Slot.insertMany(slotsToCreate);
      }
    }

    await company.save();

    // Trigger SMTP email sending
    let emailResult = null;
    try {
      const appUrl = process.env.FRONTEND_URL || 'https://nexvault-warehouse.vercel.app';

      if (decision === 'approved') {
        emailResult = await sendApprovalEmail({
          to: company.email,
          companyName: company.name,
          contactName: company.contact,
          appUrl
        });
      } else {
        emailResult = await sendRejectionEmail({
          to: company.email,
          companyName: company.name,
          contactName: company.contact,
          reason
        });
      }
    } catch (emailErr) {
      console.error('[SMTP Send Error]', emailErr);
    }

    return res.json({
      success: true,
      message: `Company registration has been ${decision}. Notification email sent via SMTP.`,
      company: {
        id: company._id,
        name: company.name,
        email: company.email,
        status: company.status,
        decidedAt: company.decidedAt,
        decisionNote: company.decisionNote
      },
      emailSent: Boolean(emailResult && emailResult.success),
      emailError: emailResult && !emailResult.success ? emailResult.error : null,
      previewUrl: emailResult && emailResult.previewUrl ? emailResult.previewUrl : null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/admin/stats
 * @desc    Get summary statistics for platform console
 * @access  Platform Admin
 */
const getPlatformStats = async (req, res, next) => {
  try {
    const totalCompanies = await Company.countDocuments();
    const pendingCompanies = await Company.countDocuments({ status: 'pending' });
    const approvedCompanies = await Company.countDocuments({ status: 'approved' });

    return res.json({
      success: true,
      stats: {
        totalCompanies,
        pendingCompanies,
        approvedCompanies
      }
    });
  } catch (error) {
    next(error);
  }
};

const deletePendingCompany = async (req, res, next) => {
  try {
    const identifier = String(req.params.identifier || req.body.identifier || req.body.id || req.body.email || req.query.identifier || '').trim();

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'Company identifier (id or email) is required.'
      });
    }

    const query = /^[0-9a-fA-F]{24}$/.test(identifier)
      ? { _id: identifier }
      : { email: identifier.toLowerCase() };

    const company = await Company.findOne(query);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found.'
      });
    }

    if (!['pending', 'rejected'].includes(company.status)) {
      return res.status(409).json({
        success: false,
        message: 'Only pending or rejected company registrations can be deleted.'
      });
    }
    if (company.warehouses && company.warehouses.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete a company that still has warehouse records.'
      });
    }

    await Company.deleteOne({ _id: company._id });

    return res.status(200).json({
      success: true,
      message: 'Company registration deleted successfully.',
      deletedCompany: {
        id: company._id,
        name: company.name,
        email: company.email
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllCompanies,
  decideCompany,
  getPlatformStats,
  deletePendingCompany

};
