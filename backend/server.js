require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const adminRoutes = require('./routes/admin');
const usageRoutes = require('./routes/usage');
const healthRoutes = require('./routes/health');
const userRoutes = require('./routes/user');
const proxyRoutes = require('./routes/proxy');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust reverse proxy (Nginx) — required for req.protocol to return 'https'
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, extensions)
    if (!origin) return callback(null, true);
    // Allow any localhost, any vercel preview, or custom domains
    const allowed = [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
      /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
      /\.vercel\.app$/,
      /abdulrahmanazam\.me$/,
    ];
    if (allowed.some(pattern => pattern.test(origin))) {
      return callback(null, true);
    }
    // Also allow if ALLOWED_ORIGINS env var is set
    const extra = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
    if (extra.includes(origin)) {
      return callback(null, true);
    }
    callback(null, true); // Allow all for now — tighten in production if needed
  },
  credentials: true,
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please try again later' }
});
app.use(limiter);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/user', userRoutes);
app.use('/api/proxy', proxyRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Centralized Token Tracker API',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      devices: '/api/devices',
      admin: '/api/admin',
      usage: '/api/usage'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Token Tracker API running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`\n📡 Access: http://localhost:${PORT}`);
  console.log(`\n⚙️  Extension setting: "tokenTracker.serverUrl": "http://YOUR_SERVER_IP:${PORT}"\n`);
});

module.exports = app;
