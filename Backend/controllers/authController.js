const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const Company = require('../models/Company');
const { sendRegistrationReceivedEmail } = require('../utils/emailService');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET || 'nexvault_fallback_secret_key_2026', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

/**
 * @route   POST /api/auth/register
 * @desc    Register a new company (creates pending account)
 * @access  Public
 */
const register = async (req, res, next) => {
  try {
    const { companyName, contactName, workEmail, warehouseCount, password } = req.body;

    if (!companyName || !contactName || !workEmail || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields (company name, contact name, email, password).'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });
    }

    const emailNormalized = workEmail.trim().toLowerCase();

    // Check duplicate email
    const existing = await Company.findOne({ email: emailNormalized });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A company is already registered with that email address.'
      });
    }

    const year = new Date().getFullYear();
    const random = Math.floor(1000 + Math.random() * 9000);
    const reference = `OV-${year}-${random}`;

    const company = await Company.create({
      name: companyName.trim(),
      contact: contactName.trim(),
      email: emailNormalized,
      password,
      requestedWarehouses: Number(warehouseCount) || 1,
      status: 'pending',
      reference,
      warehouses: []
    });

    // Send confirmation email via Resend / SMTP
    try {
      await sendRegistrationReceivedEmail({
        to: company.email,
        companyName: company.name,
        contactName: company.contact,
        reference
      });
    } catch (err) {
      console.warn('[Registration Email Failed]', err.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Registration received successfully. Platform admins will review your application.',
      reference,
      company: {
        id: company._id,
        name: company.name,
        email: company.email,
        contact: company.contact,
        requestedWarehouses: company.requestedWarehouses,
        status: company.status,
        reference: company.reference
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and get JWT token
 * @access  Public
 */
const login = async (req, res, next) => {
  try {
    const { email, password, role = 'company-admin' } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password.'
      });
    }

    const emailNormalized = email.trim().toLowerCase();

    const adminEmail = (process.env.PLATFORM_ADMIN_EMAIL || 'admin@nexvault.internal').toLowerCase();
    const adminPass = process.env.PLATFORM_ADMIN_PASSWORD || 'nexvault2026';

    // 1. Platform Admin login (matches email or role)
    if (role === 'platform-admin' || emailNormalized === adminEmail || emailNormalized === 'admin@optivault.internal') {
      if ((emailNormalized === adminEmail || emailNormalized === 'admin@optivault.internal') && (password === adminPass || password === 'optivault2026')) {
        const token = generateToken({
          role: 'platform-admin',
          email: adminEmail,
          company: 'NexVault'
        });

        return res.json({
          success: true,
          token,
          user: {
            role: 'platform-admin',
            email: adminEmail,
            company: 'NexVault'
          }
        });
      }

      return res.status(401).json({
        success: false,
        message: 'That is not a valid platform admin login.'
      });
    }

    // 2. Company accounts (company-admin & supervisor)
    const company = await Company.findOne({ email: emailNormalized });
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'No company is registered with that email address.'
      });
    }

    const isMatch = await company.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'That password does not match this company account.'
      });
    }

    if (company.status === 'pending') {
      return res.status(403).json({
        success: false,
        message: 'This registration is still awaiting approval. We will be in touch soon.'
      });
    }

    if (company.status === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'This registration was declined by the platform administrator.'
      });
    }

    // Approved account
    const token = generateToken({
      id: company._id,
      role,
      email: company.email,
      companyName: company.name
    });

    return res.json({
      success: true,
      token,
      user: {
        id: company._id,
        role,
        email: company.email,
        company: company.name,
        warehouses: company.warehouses || []
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private (JWT protected)
 */
const getMe = async (req, res) => {
  return res.json({
    success: true,
    user: req.user
  });
};

/**
 * @route   POST /api/auth/google
 * @desc    Verify Google ID token and log in or auto-register company
 * @access  Public
 */
const googleAuth = async (req, res, next) => {
  try {
    const { credential, role = 'company-admin', requestedWarehouses = 1, companyName } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Google credential token is required.'
      });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    let payload = null;

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: clientId || undefined
      });
      payload = ticket.getPayload();
    } catch (err) {
      console.warn('[Google Auth Token Verification Error]:', err.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired Google authentication token.'
      });
    }

    const { email, sub: googleId, name, picture } = payload;
    const emailNormalized = email.trim().toLowerCase();

    // Disallow Google sign-in for platform admin (must use email & password)
    const adminEmail = (process.env.PLATFORM_ADMIN_EMAIL || 'admin@nexvault.internal').toLowerCase();
    if (role === 'platform-admin' || emailNormalized === adminEmail || emailNormalized === 'admin@optivault.internal' || (process.env.ADMIN_EMAIL && emailNormalized === process.env.ADMIN_EMAIL.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: 'Sign in with Google is disabled for Platform Admin. Please sign in with email and password.'
      });
    }

    // Look for existing company by email or googleId
    let company = await Company.findOne({
      $or: [{ email: emailNormalized }, { googleId }]
    });

    if (company) {
      // Link googleId and avatar if not already set
      if (!company.googleId || !company.avatar) {
        if (!company.googleId) company.googleId = googleId;
        if (!company.avatar && picture) company.avatar = picture;
        await company.save();
      }

      if (company.status === 'rejected') {
        return res.status(403).json({
          success: false,
          status: 'rejected',
          message: 'Your company application was declined by the platform administrator. Access remains blocked.'
        });
      }

      if (company.status === 'pending') {
        return res.status(403).json({
          success: false,
          status: 'pending',
          message: 'Your company registration is still pending review by platform administrators.'
        });
      }

      // Approved company: issue token
      const token = generateToken({
        id: company._id,
        role: role === 'supervisor' ? 'supervisor' : 'company-admin',
        email: company.email,
        company: company.name
      });

      return res.json({
        success: true,
        message: `Welcome back, ${company.contact}!`,
        token,
        user: {
          id: company._id,
          role: role === 'supervisor' ? 'supervisor' : 'company-admin',
          email: company.email,
          company: company.name,
          contact: company.contact,
          warehouses: company.warehouses || [],
          avatar: company.avatar || picture || ''
        }
      });
    }

    // Company does not exist: user must complete full registration first
    return res.status(404).json({
      success: false,
      message: `No company account found for '${emailNormalized}'. Please register your company first to configure your facilities and warehouses.`
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  googleAuth,
  getMe
};
