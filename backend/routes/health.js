const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  try {
    // Check Supabase connection
    const { data, error } = await supabase
      .from('admin_settings')
      .select('setting_key')
      .limit(1);
    
    if (error) {
      return res.status(503).json({
        status: 'unhealthy',
        database: 'disconnected',
        error: error.message
      });
    }
    
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * GET /api/health/detailed
 * Detailed health check with stats
 */
router.get('/detailed', async (req, res) => {
  try {
    const { data: devices } = await supabase
      .from('devices')
      .select('id', { count: 'exact' });
    
    const { data: settings } = await supabase
      .from('admin_settings')
      .select('*');
    
    const settingsMap = {};
    settings?.forEach(s => {
      settingsMap[s.setting_key] = s.setting_value;
    });
    
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      stats: {
        registered_devices: devices?.length || 0,
        max_devices: parseInt(settingsMap.max_devices) || 6,
        total_monthly_budget: parseInt(settingsMap.total_monthly_budget) || 300,
        default_allocation: parseInt(settingsMap.default_device_allocation) || 50
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;
