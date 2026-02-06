import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { DeviceCard } from '../components/DeviceCard';
import { ProgressBar } from '../components/ProgressBar';
import { ThemeToggle } from '../App';
import {
  TransferModal,
  SetAllocationModal,
  RenameModal,
  ResetModal,
  HistoryModal,
  ConfirmModal,
} from '../components/Modals';

export default function Dashboard({ onLogout }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // overview | users | invites

  // Invites + Users state
  const [invites, setInvites] = useState([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteBudget, setInviteBudget] = useState('50');
  const [inviteMaxDevices, setInviteMaxDevices] = useState('3');
  const [inviteExpiry, setInviteExpiry] = useState('30');

  // Modals
  const [modal, setModal] = useState(null); // { type, device?, logs?, user? }

  // ─── Load Dashboard ───────────────────────────
  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); }
    else { setRefreshing(true); }
    try {
      const res = await api.getDashboard();
      setData(res);
    } catch (err) {
      toast.error('Failed to load dashboard: ' + err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  const fetchInvites = useCallback(async () => {
    try {
      const res = await api.getInvites();
      setInvites(res.invites || []);
    } catch (err) {
      toast.error('Failed to load invite tokens');
    }
  }, [toast]);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(() => fetchDashboard(true), 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  useEffect(() => {
    if (activeTab === 'invites') {
      fetchInvites();
    }
  }, [activeTab, fetchInvites]);

  // ─── Device Actions ───────────────────────────
  const handleBlock = async (deviceId, blocked) => {
    try {
      await api.blockDevice(deviceId, blocked);
      toast.success(blocked ? 'Device blocked' : 'Device unblocked');
      fetchDashboard(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleTransfer = async (toId, tokens, fromId, reason) => {
    try {
      await api.allocateTokens(toId, tokens, fromId, reason);
      toast.success(`${tokens} tokens transferred successfully`);
      setModal(null);
      fetchDashboard(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSetAllocation = async (deviceId, tokens) => {
    try {
      await api.setAllocation(deviceId, tokens);
      toast.success('Allocation updated');
      setModal(null);
      fetchDashboard(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRename = async (deviceId, newName) => {
    try {
      await api.renameDevice(deviceId, newName);
      toast.success('Device renamed');
      setModal(null);
      fetchDashboard(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleReset = async (defaultTokens) => {
    try {
      await api.resetMonthly(defaultTokens);
      toast.success('Monthly allocations reset');
      setModal(null);
      fetchDashboard(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteDevice = async (device) => {
    try {
      await api.deleteDevice(device.id);
      toast.success(`${device.name} deleted`);
      setModal(null);
      fetchDashboard(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleViewHistory = async (device) => {
    try {
      const res = await api.getUsageLogs(device.id, 50);
      setModal({ type: 'history', device, logs: res.logs || [] });
    } catch (err) {
      toast.error('Failed to load history');
    }
  };

  // ─── User Actions ─────────────────────────────
  const handleUpdateUser = async (userId, updates) => {
    try {
      await api.updateUser(userId, updates);
      toast.success('User updated');
      setModal(null);
      fetchDashboard(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteUser = async (user) => {
    try {
      await api.deleteUser(user.id);
      toast.success(`User ${user.email} deleted`);
      setModal(null);
      fetchDashboard(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleToggleUserActive = async (user) => {
    await handleUpdateUser(user.id, { is_active: !user.is_active });
  };

  // ─── Invite Actions ───────────────────────────
  const handleCreateInvite = async () => {
    setInviteLoading(true);
    try {
      await api.createInvite(parseInt(inviteBudget), parseInt(inviteMaxDevices), parseInt(inviteExpiry));
      toast.success('Invite token created');
      fetchInvites();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setInviteLoading(false);
    }
  };

  const handleDeleteInvite = async (inviteId) => {
    try {
      await api.deleteInvite(inviteId);
      toast.success('Invite token deleted');
      fetchInvites();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const copyInviteToken = (token) => {
    navigator.clipboard.writeText(token);
    toast.success('Invite token copied to clipboard');
  };

  // ─── Loading State ────────────────────────────
  if (loading || !data) {
    return (
      <div className="loading-page">
        <div className="spinner" style={{ width: 32, height: 32 }} />
        <span>Loading dashboard…</span>
      </div>
    );
  }

  const { budget, devices, users } = data;
  const budgetPct = budget.total > 0 ? Math.round((budget.used / budget.total) * 100) : 0;
  const userList = users?.list || [];
  const allDevices = devices?.list || [];

  return (
    <>
      {/* ─── Top Nav ─── */}
      <nav className="topnav">
        <div className="topnav-inner">
          <div className="topnav-brand">
            <div className="logo-icon">⚡</div>
            <span className="brand-text">Token Tracker</span>
            <span className="badge cyan" style={{ marginLeft: 4 }}>{data.month}</span>
          </div>
          <div className="topnav-actions">
            <ThemeToggle />
            <div className="server-status">
              <span className="pulse" />
              LIVE
            </div>
            {refreshing && <div className="spinner" />}
            <button className="btn btn-sm" onClick={() => fetchDashboard(true)}>
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
            <div className="stat-label">Total Budget</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{budget.total}</div>
            <div className="stat-sub">tokens / month</div>
          </div>
          <div className="stat-card green">
            <div className="stat-label">Remaining</div>
            <div className="stat-value" style={{ color: 'var(--green)' }}>{budget.remaining}</div>
            <div className="stat-sub">available to use</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-label">Consumed</div>
            <div className="stat-value" style={{ color: budget.used > budget.total * 0.8 ? 'var(--red)' : 'var(--yellow)' }}>
              {budget.used}
            </div>
            <div className="stat-sub">{budgetPct}% utilized</div>
          </div>
          <div className="stat-card red">
            <div className="stat-label">Users / Devices</div>
            <div className="stat-value">
              {userList.length}
              <span style={{ fontSize: '16px', color: 'var(--text-muted)', fontWeight: 500 }}> / {devices.count}</span>
            </div>
            <div className="stat-sub">{allDevices.filter(d => d.is_blocked).length} blocked</div>
          </div>
        </div>

        {/* ─── Overall Progress ─── */}
        <div className="card" style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontWeight: 700, fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', opacity: 0.8 }}>
              MONTHLY_USAGE_BAR
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {budget.allocated} allocated  ·  {budget.unallocated} pool
            </span>
          </div>
          <ProgressBar used={budget.used} allocated={budget.total} />
        </div>

        {/* ─── Tab Navigation ─── */}
        <div className="tab-bar" style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
          {[
            { key: 'overview', label: '⬡ Devices', count: devices.count },
            { key: 'users', label: '👥 Users', count: userList.length },
            { key: 'invites', label: '🎟 Invite Tokens' },
          ].map(tab => (
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

        {/* ─── Tab: Devices (Overview) ─── */}
        {activeTab === 'overview' && (
          <>
            <div className="section-header">
              <h2>⬡ Connected Devices</h2>
              <div className="section-header-actions">
                <button className="btn btn-primary" onClick={() => setModal({ type: 'transfer', device: null })}>
                  ⚡ Transfer Tokens
                </button>
                <button className="btn btn-warning" onClick={() => setModal({ type: 'reset' })}>
                  ↺ Reset Monthly
                </button>
              </div>
            </div>

            {allDevices.length === 0 ? (
              <div className="card empty-state">
                <div className="icon">📡</div>
                <p>No devices connected. Users need to install the VS Code extension and sign in to begin tracking.</p>
              </div>
            ) : (
              <div className="devices-grid">
                {allDevices.map(device => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    onBlock={handleBlock}
                    onTransfer={(d) => setModal({ type: 'transfer', device: d })}
                    onSetAlloc={(d) => setModal({ type: 'setAlloc', device: d })}
                    onRename={(d) => setModal({ type: 'rename', device: d })}
                    onViewHistory={handleViewHistory}
                    onDelete={(d) => setModal({ type: 'confirmDelete', device: d })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ─── Tab: Users ─── */}
        {activeTab === 'users' && (
          <>
            <div className="section-header">
              <h2>👥 Registered Users</h2>
            </div>

            {userList.length === 0 ? (
              <div className="card empty-state">
                <div className="icon">👤</div>
                <p>No users registered yet. Share an invite token or enable public registration.</p>
              </div>
            ) : (
              <div className="devices-grid">
                {userList.map(user => (
                  <UserCard
                    key={user.id}
                    user={user}
                    onToggleActive={handleToggleUserActive}
                    onEdit={(u) => setModal({ type: 'editUser', user: u })}
                    onDelete={(u) => setModal({ type: 'confirmDeleteUser', user: u })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ─── Tab: Invite Tokens ─── */}
        {activeTab === 'invites' && (
          <>
            <div className="section-header">
              <h2>🎟 Invite Tokens</h2>
            </div>

            {/* Create invite form */}
            <div className="card" style={{ marginBottom: '20px' }}>
              <h3 style={{ marginBottom: '16px', fontSize: '14px', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                GENERATE_INVITE
              </h3>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1, minWidth: '100px' }}>
                  <label className="form-label">Monthly Budget</label>
                  <input type="number" className="form-input" value={inviteBudget} onChange={e => setInviteBudget(e.target.value)} min="1" max="500" />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '100px' }}>
                  <label className="form-label">Max Devices</label>
                  <input type="number" className="form-input" value={inviteMaxDevices} onChange={e => setInviteMaxDevices(e.target.value)} min="1" max="10" />
                </div>
                <div className="form-group" style={{ flex: 1, minWidth: '100px' }}>
                  <label className="form-label">Expires (days)</label>
                  <input type="number" className="form-input" value={inviteExpiry} onChange={e => setInviteExpiry(e.target.value)} min="1" max="365" />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateInvite}
                  disabled={inviteLoading}
                  style={{ height: '38px' }}
                >
                  {inviteLoading ? <span className="spinner" /> : '🎟 Generate'}
                </button>
              </div>
            </div>

            {/* Invites list */}
            {invites.length === 0 ? (
              <div className="card empty-state">
                <div className="icon">🎟</div>
                <p>No invite tokens yet. Generate one above to share with users.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>Budget</th>
                      <th>Devices</th>
                      <th>Status</th>
                      <th>Expires</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map(inv => {
                      const isUsed = !!inv.used_by;
                      const isExpired = new Date(inv.expires_at) < new Date();
                      return (
                        <tr key={inv.id}>
                          <td>
                            <code style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', cursor: 'pointer' }} onClick={() => copyInviteToken(inv.token)} title="Click to copy">
                              {inv.token.substring(0, 16)}…
                            </code>
                          </td>
                          <td>{inv.monthly_budget}</td>
                          <td>{inv.max_devices}</td>
                          <td>
                            {isUsed ? (
                              <span className="badge green">USED</span>
                            ) : isExpired ? (
                              <span className="badge red">EXPIRED</span>
                            ) : (
                              <span className="badge cyan">AVAILABLE</span>
                            )}
                          </td>
                          <td style={{ fontSize: '12px' }}>
                            {new Date(inv.expires_at).toLocaleDateString()}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {!isUsed && (
                                <button className="btn btn-sm" onClick={() => copyInviteToken(inv.token)} title="Copy token">
                                  📋
                                </button>
                              )}
                              <button className="btn btn-sm btn-danger" onClick={() => handleDeleteInvite(inv.id)} title="Delete">
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
          Token Tracker v2.0 · SaaS Copilot Usage Management<br />
          <span className="server-url">api.abdulrahmanazam.me</span>
        </div>
      </main>

      {/* ─── Modals ─── */}
      {modal?.type === 'transfer' && (
        <TransferModal
          devices={allDevices}
          selectedDevice={modal.device}
          onClose={() => setModal(null)}
          onTransfer={handleTransfer}
        />
      )}

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

      {modal?.type === 'reset' && (
        <ResetModal
          deviceCount={devices.count}
          onClose={() => setModal(null)}
          onReset={handleReset}
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
          message={`Are you sure you want to delete user "${modal.user.email}"? This will remove all their devices and usage data. This action cannot be undone.`}
          confirmLabel="Delete User"
          danger
          onClose={() => setModal(null)}
          onConfirm={() => handleDeleteUser(modal.user)}
        />
      )}
    </>
  );
}

// ─── User Card Component ──────────────────────────────────

function UserCard({ user, onToggleActive, onEdit, onDelete }) {
  const deviceCount = user.devices?.length || 0;
  const totalUsed = user.devices?.reduce((sum, d) => sum + (d.allocation?.used || 0), 0) || 0;

  return (
    <div className={`device-card ${!user.is_active ? 'blocked' : ''}`}>
      <div className="device-header">
        <div>
          <div className="device-name">
            <span className={`dot ${user.is_active ? 'online' : 'blocked'}`} />
            {user.display_name || user.email.split('@')[0]}
          </div>
          <div className="device-meta">
            {user.email} &nbsp;·&nbsp; {deviceCount} device{deviceCount !== 1 ? 's' : ''}
            {user.github_username ? ` · GitHub: ${user.github_username}` : ''}
          </div>
        </div>
        <div className="device-actions">
          <span className={`badge ${user.role === 'admin' ? 'purple' : 'cyan'}`}>
            {user.role.toUpperCase()}
          </span>
          {!user.is_active && <span className="badge red">DISABLED</span>}
        </div>
      </div>

      <div className="token-count" style={{ marginTop: '8px' }}>
        <span className="used">Budget: {user.monthly_token_budget} token/mo</span>
        <span className={`remaining ${totalUsed > user.monthly_token_budget * 0.8 ? 'warning' : 'ok'}`}>
          Used: {totalUsed}
        </span>
      </div>

      <div className="device-meta" style={{ marginTop: '4px', fontSize: '11px' }}>
        Max devices: {user.max_devices} &nbsp;·&nbsp; Joined: {new Date(user.created_at).toLocaleDateString()}
      </div>

      <div className="device-footer">
        <button className="btn btn-sm btn-primary" onClick={() => onEdit(user)}>
          ✎ Edit
        </button>
        <button
          className={`btn btn-sm ${user.is_active ? 'btn-warning' : 'btn-success'}`}
          onClick={() => onToggleActive(user)}
        >
          {user.is_active ? '🔒 Disable' : '🔓 Enable'}
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(user)}>
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

// ─── Edit User Modal ──────────────────────────────────────

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

  // Inline modal (uses same Modal component pattern)
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
            <input type="number" className="form-input" value={maxDevices} onChange={e => setMaxDevices(e.target.value)} min="1" max="10" />
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
