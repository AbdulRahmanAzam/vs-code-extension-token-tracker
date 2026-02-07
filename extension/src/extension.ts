import * as vscode from 'vscode';
import { generateFingerprint, getDeviceName } from './deviceId';
import { ApiClient } from './apiClient';
import { Cache } from './cache';
import { StatusBarManager } from './statusBar';
import { TokenTracker } from './tokenTracker';
import { ProxyCompletionProvider } from './completionProvider';
import { getKnownModels } from './models';

let tracker: TokenTracker;
let statusBar: StatusBarManager;
let api: ApiClient;
let cache: Cache;
let completionProvider: ProxyCompletionProvider;

// Guard to avoid showing proxy notification every sync cycle
let proxyNotificationShown = false;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('tokenTracker');
  if (!config.get<boolean>('enabled', true)) {
    return;
  }

  // ─── Initialize components ─────────────────────────────
  api = new ApiClient();
  cache = new Cache(context);
  statusBar = new StatusBarManager();
  tracker = new TokenTracker(api, cache, statusBar);
  completionProvider = new ProxyCompletionProvider(api, cache);

  context.subscriptions.push({ dispose: () => statusBar.dispose() });
  context.subscriptions.push({ dispose: () => tracker.stopPeriodicSync() });

  // ─── Register inline completion provider (AI proxy) ────
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      completionProvider
    )
  );

  // ─── Check if already activated with a token key ───────
  const cached = cache.load();

  if (cached?.deviceId && cached?.deviceToken && cached?.tokenKey) {
    // Already activated — restore credentials
    api.setDeviceCredentials(cached.deviceId, cached.deviceToken);
    statusBar.update(cached.used, cached.allocated, cached.isBlocked);
    tracker.startPeriodicSync();
    // Enable AI proxy if it was previously available
    initProxyFeatures();

    // Set up callback to refresh proxy status on each sync
    tracker.setOnSyncCallback(() => {
      initProxyFeatures();
    });
  } else {
    // Not activated — prompt for token key
    statusBar.setNotActivated();
    promptForTokenKey();
  }

  // ─── Register tracking listeners ───────────────────────
  const listenerDisposables = tracker.registerListeners();
  listenerDisposables.forEach(d => context.subscriptions.push(d));

  // ─── Register @tokenTracker chat participant ──
  registerChatParticipant(context);

  // ─── Register commands ─────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenTracker.enterKey', () => enterTokenKey()),
    vscode.commands.registerCommand('tokenTracker.showBalance', showBalance),
    vscode.commands.registerCommand('tokenTracker.syncNow', syncNow),
    vscode.commands.registerCommand('tokenTracker.showHistory', showHistory),
    vscode.commands.registerCommand('tokenTracker.deactivate', deactivateExtension),
    vscode.commands.registerCommand('tokenTracker.configure', configureServer),
  );

  // ─── Listen for config changes ─────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('tokenTracker')) {
        api.refreshConfig();
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
          tracker.stopPeriodicSync();
          statusBar.dispose();
        }
      }
    })
  );

  console.log('Token Tracker activated');
}

export function deactivate() {
  tracker?.stopPeriodicSync();
}

// ─── Token Key Activation Flow ─────────────────────────────

async function promptForTokenKey() {
  const action = await vscode.window.showInformationMessage(
    '🎫 Token Tracker requires a Token Key to work. Get one from your Token Tracker dashboard.',
    'Enter Token Key',
    'Get a Key'
  );
  if (action === 'Enter Token Key') {
    enterTokenKey();
  } else if (action === 'Get a Key') {
    vscode.env.openExternal(vscode.Uri.parse('https://vstokentracker.vercel.app'));
  }
}

async function enterTokenKey() {
  const tokenKey = await vscode.window.showInputBox({
    prompt: 'Paste your Token Key from the Token Tracker dashboard',
    placeHolder: 'TK-xxxxxxxxxxxxxxxxxxxxxxxx',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Token key is required';
      }
      if (!value.trim().startsWith('TK-')) {
        return 'Token key must start with TK-';
      }
      if (value.trim().length < 10) {
        return 'Token key is too short';
      }
      return null;
    },
  });

  if (!tokenKey) {
    return; // User cancelled
  }

  statusBar.setLoading();

  try {
    const fingerprint = generateFingerprint();
    const deviceName = getDeviceName();

    const result = await api.redeemKey(tokenKey.trim(), deviceName, fingerprint);

    // Save activation data
    api.setDeviceCredentials(result.device_id, result.device_token);
    cache.saveActivation(
      tokenKey.trim(),
      result.owner,
      result.device_id,
      result.device_token,
      result.device_name,
      fingerprint,
      result.allocation,
    );

    // Update UI
    statusBar.update(result.allocation.used, result.allocation.allocated, false);
    tracker.startPeriodicSync();

    // Enable AI proxy features if available
    if (result.has_copilot_proxy) {
      completionProvider.setEnabled(true);
      vscode.window.showInformationMessage(
        `🎫 Token Tracker activated! Owner: ${result.owner}. ${result.allocation.remaining}/${result.allocation.allocated} tokens.`,
        'Use @tokenTracker'
      ).then(selection => {
        if (selection === 'Use @tokenTracker') {
          vscode.commands.executeCommand('workbench.action.chat.open', { query: '@tokenTracker ' });
        }
      });
      // Show additional tip about how to use
      vscode.window.showInformationMessage(
        '✨ AI Proxy enabled! Use @tokenTracker in chat or wait for inline completions. No GitHub sign-in needed!'
      );
    } else {
      vscode.window.showInformationMessage(
        `🎫 Token Tracker activated! Owner: ${result.owner}. ${result.allocation.remaining}/${result.allocation.allocated} tokens. (AI proxy not available — owner must add GitHub PAT in dashboard Settings)`
      );
    }

    // Check proxy status from server as well
    initProxyFeatures();
  } catch (err: any) {
    const msg = err?.error || err?.message || 'Failed to redeem token key';
    statusBar.setNotActivated();
    vscode.window.showErrorMessage(`Token Tracker: ${msg}`);
  }
}

async function deactivateExtension() {
  const confirm = await vscode.window.showWarningMessage(
    'Token Tracker: Remove your token key and deactivate? You\'ll need a new key to reactivate.',
    { modal: true },
    'Deactivate'
  );
  if (confirm !== 'Deactivate') { return; }

  tracker.stopPeriodicSync();
  api.clearCredentials();
  cache.clear();
  statusBar.setNotActivated();

  vscode.window.showInformationMessage('Token Tracker: Deactivated. Enter a new token key to reactivate.');
}

// ─── AI Proxy Initialization ───────────────────────────────

async function initProxyFeatures() {
  if (!api.isActivated()) { return; }

  try {
    const status = await api.getProxyStatus();
    if (status.available) {
      completionProvider.setEnabled(true);
      console.log('[TokenTracker] AI proxy enabled — inline completions active');

      // Check if GitHub Copilot is signed in
      // Show a one-time notification that proxy is available
      if (!proxyNotificationShown) {
        proxyNotificationShown = true;
        try {
          const hasNativeModels = vscode.lm && await vscode.lm.selectChatModels().then(m => m.length > 0);

          if (!hasNativeModels) {
            // No native Copilot models, but proxy is available
            vscode.window.showInformationMessage(
              '⚡ Token Tracker: AI models available via proxy! Use @tokenTracker in chat or get inline completions without GitHub sign-in.',
              'Try @tokenTracker'
            ).then(selection => {
              if (selection === 'Try @tokenTracker') {
                vscode.commands.executeCommand('workbench.action.chat.open', { query: '@tokenTracker' });
              }
            });
          }
        } catch {
          // Ignore - LM API might not be available
        }
      }
    } else {
      completionProvider.setEnabled(false);
      console.log('[TokenTracker] AI proxy not available — owner has no GitHub token stored');
    }
  } catch (err) {
    console.log('[TokenTracker] Could not check proxy status:', err);
    // Optimistically enable if we had it before
    completionProvider.setEnabled(true);
  }
}

// ─── Chat Participant (AI-powered via proxy) ───────────────

function registerChatParticipant(context: vscode.ExtensionContext) {
  try {
    if (!vscode.chat || typeof vscode.chat.createChatParticipant !== 'function') {
      return;
    }

    const participant = vscode.chat.createChatParticipant(
      'tokenTracker.watcher',
      async (request, chatContext, stream, token) => {
        if (token.isCancellationRequested) { return; }

        const userQuery = request.prompt.trim().toLowerCase();

        // Handle balance/status queries
        if (userQuery === 'balance' || userQuery === 'status' || userQuery === 'help' || userQuery === '') {
          const cached = cache.load();
          const remaining = cached?.remaining ?? '?';
          const allocated = cached?.allocated ?? '?';
          const used = cached?.used ?? '?';

          stream.markdown(
            `⚡ **Token Tracker**\n\n` +
            (cached?.ownerName ? `👤 **Owner:** ${cached.ownerName}\n\n` : '') +
            `| Stat | Value |\n|---|---|\n` +
            `| Allocated | ${allocated} |\n` +
            `| Used | ${used} |\n` +
            `| Remaining | ${remaining} |\n` +
            `| Server | ${tracker.getOnlineStatus() ? '🟢 Online' : '🔴 Offline'} |\n` +
            `| AI Proxy | ${completionProvider?.isEnabled() ? '🟢 Active' : '🔴 Inactive'} |\n\n` +
            `**Tip:** Ask me any coding question and I'll answer using your account's AI models!\n` +
            `Example: \`@tokenTracker explain how async/await works in JavaScript\``
          );
          return;
        }

        // If not a status query, use the AI proxy to answer 
        if (!api.isActivated()) {
          stream.markdown('⚠️ Token Tracker is not activated. Enter a token key first.');
          return;
        }

        const cached = cache.load();
        if (cached && (cached.isBlocked || cached.remaining <= 0)) {
          stream.markdown('⚠️ Token limit reached! No remaining tokens this month. Contact admin for more.');
          return;
        }

        // Build conversation history from chat context
        const messages: { role: string; content: string }[] = [
          {
            role: 'system',
            content: 'You are a helpful AI coding assistant. Provide clear, concise answers. Use markdown formatting for code blocks and explanations.',
          },
        ];

        // Include previous turns for context
        for (const turn of chatContext.history) {
          if (turn instanceof vscode.ChatRequestTurn) {
            messages.push({ role: 'user', content: turn.prompt });
          } else if (turn instanceof vscode.ChatResponseTurn) {
            // Extract text from response parts
            let responseText = '';
            for (const part of turn.response) {
              if (part instanceof vscode.ChatResponseMarkdownPart) {
                responseText += part.value.value;
              }
            }
            if (responseText) {
              messages.push({ role: 'assistant', content: responseText });
            }
          }
        }

        messages.push({ role: 'user', content: request.prompt });

        try {
          // Check proxy availability first
          const proxyCheck = await api.getProxyStatus().catch(() => ({ available: false, github_username: null }));
          if (!proxyCheck.available) {
            stream.markdown(
              `⚠️ **AI Proxy Unavailable**\n\n` +
              `The account owner has not configured a GitHub Personal Access Token (PAT) yet.\n\n` +
              `Ask the account owner to:\n` +
              `1. Go to GitHub → Settings → Developer settings → Personal access tokens\n` +
              `2. Create a token with \`models:read\` scope\n` +
              `3. Save it in the Token Tracker dashboard under **Settings**`
            );
            return;
          }

          // Use streaming for better UX
          await new Promise<void>((resolve, reject) => {
            api.streamChatCompletion(
              messages,
              'gpt-4o',
              { temperature: 0.7, max_tokens: 2048 },
              (chunk) => {
                if (token.isCancellationRequested) { return; }
                stream.markdown(chunk);
              },
              () => resolve(),
              (err) => reject(err)
            );

            // Handle cancellation
            token.onCancellationRequested(() => resolve());
          });
        } catch (err: any) {
          const errMsg = err?.message || 'Failed to get AI response';
          stream.markdown(
            `\n\n⚠️ **Error:** ${errMsg}\n\n` +
            `**Troubleshooting:**\n` +
            `- Check that the Token Tracker server is online\n` +
            `- Verify the account owner's GitHub PAT is valid\n` +
            `- Run \`@tokenTracker status\` to see your connection info`
          );
          console.error('[TokenTracker] Chat proxy error:', err);
        }
      }
    );

    participant.iconPath = new vscode.ThemeIcon('credit-card');
    context.subscriptions.push(participant);
  } catch (err) {
    console.warn('Token Tracker: Chat participant unavailable:', err);
  }
}

// ─── Command handlers ──────────────────────────────────────

async function showBalance() {
  if (!cache.isActivated()) {
    enterTokenKey();
    return;
  }

  await tracker.syncBalance();
  const cached = cache.load();

  if (!cached) {
    vscode.window.showErrorMessage('Token Tracker: Not activated.');
    return;
  }

  const models = getKnownModels();

  // Get proxy status and available models
  let proxyStatus: { available: boolean; github_username: string | null } = { available: false, github_username: null };
  let proxyModels: any[] = [];
  try {
    proxyStatus = await api.getProxyStatus();
    if (proxyStatus.available) {
      const modelsResponse = await api.getProxyModels();
      proxyModels = modelsResponse.models || [];
    }
  } catch (err) {
    console.log('[TokenTracker] Could not fetch proxy models:', err);
  }

  const panel = vscode.window.createWebviewPanel(
    'tokenBalance',
    'Token Balance',
    vscode.ViewColumn.One,
    {}
  );

  const barWidth = cached.allocated > 0 ? Math.round((cached.used / cached.allocated) * 100) : 0;
  const barColor = barWidth >= 90 ? '#e74c3c' : barWidth >= 70 ? '#f39c12' : '#2ecc71';

  const proxyModelsList = proxyModels.length > 0
    ? proxyModels.map(m => `<tr><td>${m.name}</td><td>${m.provider}</td><td class="${m.cost === 0 ? 'free' : m.cost >= 3 ? 'premium' : ''}">${m.cost === 0 ? 'FREE' : m.cost + ' token(s)'}</td></tr>`).join('')
    : '<tr><td colspan="3" style="opacity:0.5; text-align:center;">AI proxy not available</td></tr>';

  panel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
        .card { background: var(--vscode-editorWidget-background); border-radius: 8px; padding: 20px; margin-bottom: 16px; border: 1px solid var(--vscode-widget-border); }
        h1 { margin: 0 0 20px; }
        .bar-container { background: var(--vscode-progressBar-background); border-radius: 4px; height: 24px; margin: 12px 0; overflow: hidden; }
        .bar { height: 100%; border-radius: 4px; transition: width 0.3s; display: flex; align-items: center; padding-left: 8px; color: white; font-weight: bold; font-size: 12px; }
        .stat { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--vscode-widget-border); }
        .stat:last-child { border-bottom: none; }
        .label { opacity: 0.7; }
        .cost-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        .cost-table th, .cost-table td { padding: 6px 12px; text-align: left; border-bottom: 1px solid var(--vscode-widget-border); }
        .free { color: #2ecc71; font-weight: bold; }
        .premium { color: #e74c3c; font-weight: bold; }
        .status { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
        .status.online { background: #2ecc71; color: white; }
        .status.offline { background: #e74c3c; color: white; }
        .status.blocked { background: #8e44ad; color: white; }
        .info-banner { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 8px; padding: 14px 20px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
        .info-icon { width: 36px; height: 36px; border-radius: 50%; background: var(--vscode-button-background); display: flex; align-items: center; justify-content: center; font-size: 18px; }
        .proxy-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; background: #2ecc71; color: white; }
        .proxy-badge.inactive { background: #95a5a6; }
        .hint { margin-top: 12px; padding: 12px; background: rgba(100, 200, 255, 0.1); border-left: 3px solid #64c8ff; border-radius: 4px; font-size: 13px; }
      </style>
    </head>
    <body>
      <h1>🎫 Token Tracker</h1>

      <div class="info-banner">
        <div class="info-icon">🔑</div>
        <div>
          <strong>${cached.deviceName}</strong><br/>
          <span style="opacity:0.6; font-size:13px;">Owner: ${cached.ownerName} · Key: ${cached.tokenKey?.substring(0, 12)}…</span>
        </div>
      </div>
      
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="margin:0;">Balance — ${cached.month || 'Current Month'}</h3>
          ${proxyStatus.available
      ? '<span class="proxy-badge">⚡ AI Proxy Active</span>'
      : '<span class="proxy-badge inactive">AI Proxy Offline</span>'}
        </div>
        <div class="bar-container">
          <div class="bar" style="width: ${Math.max(barWidth, 2)}%; background: ${barColor};">${barWidth}%</div>
        </div>
        <div class="stat"><span class="label">Allocated</span><strong>${cached.allocated}</strong></div>
        <div class="stat"><span class="label">Used</span><strong>${cached.used}</strong></div>
        <div class="stat"><span class="label">Remaining</span><strong>${cached.remaining}</strong></div>
        <div class="stat"><span class="label">Status</span>
          ${cached.isBlocked
      ? '<span class="status blocked">BLOCKED</span>'
      : cached.remaining <= 0
        ? '<span class="status offline">LIMIT REACHED</span>'
        : '<span class="status online">Active</span>'}
        </div>
        <div class="stat"><span class="label">Server</span>
          <span class="status ${tracker.getOnlineStatus() ? 'online' : 'offline'}">${tracker.getOnlineStatus() ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      ${proxyStatus.available ? `
        <div class="card">
          <h3>⚡ AI Proxy Models (Available without GitHub sign-in)</h3>
          <table class="cost-table">
            <tr><th>Model</th><th>Provider</th><th>Cost / Prompt</th></tr>
            ${proxyModelsList}
          </table>
          <div class="hint">
            💡 <strong>Tip:</strong> Use <code>@tokenTracker</code> in chat to ask coding questions, or simply start typing to get inline AI completions — no GitHub sign-in required!
          </div>
        </div>
      ` : ''}

      <div class="card">
        <h3>Model Costs (Standard Tracking)</h3>
        <table class="cost-table">
          <tr><th>Model</th><th>Cost / Prompt</th></tr>
          ${models.map(m => `<tr><td>${m.name}</td><td class="${m.cost === 0 ? 'free' : m.cost >= 3 ? 'premium' : ''}">${m.cost === 0 ? 'FREE' : m.cost + ' token(s)'}</td></tr>`).join('')}
        </table>
      </div>
    </body>
    </html>
  `;
}

async function syncNow() {
  if (!cache.isActivated()) {
    enterTokenKey();
    return;
  }
  statusBar.setLoading();
  await tracker.syncBalance();
  vscode.window.showInformationMessage('Token Tracker: Synced with server!');
}

async function showHistory() {
  if (!cache.isActivated()) {
    enterTokenKey();
    return;
  }

  try {
    const history = await api.getHistory(30);
    const panel = vscode.window.createWebviewPanel(
      'tokenHistory',
      'Token Usage History',
      vscode.ViewColumn.One,
      {}
    );

    const rows = (history.history || [])
      .map((h: any) => `<tr><td>${new Date(h.created_at).toLocaleString()}</td><td>${h.model_type}</td><td>${h.request_type}</td><td>${h.tokens_used}</td></tr>`)
      .join('');

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, sans-serif; padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--vscode-widget-border); }
          th { opacity: 0.7; }
        </style>
      </head>
      <body>
        <h1>📊 Usage History</h1>
        <table>
          <tr><th>Time</th><th>Model</th><th>Type</th><th>Tokens</th></tr>
          ${rows || '<tr><td colspan="4">No usage recorded yet.</td></tr>'}
        </table>
      </body>
      </html>
    `;
  } catch {
    vscode.window.showErrorMessage('Token Tracker: Could not fetch history. Server offline?');
  }
}

async function configureServer() {
  const currentUrl = vscode.workspace.getConfiguration('tokenTracker').get<string>('serverUrl') || 'https://tokentrackerbackend.abdulrahmanazam.me';
  const url = await vscode.window.showInputBox({
    prompt: 'Enter token tracker server URL (only change if self-hosting)',
    value: currentUrl,
    placeHolder: 'https://tokentrackerbackend.abdulrahmanazam.me',
  });
  if (url) {
    await vscode.workspace.getConfiguration('tokenTracker').update('serverUrl', url, vscode.ConfigurationTarget.Global);
    api.refreshConfig();
    vscode.window.showInformationMessage(`Token Tracker: Server URL updated to ${url}`);
    tracker.syncBalance();
  }
}
