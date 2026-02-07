const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticateDevice } = require('../middleware/auth');
const { 
  generateDeviceToken, 
  getCurrentMonth,
  calculateTokens,
  getModelTokenCost 
} = require('../utils/helpers');

/**
 * POST /api/devices/register
 * Register a new device
 */
router.post('/register', async (req, res) => {
  try {
    const { device_name, hardware_fingerprint, metadata = {} } = req.body;
    
    if (!device_name || !hardware_fingerprint) {
      return res.status(400).json({ 
        error: 'device_name and hardware_fingerprint are required' 
      });
    }
    
    // Check if device already exists
    const { data: existingDevice } = await supabase
      .from('devices')
      .select('*')
      .eq('hardware_fingerprint', hardware_fingerprint)
      .single();
    
    if (existingDevice) {
      // Device already registered, return existing token info
      const currentMonth = getCurrentMonth();
      
      // Get or create allocation for current month
      let { data: allocation } = await supabase
        .from('token_allocations')
        .select('*')
        .eq('device_id', existingDevice.id)
        .eq('month_year', currentMonth)
        .single();
      
      if (!allocation) {
        const { data: newAllocation } = await supabase
          .from('token_allocations')
          .insert({
            device_id: existingDevice.id,
            allocated_tokens: 50,
            used_tokens: 0,
            month_year: currentMonth
          })
          .select()
          .single();
        allocation = newAllocation;
      }
      
      // Update last seen
      await supabase
        .from('devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', existingDevice.id);
      
      return res.json({
        message: 'Device already registered',
        device_id: existingDevice.id,
        device_token: existingDevice.device_token,
        device_name: existingDevice.device_name,
        is_blocked: existingDevice.is_blocked,
        allocation: {
          allocated: allocation?.allocated_tokens || 50,
          used: allocation?.used_tokens || 0,
          remaining: (allocation?.allocated_tokens || 50) - (allocation?.used_tokens || 0),
          month: currentMonth
        }
      });
    }
    
    // Check max devices limit
    const { count } = await supabase
      .from('devices')
      .select('*', { count: 'exact', head: true });
    
    const { data: settings } = await supabase
      .from('admin_settings')
      .select('setting_value')
      .eq('setting_key', 'max_devices')
      .single();
    
    const maxDevices = parseInt(settings?.setting_value) || 6;
    
    if (count >= maxDevices) {
      return res.status(403).json({ 
        error: `Maximum device limit (${maxDevices}) reached. Contact admin.` 
      });
    }
    
    // Generate device token
    // NOTE: This legacy route creates devices without a user_id.
    // The preferred flow is via POST /api/user/redeem-key (token key based).
    // We need a placeholder user_id or this route must be deprecated.
    const deviceId = require('uuid').v4();
    // Legacy route: no user context available, pass null for userId
    const deviceToken = generateDeviceToken(deviceId, null, hardware_fingerprint);
    const currentMonth = getCurrentMonth();
    
    // Create device — legacy route without user association
    // This will fail if user_id is NOT NULL in schema. 
    // Devices should be created via redeem-key or link-device routes.
    const { data: newDevice, error: deviceError } = await supabase
      .from('devices')
      .insert({
        id: deviceId,
        device_name,
        hardware_fingerprint,
        device_token: deviceToken,
        metadata
      })
      .select()
      .single();
    
    if (deviceError) {
      console.error('Device creation error:', deviceError);
      return res.status(500).json({ error: 'Failed to register device' });
    }
    
    // Create initial token allocation
    const { data: allocation, error: allocError } = await supabase
      .from('token_allocations')
      .insert({
        device_id: deviceId,
        allocated_tokens: 50,
        used_tokens: 0,
        month_year: currentMonth
      })
      .select()
      .single();
    
    if (allocError) {
      console.error('Allocation error:', allocError);
    }
    
    res.status(201).json({
      message: 'Device registered successfully',
      device_id: deviceId,
      device_token: deviceToken,
      device_name: newDevice.device_name,
      is_blocked: false,
      allocation: {
        allocated: 50,
        used: 0,
        remaining: 50,
        month: currentMonth
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * GET /api/devices/me
 * Get current device info (authenticated)
 */
router.get('/me', authenticateDevice, async (req, res) => {
  try {
    const currentMonth = getCurrentMonth();
    
    // Get allocation
    let { data: allocation } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', req.deviceId)
      .eq('month_year', currentMonth)
      .single();
    
    // Create allocation if doesn't exist
    if (!allocation) {
      const { data: newAllocation } = await supabase
        .from('token_allocations')
        .insert({
          device_id: req.deviceId,
          allocated_tokens: 50,
          used_tokens: 0,
          month_year: currentMonth
        })
        .select()
        .single();
      allocation = newAllocation;
    }
    
    res.json({
      device: {
        id: req.device.id,
        name: req.device.device_name,
        is_blocked: req.device.is_blocked,
        last_seen: req.device.last_seen_at,
        created_at: req.device.created_at
      },
      allocation: {
        allocated: allocation?.allocated_tokens || 50,
        used: allocation?.used_tokens || 0,
        remaining: (allocation?.allocated_tokens || 50) - (allocation?.used_tokens || 0),
        month: currentMonth
      }
    });
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({ error: 'Failed to get device info' });
  }
});

/**
 * GET /api/devices/:id/tokens
 * Get token balance for a device (authenticated)
 */
router.get('/:id/tokens', authenticateDevice, async (req, res) => {
  try {
    const deviceId = req.params.id;
    
    // Only allow device to check its own tokens (unless admin check added later)
    if (deviceId !== req.deviceId) {
      return res.status(403).json({ error: 'Can only check your own tokens' });
    }
    
    const currentMonth = getCurrentMonth();
    
    let { data: allocation } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', deviceId)
      .eq('month_year', currentMonth)
      .single();
    
    if (!allocation) {
      const { data: newAllocation } = await supabase
        .from('token_allocations')
        .insert({
          device_id: deviceId,
          allocated_tokens: 50,
          used_tokens: 0,
          month_year: currentMonth
        })
        .select()
        .single();
      allocation = newAllocation;
    }
    
    const remaining = (allocation?.allocated_tokens || 50) - (allocation?.used_tokens || 0);
    
    res.json({
      device_id: deviceId,
      month: currentMonth,
      allocated: allocation?.allocated_tokens || 50,
      used: allocation?.used_tokens || 0,
      remaining: remaining,
      can_use_tokens: remaining > 0 && !req.device.is_blocked,
      token_costs: {
        'claude-opus-4.5': 3,
        'other-models': 1
      }
    });
  } catch (error) {
    console.error('Get tokens error:', error);
    res.status(500).json({ error: 'Failed to get token balance' });
  }
});

/**
 * POST /api/devices/:id/usage
 * Log token usage (authenticated)
 */
router.post('/:id/usage', authenticateDevice, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const { model_type, request_type = 'completion', description = '', prompt_count = 1 } = req.body;
    
    if (deviceId !== req.deviceId) {
      return res.status(403).json({ error: 'Can only log usage for your own device' });
    }
    
    if (!model_type) {
      return res.status(400).json({ error: 'model_type is required' });
    }
    
    const currentMonth = getCurrentMonth();
    
    // Get current allocation
    let { data: allocation } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', deviceId)
      .eq('month_year', currentMonth)
      .single();
    
    if (!allocation) {
      const { data: newAllocation } = await supabase
        .from('token_allocations')
        .insert({
          device_id: deviceId,
          allocated_tokens: 50,
          used_tokens: 0,
          month_year: currentMonth
        })
        .select()
        .single();
      allocation = newAllocation;
    }
    
    // Calculate tokens to use
    const tokensToUse = calculateTokens(model_type, prompt_count);
    const remaining = allocation.allocated_tokens - allocation.used_tokens;
    
    if (tokensToUse > remaining) {
      return res.status(403).json({
        error: 'Insufficient tokens',
        requested: tokensToUse,
        remaining: remaining,
        message: 'Contact admin to request more tokens'
      });
    }
    
    // Update allocation
    const newUsed = allocation.used_tokens + tokensToUse;
    const { error: updateError } = await supabase
      .from('token_allocations')
      .update({ used_tokens: newUsed })
      .eq('id', allocation.id);
    
    if (updateError) {
      return res.status(500).json({ error: 'Failed to update token usage' });
    }
    
    // Log usage
    await supabase
      .from('usage_logs')
      .insert({
        device_id: deviceId,
        user_id: req.userId,
        tokens_used: tokensToUse,
        model_type,
        request_type,
        description
      });
    
    res.json({
      success: true,
      tokens_used: tokensToUse,
      model_type,
      token_cost_per_prompt: getModelTokenCost(model_type),
      prompt_count,
      allocation: {
        allocated: allocation.allocated_tokens,
        used: newUsed,
        remaining: allocation.allocated_tokens - newUsed
      }
    });
  } catch (error) {
    console.error('Usage log error:', error);
    res.status(500).json({ error: 'Failed to log usage' });
  }
});

/**
 * GET /api/devices/:id/history
 * Get usage history for a device (authenticated)
 */
router.get('/:id/history', authenticateDevice, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const limit = parseInt(req.query.limit) || 50;
    
    if (deviceId !== req.deviceId) {
      return res.status(403).json({ error: 'Can only view your own history' });
    }
    
    const { data: logs, error } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('device_id', deviceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch history' });
    }
    
    res.json({
      device_id: deviceId,
      total_entries: logs.length,
      history: logs
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

/**
 * POST /api/devices/check-can-use
 * Quick check if device can use tokens (authenticated)
 */
router.post('/check-can-use', authenticateDevice, async (req, res) => {
  try {
    const { model_type, prompt_count = 1 } = req.body;
    
    if (!model_type) {
      return res.status(400).json({ error: 'model_type is required' });
    }
    
    const currentMonth = getCurrentMonth();
    const tokensNeeded = calculateTokens(model_type, prompt_count);
    
    let { data: allocation } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', req.deviceId)
      .eq('month_year', currentMonth)
      .single();
    
    if (!allocation) {
      allocation = { allocated_tokens: 50, used_tokens: 0 };
    }
    
    const remaining = allocation.allocated_tokens - allocation.used_tokens;
    const canUse = remaining >= tokensNeeded && !req.device.is_blocked;
    
    res.json({
      can_use: canUse,
      tokens_needed: tokensNeeded,
      remaining: remaining,
      is_blocked: req.device.is_blocked,
      reason: !canUse ? (req.device.is_blocked ? 'Device is blocked' : 'Insufficient tokens') : null
    });
  } catch (error) {
    console.error('Check error:', error);
    res.status(500).json({ error: 'Check failed' });
  }
});

module.exports = router;
