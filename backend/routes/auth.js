const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticateUser } = require('../middleware/auth');
const {
  generateUserToken,
  hashPassword,
  comparePassword,
  generateDeviceToken,
  getCurrentMonth,
} = require('../utils/helpers');

/**
 * POST /api/auth/register
 * Register a new user account
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, display_name, invite_token } = req.body;

    if (!email || !password || !display_name) {
      return res.status(400).json({ error: 'email, password, and display_name are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check platform settings
    const { data: settings } = await supabase.from('admin_settings').select('*');
    const settingsMap = {};
    settings?.forEach(s => { settingsMap[s.setting_key] = s.setting_value; });

    const requireInvite = settingsMap.require_invite_token === 'true';
    const allowPublic = settingsMap.allow_public_registration !== 'false';

    if (!allowPublic && !invite_token) {
      return res.status(403).json({ error: 'Public registration is disabled. An invite token is required.' });
    }

    // Validate invite token if provided or required
    let invite = null;
    if (invite_token || requireInvite) {
      if (!invite_token) {
        return res.status(400).json({ error: 'An invite token is required to register.' });
      }

      const { data: inv } = await supabase
        .from('invite_tokens')
        .select('*')
        .eq('token', invite_token)
        .single();

      if (!inv) {
        return res.status(400).json({ error: 'Invalid invite token.' });
      }
      if (inv.is_used) {
        return res.status(400).json({ error: 'This invite token has already been used.' });
      }
      if (new Date(inv.expires_at) < new Date()) {
        return res.status(400).json({ error: 'This invite token has expired.' });
      }

      invite = inv;
    }

    // Check if email already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await hashPassword(password);
    const defaultBudget = invite?.monthly_budget || parseInt(settingsMap.default_user_budget) || 50;
    const defaultMaxDevices = invite?.max_devices || parseInt(settingsMap.default_max_devices) || 3;

    const { data: user, error: createErr } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        display_name: display_name.trim(),
        monthly_token_budget: defaultBudget,
        max_devices: defaultMaxDevices,
      })
      .select()
      .single();

    if (createErr) {
      console.error('User creation error:', createErr);
      return res.status(500).json({ error: 'Failed to create account' });
    }

    // Mark invite as used
    if (invite) {
      await supabase
        .from('invite_tokens')
        .update({ is_used: true, used_by: user.id, used_at: new Date().toISOString() })
        .eq('id', invite.id);
    }

    const token = generateUserToken(user.id, user.email, user.role);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        monthly_token_budget: user.monthly_token_budget,
        max_devices: user.max_devices,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /api/auth/login
 * Login with email + password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses GitHub login. Please sign in with GitHub.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact admin.' });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    const token = generateUserToken(user.id, user.email, user.role);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        monthly_token_budget: user.monthly_token_budget,
        max_devices: user.max_devices,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/github
 * Login/register via GitHub OAuth (extension sends the GitHub user info)
 */
router.post('/github', async (req, res) => {
  try {
    const { github_id, github_username, email, avatar_url, display_name } = req.body;

    if (!github_id || !github_username) {
      return res.status(400).json({ error: 'github_id and github_username are required' });
    }

    // Check if user exists by github_id
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('github_id', String(github_id))
      .single();

    if (user) {
      // Update last login & info
      await supabase
        .from('users')
        .update({
          last_login_at: new Date().toISOString(),
          github_username,
          avatar_url: avatar_url || user.avatar_url,
        })
        .eq('id', user.id);

      if (!user.is_active) {
        return res.status(403).json({ error: 'Account is deactivated. Contact admin.' });
      }

      const token = generateUserToken(user.id, user.email, user.role);
      return res.json({
        message: 'GitHub login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          role: user.role,
          monthly_token_budget: user.monthly_token_budget,
          max_devices: user.max_devices,
        },
      });
    }

    // New GitHub user — check settings
    const { data: settings } = await supabase.from('admin_settings').select('*');
    const settingsMap = {};
    settings?.forEach(s => { settingsMap[s.setting_key] = s.setting_value; });

    const allowPublic = settingsMap.allow_public_registration !== 'false';
    if (!allowPublic) {
      return res.status(403).json({ error: 'Public registration is disabled.' });
    }

    const defaultBudget = parseInt(settingsMap.default_user_budget) || 50;
    const defaultMaxDevices = parseInt(settingsMap.default_max_devices) || 3;

    const userEmail = (email || `${github_username}@github.local`).toLowerCase().trim();

    const { data: newUser, error: createErr } = await supabase
      .from('users')
      .insert({
        email: userEmail,
        display_name: display_name || github_username,
        github_id: String(github_id),
        github_username,
        avatar_url,
        monthly_token_budget: defaultBudget,
        max_devices: defaultMaxDevices,
      })
      .select()
      .single();

    if (createErr) {
      console.error('GitHub user creation error:', createErr);
      return res.status(500).json({ error: 'Failed to create account' });
    }

    const token = generateUserToken(newUser.id, newUser.email, newUser.role);

    res.status(201).json({
      message: 'GitHub account created',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        display_name: newUser.display_name,
        role: newUser.role,
        monthly_token_budget: newUser.monthly_token_budget,
        max_devices: newUser.max_devices,
      },
    });
  } catch (error) {
    console.error('GitHub auth error:', error);
    res.status(500).json({ error: 'GitHub authentication failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile (requires user token)
 */
router.get('/me', authenticateUser, async (req, res) => {
  try {
    // Get user's devices
    const { data: devices } = await supabase
      .from('devices')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: true });

    const currentMonth = getCurrentMonth();
    const { data: allocations } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('month_year', currentMonth);

    const allocMap = {};
    allocations?.forEach(a => { allocMap[a.device_id] = a; });

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
      },
      devices: deviceList,
      summary: {
        month: currentMonth,
        total_allocated: totalAllocated,
        total_used: totalUsed,
        total_remaining: totalAllocated - totalUsed,
        device_count: deviceList.length,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

/**
 * POST /api/auth/link-device
 * Register/link a device to the logged-in user
 */
router.post('/link-device', authenticateUser, async (req, res) => {
  try {
    const { device_name, hardware_fingerprint, metadata = {} } = req.body;

    if (!device_name || !hardware_fingerprint) {
      return res.status(400).json({ error: 'device_name and hardware_fingerprint are required' });
    }

    // Check if this fingerprint already linked to this user
    const { data: existing } = await supabase
      .from('devices')
      .select('*')
      .eq('user_id', req.userId)
      .eq('hardware_fingerprint', hardware_fingerprint)
      .single();

    const currentMonth = getCurrentMonth();

    if (existing) {
      // Already linked — return existing info
      let { data: allocation } = await supabase
        .from('token_allocations')
        .select('*')
        .eq('device_id', existing.id)
        .eq('month_year', currentMonth)
        .single();

      if (!allocation) {
        const { data: newAlloc } = await supabase
          .from('token_allocations')
          .insert({
            device_id: existing.id,
            allocated_tokens: req.user.monthly_token_budget,
            used_tokens: 0,
            month_year: currentMonth,
          })
          .select()
          .single();
        allocation = newAlloc;
      }

      await supabase
        .from('devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', existing.id);

      return res.json({
        message: 'Device already linked',
        device_id: existing.id,
        device_token: existing.device_token,
        device_name: existing.device_name,
        is_blocked: existing.is_blocked,
        allocation: {
          allocated: allocation?.allocated_tokens || req.user.monthly_token_budget,
          used: allocation?.used_tokens || 0,
          remaining: (allocation?.allocated_tokens || req.user.monthly_token_budget) - (allocation?.used_tokens || 0),
          month: currentMonth,
        },
      });
    }

    // Check max devices for this user
    const { count } = await supabase
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    if (count >= req.user.max_devices) {
      return res.status(403).json({
        error: `Maximum device limit (${req.user.max_devices}) reached. Remove a device or contact admin.`,
      });
    }

    // Create device
    const deviceId = require('uuid').v4();
    const deviceToken = generateDeviceToken(deviceId, req.userId, hardware_fingerprint);

    const { data: newDevice, error: devErr } = await supabase
      .from('devices')
      .insert({
        id: deviceId,
        user_id: req.userId,
        device_name,
        hardware_fingerprint,
        device_token: deviceToken,
        metadata,
      })
      .select()
      .single();

    if (devErr) {
      console.error('Device creation error:', devErr);
      return res.status(500).json({ error: 'Failed to link device' });
    }

    // Create allocation
    const { data: allocation } = await supabase
      .from('token_allocations')
      .insert({
        device_id: deviceId,
        allocated_tokens: req.user.monthly_token_budget,
        used_tokens: 0,
        month_year: currentMonth,
      })
      .select()
      .single();

    res.status(201).json({
      message: 'Device linked successfully',
      device_id: deviceId,
      device_token: deviceToken,
      device_name: newDevice.device_name,
      is_blocked: false,
      allocation: {
        allocated: req.user.monthly_token_budget,
        used: 0,
        remaining: req.user.monthly_token_budget,
        month: currentMonth,
      },
    });
  } catch (error) {
    console.error('Link device error:', error);
    res.status(500).json({ error: 'Failed to link device' });
  }
});

module.exports = router;
