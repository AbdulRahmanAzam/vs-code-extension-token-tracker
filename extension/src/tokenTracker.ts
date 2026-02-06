import * as vscode from 'vscode';
import { ApiClient } from './apiClient';
import { Cache } from './cache';
import { StatusBarManager } from './statusBar';
import { resolveModel, ModelInfo } from './models';

/**
 * Core tracker that:
 *  - Monitors VS Code Language Model (lm) API calls by wrapping sendRequest
 *  - Detects Copilot inline completions via document change heuristics
 *  - Detects Copilot Chat messages via output channel monitoring
 *  - Enforces per-device token limits
 *  - Reports usage to the central server
 *  - Caches balance locally for offline mode
 */
export class TokenTracker {
  private api: ApiClient;
  private cache: Cache;
  private statusBar: StatusBarManager;
  private isOnline: boolean = false;
  private syncInterval: ReturnType<typeof setInterval> | undefined;
  private copilotBlocked: boolean = false;

  // Debounce: avoid double-counting rapid events
  private lastLoggedAt: number = 0;
  private readonly DEBOUNCE_MS = 3000;

  // Inline completion tracking
  private lastDocVersion: Map<string, number> = new Map();
  private lastUserTypingAt: number = 0;
  private pendingInserts: number = 0;

  // Wrapped models cache
  private wrappedModels: WeakSet<vscode.LanguageModelChat> = new WeakSet();

  constructor(api: ApiClient, cache: Cache, statusBar: StatusBarManager) {
    this.api = api;
    this.cache = cache;
    this.statusBar = statusBar;
  }

  // ─── Lifecycle ───────────────────────────────────────────

  /** Sync balance from server and update UI */
  async syncBalance(): Promise<void> {
    try {
      this.api.refreshConfig();
      const balance = await this.api.getBalance();
      this.isOnline = true;
      this.cache.updateBalance(
        balance.allocated,
        balance.used,
        balance.remaining,
        balance.month || '',
        balance.is_blocked,
      );
      this.statusBar.update(balance.used, balance.allocated, balance.is_blocked);
      this.checkAndEnforceLimits();
    } catch {
      this.isOnline = false;
      const cached = this.cache.load();
      if (cached) {
        this.statusBar.setOffline(cached.remaining, cached.allocated);
      }
    }
  }

  /** Start periodic sync (every 60 s) */
  startPeriodicSync(): void {
    this.syncBalance();
    this.syncInterval = setInterval(() => this.syncBalance(), 60_000);
  }

  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
  }

  // ─── Interception ────────────────────────────────────────

  /**
   * Register all VS Code event listeners that detect AI model usage.
   * Returns disposables for cleanup.
   */
  registerListeners(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // ═══════════════════════════════════════════════════════════
    // STRATEGY 1: Wrap vscode.lm.selectChatModels → intercept sendRequest
    // This catches chat panel, inline chat, and any LM API usage.
    // ═══════════════════════════════════════════════════════════
    this.startModelWrapping(disposables);

    // ═══════════════════════════════════════════════════════════
    // STRATEGY 2: Monitor document changes for inline completions
    // Copilot inline suggestions insert multi-line code blocks
    // that are NOT caused by user typing. We detect these.
    // ═══════════════════════════════════════════════════════════
    this.startInlineCompletionDetection(disposables);

    // ═══════════════════════════════════════════════════════════
    // STRATEGY 3: Monitor Copilot chat commands being executed
    // ═══════════════════════════════════════════════════════════
    this.startCommandMonitoring(disposables);

    return disposables;
  }

  /**
   * STRATEGY 1: Periodically wrap all available LM models' sendRequest
   * so we get notified whenever any extension (including Copilot) uses them.
   */
  private startModelWrapping(disposables: vscode.Disposable[]): void {
    const wrapAvailableModels = async () => {
      try {
        if (!vscode.lm || typeof vscode.lm.selectChatModels !== 'function') {
          return;
        }

        const models = await vscode.lm.selectChatModels();
        for (const model of models) {
          if (this.wrappedModels.has(model)) {
            continue;
          }

          const originalSendRequest = model.sendRequest.bind(model);
          const tracker = this;

          // Monkey-patch sendRequest to intercept calls
          (model as any).sendRequest = async function (
            messages: vscode.LanguageModelChatMessage[],
            options?: vscode.LanguageModelChatRequestOptions,
            token?: vscode.CancellationToken
          ): Promise<vscode.LanguageModelChatResponse> {
            // Track this model usage BEFORE allowing the request
            const modelId = model.id || model.family || model.name || 'copilot';
            console.log(`[TokenTracker] LM sendRequest intercepted: ${modelId}`);

            const canUse = await tracker.onModelUsed(modelId, 'chat');

            if (!canUse) {
              // Throw a LanguageModelError to block the request
              throw new Error(
                'Token limit reached! You have used all your allocated tokens this month. Contact admin for more.'
              );
            }

            return originalSendRequest(messages, options, token);
          };

          this.wrappedModels.add(model);
          console.log(`[TokenTracker] Wrapped model: ${model.id || model.family}`);
        }
      } catch (err) {
        // LM API might not be available — that's fine
      }
    };

    // Wrap models on start and whenever the model list changes
    wrapAvailableModels();

    if (vscode.lm && typeof vscode.lm.onDidChangeChatModels === 'function') {
      disposables.push(
        vscode.lm.onDidChangeChatModels(() => {
          wrapAvailableModels();
        })
      );
    }

    // Re-wrap periodically since models are re-fetched by other extensions
    const wrapInterval = setInterval(() => wrapAvailableModels(), 15_000);
    disposables.push({ dispose: () => clearInterval(wrapInterval) });
  }

  /**
   * STRATEGY 2: Detect inline completion acceptance
   * When user accepts a Copilot suggestion, a multi-character/multi-line
   * insert happens that wasn't from keyboard typing.
   */
  private startInlineCompletionDetection(disposables: vscode.Disposable[]): void {
    // Track keyboard typing to distinguish from Copilot insertions
    disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document !== vscode.window.activeTextEditor?.document) {
          return;
        }
        if (e.reason === vscode.TextDocumentChangeReason.Undo ||
            e.reason === vscode.TextDocumentChangeReason.Redo) {
          return;
        }

        for (const change of e.contentChanges) {
          const insertedText = change.text;
          const deletedChars = change.rangeLength;

          // User typing: 0-2 chars inserted, or a paste/format
          // Copilot inline: multi-line or many characters inserted
          if (insertedText.length > 0 && deletedChars === 0) {
            const lines = insertedText.split('\n').length;
            const chars = insertedText.length;
            const now = Date.now();
            const timeSinceLastType = now - this.lastUserTypingAt;

            // Small inserts (1-2 chars) are user typing
            if (chars <= 2) {
              this.lastUserTypingAt = now;
              return;
            }

            // If >10 chars or >=2 lines, and not immediately after typing,
            // it's very likely a Copilot inline completion acceptance
            if ((chars >= 10 || lines >= 2) && timeSinceLastType > 300) {
              console.log(`[TokenTracker] Inline completion detected: ${chars} chars, ${lines} lines`);
              this.onModelUsed('copilot', 'inline-completion');
              return;
            }
          }
        }
      })
    );
  }

  /**
   * STRATEGY 3: Monitor when chat-related commands are executed
   */
  private startCommandMonitoring(disposables: vscode.Disposable[]): void {
    // Monitor when the user sends a chat message
    // The key insight: when user presses Enter in the chat panel,
    // the 'workbench.action.chat.open' doesn't help, but we can watch
    // for panel visibility + editor focus changes that indicate chat activity.

    // Track active editor switches after chat — indicates chat was used
    let chatPanelActive = false;
    let chatPanelLastSeen = 0;

    // Monitor visible text editors — when chat panel opens, editors may blur
    disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // If returning to text editor from non-editor view, 
        // the user may have just used chat
        if (!editor && !chatPanelActive) {
          chatPanelActive = true;
          chatPanelLastSeen = Date.now();
        }
      })
    );

    // Monitor terminal activity — Copilot can generate terminal commands
    disposables.push(
      vscode.window.onDidChangeActiveTerminal(() => {
        // Don't track terminal switches as model usage — too noisy
      })
    );
  }

  /**
   * Called whenever we detect an AI model was used.
   * This is the MAIN tracking function.
   */
  async onModelUsed(modelId: string, requestType: string = 'completion'): Promise<boolean> {
    // Debounce rapid events
    const now = Date.now();
    if (now - this.lastLoggedAt < this.DEBOUNCE_MS) {
      console.log(`[TokenTracker] Debounced: ${modelId} (${requestType})`);
      return true;
    }
    this.lastLoggedAt = now;

    const model: ModelInfo = resolveModel(modelId);

    // Free models — no tracking needed
    if (model.isFree) {
      console.log(`[TokenTracker] Free model, no tracking: ${model.trackingName}`);
      return true;
    }

    console.log(`[TokenTracker] Tracking usage: ${model.trackingName} (${model.cost} tokens) [${requestType}]`);

    // Check limits locally first (fast path)
    const cached = this.cache.load();
    if (cached) {
      if (cached.isBlocked) {
        this.showBlockedNotification('Device is blocked by admin.');
        return false;
      }
      if (cached.remaining < model.cost) {
        this.showBlockedNotification('Monthly token limit reached!');
        return false;
      }
    }

    // Try reporting to server
    if (this.isOnline) {
      try {
        const result = await this.api.logUsage(model.trackingName, requestType);
        console.log(`[TokenTracker] Server logged: ${model.trackingName}, remaining=${result.remaining}`);
        
        this.cache.updateBalance(
          cached?.allocated ?? 50,
          (cached?.allocated ?? 50) - result.remaining,
          result.remaining,
          cached?.month ?? '',
          false,
        );
        this.statusBar.update(
          (cached?.allocated ?? 50) - result.remaining,
          cached?.allocated ?? 50,
          false,
        );
        this.checkAndEnforceLimits();
        return true;
      } catch (err: any) {
        console.error(`[TokenTracker] Server error:`, err);
        if (err?.status === 403) {
          // Server says no — enforce
          this.cache.updateBalance(
            cached?.allocated ?? 50,
            cached?.used ?? 50,
            0,
            cached?.month ?? '',
            true,
          );
          this.showBlockedNotification(err?.message || 'Insufficient tokens');
          this.checkAndEnforceLimits();
          return false;
        }
        // Network error — fall through to offline tracking
        this.isOnline = false;
      }
    }

    // Offline tracking — increment locally
    console.log(`[TokenTracker] Offline tracking: +${model.cost} tokens`);
    this.cache.incrementUsed(model.cost);
    const updatedCached = this.cache.load();
    if (updatedCached) {
      this.statusBar.setOffline(updatedCached.remaining, updatedCached.allocated);
      this.checkAndEnforceLimits();
    }

    return true;
  }

  // ─── Copilot Blocking ────────────────────────────────────

  /** Check limits and block/unblock Copilot accordingly */
  private checkAndEnforceLimits(): void {
    const config = vscode.workspace.getConfiguration('tokenTracker');
    if (!config.get<boolean>('blockOnLimitReached', true)) {
      return;
    }

    const cached = this.cache.load();
    if (!cached) return;

    const shouldBlock = cached.isBlocked || cached.remaining <= 0;

    if (shouldBlock && !this.copilotBlocked) {
      this.blockCopilot();
    } else if (!shouldBlock && this.copilotBlocked) {
      this.unblockCopilot();
    }
  }

  private blockCopilot(): void {
    this.copilotBlocked = true;

    // Disable inline suggestions via settings
    const config = vscode.workspace.getConfiguration('editor');
    config.update('inlineSuggest.enabled', false, vscode.ConfigurationTarget.Global);

    // Disable Copilot completions panel
    vscode.commands.executeCommand('setContext', 'tokenTracker.blocked', true);

    this.showBlockedNotification('Token limit reached! Copilot inline suggestions disabled.');
  }

  private unblockCopilot(): void {
    this.copilotBlocked = false;

    // Re-enable inline suggestions
    const config = vscode.workspace.getConfiguration('editor');
    config.update('inlineSuggest.enabled', true, vscode.ConfigurationTarget.Global);

    vscode.commands.executeCommand('setContext', 'tokenTracker.blocked', false);
    vscode.window.showInformationMessage('Token Tracker: Copilot re-enabled!');
  }

  private showBlockedNotification(reason: string): void {
    vscode.window.showWarningMessage(
      `⚡ ${reason} Contact admin for more tokens.`,
      'Show Balance'
    ).then(selection => {
      if (selection === 'Show Balance') {
        vscode.commands.executeCommand('tokenTracker.showBalance');
      }
    });
  }

  // ─── Public helpers ──────────────────────────────────────

  isDeviceBlocked(): boolean {
    return this.copilotBlocked;
  }

  getOnlineStatus(): boolean {
    return this.isOnline;
  }
}
