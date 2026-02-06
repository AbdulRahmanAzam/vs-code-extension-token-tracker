const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticateUser } = require('../middleware/auth');
const crypto = require('crypto');
const { getCurrentMonth, generateDeviceToken } = require('../utils/helpers');

/**
 * GET /api/user/dashboard
 * Get the logged-in user's own dashboard data
 */
router.get('/dashboard', authenticateUser, async (req, res) => {
  try {
    const currentMonth = getCurrentMonth();

    // Get user's devices
    const { data: devices } = await supabase
      .from('devices')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: true });

    // Get allocations for this month
    const deviceIds = (devices || []).map(d => d.id);
    let allocations = [];
    if (deviceIds.length > 0) {
      const { data: allocs } = await supabase
        .from('token_allocations')
        .select('*')
        .in('device_id', deviceIds)
        .eq('month_year', currentMonth);
      allocations = allocs || [];
    }

    const allocMap = {};
    allocations.forEach(a => { allocMap[a.device_id] = a; });

    // Get user's token keys
    const { data: tokenKeys } = await supabase
      .from('device_token_keys')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    const deviceList = (devices || []).map(d => {
      const alloc = allocMap[d.id] || { allocated_tokens: req.user.monthly_token_budget, used_tokens: 0 };
      return {
        id: d.id,
        name: d.device_name,
        is_blocked: d.is_blocked,
        last_seen: d.last_seen_at,
        created_at: d.created_at,
        allocation: {
          allocated: alloc.allocated_tokens,
          used: alloc.used_tokens,
          remaining: alloc.allocated_tokens - alloc.used_tokens,
        },
      };
    });

    const totalUsed = deviceList.reduce((s, d) => s + d.allocation.used, 0);
    const totalAllocated = deviceList.reduce((s, d) => s + d.allocation.allocated, 0);

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        display_name: req.user.display_name,
        role: req.user.role,
        monthly_token_budget: req.user.monthly_token_budget,
        max_devices: req.user.max_devices,
        github_username: req.user.github_username,
        avatar_url: req.user.avatar_url,
      },
      devices: deviceList,
      token_keys: (tokenKeys || []).map(tk => ({
        id: tk.id,
        key: tk.token_key,
        label: tk.label,
        allocated_tokens: tk.allocated_tokens,
        is_used: tk.is_used,
        used_by_device: tk.used_by_device,
        created_at: tk.created_at,
        expires_at: tk.expires_at,
      })),
      summary: {
        month: currentMonth,
        total_budget: req.user.monthly_token_budget,
        total_allocated: totalAllocated,
        total_used: totalUsed,
        total_remaining: req.user.monthly_token_budget - totalUsed,
        device_count: deviceList.length,
        max_devices: req.user.max_devices,
      },
    });
  } catch (error) {
    console.error('User dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

/**
 * POST /api/user/generate-key
 * Generate a token key that can be given to a device
 */
router.post('/generate-key', authenticateUser, async (req, res) => {
  try {
    const { label = 'Device Key', allocated_tokens, expires_days = 30 } = req.body;

    // Check device limit
    const { count: deviceCount } = await supabase
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    const { count: unusedKeyCount } = await supabase
      .from('device_token_keys')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId)
      .eq('is_used', false);

    const totalSlots = (deviceCount || 0) + (unusedKeyCount || 0);
    if (totalSlots >= req.user.max_devices) {
      return res.status(403).json({
        error: `You've reached your maximum of ${req.user.max_devices} devices/keys. Remove a device or unused key first.`,
      });
    }

    // Calculate token allocation for this key
    const budgetPerDevice = allocated_tokens || Math.floor(req.user.monthly_token_budget / Math.max(totalSlots + 1, 1));
    const finalTokens = Math.min(budgetPerDevice, req.user.monthly_token_budget);

    // Generate the key: TK-<userId_short>-<random>
    const keyPart = crypto.randomBytes(12).toString('hex');
    const tokenKey = `TK-${keyPart}`;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (expires_days || 30));

    const { data: newKey, error: err } = await supabase
      .from('device_token_keys')
      .insert({
        user_id: req.userId,
        token_key: tokenKey,
        label: label.trim() || 'Device Key',
        allocated_tokens: finalTokens,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (err) {
      console.error('Key creation error:', err);
      return res.status(500).json({ error: 'Failed to generate key' });
    }

    res.status(201).json({
      success: true,
      key: {
        id: newKey.id,
        token_key: tokenKey,
        label: newKey.label,
        allocated_tokens: newKey.allocated_tokens,
        expires_at: newKey.expires_at,
      },
      message: `Token key generated. Share this key with the device: ${tokenKey}`,
    });
  } catch (error) {
    console.error('Generate key error:', error);
    res.status(500).json({ error: 'Failed to generate key' });
  }
});

/**
 * DELETE /api/user/keys/:id
 * Delete an unused token key
 */
router.delete('/keys/:id', authenticateUser, async (req, res) => {
  try {
    const { data: key } = await supabase
      .from('device_token_keys')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (!key) {
      return res.status(404).json({ error: 'Key not found' });
    }

    await supabase.from('device_token_keys').delete().eq('id', key.id);
    res.json({ success: true, message: 'Key deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete key' });
  }
});

/**
 * POST /api/user/redeem-key
 * A device uses this to redeem a token key and register itself
 */
router.post('/redeem-key', async (req, res) => {
  try {
    const { token_key, device_name, hardware_fingerprint } = req.body;

    if (!token_key || !device_name || !hardware_fingerprint) {
      return res.status(400).json({ error: 'token_key, device_name, and hardware_fingerprint are required' });
    }

    // Find the key
    const { data: key } = await supabase
      .from('device_token_keys')
      .select('*')
      .eq('token_key', token_key.trim())
      .single();

    if (!key) {
      return res.status(404).json({ error: 'Invalid token key. Check your key and try again.' });
    }
    if (key.is_used) {
      return res.status(400).json({ error: 'This token key has already been redeemed by another device.' });
    }
    if (new Date(key.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This token key has expired. Request a new one from the owner.' });
    }

    // Get the key owner (user) — include github_access_token to check proxy availability
    const { data: owner } = await supabase
      .from('users')
      .select('*')
      .eq('id', key.user_id)
      .single();

    if (!owner || !owner.is_active) {
      return res.status(403).json({ error: 'The account that generated this key is not active.' });
    }

    // Check if device already exists for this user
    const { data: existingDevice } = await supabase
      .from('devices')
      .select('*')
      .eq('user_id', key.user_id)
      .eq('hardware_fingerprint', hardware_fingerprint)
      .single();

    // Also check if fingerprint exists under a **different** user (cross-user collision)
    const { data: foreignDevice } = await supabase
      .from('devices')
      .select('id, user_id, device_name')
      .eq('hardware_fingerprint', hardware_fingerprint)
      .neq('user_id', key.user_id)
      .single();

    if (foreignDevice) {
      // Remove the stale device record under the other user so this key owner can register it
      await supabase.from('devices').delete().eq('id', foreignDevice.id);
      console.log(`Migrated device fingerprint from user ${foreignDevice.user_id} → ${key.user_id}`);
    }

    const currentMonth = getCurrentMonth();

    if (existingDevice) {
      // Mark key as used and link to existing device
      await supabase
        .from('device_token_keys')
        .update({ is_used: true, used_by_device: existingDevice.id, used_at: new Date().toISOString() })
        .eq('id', key.id);

      await supabase
        .from('devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', existingDevice.id);

      let { data: allocation } = await supabase
        .from('token_allocations')
        .select('*')
        .eq('device_id', existingDevice.id)
        .eq('month_year', currentMonth)
        .single();

      if (!allocation) {
        const { data: newAlloc } = await supabase
          .from('token_allocations')
          .insert({
            device_id: existingDevice.id,
            allocated_tokens: key.allocated_tokens,
            used_tokens: 0,
            month_year: currentMonth,
          })
          .select()
          .single();
        allocation = newAlloc;
      }

      return res.json({
        message: 'Device already registered — key redeemed',
        device_id: existingDevice.id,
        device_token: existingDevice.device_token,
        device_name: existingDevice.device_name,
        owner: owner.display_name,
        has_copilot_proxy: !!owner.github_access_token,
        allocation: {
          allocated: allocation?.allocated_tokens || key.allocated_tokens,
          used: allocation?.used_tokens || 0,
          remaining: (allocation?.allocated_tokens || key.allocated_tokens) - (allocation?.used_tokens || 0),
        },
      });
    }

    // Create new device
    const deviceId = require('uuid').v4();
    const deviceToken = generateDeviceToken(deviceId, key.user_id, hardware_fingerprint);

    const { data: newDevice, error: devErr } = await supabase
      .from('devices')
      .insert({
        id: deviceId,
        user_id: key.user_id,
        device_name,
        hardware_fingerprint,
        device_token: deviceToken,
      })
      .select()
      .single();

    if (devErr) {
      console.error('Device creation error:', devErr);
      const msg = devErr.code === '23505'
        ? 'This device is already registered under another account. Contact your admin.'
        : 'Failed to register device';
      return res.status(500).json({ error: msg });
    }

    // Create allocation
    const { data: allocation } = await supabase
      .from('token_allocations')
      .insert({
        device_id: deviceId,
        allocated_tokens: key.allocated_tokens,
        used_tokens: 0,
        month_year: currentMonth,
      })
      .select()
      .single();

    // Mark key as used
    await supabase
      .from('device_token_keys')
      .update({ is_used: true, used_by_device: deviceId, used_at: new Date().toISOString() })
      .eq('id', key.id);

    res.status(201).json({
      message: 'Device registered successfully via token key!',
      device_id: deviceId,
      device_token: deviceToken,
      device_name: newDevice.device_name,
      owner: owner.display_name,
      has_copilot_proxy: !!owner.github_access_token,
      allocation: {
        allocated: key.allocated_tokens,
        used: 0,
        remaining: key.allocated_tokens,
      },
    });
  } catch (error) {
    console.error('Redeem key error:', error);
    res.status(500).json({ error: 'Failed to redeem key' });
  }
});

/**
 * PUT /api/user/devices/:id/allocation
 * User sets token allocation for their own device
 */
router.put('/devices/:id/allocation', authenticateUser, async (req, res) => {
  try {
    const { allocated_tokens } = req.body;
    if (allocated_tokens === undefined || allocated_tokens < 0) {
      return res.status(400).json({ error: 'allocated_tokens is required and must be >= 0' });
    }

    // Verify device belongs to user
    const { data: device } = await supabase
      .from('devices')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const currentMonth = getCurrentMonth();
    let { data: alloc } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', device.id)
      .eq('month_year', currentMonth)
      .single();

    if (!alloc) {
      await supabase
        .from('token_allocations')
        .insert({ device_id: device.id, allocated_tokens, used_tokens: 0, month_year: currentMonth });
    } else {
      await supabase
        .from('token_allocations')
        .update({ allocated_tokens })
        .eq('id', alloc.id);
    }

    res.json({ success: true, device_id: device.id, allocated_tokens });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update allocation' });
  }
});

/**
 * PUT /api/user/devices/:id/block
 * User blocks/unblocks their own device
 */
router.put('/devices/:id/block', authenticateUser, async (req, res) => {
  try {
    const { blocked } = req.body;

    const { data: device } = await supabase
      .from('devices')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await supabase
      .from('devices')
      .update({ is_blocked: !!blocked })
      .eq('id', device.id);

    res.json({ success: true, device_id: device.id, is_blocked: !!blocked });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update device' });
  }
});

/**
 * PUT /api/user/devices/:id/rename
 * User renames their own device
 */
router.put('/devices/:id/rename', authenticateUser, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const { data: device } = await supabase
      .from('devices')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await supabase
      .from('devices')
      .update({ device_name: name.trim() })
      .eq('id', device.id);

    res.json({ success: true, device_id: device.id, name: name.trim() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rename device' });
  }
});

/**
 * DELETE /api/user/devices/:id
 * User deletes their own device
 */
router.delete('/devices/:id', authenticateUser, async (req, res) => {
  try {
    const { data: device } = await supabase
      .from('devices')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await supabase.from('devices').delete().eq('id', device.id);
    res.json({ success: true, message: 'Device deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

/**
 * GET /api/user/devices/:id/history
 * Get usage history for user's own device
 */
router.get('/devices/:id/history', authenticateUser, async (req, res) => {
  try {
    const { data: device } = await supabase
      .from('devices')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const { data: logs } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('device_id', device.id)
      .order('created_at', { ascending: false })
      .limit(50);

    res.json({ logs: logs || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
