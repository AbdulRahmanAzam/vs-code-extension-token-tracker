require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const deviceRoutes = require('./routes/devices');
const adminRoutes = require('./routes/admin');
const usageRoutes = require('./routes/usage');
const healthRoutes = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
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
app.use('/api/devices', deviceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/usage', usageRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Centralized Token Tracker API',
    version: '1.0.0',
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
  console.log(`\n📡 Network Access:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://192.168.100.6:${PORT}`);
  console.log(`\n⚙️  Configure other devices with: "tokenTracker.serverUrl": "http://192.168.100.6:${PORT}"\n`);
});

module.exports = app;
