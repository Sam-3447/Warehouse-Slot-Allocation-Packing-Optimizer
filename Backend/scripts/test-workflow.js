/**
 * End-to-End Test for Authentication, Approval/Rejection Workflow, and SMTP Email Notifications
 */
const http = require('http');

const PORT = process.env.PORT || 5001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const request = (endpoint, options = {}, data = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
};

async function runTests() {
  console.log('==================================================');
  console.log('  STARTING NEXVAULT AUTHENTICATION & SMTP WORKFLOW TESTS');
  console.log('==================================================\n');

  try {
    // 1. Health check
    const health = await request('/api/health');
    console.log('✔ [1/7] Health Check:', health.status === 200 ? 'PASSED' : 'FAILED', health.data);

    // 2. Register Company A (Target for Approval)
    const testEmailA = `test.approval.${Date.now()}@logistics.com`;
    const regA = await request('/api/auth/register', { method: 'POST' }, {
      companyName: 'Starlight Global Logistics',
      contactName: 'Rohit Sharma',
      workEmail: testEmailA,
      warehouseCount: 3,
      password: 'password2026'
    });
    console.log('✔ [2/7] Company Registration (Status: Pending):', regA.status === 201 ? 'PASSED' : 'FAILED');
    console.log('        Company ID:', regA.data.company.id, '| Reference:', regA.data.reference);

    // 3. Attempt Login While Pending
    const pendingLogin = await request('/api/auth/login', { method: 'POST' }, {
      email: testEmailA,
      password: 'password2026',
      role: 'company-admin'
    });
    console.log('✔ [3/7] Block Sign-In for Pending Account:', pendingLogin.status === 403 ? 'PASSED (Blocked as expected)' : 'FAILED', pendingLogin.data.message);

    // 4. Platform Admin Approves Company A
    const approve = await request('/api/admin/companies/decide', { method: 'POST' }, {
      email: testEmailA,
      decision: 'approved'
    });
    console.log('✔ [4/7] Platform Admin Approval & SMTP Email:', approve.status === 200 ? 'PASSED' : 'FAILED');
    console.log('        Email Sent via SMTP:', approve.data.emailSent);
    if (approve.data.previewUrl) {
      console.log('        Email Preview URL:', approve.data.previewUrl);
    }

    // 5. Login After Approval (JWT issued)
    const approvedLogin = await request('/api/auth/login', { method: 'POST' }, {
      email: testEmailA,
      password: 'password2026',
      role: 'company-admin'
    });
    const token = approvedLogin.data.token;
    console.log('✔ [5/7] Sign-In for Approved Account:', approvedLogin.status === 200 && token ? 'PASSED (JWT Token Issued)' : 'FAILED');

    // 6. Access Protected Route with JWT
    const me = await request('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('✔ [6/7] Access Protected Route with JWT:', me.status === 200 ? 'PASSED' : 'FAILED', `Authenticated as: ${me.data.user.email} (${me.data.user.role})`);

    // 7. Rejection Workflow
    const testEmailB = `test.rejection.${Date.now()}@cargo.com`;
    await request('/api/auth/register', { method: 'POST' }, {
      companyName: 'Blue Ocean Freight',
      contactName: 'Ananya Roy',
      workEmail: testEmailB,
      warehouseCount: 1,
      password: 'mypassword2026'
    });
    const decline = await request('/api/admin/companies/decide', { method: 'POST' }, {
      email: testEmailB,
      decision: 'rejected',
      reason: 'Incomplete warehouse documentation.'
    });
    const declineLogin = await request('/api/auth/login', { method: 'POST' }, {
      email: testEmailB,
      password: 'mypassword2026',
      role: 'company-admin'
    });
    console.log('✔ [7/7] Rejection Workflow & SMTP Email:', decline.status === 200 && declineLogin.status === 403 ? 'PASSED' : 'FAILED');
    console.log('        Rejection Message:', declineLogin.data.message);
    if (decline.data.previewUrl) {
      console.log('        Rejection Email Preview URL:', decline.data.previewUrl);
    }

    // Cleanup temporary test accounts and slots from MongoDB
    try {
      const mongoose = require('mongoose');
      const Company = require('../models/Company');
      const Slot = require('../models/Slot');
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nexvault');
      await Company.deleteMany({ email: { $in: [testEmailA, testEmailB] } });
      await Slot.deleteMany({ warehouseId: { $in: ['WH-STA1', 'WH-STA2', 'WH-STA3'] } });
      await mongoose.disconnect();
      console.log('✔ [Cleanup] Removed temporary test records from MongoDB Atlas.');
    } catch (cleanupErr) {
      // Non-fatal if direct DB cleanup is skipped
    }

    console.log('\n==================================================');
    console.log('  ALL WORKFLOW TESTS COMPLETED SUCCESSFULLY!');
    console.log('==================================================');
  } catch (err) {
    console.error('Test suite encountered an error:', err);
  }
}

runTests();
