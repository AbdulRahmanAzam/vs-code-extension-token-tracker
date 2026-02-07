const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticateDevice } = require('../middleware/auth');
const { calculateTokens, getCurrentMonth } = require('../utils/helpers');

/**
 * GitHub Models API endpoint.
 * This is the public GitHub-hosted inference API that works with
 * GitHub personal access tokens with `models:read` scope.
 * The correct endpoint is models.github.ai, NOT models.inference.ai.azure.com
 */
const GITHUB_MODELS_API = 'https://models.github.ai/inference';

/**
 * Default models available through GitHub Models / Copilot.
 * Model IDs must match what GitHub Models API accepts.
 */
const PROXY_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', cost: 1 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', cost: 0 },
  { id: 'o3-mini', name: 'o3-mini', provider: 'openai', cost: 1 },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', cost: 1 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai', cost: 0 },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'openai', cost: 0 },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic', cost: 1 },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', cost: 1 },
  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', provider: 'anthropic', cost: 3 },
];

/**
 * GET /api/proxy/models
 * List available models for this device's account.
 * Requires device JWT.
 */
router.get('/models', authenticateDevice, async (req, res) => {
  try {
    // Get the device owner's user record
    const { data: user } = await supabase
      .from('users')
      .select('id, github_access_token')
      .eq('id', req.userId)
      .single();

    if (!user || !user.github_access_token) {
      return res.json({
        available: false,
        reason: 'Account owner has not connected GitHub with Copilot access. Ask the owner to sign in via GitHub on the dashboard.',
        models: [],
      });
    }

    res.json({
      available: true,
      models: PROXY_MODELS.map(m => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        cost: m.cost,
      })),
    });
  } catch (error) {
    console.error('Proxy models error:', error);
    res.status(500).json({ error: 'Failed to list models' });
  }
});

/**
 * GET /api/proxy/status
 * Quick check if proxy is available for this device.
 */
router.get('/status', authenticateDevice, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, github_access_token, github_username')
      .eq('id', req.userId)
      .single();

    res.json({
      available: !!(user && user.github_access_token),
      github_username: user?.github_username || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check proxy status' });
  }
});

/**
 * POST /api/proxy/chat
 * Proxy chat completions through the account owner's GitHub token.
 * Accepts OpenAI-compatible request body.
 * Requires device JWT.
 */
router.post('/chat', authenticateDevice, async (req, res) => {
  try {
    const { messages, model = 'gpt-4o', temperature, max_tokens, stream = false } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Get the device owner's GitHub token
    const { data: user } = await supabase
      .from('users')
      .select('id, github_access_token')
      .eq('id', req.userId)
      .single();

    if (!user || !user.github_access_token) {
      return res.status(403).json({
        error: 'AI proxy not available. Account owner must sign in via GitHub on the dashboard to enable model access.',
      });
    }

    // Check token limits before making the API call
    const currentMonth = getCurrentMonth();
    const { data: allocation } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', req.deviceId)
      .eq('month_year', currentMonth)
      .single();

    if (!allocation) {
      return res.status(403).json({ error: 'No token allocation for this month.' });
    }

    const modelCost = calculateTokens(model);
    if (allocation.used_tokens + modelCost > allocation.allocated_tokens) {
      return res.status(403).json({
        error: 'Token limit reached. No remaining tokens this month.',
        remaining: allocation.allocated_tokens - allocation.used_tokens,
      });
    }

    // Build the request to GitHub Models API
    const apiBody = {
      messages,
      model,
      ...(temperature !== undefined && { temperature }),
      ...(max_tokens !== undefined && { max_tokens }),
      stream: !!stream,
    };

    if (stream) {
      // ─── Streaming response ────────────────────────────
      const apiRes = await fetch(`${GITHUB_MODELS_API}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.github_access_token}`,
        },
        body: JSON.stringify(apiBody),
      });

      if (!apiRes.ok) {
        const errBody = await apiRes.text();
        console.error(`GitHub Models API error (${apiRes.status}):`, errBody);

        // If 401, the stored token is invalid
        if (apiRes.status === 401) {
          return res.status(502).json({
            error: 'GitHub token expired or invalid. Account owner must re-login via GitHub on the dashboard.',
          });
        }
        return res.status(502).json({
          error: `Upstream AI API error: ${apiRes.status}`,
          detail: errBody.substring(0, 500),
        });
      }

      // Set up SSE streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = apiRes.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      } catch (streamErr) {
        console.error('Stream error:', streamErr);
      } finally {
        res.end();
      }

      // Log usage after streaming completes
      await logProxyUsage(req.deviceId, req.userId, model, 'chat-stream', currentMonth, allocation);
    } else {
      // ─── Non-streaming response ────────────────────────
      const apiRes = await fetch(`${GITHUB_MODELS_API}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.github_access_token}`,
        },
        body: JSON.stringify(apiBody),
      });

      if (!apiRes.ok) {
        const errBody = await apiRes.text();
        console.error(`GitHub Models API error (${apiRes.status}):`, errBody);

        if (apiRes.status === 401) {
          return res.status(502).json({
            error: 'GitHub token expired or invalid. Account owner must re-login via GitHub on the dashboard.',
          });
        }
        return res.status(502).json({
          error: `Upstream AI API error: ${apiRes.status}`,
          detail: errBody.substring(0, 500),
        });
      }

      const result = await apiRes.json();

      // Log usage
      await logProxyUsage(req.deviceId, req.userId, model, 'chat', currentMonth, allocation);

      res.json(result);
    }
  } catch (error) {
    console.error('Proxy chat error:', error);
    res.status(500).json({ error: 'Proxy request failed' });
  }
});

/**
 * POST /api/proxy/completions
 * Proxy code completions (FIM - Fill In Middle) for inline suggestions.
 * Takes prefix/suffix context and returns completion text.
 * Requires device JWT.
 */
router.post('/completions', authenticateDevice, async (req, res) => {
  try {
    const { prefix, suffix, language, file_path, model = 'gpt-4o-mini', max_tokens = 256 } = req.body;

    if (!prefix) {
      return res.status(400).json({ error: 'prefix is required for code completion' });
    }

    // Get the device owner's GitHub token
    const { data: user } = await supabase
      .from('users')
      .select('id, github_access_token')
      .eq('id', req.userId)
      .single();

    if (!user || !user.github_access_token) {
      return res.status(403).json({ error: 'AI proxy not available.' });
    }

    // Check token limits
    const currentMonth = getCurrentMonth();
    const { data: allocation } = await supabase
      .from('token_allocations')
      .select('*')
      .eq('device_id', req.deviceId)
      .eq('month_year', currentMonth)
      .single();

    if (!allocation) {
      return res.status(403).json({ error: 'No token allocation for this month.' });
    }

    const modelCost = calculateTokens(model);
    if (allocation.used_tokens + modelCost > allocation.allocated_tokens) {
      return res.status(403).json({ error: 'Token limit reached.' });
    }

    // Build a chat-style request for code completion using FIM-style prompt
    const systemPrompt = `You are a code completion assistant. You are given code context (prefix and suffix) and must return ONLY the code that goes between them. Do not include any explanation, markdown formatting, or code fences. Output raw code only.${language ? ` Language: ${language}.` : ''}`;

    const userPrompt = suffix
      ? `Complete the code between PREFIX and SUFFIX.\n\nPREFIX:\n${prefix}\n\nSUFFIX:\n${suffix}\n\nCompletion:`
      : `Continue this code:\n\n${prefix}\n\nCompletion:`;

    const apiRes = await fetch(`${GITHUB_MODELS_API}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.github_access_token}`,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model,
        temperature: 0.1,
        max_tokens,
        stream: false,
      }),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      console.error(`Completions API error (${apiRes.status}):`, errBody);
      if (apiRes.status === 401) {
        return res.status(502).json({ error: 'GitHub token expired. Owner must re-login.' });
      }
      return res.status(502).json({ error: `Upstream error: ${apiRes.status}` });
    }

    const result = await apiRes.json();
    const completionText = result.choices?.[0]?.message?.content || '';

    // Log usage
    await logProxyUsage(req.deviceId, req.userId, model, 'inline-completion', currentMonth, allocation);

    res.json({
      completion: completionText,
      model: result.model || model,
      usage: result.usage || null,
    });
  } catch (error) {
    console.error('Proxy completions error:', error);
    res.status(500).json({ error: 'Proxy completion failed' });
  }
});

/**
 * Helper: Log proxy usage and update token allocation
 */
async function logProxyUsage(deviceId, userId, modelType, requestType, currentMonth, allocation) {
  try {
    const tokenCost = calculateTokens(modelType);

    // Update allocation
    await supabase
      .from('token_allocations')
      .update({ used_tokens: (allocation.used_tokens || 0) + tokenCost })
      .eq('device_id', deviceId)
      .eq('month_year', currentMonth);

    // Insert usage log
    await supabase
      .from('usage_logs')
      .insert({
        device_id: deviceId,
        user_id: userId,
        tokens_used: tokenCost,
        model_type: modelType,
        request_type: `proxy-${requestType}`,
        description: `AI proxy: ${requestType} via ${modelType}`,
      });
  } catch (err) {
    console.error('Failed to log proxy usage:', err);
  }
}

module.exports = router;
