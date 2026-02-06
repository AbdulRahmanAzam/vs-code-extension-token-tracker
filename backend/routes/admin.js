const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticateAdmin } = require('../middleware/auth');
const { generateAdminToken, getCurrentMonth } = require('../utils/helpers');

/**
 * POST /api/admin/login
 * Admin login to get token
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (username !== adminUsername || password !== adminPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = generateAdminToken();
    
    res.json({
      message: 'Admin login successful',
      token,
      expires_in: '24h'
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /api/admin/dashboard
 * Get full dashboard data
 */
router.get('/dashboard', authenticateAdmin, async (req, res) => {
  try {
    const currentMonth = getCurrentMonth();
    
    // Get all devices with their allocations
    const { data: devices, error: devicesError } = await supabase
      .from('devices')
      .select('*')
      .order('created_at', { ascending: true });
    
    if (devicesError) {
      return res.status(500).json({ error: 'Failed to fetch devices' });
    }
    
    // Get allocations for current month
    const { data: allocations } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('month_year', currentMonth);
    
    const allocationMap = {};
    allocations?.forEach(a => {
      allocationMap[a.device_id] = a;
    });
    
    // Get settings
    const { data: settings } = await supabase
      .from('admin_settings')
      .select('*');
    
    const settingsMap = {};
    settings?.forEach(s => {
      settingsMap[s.setting_key] = s.setting_value;
    });
    
    // Build device list with allocations
    const deviceList = devices.map(d => {
      const alloc = allocationMap[d.id] || { allocated_tokens: 50, used_tokens: 0 };
      return {
        id: d.id,
        name: d.device_name,
        fingerprint: d.hardware_fingerprint,
        is_blocked: d.is_blocked,
        is_admin: d.is_admin,
        last_seen: d.last_seen_at,
        created_at: d.created_at,
        allocation: {
          allocated: alloc.allocated_tokens,
          used: alloc.used_tokens,
          remaining: alloc.allocated_tokens - alloc.used_tokens
        }
      };
    });
    
    // Calculate totals
    const totalAllocated = deviceList.reduce((sum, d) => sum + d.allocation.allocated, 0);
    const totalUsed = deviceList.reduce((sum, d) => sum + d.allocation.used, 0);
    
    res.json({
      month: currentMonth,
      budget: {
        total: parseInt(settingsMap.total_monthly_budget) || 300,
        allocated: totalAllocated,
        used: totalUsed,
        remaining: (parseInt(settingsMap.total_monthly_budget) || 300) - totalUsed,
        unallocated: (parseInt(settingsMap.total_monthly_budget) || 300) - totalAllocated
      },
      devices: {
        count: deviceList.length,
        max: parseInt(settingsMap.max_devices) || 6,
        list: deviceList
      },
      settings: settingsMap
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

/**
 * GET /api/admin/devices
 * Get all devices
 */
router.get('/devices', authenticateAdmin, async (req, res) => {
  try {
    const currentMonth = getCurrentMonth();
    
    const { data: devices } = await supabase
      .from('devices')
      .select('*')
      .order('created_at', { ascending: true });
    
    const { data: allocations } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('month_year', currentMonth);
    
    const allocationMap = {};
    allocations?.forEach(a => {
      allocationMap[a.device_id] = a;
    });
    
    const deviceList = devices.map(d => {
      const alloc = allocationMap[d.id] || { allocated_tokens: 50, used_tokens: 0 };
      return {
        id: d.id,
        name: d.device_name,
        is_blocked: d.is_blocked,
        last_seen: d.last_seen_at,
        allocated: alloc.allocated_tokens,
        used: alloc.used_tokens,
        remaining: alloc.allocated_tokens - alloc.used_tokens
      };
    });
    
    res.json({ devices: deviceList });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

/**
 * POST /api/admin/allocate
 * Allocate/transfer tokens to a device
 */
router.post('/allocate', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, tokens, from_device_id = null, reason = '' } = req.body;
    
    if (!device_id || tokens === undefined) {
      return res.status(400).json({ error: 'device_id and tokens are required' });
    }
    
    const currentMonth = getCurrentMonth();
    
    // Verify target device exists
    const { data: targetDevice } = await supabase
      .from('devices')
      .select('*')
      .eq('id', device_id)
      .single();
    
    if (!targetDevice) {
      return res.status(404).json({ error: 'Target device not found' });
    }
    
    // If transferring from another device, check source
    if (from_device_id) {
      const { data: sourceAlloc } = await supabase
        .from('token_allocations')
        .select('*')
        .eq('device_id', from_device_id)
        .eq('month_year', currentMonth)
        .single();
      
      if (!sourceAlloc) {
        return res.status(404).json({ error: 'Source device allocation not found' });
      }
      
      const sourceRemaining = sourceAlloc.allocated_tokens - sourceAlloc.used_tokens;
      if (tokens > sourceRemaining) {
        return res.status(400).json({ 
          error: 'Source device has insufficient tokens',
          available: sourceRemaining,
          requested: tokens
        });
      }
      
      // Reduce source allocation
      await supabase
        .from('token_allocations')
        .update({ allocated_tokens: sourceAlloc.allocated_tokens - tokens })
        .eq('id', sourceAlloc.id);
    }
    
    // Get or create target allocation
    let { data: targetAlloc } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', device_id)
      .eq('month_year', currentMonth)
      .single();
    
    if (!targetAlloc) {
      const { data: newAlloc } = await supabase
        .from('token_allocations')
        .insert({
          device_id,
          allocated_tokens: tokens,
          used_tokens: 0,
          month_year: currentMonth
        })
        .select()
        .single();
      targetAlloc = newAlloc;
    } else {
      await supabase
        .from('token_allocations')
        .update({ allocated_tokens: targetAlloc.allocated_tokens + tokens })
        .eq('id', targetAlloc.id);
      targetAlloc.allocated_tokens += tokens;
    }
    
    // Log transfer
    await supabase
      .from('token_transfers')
      .insert({
        from_device_id,
        to_device_id: device_id,
        tokens_transferred: tokens,
        month_year: currentMonth,
        reason
      });
    
    res.json({
      success: true,
      message: from_device_id ? 'Tokens transferred' : 'Tokens allocated',
      device_id,
      new_allocation: targetAlloc.allocated_tokens,
      tokens_added: tokens
    });
  } catch (error) {
    console.error('Allocate error:', error);
    res.status(500).json({ error: 'Failed to allocate tokens' });
  }
});

/**
 * POST /api/admin/set-allocation
 * Set exact allocation for a device
 */
router.post('/set-allocation', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, allocated_tokens } = req.body;
    
    if (!device_id || allocated_tokens === undefined) {
      return res.status(400).json({ error: 'device_id and allocated_tokens are required' });
    }
    
    const currentMonth = getCurrentMonth();
    
    // Get or create allocation
    let { data: allocation } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', device_id)
      .eq('month_year', currentMonth)
      .single();
    
    if (!allocation) {
      const { data: newAlloc } = await supabase
        .from('token_allocations')
        .insert({
          device_id,
          allocated_tokens,
          used_tokens: 0,
          month_year: currentMonth
        })
        .select()
        .single();
      allocation = newAlloc;
    } else {
      await supabase
        .from('token_allocations')
        .update({ allocated_tokens })
        .eq('id', allocation.id);
    }
    
    res.json({
      success: true,
      device_id,
      allocated_tokens,
      used_tokens: allocation?.used_tokens || 0,
      remaining: allocated_tokens - (allocation?.used_tokens || 0)
    });
  } catch (error) {
    console.error('Set allocation error:', error);
    res.status(500).json({ error: 'Failed to set allocation' });
  }
});

/**
 * POST /api/admin/block-device
 * Block or unblock a device
 */
router.post('/block-device', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, blocked } = req.body;
    
    if (!device_id || blocked === undefined) {
      return res.status(400).json({ error: 'device_id and blocked are required' });
    }
    
    const { data, error } = await supabase
      .from('devices')
      .update({ is_blocked: blocked })
      .eq('id', device_id)
      .select()
      .single();
    
    if (error || !data) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({
      success: true,
      device_id,
      is_blocked: data.is_blocked,
      message: blocked ? 'Device blocked' : 'Device unblocked'
    });
  } catch (error) {
    console.error('Block device error:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

/**
 * DELETE /api/admin/devices/:id
 * Delete a device
 */
router.delete('/devices/:id', authenticateAdmin, async (req, res) => {
  try {
    const deviceId = req.params.id;
    
    const { error } = await supabase
      .from('devices')
      .delete()
      .eq('id', deviceId);
    
    if (error) {
      return res.status(500).json({ error: 'Failed to delete device' });
    }
    
    res.json({ success: true, message: 'Device deleted' });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

/**
 * POST /api/admin/reset-monthly
 * Reset all allocations for current or specified month
 */
router.post('/reset-monthly', authenticateAdmin, async (req, res) => {
  try {
    const { month = getCurrentMonth(), default_tokens = 50 } = req.body;
    
    // Get all devices
    const { data: devices } = await supabase
      .from('devices')
      .select('id');
    
    if (!devices || devices.length === 0) {
      return res.json({ success: true, message: 'No devices to reset', devices_reset: 0 });
    }
    
    // Delete existing allocations for the month
    await supabase
      .from('token_allocations')
      .delete()
      .eq('month_year', month);
    
    // Create new allocations
    const newAllocations = devices.map(d => ({
      device_id: d.id,
      allocated_tokens: default_tokens,
      used_tokens: 0,
      month_year: month
    }));
    
    await supabase
      .from('token_allocations')
      .insert(newAllocations);
    
    // Update current month setting
    await supabase
      .from('admin_settings')
      .update({ setting_value: month })
      .eq('setting_key', 'current_month');
    
    res.json({
      success: true,
      message: 'Monthly allocations reset',
      month,
      devices_reset: devices.length,
      tokens_per_device: default_tokens
    });
  } catch (error) {
    console.error('Reset monthly error:', error);
    res.status(500).json({ error: 'Failed to reset allocations' });
  }
});

/**
 * PUT /api/admin/settings
 * Update admin settings
 */
router.put('/settings', authenticateAdmin, async (req, res) => {
  try {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object is required' });
    }
    
    const updates = [];
    for (const [key, value] of Object.entries(settings)) {
      updates.push(
        supabase
          .from('admin_settings')
          .upsert({ setting_key: key, setting_value: String(value) })
      );
    }
    
    await Promise.all(updates);
    
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * GET /api/admin/usage-logs
 * Get all usage logs with filters
 */
router.get('/usage-logs', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, model_type, limit = 100, offset = 0 } = req.query;
    
    let query = supabase
      .from('usage_logs')
      .select('*, devices(device_name)')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (device_id) {
      query = query.eq('device_id', device_id);
    }
    
    if (model_type) {
      query = query.eq('model_type', model_type);
    }
    
    const { data: logs, error } = await query;
    
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch logs' });
    }
    
    res.json({
      total: logs.length,
      offset,
      limit,
      logs
    });
  } catch (error) {
    console.error('Usage logs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

/**
 * GET /api/admin/transfers
 * Get token transfer history
 */
router.get('/transfers', authenticateAdmin, async (req, res) => {
  try {
    const { data: transfers, error } = await supabase
      .from('token_transfers')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch transfers' });
    }
    
    res.json({ transfers });
  } catch (error) {
    console.error('Transfers error:', error);
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

/**
 * POST /api/admin/rename-device
 * Rename a device
 */
router.post('/rename-device', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, new_name } = req.body;
    
    if (!device_id || !new_name) {
      return res.status(400).json({ error: 'device_id and new_name are required' });
    }
    
    const { data, error } = await supabase
      .from('devices')
      .update({ device_name: new_name })
      .eq('id', device_id)
      .select()
      .single();
    
    if (error || !data) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({
      success: true,
      device_id,
      new_name: data.device_name
    });
  } catch (error) {
    console.error('Rename device error:', error);
    res.status(500).json({ error: 'Failed to rename device' });
  }
});

module.exports = router;
