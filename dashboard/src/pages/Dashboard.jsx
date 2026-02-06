import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { DeviceCard } from '../components/DeviceCard';
import { ProgressBar } from '../components/ProgressBar';
import { ThemeToggle } from '../App';
import {
  SetAllocationModal,
  RenameModal,
  HistoryModal,
  ConfirmModal,
} from '../components/Modals';

function formatNumber(n) {
  if (n == null) return '0';
  return n.toLocaleString();
}

function relativeTime(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function Dashboard({ onLogout }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const [keyLabel, setKeyLabel] = useState('');
  const [keyTokens, setKeyTokens] = useState('50');
  const [keyExpiry, setKeyExpiry] = useState('30');
  const [keyLoading, setKeyLoading] = useState(false);
  const [generatedKey, setGeneratedKey] = useState(null);

  const [adminData, setAdminData] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [busyDevices, setBusyDevices] = useState(new Set());
  const [busyKeys, setBusyKeys] = useState(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentUser = api.getUser();
  const isAdmin = api.isAdmin();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Data fetching ──────────────────────────────────────────
  const fetchDashboard = useCallback(async () => {
    try {
      const res = await api.getUserDashboard();
      if (mountedRef.current) { setData(res); setInitialLoading(false); }
    } catch {
      if (mountedRef.current) { setInitialLoading(false); toast.error('Failed to load dashboard'); }
    }
  }, [toast]);

  const fetchAdminData = useCallback(async () => {
    setAdminLoading(true);
    try {
      const res = await api.getAdminDashboard();
      if (mountedRef.current) setAdminData(res);
    } catch { toast.error('Admin dashboard error'); }
    finally { if (mountedRef.current) setAdminLoading(false); }
  }, [toast]);

  useEffect(() => { fetchDashboard(); const i = setInterval(fetchDashboard, 30000); return () => clearInterval(i); }, [fetchDashboard]);
  useEffect(() => { if (activeTab === 'admin' && isAdmin) fetchAdminData(); }, [activeTab, isAdmin, fetchAdminData]);

  const syncAfterMutation = () => setTimeout(fetchDashboard, 300);
  const markDeviceBusy = (id, busy) => setBusyDevices(p => { const s = new Set(p); busy ? s.add(id) : s.delete(id); return s; });
  const markKeyBusy = (id, busy) => setBusyKeys(p => { const s = new Set(p); busy ? s.add(id) : s.delete(id); return s; });

  // ── Token Key Actions ──────────────────────────────────────
  const handleGenerateKey = async () => {
    setKeyLoading(true); setGeneratedKey(null);
    try {
      const res = await api.generateTokenKey(keyLabel.trim() || 'Device Key', parseInt(keyTokens) || 50, parseInt(keyExpiry) || 30);
      setGeneratedKey(res.key?.token_key || res.token_key);
      toast.success('Token key generated'); setKeyLabel(''); syncAfterMutation();
    } catch (err) { toast.error(err.message); }
    finally { setKeyLoading(false); }
  };

  const handleDeleteKey = async (keyId) => {
    markKeyBusy(keyId, true);
    try {
      setData(p => p ? { ...p, token_keys: (p.token_keys || []).filter(k => k.id !== keyId) } : p);
      await api.deleteTokenKey(keyId); toast.success('Token key deleted'); syncAfterMutation();
    } catch (err) { toast.error(err.message); fetchDashboard(); }
    finally { markKeyBusy(keyId, false); }
  };

  const copyToClipboard = (text) => { navigator.clipboard.writeText(text); toast.success('Copied to clipboard'); };

  // ── Device Actions ─────────────────────────────────────────
  const handleBlock = async (deviceId, blocked) => {
    markDeviceBusy(deviceId, true);
    try {
      setData(p => p ? { ...p, devices: (p.devices || []).map(d => d.id === deviceId ? { ...d, is_blocked: blocked } : d) } : p);
      await api.blockDevice(deviceId, blocked); toast.success(blocked ? 'Device blocked' : 'Device unblocked'); syncAfterMutation();
    } catch (err) { toast.error(err.message); fetchDashboard(); }
    finally { markDeviceBusy(deviceId, false); }
  };

  const handleSetAllocation = async (deviceId, tokens) => {
    markDeviceBusy(deviceId, true);
    try {
      setData(p => p ? { ...p, devices: (p.devices || []).map(d => d.id === deviceId ? { ...d, allocation: { ...d.allocation, allocated: tokens, remaining: tokens - d.allocation.used } } : d) } : p);
      await api.setDeviceAllocation(deviceId, tokens); toast.success('Allocation updated'); setModal(null); syncAfterMutation();
    } catch (err) { toast.error(err.message); fetchDashboard(); }
    finally { markDeviceBusy(deviceId, false); }
  };

  const handleRename = async (deviceId, newName) => {
    markDeviceBusy(deviceId, true);
    try {
      setData(p => p ? { ...p, devices: (p.devices || []).map(d => d.id === deviceId ? { ...d, name: newName } : d) } : p);
      await api.renameDevice(deviceId, newName); toast.success('Device renamed'); setModal(null); syncAfterMutation();
    } catch (err) { toast.error(err.message); fetchDashboard(); }
    finally { markDeviceBusy(deviceId, false); }
  };

  const handleDeleteDevice = async (device) => {
    markDeviceBusy(device.id, true);
    try {
      setData(p => p ? { ...p, devices: (p.devices || []).filter(d => d.id !== device.id) } : p);
      await api.deleteDevice(device.id); toast.success(`${device.name} deleted`); setModal(null); syncAfterMutation();
    } catch (err) { toast.error(err.message); fetchDashboard(); }
    finally { markDeviceBusy(device.id, false); }
  };

  const handleViewHistory = async (device) => {
    try { const res = await api.getDeviceHistory(device.id); setModal({ type: 'history', device, logs: res.logs || [] }); }
    catch { toast.error('Failed to load history'); }
  };

  // ── Admin Actions ──────────────────────────────────────────
  const handleUpdateUser = async (userId, updates) => {
    try { await api.updateUser(userId, updates); toast.success('User updated'); setModal(null); fetchAdminData(); }
    catch (err) { toast.error(err.message); }
  };

  const handleDeleteUser = async (user) => {
    try {
      setAdminData(p => p ? { ...p, users: { ...p.users, count: (p.users?.count || 1) - 1, list: (p.users?.list || []).filter(u => u.id !== user.id) } } : p);
      await api.deleteUser(user.id); toast.success(`User ${user.email} deleted`); setModal(null); fetchAdminData();
    } catch (err) { toast.error(err.message); fetchAdminData(); }
  };

  // ── Derived ────────────────────────────────────────────────
  const { user, devices = [], token_keys = [], summary = {} } = data || {};
  const budgetPct = summary.total_budget > 0 ? Math.round((summary.total_used / summary.total_budget) * 100) : 0;
  const activeDevices = devices.filter(d => !d.is_blocked).length;
  const blockedDevices = devices.filter(d => d.is_blocked).length;
  const usedKeys = (token_keys || []).filter(k => k.is_used).length;
  const availableKeys = (token_keys || []).filter(k => !k.is_used && new Date(k.expires_at) >= new Date()).length;

  const tabs = useMemo(() => {
    const t = [
      { key: 'overview', label: 'Overview', icon: '◎' },
      { key: 'devices', label: 'Devices', icon: '◈', count: devices.length },
      { key: 'keys', label: 'Token Keys', icon: '⬡', count: token_keys?.length },
    ];
    if (isAdmin) t.push({ key: 'admin', label: 'Admin', icon: '⛊' });
    return t;
  }, [devices.length, token_keys?.length, isAdmin]);

  // ── Skeleton ───────────────────────────────────────────────
  if (initialLoading && !data) {
    return (
      <div className="dashboard-layout">
        <aside className="sidebar">
          <div className="sidebar-brand"><div className="sidebar-logo">⚡</div><span className="sidebar-brand-text">Token Tracker</span></div>
        </aside>
        <main className="dashboard-main">
          <div className="dashboard-topbar"><div className="skeleton-line" style={{ width: 200, height: 20 }} /><div className="skeleton-line" style={{ width: 120, height: 32, borderRadius: 8 }} /></div>
          <div className="dashboard-content">
            <div className="stats-grid">{[1, 2, 3, 4].map(i => <div key={i} className="stat-card" style={{ minHeight: 120 }}><div className="skeleton-line" style={{ width: '50%', height: 12, marginBottom: 16 }} /><div className="skeleton-line" style={{ width: '60%', height: 36, marginBottom: 10 }} /><div className="skeleton-line" style={{ width: '40%', height: 10 }} /></div>)}</div>
            <div className="card" style={{ marginBottom: 24 }}><div className="skeleton-line" style={{ width: '100%', height: 10, borderRadius: 99 }} /></div>
          </div>
        </main>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="dashboard-layout">
      {/* ── Sidebar ── */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">⚡</div>
          <span className="sidebar-brand-text">Token Tracker</span>
        </div>

        <nav className="sidebar-nav">
          {tabs.map(tab => (
            <button key={tab.key} className={`sidebar-link${activeTab === tab.key ? ' active' : ''}`} onClick={() => { setActiveTab(tab.key); setSidebarOpen(false); }}>
              <span className="sidebar-link-icon">{tab.icon}</span>
              <span className="sidebar-link-label">{tab.label}</span>
              {tab.count != null && <span className="sidebar-link-count">{tab.count}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            {user?.avatar_url && <img src={user.avatar_url} alt="" className="sidebar-avatar" />}
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.display_name || user?.email?.split('@')[0]}</div>
              <div className="sidebar-user-role">{isAdmin ? 'Administrator' : 'User'}</div>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <ThemeToggle />
            <button className="btn btn-sm btn-ghost" onClick={onLogout} title="Sign out">⏻</button>
          </div>
        </div>
      </aside>

      {/* Mobile hamburger */}
      <button className="mobile-menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* ── Main ── */}
      <main className="dashboard-main">
        <div className="dashboard-topbar">
          <div>
            <h1 className="page-title">
              {activeTab === 'overview' && 'Dashboard'}
              {activeTab === 'devices' && 'Devices'}
              {activeTab === 'keys' && 'Token Keys'}
              {activeTab === 'admin' && 'Admin Panel'}
            </h1>
            <p className="page-subtitle">
              {summary.month || new Date().toLocaleString('en', { month: 'long', year: 'numeric' })}
              <span className="topbar-status"><span className="topbar-pulse" /> Live</span>
            </p>
          </div>
          <div className="topbar-actions">
            <button className="btn btn-sm btn-ghost" onClick={fetchDashboard} title="Refresh">↻ Sync</button>
          </div>
        </div>

        <div className="dashboard-content">
          {/* ══════════════ OVERVIEW ══════════════ */}
          {activeTab === 'overview' && (
            <>
              <div className="stats-grid">
                <StatCard icon="⚡" iconBg="var(--accent-dim)" iconColor="var(--accent)" label="Monthly Budget" value={formatNumber(summary.total_budget || 0)} sub="tokens allocated this cycle" />
                <StatCard icon="▲" iconBg="var(--green-dim)" iconColor="var(--green)" label="Remaining" value={formatNumber(summary.total_remaining || 0)} valueColor="var(--green)" sub="available to use" />
                <StatCard icon="◉" iconBg={budgetPct > 80 ? 'var(--red-dim)' : 'var(--yellow-dim)'} iconColor={budgetPct > 80 ? 'var(--red)' : 'var(--yellow)'} label="Used" value={formatNumber(summary.total_used || 0)} valueColor={budgetPct > 80 ? 'var(--red)' : 'var(--yellow)'} sub={`${budgetPct}% of budget consumed`} />
                <StatCard icon="◈" iconBg="var(--blue-dim)" iconColor="var(--blue)" label="Devices" value={<>{summary.device_count || devices.length}<span className="stat-value-sub"> / {summary.max_devices || '∞'}</span></>} sub={`${activeDevices} active · ${blockedDevices} blocked`} />
              </div>

              <div className="card usage-card">
                <div className="usage-card-header">
                  <h3>Monthly Usage</h3>
                  <span className="usage-card-meta">{formatNumber(summary.total_allocated || 0)} allocated · {formatNumber((summary.total_budget || 0) - (summary.total_allocated || 0))} unallocated</span>
                </div>
                <ProgressBar used={summary.total_used || 0} allocated={summary.total_budget || 0} />
              </div>

              <div className="overview-grid">
                {/* Quick devices */}
                <div className="card">
                  <div className="card-header-row">
                    <h3>Devices</h3>
                    <button className="btn btn-sm btn-ghost" onClick={() => setActiveTab('devices')}>View all →</button>
                  </div>
                  {devices.length === 0 ? (
                    <div className="mini-empty">
                      <p>No devices linked yet.</p>
                      <button className="btn btn-sm btn-primary" onClick={() => setActiveTab('keys')}>Generate a key</button>
                    </div>
                  ) : (
                    <div className="quick-device-list">
                      {devices.slice(0, 4).map(d => {
                        const rem = d.allocation.allocated - d.allocation.used;
                        const pct = d.allocation.allocated > 0 ? Math.round((d.allocation.used / d.allocation.allocated) * 100) : 0;
                        const isActive = d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) < 10 * 60000;
                        return (
                          <div key={d.id} className={`quick-device${d.is_blocked ? ' blocked' : ''}`}>
                            <div className="quick-device-left">
                              <span className={`dot-sm ${d.is_blocked ? 'blocked' : isActive ? 'online' : 'inactive'}`} />
                              <div><div className="quick-device-name">{d.name}</div><div className="quick-device-meta">{relativeTime(d.last_seen)}</div></div>
                            </div>
                            <div className="quick-device-right">
                              <div className="mini-bar"><div className={`mini-bar-fill${pct >= 90 ? ' danger' : pct >= 70 ? ' warning' : ''}`} style={{ width: `${Math.max(pct, 2)}%` }} /></div>
                              <span className="quick-device-tokens">{rem} left</span>
                            </div>
                          </div>
                        );
                      })}
                      {devices.length > 4 && <button className="btn btn-sm btn-ghost" onClick={() => setActiveTab('devices')} style={{ width: '100%', marginTop: 8 }}>+{devices.length - 4} more</button>}
                    </div>
                  )}
                </div>

                {/* Quick keys */}
                <div className="card">
                  <div className="card-header-row">
                    <h3>Token Keys</h3>
                    <button className="btn btn-sm btn-ghost" onClick={() => setActiveTab('keys')}>Manage →</button>
                  </div>
                  <div className="key-stats-row">
                    <div className="key-stat"><div className="key-stat-value">{token_keys?.length || 0}</div><div className="key-stat-label">Total</div></div>
                    <div className="key-stat"><div className="key-stat-value" style={{ color: 'var(--green)' }}>{availableKeys}</div><div className="key-stat-label">Available</div></div>
                    <div className="key-stat"><div className="key-stat-value" style={{ color: 'var(--blue)' }}>{usedKeys}</div><div className="key-stat-label">Redeemed</div></div>
                  </div>
                  <button className="btn btn-primary" onClick={() => setActiveTab('keys')} style={{ width: '100%', marginTop: 16 }}>Generate New Key</button>
                </div>
              </div>

              {/* Model costs (compact) */}
              <div className="card model-costs-card">
                <h3>Model Token Costs</h3>
                <div className="model-costs-grid">
                  <CostRow label="Claude Opus 4.5" cost="3" color="var(--purple)" />
                  <CostRow label="GPT-4 / Claude Sonnet / Gemini" cost="1" color="var(--blue)" />
                  <CostRow label="GPT-4o-mini / Grok" cost="Free" color="var(--green)" />
                </div>
              </div>

              {devices.length === 0 && (
                <div className="card onboarding-card">
                  <h3>Getting Started</h3>
                  <p className="onboarding-subtitle">Link your first device in 3 steps</p>
                  <div className="onboarding-steps">
                    {[
                      { n: '1', title: 'Generate a Token Key', desc: 'Go to Token Keys and create a key with your desired token allocation.' },
                      { n: '2', title: 'Install the VS Code Extension', desc: 'Search "Token Tracker" in the VS Code marketplace and install it.' },
                      { n: '3', title: 'Paste the Key', desc: 'Run "Token Tracker: Enter Token Key" from the command palette and paste your key.' },
                    ].map(s => (
                      <div key={s.n} className="onboarding-step">
                        <div className="onboarding-step-num">{s.n}</div>
                        <div><strong>{s.title}</strong><p>{s.desc}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══════════════ DEVICES ══════════════ */}
          {activeTab === 'devices' && (
            <>
              <div className="section-header">
                <div>
                  <h2>All Devices</h2>
                  <p className="section-description">{devices.length} device{devices.length !== 1 ? 's' : ''} linked to your account</p>
                </div>
                <button className="btn btn-primary" onClick={() => setActiveTab('keys')}>+ New Device</button>
              </div>

              {devices.length === 0 ? (
                <div className="card empty-state-card">
                  <div className="empty-icon">◈</div>
                  <h3>No devices linked</h3>
                  <p>Generate a Token Key and paste it in the VS Code extension to link your first device.</p>
                  <button className="btn btn-primary" onClick={() => setActiveTab('keys')} style={{ marginTop: 16 }}>Generate Token Key</button>
                </div>
              ) : (
                <div className="devices-grid">
                  {devices.map(device => (
                    <DeviceCard key={device.id} device={device} busy={busyDevices.has(device.id)}
                      onBlock={handleBlock}
                      onTransfer={d => setModal({ type: 'setAlloc', device: d })}
                      onSetAlloc={d => setModal({ type: 'setAlloc', device: d })}
                      onRename={d => setModal({ type: 'rename', device: d })}
                      onViewHistory={handleViewHistory}
                      onDelete={d => setModal({ type: 'confirmDelete', device: d })}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ══════════════ TOKEN KEYS ══════════════ */}
          {activeTab === 'keys' && (
            <>
              <div className="section-header">
                <div>
                  <h2>Token Keys</h2>
                  <p className="section-description">Generate keys to link devices to your account</p>
                </div>
              </div>

              <div className="card generate-card">
                <h3>Generate New Key</h3>
                <p className="card-description">Create a key and share it with a device. Paste the key in the VS Code extension to link it.</p>
                <div className="generate-form">
                  <div className="form-group"><label className="form-label">Label</label><input type="text" className="form-input" value={keyLabel} onChange={e => setKeyLabel(e.target.value)} placeholder="e.g. Work Laptop" /></div>
                  <div className="form-group"><label className="form-label">Tokens</label><input type="number" className="form-input" value={keyTokens} onChange={e => setKeyTokens(e.target.value)} min="1" max={user?.monthly_token_budget || 500} /></div>
                  <div className="form-group"><label className="form-label">Expires (days)</label><input type="number" className="form-input" value={keyExpiry} onChange={e => setKeyExpiry(e.target.value)} min="1" max="365" /></div>
                  <button className="btn btn-primary generate-btn" onClick={handleGenerateKey} disabled={keyLoading}>{keyLoading ? <span className="spinner" /> : 'Generate Key'}</button>
                </div>

                {generatedKey && (
                  <div className="generated-key-result">
                    <div className="generated-key-header"><span>Key Generated Successfully</span><button className="btn btn-sm btn-success" onClick={() => copyToClipboard(generatedKey)}>Copy</button></div>
                    <code className="generated-key-code" onClick={() => copyToClipboard(generatedKey)}>{generatedKey}</code>
                    <p className="generated-key-note">Copy this key now — it won't be shown again.</p>
                  </div>
                )}
              </div>

              {token_keys && token_keys.length > 0 ? (
                <div className="card table-card">
                  <div className="table-wrapper">
                    <table>
                      <thead><tr><th>Key</th><th>Label</th><th>Tokens</th><th>Status</th><th>Expires</th><th style={{ width: 80 }}>Actions</th></tr></thead>
                      <tbody>
                        {token_keys.map(tk => {
                          const tkKey = tk.token_key || tk.key || '';
                          const isExpired = new Date(tk.expires_at) < new Date();
                          return (
                            <tr key={tk.id} className={busyKeys.has(tk.id) ? 'row-busy' : ''}>
                              <td><code className="key-code" onClick={() => copyToClipboard(tkKey)} title="Click to copy">{tkKey.substring(0, 18)}…</code></td>
                              <td className="cell-label">{tk.label}</td>
                              <td>{tk.allocated_tokens}</td>
                              <td>{tk.is_used ? <span className="badge green">Redeemed</span> : isExpired ? <span className="badge red">Expired</span> : <span className="badge cyan">Available</span>}</td>
                              <td className="cell-date">{new Date(tk.expires_at).toLocaleDateString()}</td>
                              <td>
                                <div className="cell-actions">
                                  {!tk.is_used && !isExpired && <button className="btn btn-sm btn-ghost" onClick={() => copyToClipboard(tkKey)} title="Copy">Copy</button>}
                                  <button className="btn btn-sm btn-ghost btn-danger-ghost" onClick={() => handleDeleteKey(tk.id)} title="Delete">✕</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="card empty-state-card"><div className="empty-icon">⬡</div><h3>No keys yet</h3><p>Generate a key above to get started.</p></div>
              )}
            </>
          )}

          {/* ══════════════ ADMIN ══════════════ */}
          {activeTab === 'admin' && isAdmin && (
            <>
              <div className="section-header">
                <div><h2>Admin Panel</h2><p className="section-description">Platform-wide management</p></div>
                <button className="btn btn-sm" onClick={fetchAdminData} disabled={adminLoading}>{adminLoading ? <span className="spinner" /> : '↻ Refresh'}</button>
              </div>

              {adminLoading && !adminData ? (
                <div className="card empty-state-card"><div className="spinner" style={{ width: 24, height: 24, margin: '0 auto 12px' }} /><p>Loading admin data…</p></div>
              ) : adminData ? (
                <>
                  <div className="stats-grid">
                    <StatCard icon="⚡" iconBg="var(--accent-dim)" iconColor="var(--accent)" label="Platform Budget" value={formatNumber(adminData.budget?.total || 0)} />
                    <StatCard icon="○" iconBg="var(--blue-dim)" iconColor="var(--blue)" label="Users" value={adminData.users?.count || 0} />
                    <StatCard icon="◈" iconBg="var(--purple-dim)" iconColor="var(--purple)" label="Devices" value={adminData.devices?.count || 0} />
                    <StatCard icon="◉" iconBg="var(--red-dim)" iconColor="var(--red)" label="Total Used" value={formatNumber(adminData.budget?.used || 0)} />
                  </div>

                  <div className="card table-card">
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}><h3 style={{ fontSize: 14 }}>All Users</h3></div>
                    <div className="table-wrapper">
                      <table>
                        <thead><tr><th>User</th><th>Role</th><th>Budget</th><th>Used</th><th>Devices</th><th>Status</th><th>Actions</th></tr></thead>
                        <tbody>
                          {(adminData.users?.list || []).map(u => {
                            const devCount = u.devices?.length || u.device_count || 0;
                            const totalUsed = u.total_used || u.devices?.reduce((s, d) => s + (d.allocation?.used || 0), 0) || 0;
                            return (
                              <tr key={u.id}>
                                <td>
                                  <div className="user-cell">
                                    {u.avatar_url && <img src={u.avatar_url} alt="" className="user-cell-avatar" />}
                                    <div><div className="user-cell-name">{u.display_name || u.email.split('@')[0]}</div><div className="user-cell-email">{u.email}</div></div>
                                  </div>
                                </td>
                                <td><span className={`badge ${u.role === 'admin' ? 'purple' : 'cyan'}`}>{u.role}</span></td>
                                <td>{u.monthly_token_budget}</td>
                                <td style={{ color: totalUsed > u.monthly_token_budget * 0.8 ? 'var(--red)' : 'var(--text)' }}>{totalUsed}</td>
                                <td>{devCount}</td>
                                <td>{u.is_active ? <span className="badge green">Active</span> : <span className="badge red">Disabled</span>}</td>
                                <td>
                                  <div className="cell-actions">
                                    <button className="btn btn-sm btn-ghost" onClick={() => setModal({ type: 'editUser', user: u })}>Edit</button>
                                    <button className="btn btn-sm btn-ghost" onClick={() => handleUpdateUser(u.id, { is_active: !u.is_active })}>{u.is_active ? 'Disable' : 'Enable'}</button>
                                    <button className="btn btn-sm btn-ghost btn-danger-ghost" onClick={() => setModal({ type: 'confirmDeleteUser', user: u })}>✕</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </>
          )}

          <footer className="dashboard-footer">
            <span>Token Tracker v2.0</span>
            <span className="footer-sep">·</span>
            <span>Global Copilot Usage Management</span>
          </footer>
        </div>
      </main>

      {/* ── Modals ── */}
      {modal?.type === 'setAlloc' && modal.device && <SetAllocationModal device={modal.device} onClose={() => setModal(null)} onSet={handleSetAllocation} />}
      {modal?.type === 'rename' && modal.device && <RenameModal device={modal.device} onClose={() => setModal(null)} onRename={handleRename} />}
      {modal?.type === 'history' && modal.device && <HistoryModal device={modal.device} logs={modal.logs} onClose={() => setModal(null)} />}
      {modal?.type === 'confirmDelete' && modal.device && <ConfirmModal title="Delete Device" message={`Delete "${modal.device.name}"? All usage data will be removed permanently.`} confirmLabel="Delete" danger onClose={() => setModal(null)} onConfirm={() => handleDeleteDevice(modal.device)} />}
      {modal?.type === 'editUser' && modal.user && <EditUserModal user={modal.user} onClose={() => setModal(null)} onSave={handleUpdateUser} />}
      {modal?.type === 'confirmDeleteUser' && modal.user && <ConfirmModal title="Delete User" message={`Delete "${modal.user.email}"? This cannot be undone.`} confirmLabel="Delete User" danger onClose={() => setModal(null)} onConfirm={() => handleDeleteUser(modal.user)} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════ */

function StatCard({ icon, iconBg, iconColor, label, value, valueColor, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-card-header">
        <span className="stat-icon" style={{ background: iconBg, color: iconColor }}>{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function CostRow({ label, cost, color }) {
  return (
    <div className="model-cost-row">
      <span className="model-cost-dot" style={{ background: color }} />
      <span className="model-cost-label">{label}</span>
      <span className="model-cost-value" style={{ color }}>{cost === 'Free' ? 'Free' : `${cost} tok`}</span>
    </div>
  );
}

function EditUserModal({ user, onClose, onSave }) {
  const [budget, setBudget] = useState(user.monthly_token_budget?.toString() || '50');
  const [maxDevices, setMaxDevices] = useState(user.max_devices?.toString() || '3');
  const [role, setRole] = useState(user.role || 'user');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try { await onSave(user.id, { monthly_token_budget: parseInt(budget), max_devices: parseInt(maxDevices), role }); }
    finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header"><h3>Edit User</h3><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>{user.email}</p>
          <div className="form-group">
            <label className="form-label">Monthly Token Budget</label>
            <input type="number" className="form-input" value={budget} onChange={e => setBudget(e.target.value)} min="0" max="500" />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>{[10, 25, 50, 100, 200].map(v => <button key={v} className="btn btn-sm" onClick={() => setBudget(v.toString())}>{v}</button>)}</div>
          </div>
          <div className="form-group"><label className="form-label">Max Devices</label><input type="number" className="form-input" value={maxDevices} onChange={e => setMaxDevices(e.target.value)} min="1" max="20" /></div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select" value={role} onChange={e => setRole(e.target.value)}><option value="user">User</option><option value="admin">Admin</option></select>
          </div>
        </div>
        <div className="modal-footer"><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>{loading ? <span className="spinner" /> : 'Save'}</button></div>
      </div>
    </div>
  );
}
