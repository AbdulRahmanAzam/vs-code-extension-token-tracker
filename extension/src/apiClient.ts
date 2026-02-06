import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

// ─── Global backend URL (hardcoded for SaaS) ────────────
const GLOBAL_SERVER_URL = 'https://api.abdulrahmanazam.me';

/**
 * Allocation data from the server.
 */
export interface Allocation {
  allocated: number;
  used: number;
  remaining: number;
  month: string;
}

export interface UserInfo {
  id: string;
  email: string;
  display_name: string;
  role: string;
  monthly_token_budget: number;
  max_devices: number;
}

export interface AuthResult {
  token: string;
  user: UserInfo;
}

export interface DeviceInfo {
  device_id: string;
  device_token: string;
  device_name: string;
  is_blocked: boolean;
  allocation: Allocation;
}

export interface CheckResult {
  can_use: boolean;
  tokens_needed: number;
  remaining: number;
  is_blocked: boolean;
  reason: string | null;
}

export interface UsageResult {
  success: boolean;
  tokens_used: number;
  model_type: string;
  remaining: number;
}

/**
 * HTTP/HTTPS client for communicating with the global token tracker API.
 * Uses built-in Node modules — zero external dependencies.
 */
export class ApiClient {
  private serverUrl: string;
  private userToken: string | null = null;
  private deviceToken: string | null = null;
  private deviceId: string | null = null;

  constructor() {
    // Use configurable URL with global default
    this.serverUrl = vscode.workspace.getConfiguration('tokenTracker')
      .get<string>('serverUrl') || GLOBAL_SERVER_URL;
  }

  /** Update server URL from settings */
  refreshConfig(): void {
    this.serverUrl = vscode.workspace.getConfiguration('tokenTracker')
      .get<string>('serverUrl') || GLOBAL_SERVER_URL;
  }

  setUserToken(token: string): void {
    this.userToken = token;
  }

  setDeviceCredentials(deviceId: string, deviceToken: string): void {
    this.deviceId = deviceId;
    this.deviceToken = deviceToken;
  }

  clearCredentials(): void {
    this.userToken = null;
    this.deviceToken = null;
    this.deviceId = null;
  }

  getDeviceId(): string | null {
    return this.deviceId;
  }

  isLoggedIn(): boolean {
    return !!this.userToken;
  }

  /**
   * Generic HTTP request helper.
   */
  private request<T>(method: string, path: string, body?: any, authType: 'user' | 'device' | 'none' = 'device'): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Choose which token to send
      if (authType === 'user' && this.userToken) {
        headers['Authorization'] = `Bearer ${this.userToken}`;
      } else if (authType === 'device' && this.deviceToken) {
        headers['Authorization'] = `Bearer ${this.deviceToken}`;
      }

      const bodyStr = body ? JSON.stringify(body) : undefined;
      if (bodyStr) {
        headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 15000,
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject({ status: res.statusCode, ...parsed });
            } else {
              resolve(parsed as T);
            }
          } catch {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err: Error) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  // ─── Auth endpoints ──────────────────────────────────────

  /** Register a new account */
  async register(email: string, password: string, displayName: string, inviteToken?: string): Promise<AuthResult> {
    return this.request('POST', '/api/auth/register', {
      email, password, display_name: displayName, invite_token: inviteToken,
    }, 'none');
  }

  /** Login with email + password */
  async login(email: string, password: string): Promise<AuthResult> {
    return this.request('POST', '/api/auth/login', { email, password }, 'none');
  }

  /** Login/register with GitHub session info */
  async githubAuth(githubSession: { id: string; username: string; email?: string; avatar?: string }): Promise<AuthResult> {
    return this.request('POST', '/api/auth/github', {
      github_id: githubSession.id,
      github_username: githubSession.username,
      email: githubSession.email,
      avatar_url: githubSession.avatar,
      display_name: githubSession.username,
    }, 'none');
  }

  /** Get current user profile */
  async getProfile(): Promise<any> {
    return this.request('GET', '/api/auth/me', undefined, 'user');
  }

  // ─── Device endpoints ────────────────────────────────────

  /** Link a device to the logged-in user */
  async linkDevice(deviceName: string, fingerprint: string): Promise<DeviceInfo> {
    const res = await this.request<DeviceInfo>('POST', '/api/auth/link-device', {
      device_name: deviceName,
      hardware_fingerprint: fingerprint,
      metadata: {
        os: process.platform,
        arch: process.arch,
        vscode_version: vscode.version,
      },
    }, 'user');
    this.deviceId = res.device_id;
    this.deviceToken = res.device_token;
    return res;
  }

  // ─── Usage endpoints (device auth) ───────────────────────

  /** Health check */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.request<{ status: string }>('GET', '/api/health', undefined, 'none');
      return res.status === 'healthy';
    } catch {
      return false;
    }
  }

  /** Get current balance */
  async getBalance(): Promise<Allocation & { device_id: string; is_blocked: boolean }> {
    return this.request('GET', '/api/usage/balance');
  }

  /** Check if device can use tokens for a model */
  async checkCanUse(modelType: string, promptCount: number = 1): Promise<CheckResult> {
    return this.request('POST', '/api/usage/check', {
      model_type: modelType,
      prompt_count: promptCount,
    });
  }

  /** Log usage after a prompt */
  async logUsage(modelType: string, requestType: string = 'completion', description: string = ''): Promise<UsageResult> {
    return this.request('POST', '/api/usage/log', {
      model_type: modelType,
      request_type: requestType,
      description,
    });
  }

  /** Get usage history */
  async getHistory(limit: number = 20): Promise<any> {
    if (!this.deviceId) { throw new Error('Not registered'); }
    return this.request('GET', `/api/devices/${this.deviceId}/history?limit=${limit}`);
  }
}
