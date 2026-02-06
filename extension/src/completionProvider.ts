import * as vscode from 'vscode';
import { ApiClient } from './apiClient';
import { Cache } from './cache';

/**
 * Provides inline code completions by proxying through the backend
 * to the account owner's GitHub Copilot/Models access.
 *
 * This replaces the need for GitHub sign-in on each device —
 * the token key is enough to get AI suggestions.
 */
export class ProxyCompletionProvider implements vscode.InlineCompletionItemProvider {
  private api: ApiClient;
  private cache: Cache;
  private enabled: boolean = false;
  private lastRequestTime: number = 0;
  private readonly DEBOUNCE_MS = 500; // Don't fire requests too fast

  // Model to use for inline completions (fast & cheap)
  private completionModel: string = 'gpt-4o-mini';

  constructor(api: ApiClient, cache: Cache) {
    this.api = api;
    this.cache = cache;
  }

  /** Enable or disable the provider */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Set the model for inline completions */
  setModel(model: string): void {
    this.completionModel = model;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    // Don't provide if disabled or not activated
    if (!this.enabled || !this.api.isActivated()) {
      return undefined;
    }

    // Check if blocked
    const cached = this.cache.load();
    if (!cached || cached.isBlocked || cached.remaining <= 0) {
      return undefined;
    }

    // Debounce rapid typing
    const now = Date.now();
    if (now - this.lastRequestTime < this.DEBOUNCE_MS) {
      return undefined;
    }

    // Only trigger on explicit invoke or after a newline/typing pause
    // Skip if user just typed a single character (wait for a pause)
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      // For automatic triggers, wait a bit longer
      if (now - this.lastRequestTime < 1000) {
        return undefined;
      }
    }

    this.lastRequestTime = now;

    try {
      // Get code context around the cursor
      const maxPrefixLines = 50;
      const maxSuffixLines = 15;

      const startLine = Math.max(0, position.line - maxPrefixLines);
      const endLine = Math.min(document.lineCount - 1, position.line + maxSuffixLines);

      const prefixRange = new vscode.Range(startLine, 0, position.line, position.character);
      const suffixRange = new vscode.Range(position.line, position.character, endLine, document.lineAt(endLine).text.length);

      const prefix = document.getText(prefixRange);
      const suffix = document.getText(suffixRange);

      if (prefix.trim().length < 3) {
        return undefined; // Not enough context
      }

      // Check cancellation
      if (token.isCancellationRequested) {
        return undefined;
      }

      // Get the language ID
      const language = document.languageId;
      const filePath = document.uri.fsPath || document.fileName;

      // Call the proxy
      const result = await this.api.proxyCodeCompletion(
        prefix,
        suffix,
        language,
        filePath,
        this.completionModel,
        200
      );

      // Check cancellation again
      if (token.isCancellationRequested) {
        return undefined;
      }

      const completionText = result.completion?.trim();
      if (!completionText) {
        return undefined;
      }

      // Return as inline completion
      const item = new vscode.InlineCompletionItem(
        completionText,
        new vscode.Range(position, position)
      );

      return [item];
    } catch (err: any) {
      // Don't show errors for every keystroke — just log silently
      console.log('[TokenTracker] Inline completion error:', err?.message || err);
      return undefined;
    }
  }
}
