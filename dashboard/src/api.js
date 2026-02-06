// In dev, Vite proxies /api → localhost:3000
// In production (Vercel), VITE_API_URL must point to the deployed backend
const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api';

class Api {
  constructor() {
    this.token = localStorage.getItem('admin_token') || null;
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('admin_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('admin_token');
  }

  isAuthenticated() {
    return !!this.token;
  }

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        this.clearToken();
        window.location.reload();
      }
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  // ─── Auth ─────────────────────
  login(username, password) {
    return this.request('POST', '/admin/login', { username, password });
  }

  // ─── Dashboard ────────────────
  getDashboard() {
    return this.request('GET', '/admin/dashboard');
  }

  // ─── Users ────────────────────
  getUsers() {
    return this.request('GET', '/admin/users');
  }

  updateUser(userId, updates) {
    return this.request('PUT', `/admin/users/${userId}`, updates);
  }

  deleteUser(userId) {
    return this.request('DELETE', `/admin/users/${userId}`);
  }

  // ─── Invite Tokens ────────────
  getInvites() {
    return this.request('GET', '/admin/invites');
  }

  createInvite(monthlyBudget = 50, maxDevices = 3, expiresInDays = 30) {
    return this.request('POST', '/admin/invites', {
      monthly_budget: monthlyBudget,
      max_devices: maxDevices,
      expires_in_days: expiresInDays,
    });
  }

  deleteInvite(inviteId) {
    return this.request('DELETE', `/admin/invites/${inviteId}`);
  }

  // ─── Devices ──────────────────
  getDevices() {
    return this.request('GET', '/admin/devices');
  }

  blockDevice(deviceId, blocked) {
    return this.request('POST', '/admin/block-device', { device_id: deviceId, blocked });
  }

  deleteDevice(deviceId) {
    return this.request('DELETE', `/admin/devices/${deviceId}`);
  }

  renameDevice(deviceId, newName) {
    return this.request('POST', '/admin/rename-device', { device_id: deviceId, new_name: newName });
  }

  // ─── Tokens ───────────────────
  allocateTokens(deviceId, tokens, fromDeviceId = null, reason = '') {
    return this.request('POST', '/admin/allocate', {
      device_id: deviceId,
      tokens,
      from_device_id: fromDeviceId,
      reason,
    });
  }

  setAllocation(deviceId, allocatedTokens) {
    return this.request('POST', '/admin/set-allocation', {
      device_id: deviceId,
      allocated_tokens: allocatedTokens,
    });
  }

  resetMonthly(defaultTokens = 50) {
    return this.request('POST', '/admin/reset-monthly', { default_tokens: defaultTokens });
  }

  // ─── Usage ────────────────────
  getUsageLogs(deviceId = null, limit = 100) {
    let query = `/admin/usage-logs?limit=${limit}`;
    if (deviceId) { query += `&device_id=${deviceId}`; }
    return this.request('GET', query);
  }

  getTransfers() {
    return this.request('GET', '/admin/transfers');
  }

  getModels() {
    return this.request('GET', '/usage/models');
  }

  // ─── Settings ─────────────────
  updateSettings(settings) {
    return this.request('PUT', '/admin/settings', { settings });
  }

  // ─── Health ───────────────────
  healthCheck() {
    return this.request('GET', '/health');
  }
}

export const api = new Api();
