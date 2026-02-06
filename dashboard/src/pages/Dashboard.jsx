import { useState, useEffect, useCallback, useRef } from 'react';
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

export default function Dashboard({ onLogout }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('devices');

  // Token key generation
  const [keyLabel, setKeyLabel] = useState('');
  const [keyTokens, setKeyTokens] = useState('50');
  const [keyExpiry, setKeyExpiry] = useState('30');
  const [keyLoading, setKeyLoading] = useState(false);
  const [generatedKey, setGeneratedKey] = useState(null);

  // Admin state
  const [adminData, setAdminData] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);

  // Modals
  const [modal, setModal] = useState(null);

  // Per-action loading states — track which items are being mutated
  const [busyDevices, setBusyDevices] = useState(new Set());
  const [busyKeys, setBusyKeys] = useState(new Set());

  const currentUser = api.getUser();
  const isAdmin = api.isAdmin();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ─── Load User Dashboard (silent — never shows a full-page loader after first load) ─────
  const fetchDashboard = useCallback(async () => {
    try {
      const res = await api.getUserDashboard();
      if (mountedRef.current) {
        setData(res);
        setInitialLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setInitialLoading(false);
        toast.error('Failed to load dashboard: ' + err.message);
      }
    }
  }, [toast]);

  const fetchAdminData = useCallback(async () => {
    setAdminLoading(true);
    try {
      const res = await api.getAdminDashboard();
      if (mountedRef.current) setAdminData(res);
    } catch (err) {
      toast.error('Admin dashboard error: ' + err.message);
    } finally {
      if (mountedRef.current) setAdminLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  useEffect(() => {
    if (activeTab === 'admin' && isAdmin) {
      fetchAdminData();
    }
  }, [activeTab, isAdmin, fetchAdminData]);

  // ─── Helpers ───────────────────
  /** Background sync after any mutation — don't touch UI until data arrives */
  const syncAfterMutation = () => {
    // Small delay to let DB propagate, then silently refetch
    setTimeout(fetchDashboard, 300);
  };

  const markDeviceBusy = (id, busy) => {
    setBusyDevices(prev => {
      const next = new Set(prev);
      busy ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const markKeyBusy = (id, busy) => {
    setBusyKeys(prev => {
      const next = new Set(prev);
      busy ? next.add(id) : next.delete(id);
      return next;
    });
  };

  // ─── Token Key Actions ────────────────
  const handleGenerateKey = async () => {
    setKeyLoading(true);
    setGeneratedKey(null);
    try {
      const res = await api.generateTokenKey(
        keyLabel.trim() || 'Device Key',
        parseInt(keyTokens) || 50,
        parseInt(keyExpiry) || 30
      );
      setGeneratedKey(res.key?.token_key || res.token_key);
      toast.success('Token key generated!');
      setKeyLabel('');
      syncAfterMutation();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setKeyLoading(false);
    }
  };

  const handleDeleteKey = async (keyId) => {
    markKeyBusy(keyId, true);
    try {
      // Optimistic: remove key from UI immediately
      setData(prev => prev ? {
        ...prev,
        token_keys: (prev.token_keys || []).filter(k => k.id !== keyId),
      } : prev);
      await api.deleteTokenKey(keyId);
      toast.success('Token key deleted');
      syncAfterMutation();
    } catch (err) {
      toast.error(err.message);
      fetchDashboard(); // rollback
    } finally {
      markKeyBusy(keyId, false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
    // NO refetch — just a clipboard action
  };

  // ─── Device Actions ───────────────────
  const handleBlock = async (deviceId, blocked) => {
    markDeviceBusy(deviceId, true);
    try {
      // Optimistic: update device card immediately
      setData(prev => prev ? {
        ...prev,
        devices: (prev.devices || []).map(d =>
          d.id === deviceId ? { ...d, is_blocked: blocked } : d
        ),
      } : prev);
      await api.blockDevice(deviceId, blocked);
      toast.success(blocked ? 'Device blocked' : 'Device unblocked');
      syncAfterMutation();
    } catch (err) {
      toast.error(err.message);
      fetchDashboard(); // rollback
    } finally {
      markDeviceBusy(deviceId, false);
    }
  };

  const handleSetAllocation = async (deviceId, tokens) => {
    markDeviceBusy(deviceId, true);
    try {
      // Optimistic
      setData(prev => prev ? {
        ...prev,
        devices: (prev.devices || []).map(d =>
          d.id === deviceId ? {
            ...d,
            allocation: { ...d.allocation, allocated: tokens, remaining: tokens - d.allocation.used },
          } : d
        ),
      } : prev);
      await api.setDeviceAllocation(deviceId, tokens);
      toast.success('Allocation updated');
      setModal(null);
      syncAfterMutation();
    } catch (err) {
      toast.error(err.message);
      fetchDashboard();
    } finally {
      markDeviceBusy(deviceId, false);
    }
  };

  const handleRename = async (deviceId, newName) => {
    markDeviceBusy(deviceId, true);
    try {
      // Optimistic
      setData(prev => prev ? {
        ...prev,
        devices: (prev.devices || []).map(d =>
          d.id === deviceId ? { ...d, name: newName } : d
        ),
      } : prev);
      await api.renameDevice(deviceId, newName);
      toast.success('Device renamed');
      setModal(null);
      syncAfterMutation();
    } catch (err) {
      toast.error(err.message);
      fetchDashboard();
    } finally {
      markDeviceBusy(deviceId, false);
    }
  };

  const handleDeleteDevice = async (device) => {
    markDeviceBusy(device.id, true);
    try {
      // Optimistic
      setData(prev => prev ? {
        ...prev,
        devices: (prev.devices || []).filter(d => d.id !== device.id),
      } : prev);
      await api.deleteDevice(device.id);
      toast.success(`${device.name} deleted`);
      setModal(null);
      syncAfterMutation();
    } catch (err) {
      toast.error(err.message);
      fetchDashboard();
    } finally {
      markDeviceBusy(device.id, false);
    }
  };

  const handleViewHistory = async (device) => {
    try {
      const res = await api.getDeviceHistory(device.id);
      setModal({ type: 'history', device, logs: res.logs || [] });
    } catch (err) {
      toast.error('Failed to load history');
    }
  };

  // ─── Admin Actions ────────────────────
  const handleUpdateUser = async (userId, updates) => {
    try {
      await api.updateUser(userId, updates);
      toast.success('User updated');
      setModal(null);
      fetchAdminData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteUser = async (user) => {
    try {
      // Optimistic
      setAdminData(prev => prev ? {
        ...prev,
        users: {
          ...prev.users,
          count: (prev.users?.count || 1) - 1,
          list: (prev.users?.list || []).filter(u => u.id !== user.id),
        },
      } : prev);
      await api.deleteUser(user.id);
      toast.success(`User ${user.email} deleted`);
      setModal(null);
      fetchAdminData();
    } catch (err) {
      toast.error(err.message);
      fetchAdminData(); // rollback
    }
  };

  // ─── Initial Skeleton Loading ──────────
  if (initialLoading && !data) {
    return (
      <>
        <nav className="topnav">
          <div className="topnav-inner">
            <div className="topnav-brand">
              <div className="logo-icon">⚡</div>
              <span className="brand-text">Token Tracker</span>
            </div>
            <div className="topnav-actions">
              <ThemeToggle />
            </div>
          </div>
        </nav>
        <main className="container" style={{ paddingTop: '28px' }}>
          <div className="stats-grid">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="stat-card" style={{ minHeight: 110 }}>
                <div className="skeleton-line" style={{ width: '60%', height: 12, marginBottom: 12 }} />
                <div className="skeleton-line" style={{ width: '40%', height: 32, marginBottom: 8 }} />
                <div className="skeleton-line" style={{ width: '50%', height: 10 }} />
              </div>
            ))}
          </div>
          <div className="card" style={{ marginBottom: 28 }}>
            <div className="skeleton-line" style={{ width: '100%', height: 10, borderRadius: 99 }} />
          </div>
          <div className="devices-grid">
            {[1, 2].map(i => (
              <div key={i} className="device-card" style={{ minHeight: 150 }}>
                <div className="skeleton-line" style={{ width: '70%', height: 14, marginBottom: 16 }} />
                <div className="skeleton-line" style={{ width: '100%', height: 10, borderRadius: 99, marginBottom: 12 }} />
                <div className="skeleton-line" style={{ width: '50%', height: 12 }} />
              </div>
            ))}
          </div>
        </main>
      </>
    );
  }

  const { user, devices = [], token_keys = [], summary = {} } = data;
  const budgetPct = summary.total_budget > 0 ? Math.round((summary.total_used / summary.total_budget) * 100) : 0;

  const tabs = [
    { key: 'devices', label: '⬡ My Devices', count: devices.length },
    { key: 'keys', label: '🔑 Token Keys', count: token_keys?.length },
  ];
  if (isAdmin) {
    tabs.push({ key: 'admin', label: '🛡 Admin Panel' });
  }

  return (
    <>
      {/* ─── Top Nav ─── */}
      <nav className="topnav">
        <div className="topnav-inner">
          <div className="topnav-brand">
            <div className="logo-icon">⚡</div>
            <span className="brand-text">Token Tracker</span>
            <span className="badge cyan" style={{ marginLeft: 4 }}>{summary.month || new Date().toLocaleString('en', { month: 'long', year: 'numeric' })}</span>
          </div>
          <div className="topnav-actions">
            <div className="user-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {user?.avatar_url && (
                <img src={user.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--border)' }} />
              )}
              <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                {user?.display_name || user?.email?.split('@')[0]}
              </span>
              {isAdmin && <span className="badge purple" style={{ fontSize: '9px' }}>ADMIN</span>}
            </div>
            <ThemeToggle />
            <div className="server-status">
              <span className="pulse" />
              LIVE
            </div>
            <button className="btn btn-sm" onClick={fetchDashboard}>
              ↻ Sync
            </button>
            <button className="btn btn-sm btn-danger" onClick={onLogout}>
              ⏻ Logout
            </button>
          </div>
        </div>
      </nav>

      <main className="container" style={{ paddingTop: '28px', paddingBottom: '48px' }}>
        {/* ─── Budget Stats ─── */}
        <div className="stats-grid">
          <div className="stat-card accent">
            <div className="stat-label">Monthly Budget</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{summary.total_budget || 0}</div>
            <div className="stat-sub">tokens / month</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Remaining</div>
            <div className="stat-value" style={{ color: 'var(--green)' }}>{summary.total_remaining || 0}</div>
            <div className="stat-sub">available to use</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-label">Used</div>
            <div className="stat-value" style={{ color: budgetPct > 80 ? 'var(--red)' : 'var(--yellow)' }}>
              {summary.total_used || 0}
            </div>
            <div className="stat-sub">{budgetPct}% consumed</div>
          </div>
          <div className="stat-card red">
            <div className="stat-label">Devices</div>
            <div className="stat-value">
              {summary.device_count || devices.length}
              <span style={{ fontSize: '16px', color: 'var(--text-muted)', fontWeight: 500 }}> / {summary.max_devices || '∞'}</span>
            </div>
            <div className="stat-sub">linked devices</div>
          </div>
        </div>

        {/* ─── Overall Progress ─── */}
        <div className="card" style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontWeight: 700, fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', opacity: 0.8 }}>
              MONTHLY_USAGE_BAR
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {summary.total_allocated || 0} allocated · {(summary.total_budget || 0) - (summary.total_allocated || 0)} unallocated
            </span>
          </div>
          <ProgressBar used={summary.total_used || 0} allocated={summary.total_budget || 0} />
        </div>

        {/* ─── Tab Navigation ─── */}
        <div className="tab-bar" style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`btn btn-sm ${activeTab === tab.key ? 'btn-primary' : ''}`}
              onClick={() => setActiveTab(tab.key)}
              style={{
                borderRadius: '6px 6px 0 0',
                borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                fontWeight: activeTab === tab.key ? 700 : 400,
              }}
            >
              {tab.label}{tab.count != null ? ` (${tab.count})` : ''}
            </button>
          ))}
        </div>

        {/* ─── Tab: My Devices ─── */}
        {activeTab === 'devices' && (
          <>
            <div className="section-header">
              <h2>⬡ My Devices</h2>
              <div className="section-header-actions">
                <button className="btn btn-primary" onClick={() => setActiveTab('keys')}>
                  🔑 Generate Token Key
                </button>
              </div>
            </div>

            {devices.length === 0 ? (
              <div className="card empty-state">
                <div className="icon">📡</div>
                <h3 style={{ marginBottom: '8px', color: 'var(--text)' }}>No devices linked yet</h3>
                <p>Generate a <strong>Token Key</strong> and paste it in the VS Code extension to link a device.</p>
                <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={() => setActiveTab('keys')}>
                  🔑 Generate Your First Key
                </button>
              </div>
            ) : (
              <div className="devices-grid">
                {devices.map(device => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    onBlock={handleBlock}
                    onTransfer={(d) => setModal({ type: 'setAlloc', device: d })}
                    onSetAlloc={(d) => setModal({ type: 'setAlloc', device: d })}
                    onRename={(d) => setModal({ type: 'rename', device: d })}
                    onViewHistory={handleViewHistory}
                    onDelete={(d) => setModal({ type: 'confirmDelete', device: d })}
                  />
                ))}
              </div>
            )}

            {/* How it works */}
            <div className="card" style={{ marginTop: '28px' }}>
              <h3 style={{ fontSize: '14px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginBottom: '16px' }}>
                📋 HOW_IT_WORKS
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                {[
                  { num: '1', title: 'Generate a Token Key', desc: 'Go to Token Keys tab and generate a key with desired token allocation.' },
                  { num: '2', title: 'Paste in VS Code Extension', desc: 'Install the Token Tracker extension, paste the key to link the device.' },
                  { num: '3', title: 'Device Uses Your Tokens', desc: 'The device can use Copilot until the allocated tokens are exhausted.' },
                  { num: '4', title: 'Manage From Here', desc: 'Block, rename, adjust limits, or remove devices anytime from this dashboard.' },
                ].map(step => (
                  <div key={step.num} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                      background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '12px', fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)'
                    }}>{step.num}</div>
                    <div>
                      <strong style={{ fontSize: '13px' }}>{step.title}</strong>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ─── Tab: Token Keys ─── */}
        {activeTab === 'keys' && (
          <>
            <div className="section-header">
              <h2>🔑 Token Keys</h2>
            </div>

            {/* Generate key form */}
            <div className="card" style={{ marginBottom: '20px' }}>
              <h3 style={{ marginBottom: '16px', fontSize: '14px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                GENERATE_TOKEN_KEY
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Generate a key, share it with a device. That device can then paste the key into the VS Code extension to start using your tokens.
              </p>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 2, minWidth: '150px' }}>
                  <label className="form-label">Label (nickname)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={keyLabel}
                    onChange={e => setKeyLabel(e.target.value)}
                    placeholder="e.g. Office Laptop, John's Mac"
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '100px' }}>
                  <label className="form-label">Token Limit</label>
                  <input
                    type="number"
                    className="form-input"
                    value={keyTokens}
                    onChange={e => setKeyTokens(e.target.value)}
                    min="1"
                    max={user?.monthly_token_budget || 500}
                  />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '100px' }}>
                  <label className="form-label">Expiry (days)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={keyExpiry}
                    onChange={e => setKeyExpiry(e.target.value)}
                    min="1"
                    max="365"
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleGenerateKey}
                  disabled={keyLoading}
                  style={{ height: '42px', padding: '0 20px' }}
                >
                  {keyLoading ? <span className="spinner" /> : '🔑 Generate'}
                </button>
              </div>

              {/* Show generated key */}
              {generatedKey && (
                <div style={{
                  marginTop: '16px', padding: '16px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--green-dim)', border: '1px solid rgba(34, 197, 94, 0.3)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--green)' }}>✅ Key Generated — Share this with the device:</span>
                    <button className="btn btn-sm btn-success" onClick={() => copyToClipboard(generatedKey)}>
                      📋 Copy Key
                    </button>
                  </div>
                  <code
                    style={{
                      display: 'block', padding: '12px', borderRadius: 'var(--radius-xs)',
                      background: 'var(--bg-input)', border: '1px solid var(--border)',
                      fontSize: '13px', fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
                      cursor: 'pointer', color: 'var(--accent)'
                    }}
                    onClick={() => copyToClipboard(generatedKey)}
                  >
                    {generatedKey}
                  </code>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                    ⚠ This key will be shown only once. Copy it now and paste it in the VS Code extension's Token Tracker settings.
                  </p>
                </div>
              )}
            </div>

            {/* Keys list */}
            {(!token_keys || token_keys.length === 0) ? (
              <div className="card empty-state">
                <div className="icon">🔑</div>
                <p>No token keys yet. Generate one above to link a device.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Label</th>
                      <th>Tokens</th>
                      <th>Status</th>
                      <th>Expires</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {token_keys.map(tk => {
                      const tkKey = tk.token_key || tk.key || '';
                      const isExpired = new Date(tk.expires_at) < new Date();
                      return (
                        <tr key={tk.id}>
                          <td>
                            <code
                              style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
                              onClick={() => copyToClipboard(tkKey)}
                              title="Click to copy"
                            >
                              {tkKey.substring(0, 20)}…
                            </code>
                          </td>
                          <td>{tk.label}</td>
                          <td>{tk.allocated_tokens}</td>
                          <td>
                            {tk.is_used ? (
                              <span className="badge green">REDEEMED</span>
                            ) : isExpired ? (
                              <span className="badge red">EXPIRED</span>
                            ) : (
                              <span className="badge cyan">AVAILABLE</span>
                            )}
                          </td>
                          <td style={{ fontSize: '12px' }}>
                            {new Date(tk.expires_at).toLocaleDateString()}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {!tk.is_used && !isExpired && (
                                <button className="btn btn-sm" onClick={() => copyToClipboard(tkKey)} title="Copy key">
                                  📋
                                </button>
                              )}
                              <button className="btn btn-sm btn-danger" onClick={() => handleDeleteKey(tk.id)} title="Delete">
                                🗑
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ─── Tab: Admin Panel ─── */}
        {activeTab === 'admin' && isAdmin && (
          <>
            <div className="section-header">
              <h2>🛡 Admin Panel</h2>
              <button className="btn btn-sm" onClick={fetchAdminData} disabled={adminLoading}>
                {adminLoading ? <span className="spinner" /> : '↻ Refresh'}
              </button>
            </div>

            {adminLoading && !adminData ? (
              <div className="card empty-state">
                <div className="spinner" style={{ width: 24, height: 24, margin: '0 auto 10px' }} />
                <p>Loading admin data…</p>
              </div>
            ) : adminData ? (
              <>
                {/* Admin Stats */}
                <div className="stats-grid">
                  <div className="stat-card accent">
                    <div className="stat-label">Platform Budget</div>
                    <div className="stat-value" style={{ color: 'var(--accent)' }}>{adminData.budget?.total || 0}</div>
                  </div>
                  <div className="stat-card green">
                    <div className="stat-label">Total Users</div>
                    <div className="stat-value" style={{ color: 'var(--green)' }}>{adminData.users?.count || 0}</div>
                  </div>
                  <div className="stat-card yellow">
                    <div className="stat-label">Total Devices</div>
                    <div className="stat-value" style={{ color: 'var(--yellow)' }}>{adminData.devices?.count || 0}</div>
                  </div>
                  <div className="stat-card red">
                    <div className="stat-label">Total Used</div>
                    <div className="stat-value" style={{ color: 'var(--red)' }}>{adminData.budget?.used || 0}</div>
                  </div>
                </div>

                {/* Users list */}
                <h3 style={{ marginBottom: '16px', fontSize: '14px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                  ALL_USERS
                </h3>
                <div className="devices-grid">
                  {(adminData.users?.list || []).map(u => (
                    <AdminUserCard
                      key={u.id}
                      user={u}
                      onEdit={(usr) => setModal({ type: 'editUser', user: usr })}
                      onToggleActive={(usr) => handleUpdateUser(usr.id, { is_active: !usr.is_active })}
                      onDelete={(usr) => setModal({ type: 'confirmDeleteUser', user: usr })}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}

        {/* ─── Token Cost Reference ─── */}
        <div className="cost-ref" style={{ marginTop: '32px' }}>
          <h3>⚙ TOKEN_COST_MATRIX</h3>
          <div className="cost-grid">
            <div className="cost-item">
              <span className="cost-dot" style={{ background: 'var(--purple)' }} />
              <span>Claude Opus 4.5</span>
              <span className="cost-val" style={{ color: 'var(--purple)' }}>3 tok</span>
            </div>
            <div className="cost-item">
              <span className="cost-dot" style={{ background: 'var(--blue)' }} />
              <span>GPT-4 / Sonnet / Others</span>
              <span className="cost-val" style={{ color: 'var(--blue)' }}>1 tok</span>
            </div>
            <div className="cost-item">
              <span className="cost-dot" style={{ background: 'var(--green)' }} />
              <span>GPT-5 Mini / Grok Code Fast</span>
              <span className="cost-val" style={{ color: 'var(--green)' }}>FREE</span>
            </div>
          </div>
        </div>

        {/* ─── Footer ─── */}
        <div className="footer-info">
          Token Tracker v2.0 · Global Copilot Usage Management<br />
          <span className="server-url">Powered by Token Tracker</span>
        </div>
      </main>

      {/* ─── Modals ─── */}
      {modal?.type === 'setAlloc' && modal.device && (
        <SetAllocationModal
          device={modal.device}
          onClose={() => setModal(null)}
          onSet={handleSetAllocation}
        />
      )}

      {modal?.type === 'rename' && modal.device && (
        <RenameModal
          device={modal.device}
          onClose={() => setModal(null)}
          onRename={handleRename}
        />
      )}

      {modal?.type === 'history' && modal.device && (
        <HistoryModal
          device={modal.device}
          logs={modal.logs}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'confirmDelete' && modal.device && (
        <ConfirmModal
          title="🗑 Delete Device"
          message={`Are you sure you want to delete "${modal.device.name}"? This will remove all its usage data. This action cannot be undone.`}
          confirmLabel="Delete"
          danger
          onClose={() => setModal(null)}
          onConfirm={() => handleDeleteDevice(modal.device)}
        />
      )}

      {modal?.type === 'editUser' && modal.user && (
        <EditUserModal
          user={modal.user}
          onClose={() => setModal(null)}
          onSave={handleUpdateUser}
        />
      )}

      {modal?.type === 'confirmDeleteUser' && modal.user && (
        <ConfirmModal
          title="🗑 Delete User"
          message={`Are you sure you want to delete user "${modal.user.email}"? This action cannot be undone.`}
          confirmLabel="Delete User"
          danger
          onClose={() => setModal(null)}
          onConfirm={() => handleDeleteUser(modal.user)}
        />
      )}
    </>
  );
}

// ─── Admin User Card ──────────────────────────

function AdminUserCard({ user, onEdit, onToggleActive, onDelete }) {
  const deviceCount = user.devices?.length || user.device_count || 0;
  const totalUsed = user.total_used || user.devices?.reduce((sum, d) => sum + (d.allocation?.used || 0), 0) || 0;

  return (
    <div className={`device-card ${!user.is_active ? 'blocked' : ''}`}>
      <div className="device-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {user.avatar_url && (
            <img src={user.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--border)' }} />
          )}
          <div>
            <div className="device-name">
              <span className={`dot ${user.is_active ? 'online' : 'blocked'}`} />
              {user.display_name || user.email.split('@')[0]}
            </div>
            <div className="device-meta">
              {user.email} · {deviceCount} device{deviceCount !== 1 ? 's' : ''}
              {user.github_username ? ` · @${user.github_username}` : ''}
            </div>
          </div>
        </div>
        <div className="device-actions">
          <span className={`badge ${user.role === 'admin' ? 'purple' : 'cyan'}`}>
            {user.role?.toUpperCase()}
          </span>
          {!user.is_active && <span className="badge red">DISABLED</span>}
        </div>
      </div>

      <div className="token-count" style={{ marginTop: '8px' }}>
        <span className="used">Budget: {user.monthly_token_budget} tok/mo</span>
        <span className={`remaining ${totalUsed > user.monthly_token_budget * 0.8 ? 'warning' : 'ok'}`}>
          Used: {totalUsed}
        </span>
      </div>

      <div className="device-meta" style={{ marginTop: '4px', fontSize: '11px' }}>
        Max devices: {user.max_devices} · Joined: {new Date(user.created_at).toLocaleDateString()}
      </div>

      <div className="device-footer">
        <button className="btn btn-sm btn-primary" onClick={() => onEdit(user)}>✎ Edit</button>
        <button
          className={`btn btn-sm ${user.is_active ? 'btn-warning' : 'btn-success'}`}
          onClick={() => onToggleActive(user)}
        >
          {user.is_active ? '🔒 Disable' : '🔓 Enable'}
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(user)}>🗑</button>
      </div>
    </div>
  );
}

// ─── Edit User Modal ──────────────────────────

function EditUserModal({ user, onClose, onSave }) {
  const [budget, setBudget] = useState(user.monthly_token_budget?.toString() || '50');
  const [maxDevices, setMaxDevices] = useState(user.max_devices?.toString() || '3');
  const [role, setRole] = useState(user.role || 'user');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onSave(user.id, {
        monthly_token_budget: parseInt(budget),
        max_devices: parseInt(maxDevices),
        role,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>✎ Edit User — {user.email}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Monthly Token Budget</label>
            <input type="number" className="form-input" value={budget} onChange={e => setBudget(e.target.value)} min="0" max="500" />
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
              {[10, 25, 50, 100, 200].map(v => (
                <button key={v} className="btn btn-sm" onClick={() => setBudget(v.toString())}>{v}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Max Devices</label>
            <input type="number" className="form-input" value={maxDevices} onChange={e => setMaxDevices(e.target.value)} min="1" max="20" />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select className="form-select" value={role} onChange={e => setRole(e.target.value)}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
