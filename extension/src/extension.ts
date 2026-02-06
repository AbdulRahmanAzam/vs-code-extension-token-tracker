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

  // ─── Restore session from cache ────────────────────────
  const fingerprint = generateFingerprint();
  const cached = cache.load();

  if (cached?.userToken) {
    // Restore user auth
    api.setUserToken(cached.userToken);

    if (cached.deviceId && cached.deviceToken && cached.fingerprint === fingerprint) {
      // Restore device credentials
      api.setDeviceCredentials(cached.deviceId, cached.deviceToken);
      statusBar.update(cached.used, cached.allocated, cached.isBlocked);
    } else {
      // User logged in but device not yet linked on this machine
      await autoLinkDevice(fingerprint);
    }
  } else {
    // Not logged in — prompt to log in
    statusBar.setError('Not logged in — click to sign in');
    promptLogin();
  }

  // ─── Register tracking listeners ───────────────────────
  const listenerDisposables = tracker.registerListeners();
  listenerDisposables.forEach(d => context.subscriptions.push(d));

  // ─── Register @tokenTracker chat participant ──
  registerChatParticipant(context);

  // ─── Register commands ─────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenTracker.showBalance', showBalance),
    vscode.commands.registerCommand('tokenTracker.syncNow', syncNow),
    vscode.commands.registerCommand('tokenTracker.showHistory', showHistory),
    vscode.commands.registerCommand('tokenTracker.login', () => showAuthWebview(context)),
    vscode.commands.registerCommand('tokenTracker.logout', logout),
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

  // ─── Start periodic sync (only if logged in) ──────────
  if (cache.isLoggedIn() && cache.hasDeviceCredentials()) {
    tracker.startPeriodicSync();
  }

  console.log('Token Tracker activated');
}

export function deactivate() {
  tracker?.stopPeriodicSync();
}

// ─── Auth flow ─────────────────────────────────────────────

async function promptLogin() {
  const action = await vscode.window.showInformationMessage(
    '🎫 Token Tracker: Sign in to start tracking your Copilot usage.',
    'Sign In',
    'Register'
  );
  if (action === 'Sign In' || action === 'Register') {
    vscode.commands.executeCommand('tokenTracker.login');
  }
}

async function autoLinkDevice(fingerprint: string) {
  try {
    const deviceName = getDeviceName();
    const info = await api.linkDevice(deviceName, fingerprint);
    cache.saveDeviceLink(info.device_id, info.device_token, fingerprint);
    statusBar.update(info.allocation.used, info.allocation.allocated, info.is_blocked);
    tracker.startPeriodicSync();
  } catch (err: any) {
    console.warn('Token Tracker: device linking failed.', err?.message);
    statusBar.setError('Device link failed — try Sign In again');
  }
}

async function handleEmailAuth(data: { action: 'login' | 'register'; email: string; password: string; displayName?: string; inviteToken?: string }) {
  try {
    let result;
    if (data.action === 'register') {
      result = await api.register(data.email, data.password, data.displayName || data.email.split('@')[0], data.inviteToken);
    } else {
      result = await api.login(data.email, data.password);
    }

    // Save user auth
    api.setUserToken(result.token);
    cache.saveUserAuth(result.token, {
      email: result.user.email,
      displayName: result.user.display_name,
      role: result.user.role,
    });

    // Auto-link this device
    const fingerprint = generateFingerprint();
    await autoLinkDevice(fingerprint);

    vscode.window.showInformationMessage(`🎫 Welcome, ${result.user.display_name}! Token tracking is active.`);
  } catch (err: any) {
    const msg = err?.error || err?.message || 'Authentication failed';
    vscode.window.showErrorMessage(`Token Tracker: ${msg}`);
    throw err; // re-throw so webview can show error
  }
}

async function handleGitHubAuth() {
  try {
    // Use VS Code's built-in GitHub auth provider
    const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true });
    if (!session) {
      vscode.window.showErrorMessage('Token Tracker: GitHub sign-in was cancelled.');
      return;
    }

    // Exchange GitHub session for our token
    const result = await api.githubAuth({
      id: session.account.id,
      username: session.account.label,
      email: undefined, // GitHub doesn't expose email in session
      avatar: undefined,
    });

    api.setUserToken(result.token);
    cache.saveUserAuth(result.token, {
      email: result.user.email,
      displayName: result.user.display_name,
      role: result.user.role,
    });

    // Auto-link device
    const fingerprint = generateFingerprint();
    await autoLinkDevice(fingerprint);

    vscode.window.showInformationMessage(`🎫 Welcome, ${result.user.display_name}! Signed in via GitHub.`);
  } catch (err: any) {
    const msg = err?.error || err?.message || 'GitHub authentication failed';
    vscode.window.showErrorMessage(`Token Tracker: ${msg}`);
  }
}

async function logout() {
  const confirm = await vscode.window.showWarningMessage(
    'Token Tracker: Are you sure you want to sign out?',
    { modal: true },
    'Sign Out'
  );
  if (confirm !== 'Sign Out') { return; }

  tracker.stopPeriodicSync();
  api.clearCredentials();
  cache.clear();
  statusBar.setError('Signed out — click to sign in');

  vscode.window.showInformationMessage('Token Tracker: Signed out successfully.');
}

// ─── Auth webview ──────────────────────────────────────────

function showAuthWebview(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'tokenTrackerAuth',
    'Token Tracker — Sign In',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = getAuthWebviewHtml();

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'email-auth') {
      try {
        await handleEmailAuth(msg.data);
        panel.dispose();
      } catch {
        panel.webview.postMessage({ type: 'error', message: 'Authentication failed. Check your credentials.' });
      }
    } else if (msg.type === 'github-auth') {
      await handleGitHubAuth();
      panel.dispose();
    }
  }, undefined, context.subscriptions);
}

function getAuthWebviewHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 40px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .container {
      max-width: 420px;
      width: 100%;
    }
    h1 {
      font-size: 24px;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      text-align: center;
      opacity: 0.7;
      margin-bottom: 32px;
      font-size: 14px;
    }
    .card {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 12px;
      padding: 28px;
      margin-bottom: 16px;
    }
    .tabs {
      display: flex;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .tab {
      flex: 1;
      text-align: center;
      padding: 10px;
      cursor: pointer;
      opacity: 0.6;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
      background: none;
      border-top: none;
      border-left: none;
      border-right: none;
      color: var(--vscode-foreground);
      font-size: 14px;
    }
    .tab.active {
      opacity: 1;
      border-bottom-color: var(--vscode-focusBorder);
      font-weight: 600;
    }
    label {
      display: block;
      font-size: 13px;
      margin-bottom: 4px;
      opacity: 0.8;
    }
    input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 6px;
      font-size: 14px;
      margin-bottom: 14px;
      outline: none;
    }
    input:focus {
      border-color: var(--vscode-focusBorder);
    }
    .btn {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
      margin-bottom: 10px;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-github {
      background: #24292e;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .divider {
      display: flex;
      align-items: center;
      margin: 18px 0;
      gap: 12px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--vscode-widget-border);
    }
    .divider span {
      font-size: 12px;
      opacity: 0.5;
      text-transform: uppercase;
    }
    .error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
      padding: 10px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 14px;
      display: none;
    }
    .invite-field { display: none; }
    .invite-toggle {
      font-size: 12px;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-align: center;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎫 Token Tracker</h1>
    <p class="subtitle">Sign in to track your Copilot usage</p>

    <div class="card">
      <div class="tabs">
        <button class="tab active" onclick="switchTab('login')">Sign In</button>
        <button class="tab" onclick="switchTab('register')">Register</button>
      </div>

      <div id="error" class="error"></div>

      <form id="authForm" onsubmit="handleSubmit(event)">
        <div id="nameField" style="display:none;">
          <label for="displayName">Display Name</label>
          <input type="text" id="displayName" placeholder="Your name" />
        </div>

        <label for="email">Email</label>
        <input type="email" id="email" placeholder="you@example.com" required />

        <label for="password">Password</label>
        <input type="password" id="password" placeholder="••••••••" required minlength="6" />

        <div id="inviteField" class="invite-field">
          <label for="inviteToken">Invite Token (optional)</label>
          <input type="text" id="inviteToken" placeholder="Paste invite token" />
        </div>

        <button type="submit" class="btn btn-primary" id="submitBtn">Sign In</button>
      </form>

      <p id="inviteToggle" class="invite-toggle" style="display:none;" onclick="toggleInvite()">Have an invite token?</p>

      <div class="divider"><span>or</span></div>

      <button class="btn btn-github" onclick="githubAuth()">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        Sign in with GitHub
      </button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let currentTab = 'login';

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach((t, i) => {
        t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1));
      });
      document.getElementById('nameField').style.display = tab === 'register' ? 'block' : 'none';
      document.getElementById('inviteToggle').style.display = tab === 'register' ? 'block' : 'none';
      document.getElementById('submitBtn').textContent = tab === 'login' ? 'Sign In' : 'Create Account';
      document.getElementById('error').style.display = 'none';
    }

    function toggleInvite() {
      const el = document.getElementById('inviteField');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    function handleSubmit(e) {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const displayName = document.getElementById('displayName').value;
      const inviteToken = document.getElementById('inviteToken').value;

      document.getElementById('submitBtn').disabled = true;
      document.getElementById('submitBtn').textContent = 'Please wait...';

      vscode.postMessage({
        type: 'email-auth',
        data: {
          action: currentTab,
          email,
          password,
          displayName: displayName || undefined,
          inviteToken: inviteToken || undefined,
        }
      });
    }

    function githubAuth() {
      vscode.postMessage({ type: 'github-auth' });
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'error') {
        const el = document.getElementById('error');
        el.textContent = msg.message;
        el.style.display = 'block';
        document.getElementById('submitBtn').disabled = false;
        document.getElementById('submitBtn').textContent = currentTab === 'login' ? 'Sign In' : 'Create Account';
      }
    });
  </script>
</body>
</html>`;
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
        const user = cached?.user;

        stream.markdown(
          `⚡ **Token Tracker**\n\n` +
          (user ? `👤 **${user.displayName}** (${user.email})\n\n` : '') +
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
  if (!cache.isLoggedIn()) {
    vscode.commands.executeCommand('tokenTracker.login');
    return;
  }

  await tracker.syncBalance();
  const cached = cache.load();

  if (!cached) {
    vscode.window.showErrorMessage('Token Tracker: Not logged in.');
    return;
  }

  const models = getKnownModels();
  const user = cached.user;

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
        .user-banner { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 8px; padding: 14px 20px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
        .user-avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--vscode-button-background); display: flex; align-items: center; justify-content: center; font-size: 18px; }
      </style>
    </head>
    <body>
      <h1>🎫 Token Tracker</h1>

      ${user ? `
      <div class="user-banner">
        <div class="user-avatar">👤</div>
        <div>
          <strong>${user.displayName}</strong><br/>
          <span style="opacity:0.6; font-size:13px;">${user.email} · ${user.role}</span>
        </div>
      </div>
      ` : ''}
      
      <div class="card">
        <h3>Balance — ${cached.month}</h3>
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
  if (!cache.isLoggedIn()) {
    vscode.commands.executeCommand('tokenTracker.login');
    return;
  }
  statusBar.setLoading();
  await tracker.syncBalance();
  vscode.window.showInformationMessage('Token Tracker: Synced with server!');
}

async function showHistory() {
  if (!cache.isLoggedIn()) {
    vscode.commands.executeCommand('tokenTracker.login');
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
  const currentUrl = vscode.workspace.getConfiguration('tokenTracker').get<string>('serverUrl') || 'https://api.abdulrahmanazam.me';
  const url = await vscode.window.showInputBox({
    prompt: 'Enter token tracker server URL (only change if self-hosting)',
    value: currentUrl,
    placeHolder: 'https://api.abdulrahmanazam.me',
  });
  if (url) {
    await vscode.workspace.getConfiguration('tokenTracker').update('serverUrl', url, vscode.ConfigurationTarget.Global);
    api.refreshConfig();
    vscode.window.showInformationMessage(`Token Tracker: Server URL updated to ${url}`);
    tracker.syncBalance();
  }
}
