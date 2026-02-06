// In dev, Vite proxies /api → localhost:3000
// In production (Vercel), VITE_API_URL must point to the deployed backend
const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api';

class Api {
  constructor() {
    this.token = localStorage.getItem('tt_token') || null;
    this.user = JSON.parse(localStorage.getItem('tt_user') || 'null');
  }

  setAuth(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('tt_token', token);
    localStorage.setItem('tt_user', JSON.stringify(user));
  }

  clearAuth() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('tt_token');
    localStorage.removeItem('tt_user');
    localStorage.removeItem('admin_token');
  }

  isAuthenticated() {
    return !!this.token;
  }

  getUser() {
    return this.user;
  }

  isAdmin() {
    return this.user?.role === 'admin';
  }

  getGitHubLoginUrl() {
    return `${API_BASE}/auth/github/login`;
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
        this.clearAuth();
        window.location.href = '/login';
      }
      throw new Error(data.error || 'Request failed');
    }

    return data;
  }

  // ─── Auth ─────────────────────
  register(email, password, display_name, invite_token) {
    return this.request('POST', '/auth/register', { email, password, display_name, invite_token });
  }

  login(email, password) {
    return this.request('POST', '/auth/login', { email, password });
  }

  adminLogin(username, password) {
    return this.request('POST', '/admin/login', { username, password });
  }

  // ─── User Dashboard ──────────
  getUserDashboard() {
    return this.request('GET', '/user/dashboard');
  }

  generateTokenKey(label, allocated_tokens, expires_days) {
    return this.request('POST', '/user/generate-key', { label, allocated_tokens, expires_days });
  }

  deleteTokenKey(keyId) {
    return this.request('DELETE', `/user/keys/${keyId}`);
  }

  setDeviceAllocation(deviceId, allocated_tokens) {
    return this.request('PUT', `/user/devices/${deviceId}/allocation`, { allocated_tokens });
  }

  blockDevice(deviceId, blocked) {
    return this.request('PUT', `/user/devices/${deviceId}/block`, { blocked });
  }

  renameDevice(deviceId, name) {
    return this.request('PUT', `/user/devices/${deviceId}/rename`, { name });
  }

  deleteDevice(deviceId) {
    return this.request('DELETE', `/user/devices/${deviceId}`);
  }

  getDeviceHistory(deviceId) {
    return this.request('GET', `/user/devices/${deviceId}/history`);
  }

  // ─── Admin (for admin role users) ────
  getAdminDashboard() {
    return this.request('GET', '/admin/dashboard');
  }

  getAdminUsers() {
    return this.request('GET', '/admin/users');
  }

  updateUser(userId, updates) {
    return this.request('PUT', `/admin/users/${userId}`, updates);
  }

  deleteUser(userId) {
    return this.request('DELETE', `/admin/users/${userId}`);
  }

  getInvites() {
    return this.request('GET', '/admin/invites');
  }

  createInvite(monthlyBudget = 50, maxDevices = 3, expiresInDays = 30) {
    return this.request('POST', '/admin/invites', {
      monthly_budget: monthlyBudget,
      max_devices: maxDevices,
      expires_days: expiresInDays,
    });
  }

  deleteInvite(inviteId) {
    return this.request('DELETE', `/admin/invites/${inviteId}`);
  }

  updateSettings(settings) {
    return this.request('PUT', '/admin/settings', { settings });
  }

  // ─── Health ───────────────────
  healthCheck() {
    return this.request('GET', '/health');
  }

  getModels() {
    return this.request('GET', '/usage/models');
  }
}

export const api = new Api();
