const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { initTransporter } = require('./config/nodemailer');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const warehouseRoutes = require('./routes/warehouseRoutes');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const app = express();

// Trust proxy for Render / Vercel cloud deployment load balancers
app.set('trust proxy', 1);

// Connect to MongoDB
connectDB();

// Initialize SMTP Mailer in background
initTransporter().catch(err => {
  console.warn('[SMTP Init Warning]', err.message);
});

// Configure CORS for Vercel Frontend and Local Development
const allowedOrigins = [
  'http://localhost:5001',
  'http://localhost:3000',
  'http://127.0.0.1:5001',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    // Allow any Vercel domain (*.vercel.app) or explicitly listed origins
    if (origin.endsWith('.vercel.app') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Allow fallback for other origins
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files seamlessly if running monolithic or local
app.use(express.static(path.join(__dirname, '../Frontend')));
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname)));

// API Root Status
app.get('/api', (req, res) => {
  res.status(200).json({
    name: 'NexVault Backend Optimization Engine API',
    status: 'online',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      admin: '/api/admin',
      warehouse: '/api/warehouse'
    }
  });
});

// Health check endpoint (Used by Render for automated health monitoring)
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

  res.status(200).json({
    status: 'healthy',
    service: 'NexVault Backend',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: dbStatusMap[dbState] || 'unknown'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/warehouse', warehouseRoutes);

// Error Handling Middleware
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`  NEXVAULT SERVER RUNNING ON PORT ${PORT}`);
  console.log(`  Frontend: http://localhost:${PORT}`);
  console.log(`  API Auth: http://localhost:${PORT}/api/auth`);
  console.log(`  API Admin: http://localhost:${PORT}/api/admin`);
  console.log(`  API Warehouse: http://localhost:${PORT}/api/warehouse/allocate`);
  console.log(`  API Health: http://localhost:${PORT}/api/health`);
  console.log(`==================================================`);
});

module.exports = app;
