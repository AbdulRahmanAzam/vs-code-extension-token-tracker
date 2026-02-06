const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-this';

/**
 * Generate JWT token for a device
 */
function generateDeviceToken(deviceId, fingerprint) {
  return jwt.sign(
    { deviceId, fingerprint, type: 'device' },
    JWT_SECRET,
    { expiresIn: '365d' }
  );
}

/**
 * Generate JWT token for admin
 */
function generateAdminToken() {
  return jwt.sign(
    { type: 'admin', isAdmin: true },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Hash password
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

/**
 * Compare password
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Get current month in YYYY-MM format
 */
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Free models list - these cost 0 tokens
 */
const FREE_MODELS = [
  'gpt-5-mini', 'gpt5-mini', 'gpt-5mini',
  'grok-code-fast-1', 'grok-code-fast', 'grokcodefast',
  'gpt-4o-mini',
];

/**
 * Check if a model is free
 */
function isModelFree(modelType) {
  const model = modelType.toLowerCase().replace(/[\s_]/g, '-');
  return FREE_MODELS.some(free => model.includes(free));
}

/**
 * Calculate tokens based on model type
 * Free models (gpt-5-mini, grok-code-fast-1) = 0 tokens
 * Claude Opus 4.5 = 3 tokens per prompt
 * All other models = 1 token per prompt
 */
function calculateTokens(modelType, promptCount = 1) {
  const model = modelType.toLowerCase();
  if (isModelFree(model)) {
    return 0;
  }
  if (model.includes('claude') && (model.includes('opus') || model.includes('4.5'))) {
    return 3 * promptCount;
  }
  return 1 * promptCount;
}

/**
 * Model types enum
 */
const MODEL_TYPES = {
  CLAUDE_OPUS_4_5: 'claude-opus-4.5',
  CLAUDE_SONNET: 'claude-sonnet',
  GPT_4: 'gpt-4',
  GPT_4O: 'gpt-4o',
  GPT_5_MINI: 'gpt-5-mini',
  GROK_CODE_FAST: 'grok-code-fast-1',
  COPILOT: 'copilot',
  OTHER: 'other'
};

/**
 * Get token cost for a model
 */
function getModelTokenCost(modelType) {
  const model = modelType.toLowerCase();
  if (isModelFree(model)) {
    return 0;
  }
  if (model.includes('claude') && (model.includes('opus') || model.includes('4.5'))) {
    return 3;
  }
  return 1;
}

module.exports = {
  generateDeviceToken,
  generateAdminToken,
  verifyToken,
  hashPassword,
  comparePassword,
  getCurrentMonth,
  calculateTokens,
  MODEL_TYPES,
  FREE_MODELS,
  isModelFree,
  getModelTokenCost
};
