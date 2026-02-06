import * as vscode from 'vscode';

interface UserData {
  email: string;
  displayName: string;
  role: string;
}

interface CachedData {
  // User auth
  userToken: string;
  user: UserData;

  // Device
  deviceId: string;
  deviceToken: string;
  fingerprint: string;

  // Balance
  allocated: number;
  used: number;
  remaining: number;
  month: string;
  isBlocked: boolean;
  lastSynced: number; // timestamp
}

const CACHE_KEY = 'tokenTracker.cache';

/**
 * Local cache for offline resilience.
 * Stores user auth + device credentials + last known balance in VS Code globalState.
 */
export class Cache {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** Save full state to cache */
  save(data: CachedData): void {
    this.context.globalState.update(CACHE_KEY, data);
  }

  /** Load cached state */
  load(): CachedData | undefined {
    return this.context.globalState.get<CachedData>(CACHE_KEY);
  }

  /** Check if we have a user token */
  isLoggedIn(): boolean {
    const cached = this.load();
    return !!(cached?.userToken);
  }

  /** Check if device is linked */
  hasDeviceCredentials(): boolean {
    const cached = this.load();
    return !!(cached?.deviceId && cached?.deviceToken);
  }

  /** Get cached user info */
  getUser(): UserData | undefined {
    return this.load()?.user;
  }

  /** Get user token */
  getUserToken(): string | undefined {
    return this.load()?.userToken;
  }

  /** Save user auth data (after login/register) */
  saveUserAuth(userToken: string, user: UserData): void {
    const cached = this.load();
    if (cached) {
      cached.userToken = userToken;
      cached.user = user;
      this.save(cached);
    } else {
      this.save({
        userToken,
        user,
        deviceId: '',
        deviceToken: '',
        fingerprint: '',
        allocated: 0,
        used: 0,
        remaining: 0,
        month: '',
        isBlocked: false,
        lastSynced: 0,
      });
    }
  }

  /** Save device credentials after linking */
  saveDeviceLink(deviceId: string, deviceToken: string, fingerprint: string): void {
    const cached = this.load();
    if (cached) {
      cached.deviceId = deviceId;
      cached.deviceToken = deviceToken;
      cached.fingerprint = fingerprint;
      this.save(cached);
    }
  }

  /** Update only balance fields */
  updateBalance(allocated: number, used: number, remaining: number, month: string, isBlocked: boolean): void {
    const cached = this.load();
    if (cached) {
      cached.allocated = allocated;
      cached.used = used;
      cached.remaining = remaining;
      cached.month = month;
      cached.isBlocked = isBlocked;
      cached.lastSynced = Date.now();
      this.save(cached);
    }
  }

  /** Increment used tokens locally (offline tracking) */
  incrementUsed(tokens: number): void {
    const cached = this.load();
    if (cached) {
      cached.used += tokens;
      cached.remaining = cached.allocated - cached.used;
      this.save(cached);
    }
  }

  /** Get remaining tokens from cache */
  getRemaining(): number {
    const cached = this.load();
    return cached?.remaining ?? 0;
  }

  /** Check if blocked */
  isBlocked(): boolean {
    const cached = this.load();
    return cached?.isBlocked ?? false;
  }

  /** How long since last sync (ms) */
  timeSinceLastSync(): number {
    const cached = this.load();
    if (!cached?.lastSynced) { return Infinity; }
    return Date.now() - cached.lastSynced;
  }

  /** Clear all cached data (logout) */
  clear(): void {
    this.context.globalState.update(CACHE_KEY, undefined);
  }
}
