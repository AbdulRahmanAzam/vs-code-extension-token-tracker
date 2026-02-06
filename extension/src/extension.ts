import * as vscode from 'vscode';
import { generateFingerprint, getDeviceName } from './deviceId';
import { ApiClient } from './apiClient';
import { Cache } from './cache';
import { StatusBarManager } from './statusBar';
import { TokenTracker } from './tokenTracker';
import { getKnownModels } from './models';

let tracker: TokenTracker;
let statusBar: StatusBarManager;
let api: ApiClient;
let cache: Cache;

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

  context.subscriptions.push({ dispose: () => statusBar.dispose() });
  context.subscriptions.push({ dispose: () => tracker.stopPeriodicSync() });

  // ─── Check if already activated with a token key ───────
  const cached = cache.load();

  if (cached?.deviceId && cached?.deviceToken && cached?.tokenKey) {
    // Already activated — restore credentials
    api.setDeviceCredentials(cached.deviceId, cached.deviceToken);
    statusBar.update(cached.used, cached.allocated, cached.isBlocked);
    tracker.startPeriodicSync();
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

    vscode.window.showInformationMessage(
      `🎫 Token Tracker activated! Owner: ${result.owner}. You have ${result.allocation.remaining}/${result.allocation.allocated} tokens this month.`
    );
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

// ─── Chat Participant (for @tokenTracker balance queries) ──

function registerChatParticipant(context: vscode.ExtensionContext) {
  try {
    if (!vscode.chat || typeof vscode.chat.createChatParticipant !== 'function') {
      return;
    }

    const participant = vscode.chat.createChatParticipant(
      'tokenTracker.watcher',
      async (request, _chatContext, stream, token) => {
        if (token.isCancellationRequested) { return; }

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
          `| Server | ${tracker.getOnlineStatus() ? '🟢 Online' : '🔴 Offline'} |\n\n` +
          `Type \`@tokenTracker help\` for commands.`
        );
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

  const panel = vscode.window.createWebviewPanel(
    'tokenBalance',
    'Token Balance',
    vscode.ViewColumn.One,
    {}
  );

  const barWidth = cached.allocated > 0 ? Math.round((cached.used / cached.allocated) * 100) : 0;
  const barColor = barWidth >= 90 ? '#e74c3c' : barWidth >= 70 ? '#f39c12' : '#2ecc71';

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
        <h3>Balance — ${cached.month || 'Current Month'}</h3>
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

      <div class="card">
        <h3>Model Costs</h3>
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
