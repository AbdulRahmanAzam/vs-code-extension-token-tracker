const { verifyToken } = require('../utils/helpers');
const supabase = require('../config/supabase');

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
    
    // Verify device exists and is not blocked
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
    
    req.device = device;
    req.deviceId = decoded.deviceId;
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
    
    if (!decoded || decoded.type !== 'admin' || !decoded.isAdmin) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }
    
    req.isAdmin = true;
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({ error: 'Admin authentication failed' });
  }
}

/**
 * Optional: Allow either device or admin auth
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
    } else if (decoded.type === 'device') {
      const { data: device, error } = await supabase
        .from('devices')
        .select('*')
        .eq('id', decoded.deviceId)
        .single();
      
      if (error || !device) {
        return res.status(401).json({ error: 'Device not found' });
      }
      
      req.device = device;
      req.deviceId = decoded.deviceId;
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
  authenticateDevice,
  authenticateAdmin,
  authenticateAny
};
