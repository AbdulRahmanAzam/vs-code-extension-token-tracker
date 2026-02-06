import * as vscode from 'vscode';

interface CachedData {
  // Token key used to activate
  tokenKey: string;
  ownerName: string;

  // Device credentials (from redeem-key API)
  deviceId: string;
  deviceToken: string;
  deviceName: string;
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
 * Stores token key + device credentials + last known balance in VS Code globalState.
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

  /** Check if the extension is activated with a token key */
  isActivated(): boolean {
    const cached = this.load();
    return !!(cached?.deviceId && cached?.deviceToken && cached?.tokenKey);
  }

  /** Get the token key used to activate */
  getTokenKey(): string | undefined {
    return this.load()?.tokenKey;
  }

  /** Save activation data after redeeming a token key */
  saveActivation(
    tokenKey: string,
    ownerName: string,
    deviceId: string,
    deviceToken: string,
    deviceName: string,
    fingerprint: string,
    allocation: { allocated: number; used: number; remaining: number },
  ): void {
    this.save({
      tokenKey,
      ownerName,
      deviceId,
      deviceToken,
      deviceName,
      fingerprint,
      allocated: allocation.allocated,
      used: allocation.used,
      remaining: allocation.remaining,
      month: '',
      isBlocked: false,
      lastSynced: Date.now(),
    });
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

  /** Clear all cached data (deactivate) */
  clear(): void {
    this.context.globalState.update(CACHE_KEY, undefined);
  }
}
