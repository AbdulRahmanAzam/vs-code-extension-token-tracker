const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticateDevice, authenticateAdmin } = require('../middleware/auth');
const { getCurrentMonth, calculateTokens, getModelTokenCost } = require('../utils/helpers');

/**
 * POST /api/usage/log
 * Quick endpoint to log usage (authenticated device)
 */
router.post('/log', authenticateDevice, async (req, res) => {
  try {
    const { model_type, request_type = 'completion', description = '', prompt_count = 1 } = req.body;
    
    if (!model_type) {
      return res.status(400).json({ error: 'model_type is required' });
    }
    
    const currentMonth = getCurrentMonth();
    const tokensToUse = calculateTokens(model_type, prompt_count);
    
    // Get current allocation
    let { data: allocation } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', req.deviceId)
      .eq('month_year', currentMonth)
      .single();
    
    if (!allocation) {
      const { data: newAlloc } = await supabase
        .from('token_allocations')
        .insert({
          device_id: req.deviceId,
          allocated_tokens: 50,
          used_tokens: 0,
          month_year: currentMonth
        })
        .select()
        .single();
      allocation = newAlloc;
    }
    
    const remaining = allocation.allocated_tokens - allocation.used_tokens;
    
    if (tokensToUse > remaining) {
      return res.status(403).json({
        error: 'Insufficient tokens',
        code: 'INSUFFICIENT_TOKENS',
        requested: tokensToUse,
        remaining: remaining,
        message: 'Contact admin to request more tokens'
      });
    }
    
    // Update allocation
    const newUsed = allocation.used_tokens + tokensToUse;
    await supabase
      .from('token_allocations')
      .update({ used_tokens: newUsed })
      .eq('id', allocation.id);
    
    // Log usage
    await supabase
      .from('usage_logs')
      .insert({
        device_id: req.deviceId,
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
      remaining: allocation.allocated_tokens - newUsed
    });
  } catch (error) {
    console.error('Usage log error:', error);
    res.status(500).json({ error: 'Failed to log usage' });
  }
});

/**
 * GET /api/usage/balance
 * Get current token balance (authenticated device)
 */
router.get('/balance', authenticateDevice, async (req, res) => {
  try {
    const currentMonth = getCurrentMonth();
    
    let { data: allocation } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', req.deviceId)
      .eq('month_year', currentMonth)
      .single();
    
    if (!allocation) {
      allocation = { allocated_tokens: 50, used_tokens: 0 };
    }
    
    res.json({
      device_id: req.deviceId,
      device_name: req.device.device_name,
      month: currentMonth,
      allocated: allocation.allocated_tokens,
      used: allocation.used_tokens,
      remaining: allocation.allocated_tokens - allocation.used_tokens,
      is_blocked: req.device.is_blocked
    });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

/**
 * GET /api/usage/models
 * Get model token costs
 */
router.get('/models', (req, res) => {
  res.json({
    models: [
      { name: 'claude-opus-4.5', tokens_per_prompt: 3, description: 'Claude Opus 4.5 - Premium model' },
      { name: 'claude-sonnet', tokens_per_prompt: 1, description: 'Claude Sonnet' },
      { name: 'gpt-4', tokens_per_prompt: 1, description: 'GPT-4' },
      { name: 'gpt-4o', tokens_per_prompt: 1, description: 'GPT-4o' },
      { name: 'gpt-5-mini', tokens_per_prompt: 0, description: 'GPT-5 Mini (FREE)' },
      { name: 'grok-code-fast-1', tokens_per_prompt: 0, description: 'Grok Code Fast 1 (FREE)' },
      { name: 'copilot', tokens_per_prompt: 1, description: 'GitHub Copilot' },
      { name: 'other', tokens_per_prompt: 1, description: 'Other models' }
    ],
    note: 'Claude Opus 4.5 = 3 tokens, free models = 0 tokens, all others = 1 token per prompt'
  });
});

/**
 * GET /api/usage/stats
 * Get usage statistics (admin only)
 */
router.get('/stats', authenticateAdmin, async (req, res) => {
  try {
    const currentMonth = getCurrentMonth();
    
    // Get usage by model
    const { data: usageByModel } = await supabase
      .from('usage_logs')
      .select('model_type, tokens_used')
      .gte('created_at', `${currentMonth}-01`);
    
    const modelStats = {};
    usageByModel?.forEach(log => {
      if (!modelStats[log.model_type]) {
        modelStats[log.model_type] = { count: 0, tokens: 0 };
      }
      modelStats[log.model_type].count++;
      modelStats[log.model_type].tokens += log.tokens_used;
    });
    
    // Get total usage
    const { data: allocations } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('month_year', currentMonth);
    
    const totalAllocated = allocations?.reduce((sum, a) => sum + a.allocated_tokens, 0) || 0;
    const totalUsed = allocations?.reduce((sum, a) => sum + a.used_tokens, 0) || 0;
    
    res.json({
      month: currentMonth,
      total_allocated: totalAllocated,
      total_used: totalUsed,
      total_remaining: totalAllocated - totalUsed,
      usage_by_model: modelStats,
      request_count: usageByModel?.length || 0
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * POST /api/usage/check
 * Check if can use tokens without consuming them
 */
router.post('/check', authenticateDevice, async (req, res) => {
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
      token_cost: getModelTokenCost(model_type),
      remaining: remaining,
      is_blocked: req.device.is_blocked
    });
  } catch (error) {
    console.error('Check error:', error);
    res.status(500).json({ error: 'Check failed' });
  }
});

module.exports = router;
