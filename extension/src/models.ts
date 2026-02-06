/**
 * Maps VS Code / Copilot model identifiers to our tracking model names.
 * Determines token cost per model.
 *
 * Costs:
 *   claude-opus-4.5  → 3 tokens / prompt
 *   Free models      → 0 tokens / prompt
 *   Everything else  → 1 token  / prompt
 */

export interface ModelInfo {
  trackingName: string;
  cost: number;
  isFree: boolean;
}

/** Patterns that identify free models (0 tokens) */
const FREE_PATTERNS: string[] = [
  'gpt-5-mini', 'gpt5-mini', 'gpt-5mini', 'gpt-4o-mini',
  'grok-code-fast', 'grokcodefast',
];

/** Pattern that identifies Opus 4.5 (3 tokens) */
function isOpus(id: string): boolean {
  const lower = id.toLowerCase();
  return (lower.includes('claude') && (lower.includes('opus') || lower.includes('4.5')));
}

/** Check if a model id matches any free pattern */
function isFree(id: string): boolean {
  const lower = id.toLowerCase().replace(/[\s_]/g, '-');
  return FREE_PATTERNS.some(p => lower.includes(p));
}

/**
 * Resolve a model identifier (from VS Code LM API or Copilot) into cost info.
 */
export function resolveModel(modelId: string): ModelInfo {
  const lower = modelId.toLowerCase().replace(/[\s_]/g, '-');

  if (isFree(lower)) {
    return { trackingName: lower, cost: 0, isFree: true };
  }
  if (isOpus(lower)) {
    return { trackingName: 'claude-opus-4.5', cost: 3, isFree: false };
  }

  // Map common names
  if (lower.includes('claude') && lower.includes('sonnet')) {
    return { trackingName: 'claude-sonnet', cost: 1, isFree: false };
  }
  if (lower.includes('gpt-4o')) {
    return { trackingName: 'gpt-4o', cost: 1, isFree: false };
  }
  if (lower.includes('gpt-4')) {
    return { trackingName: 'gpt-4', cost: 1, isFree: false };
  }
  if (lower.includes('copilot')) {
    return { trackingName: 'copilot', cost: 1, isFree: false };
  }
  if (lower.includes('gemini')) {
    return { trackingName: 'gemini', cost: 1, isFree: false };
  }

  return { trackingName: lower || 'other', cost: 1, isFree: false };
}

/**
 * Returns a sorted list of known models for display purposes.
 */
export function getKnownModels(): { name: string; cost: number }[] {
  return [
    { name: 'claude-opus-4.5', cost: 3 },
    { name: 'claude-sonnet', cost: 1 },
    { name: 'gpt-4', cost: 1 },
    { name: 'gpt-4o', cost: 1 },
    { name: 'copilot', cost: 1 },
    { name: 'gemini', cost: 1 },
    { name: 'gpt-5-mini', cost: 0 },
    { name: 'grok-code-fast-1', cost: 0 },
  ];
}
