import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

// ─── Global backend URL ────────────────────────────────
const DEFAULT_SERVER_URL = 'https://tokentrackerbackend.abdulrahmanazam.me';

/**
 * Allocation data from the server.
 */
export interface Allocation {
  allocated: number;
  used: number;
  remaining: number;
  month?: string;
}

export interface RedeemResult {
  message: string;
  device_id: string;
  device_token: string;
  device_name: string;
  owner: string;
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
 * HTTP/HTTPS client for communicating with the token tracker API.
 * Simplified for token-key-based activation — no login/register needed.
 */
export class ApiClient {
  private serverUrl: string;
  private deviceToken: string | null = null;
  private deviceId: string | null = null;

  constructor() {
    this.serverUrl = vscode.workspace.getConfiguration('tokenTracker')
      .get<string>('serverUrl') || DEFAULT_SERVER_URL;
  }

  /** Update server URL from settings */
  refreshConfig(): void {
    this.serverUrl = vscode.workspace.getConfiguration('tokenTracker')
      .get<string>('serverUrl') || DEFAULT_SERVER_URL;
  }

  setDeviceCredentials(deviceId: string, deviceToken: string): void {
    this.deviceId = deviceId;
    this.deviceToken = deviceToken;
  }

  clearCredentials(): void {
    this.deviceToken = null;
    this.deviceId = null;
  }

  getDeviceId(): string | null {
    return this.deviceId;
  }

  isActivated(): boolean {
    return !!(this.deviceId && this.deviceToken);
  }

  /**
   * Generic HTTP request helper.
   */
  private request<T>(method: string, path: string, body?: any, useDeviceAuth: boolean = true): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (useDeviceAuth && this.deviceToken) {
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

  // ─── Token Key Activation ────────────────────────────────

  /** Redeem a token key (TK-xxxx) to register this device */
  async redeemKey(tokenKey: string, deviceName: string, fingerprint: string): Promise<RedeemResult> {
    return this.request<RedeemResult>('POST', '/api/user/redeem-key', {
      token_key: tokenKey,
      device_name: deviceName,
      hardware_fingerprint: fingerprint,
      metadata: {
        os: process.platform,
        arch: process.arch,
        vscode_version: vscode.version,
      },
    }, false);
  }

  // ─── Usage endpoints (device auth) ───────────────────────

  /** Health check */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.request<{ status: string }>('GET', '/api/health', undefined, false);
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
    if (!this.deviceId) { throw new Error('Not activated'); }
    return this.request('GET', `/api/devices/${this.deviceId}/history?limit=${limit}`);
  }
}
