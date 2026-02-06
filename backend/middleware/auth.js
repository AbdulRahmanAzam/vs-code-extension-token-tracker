const { verifyToken } = require('../utils/helpers');
const supabase = require('../config/supabase');

/**
 * Middleware to authenticate user requests (from extension login)
 */
async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    if (!decoded || decoded.type !== 'user') {
      return res.status(401).json({ error: 'Invalid user token' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact admin.' });
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (error) {
    console.error('User auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Middleware to authenticate device requests
 */
async function authenticateDevice(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    
    if (!decoded || decoded.type !== 'device') {
      return res.status(401).json({ error: 'Invalid device token' });
    }
    
    // Verify device exists
    const { data: device, error } = await supabase
      .from('devices')
      .select('*')
      .eq('id', decoded.deviceId)
      .single();
    
    if (error || !device) {
      return res.status(401).json({ error: 'Device not found' });
    }
    
    if (device.is_blocked) {
      return res.status(403).json({ error: 'Device is blocked. Contact admin.' });
    }

    // Also verify user is active
    const { data: user } = await supabase
      .from('users')
      .select('id, is_active, role')
      .eq('id', device.user_id)
      .single();

    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'User account is deactivated.' });
    }
    
    req.device = device;
    req.deviceId = decoded.deviceId;
    req.userId = device.user_id;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Middleware to authenticate admin requests
 */
async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Accept admin tokens
    if (decoded.type === 'admin' && decoded.isAdmin) {
      req.isAdmin = true;
      req.userId = decoded.userId;
      return next();
    }

    // Also accept user tokens where user has admin role
    if (decoded.type === 'user') {
      const { data: user } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', decoded.userId)
        .single();

      if (user && user.role === 'admin') {
        req.isAdmin = true;
        req.userId = user.id;
        return next();
      }
    }

    return res.status(401).json({ error: 'Invalid admin token' });
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({ error: 'Admin authentication failed' });
  }
}

/**
 * Allow either user or device auth
 */
async function authenticateAny(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    if (decoded.type === 'admin') {
      req.isAdmin = true;
      req.userId = decoded.userId;
    } else if (decoded.type === 'user') {
      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('id', decoded.userId)
        .single();
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      req.userId = user.id;
      req.isAdmin = user.role === 'admin';
    } else if (decoded.type === 'device') {
      const { data: device } = await supabase
        .from('devices')
        .select('*')
        .eq('id', decoded.deviceId)
        .single();
      if (!device) return res.status(401).json({ error: 'Device not found' });
      req.device = device;
      req.deviceId = decoded.deviceId;
      req.userId = device.user_id;
    } else {
      return res.status(401).json({ error: 'Invalid token type' });
    }
    
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = {
  authenticateUser,
  authenticateDevice,
  authenticateAdmin,
  authenticateAny
};
