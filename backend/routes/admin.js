const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticateAdmin } = require('../middleware/auth');
const { generateAdminToken, generateInviteCode, generateUserToken, hashPassword, getCurrentMonth } = require('../utils/helpers');

/**
 * POST /api/admin/login
 * Admin login
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (username !== adminUsername || password !== adminPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Find or create admin user record
    let { data: adminUser } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .single();

    let adminUserId = adminUser?.id;

    if (!adminUserId) {
      const hash = await hashPassword(adminPassword);
      const { data: newAdmin } = await supabase
        .from('users')
        .insert({
          email: `${adminUsername}@admin.local`,
          password_hash: hash,
          display_name: 'Admin',
          role: 'admin',
          max_devices: 10,
          monthly_token_budget: 999,
        })
        .select()
        .single();
      adminUserId = newAdmin?.id;
    }

    const token = generateAdminToken(adminUserId);

    res.json({
      message: 'Admin login successful',
      token,
      expires_in: '24h',
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── All routes below require admin auth ──────────────────

/**
 * GET /api/admin/dashboard
 * Full dashboard data with users + devices
 */
router.get('/dashboard', authenticateAdmin, async (req, res) => {
  try {
    const currentMonth = getCurrentMonth();

    // Get all users
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: true });

    // Get all devices
    const { data: devices } = await supabase
      .from('devices')
      .select('*')
      .order('created_at', { ascending: true });

    // Get allocations
    const { data: allocations } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('month_year', currentMonth);

    const allocMap = {};
    allocations?.forEach(a => { allocMap[a.device_id] = a; });

    // Get settings
    const { data: settings } = await supabase.from('admin_settings').select('*');
    const settingsMap = {};
    settings?.forEach(s => { settingsMap[s.setting_key] = s.setting_value; });

    // Build user list with devices
    const userList = (users || []).map(u => {
      const userDevices = (devices || []).filter(d => d.user_id === u.id);
      const deviceList = userDevices.map(d => {
        const alloc = allocMap[d.id] || { allocated_tokens: u.monthly_token_budget, used_tokens: 0 };
        return {
          id: d.id,
          name: d.device_name,
          fingerprint: d.hardware_fingerprint,
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

      return {
        id: u.id,
        email: u.email,
        display_name: u.display_name,
        role: u.role,
        is_active: u.is_active,
        github_username: u.github_username,
        avatar_url: u.avatar_url,
        monthly_token_budget: u.monthly_token_budget,
        max_devices: u.max_devices,
        created_at: u.created_at,
        last_login: u.last_login_at,
        device_count: deviceList.length,
        total_used: totalUsed,
        total_allocated: totalAllocated,
        devices: deviceList,
      };
    });

    // Flatten all devices for backward compat
    const allDevices = userList.flatMap(u => u.devices.map(d => ({
      ...d,
      user_email: u.email,
      user_name: u.display_name,
    })));

    const totalBudget = parseInt(settingsMap.total_monthly_budget) || 1000;
    const totalUsed = allDevices.reduce((s, d) => s + d.allocation.used, 0);
    const totalAllocated = allDevices.reduce((s, d) => s + d.allocation.allocated, 0);

    res.json({
      month: currentMonth,
      budget: {
        total: totalBudget,
        allocated: totalAllocated,
        used: totalUsed,
        remaining: totalBudget - totalUsed,
        unallocated: totalBudget - totalAllocated,
      },
      users: {
        count: userList.length,
        list: userList,
      },
      devices: {
        count: allDevices.length,
        max: parseInt(settingsMap.max_devices) || 100,
        list: allDevices,
      },
      settings: settingsMap,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

/**
 * GET /api/admin/devices
 */
router.get('/devices', authenticateAdmin, async (req, res) => {
  try {
    const currentMonth = getCurrentMonth();

    const { data: devices } = await supabase
      .from('devices')
      .select('*, users(email, display_name)')
      .order('created_at', { ascending: true });

    const { data: allocations } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('month_year', currentMonth);

    const allocMap = {};
    allocations?.forEach(a => { allocMap[a.device_id] = a; });

    const deviceList = (devices || []).map(d => {
      const alloc = allocMap[d.id] || { allocated_tokens: 50, used_tokens: 0 };
      return {
        id: d.id,
        name: d.device_name,
        user_email: d.users?.email,
        user_name: d.users?.display_name,
        is_blocked: d.is_blocked,
        last_seen: d.last_seen_at,
        allocated: alloc.allocated_tokens,
        used: alloc.used_tokens,
        remaining: alloc.allocated_tokens - alloc.used_tokens,
      };
    });

    res.json({ devices: deviceList });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

/**
 * GET /api/admin/users
 */
router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: true });

    res.json({ users: users || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * PUT /api/admin/users/:id
 * Update user settings (budget, max_devices, role, active)
 */
router.put('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { monthly_token_budget, max_devices, role, is_active } = req.body;
    const updates = {};
    if (monthly_token_budget !== undefined) updates.monthly_token_budget = monthly_token_budget;
    if (max_devices !== undefined) updates.max_devices = max_devices;
    if (role !== undefined) updates.role = role;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /api/admin/users/:id
 */
router.delete('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    await supabase.from('users').delete().eq('id', req.params.id);
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ── Invite Tokens ─────────────────────────────────────────

/**
 * POST /api/admin/invites
 * Generate a new invite token
 */
router.post('/invites', authenticateAdmin, async (req, res) => {
  try {
    const { monthly_budget = 50, max_devices = 3, note = '', expires_days = 30 } = req.body;

    const code = generateInviteCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_days);

    const { data, error } = await supabase
      .from('invite_tokens')
      .insert({
        token: code,
        created_by: req.userId,
        monthly_budget,
        max_devices,
        note,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to create invite token' });
    }

    res.status(201).json({
      success: true,
      invite: {
        token: data.token,
        monthly_budget: data.monthly_budget,
        max_devices: data.max_devices,
        note: data.note,
        expires_at: data.expires_at,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate invite' });
  }
});

/**
 * GET /api/admin/invites
 * List all invite tokens
 */
router.get('/invites', authenticateAdmin, async (req, res) => {
  try {
    const { data } = await supabase
      .from('invite_tokens')
      .select('*, users:used_by(email, display_name)')
      .order('created_at', { ascending: false });

    res.json({ invites: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

/**
 * DELETE /api/admin/invites/:id
 */
router.delete('/invites/:id', authenticateAdmin, async (req, res) => {
  try {
    await supabase.from('invite_tokens').delete().eq('id', req.params.id);
    res.json({ success: true, message: 'Invite deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete invite' });
  }
});

// ── Existing admin endpoints (kept for backward compat) ───

router.post('/allocate', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, tokens, from_device_id = null, reason = '' } = req.body;
    if (!device_id || tokens === undefined) {
      return res.status(400).json({ error: 'device_id and tokens are required' });
    }

    const currentMonth = getCurrentMonth();

    if (from_device_id) {
      const { data: srcAlloc } = await supabase
        .from('token_allocations')
        .select('*')
        .eq('device_id', from_device_id)
        .eq('month_year', currentMonth)
        .single();

      if (!srcAlloc) return res.status(404).json({ error: 'Source allocation not found' });
      const srcRem = srcAlloc.allocated_tokens - srcAlloc.used_tokens;
      if (tokens > srcRem) return res.status(400).json({ error: 'Insufficient tokens in source', available: srcRem });

      await supabase
        .from('token_allocations')
        .update({ allocated_tokens: srcAlloc.allocated_tokens - tokens })
        .eq('id', srcAlloc.id);
    }

    let { data: tgtAlloc } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', device_id)
      .eq('month_year', currentMonth)
      .single();

    if (!tgtAlloc) {
      const { data: na } = await supabase
        .from('token_allocations')
        .insert({ device_id, allocated_tokens: tokens, used_tokens: 0, month_year: currentMonth })
        .select().single();
      tgtAlloc = na;
    } else {
      await supabase
        .from('token_allocations')
        .update({ allocated_tokens: tgtAlloc.allocated_tokens + tokens })
        .eq('id', tgtAlloc.id);
      tgtAlloc.allocated_tokens += tokens;
    }

    await supabase.from('token_transfers').insert({
      from_device_id, to_device_id: device_id, tokens_transferred: tokens, month_year: currentMonth, reason,
    });

    res.json({ success: true, device_id, new_allocation: tgtAlloc.allocated_tokens, tokens_added: tokens });
  } catch (error) {
    res.status(500).json({ error: 'Failed to allocate tokens' });
  }
});

router.post('/set-allocation', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, allocated_tokens } = req.body;
    if (!device_id || allocated_tokens === undefined) {
      return res.status(400).json({ error: 'device_id and allocated_tokens are required' });
    }
    const currentMonth = getCurrentMonth();

    let { data: alloc } = await supabase
      .from('token_allocations').select('*')
      .eq('device_id', device_id).eq('month_year', currentMonth).single();

    if (!alloc) {
      const { data: na } = await supabase
        .from('token_allocations')
        .insert({ device_id, allocated_tokens, used_tokens: 0, month_year: currentMonth })
        .select().single();
      alloc = na;
    } else {
      await supabase.from('token_allocations').update({ allocated_tokens }).eq('id', alloc.id);
    }

    res.json({ success: true, device_id, allocated_tokens, used_tokens: alloc?.used_tokens || 0, remaining: allocated_tokens - (alloc?.used_tokens || 0) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to set allocation' });
  }
});

router.post('/block-device', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, blocked } = req.body;
    if (!device_id || blocked === undefined) {
      return res.status(400).json({ error: 'device_id and blocked are required' });
    }
    const { data, error } = await supabase.from('devices').update({ is_blocked: blocked }).eq('id', device_id).select().single();
    if (error || !data) return res.status(404).json({ error: 'Device not found' });
    res.json({ success: true, device_id, is_blocked: data.is_blocked });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update device' });
  }
});

router.delete('/devices/:id', authenticateAdmin, async (req, res) => {
  try {
    await supabase.from('devices').delete().eq('id', req.params.id);
    res.json({ success: true, message: 'Device deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

router.post('/rename-device', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, new_name } = req.body;
    if (!device_id || !new_name) return res.status(400).json({ error: 'device_id and new_name required' });
    const { data, error } = await supabase.from('devices').update({ device_name: new_name }).eq('id', device_id).select().single();
    if (error || !data) return res.status(404).json({ error: 'Device not found' });
    res.json({ success: true, device_id, new_name: data.device_name });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rename device' });
  }
});

router.post('/reset-monthly', authenticateAdmin, async (req, res) => {
  try {
    const { month = getCurrentMonth(), default_tokens = 50 } = req.body;
    const { data: devices } = await supabase.from('devices').select('id');
    if (!devices?.length) return res.json({ success: true, message: 'No devices to reset', devices_reset: 0 });

    await supabase.from('token_allocations').delete().eq('month_year', month);
    const newAllocations = devices.map(d => ({
      device_id: d.id, allocated_tokens: default_tokens, used_tokens: 0, month_year: month,
    }));
    await supabase.from('token_allocations').insert(newAllocations);

    res.json({ success: true, month, devices_reset: devices.length, tokens_per_device: default_tokens });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset allocations' });
  }
});

router.put('/settings', authenticateAdmin, async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object is required' });
    }
    const updates = Object.entries(settings).map(([key, value]) =>
      supabase.from('admin_settings').upsert({ setting_key: key, setting_value: String(value) })
    );
    await Promise.all(updates);
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

router.get('/usage-logs', authenticateAdmin, async (req, res) => {
  try {
    const { device_id, model_type, limit = 100, offset = 0 } = req.query;
    let query = supabase.from('usage_logs').select('*, devices(device_name)').order('created_at', { ascending: false })
      .range(offset, parseInt(offset) + parseInt(limit) - 1);
    if (device_id) query = query.eq('device_id', device_id);
    if (model_type) query = query.eq('model_type', model_type);
    const { data: logs } = await query;
    res.json({ total: logs?.length || 0, logs: logs || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

router.get('/transfers', authenticateAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('token_transfers').select('*').order('created_at', { ascending: false }).limit(100);
    res.json({ transfers: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

module.exports = router;
