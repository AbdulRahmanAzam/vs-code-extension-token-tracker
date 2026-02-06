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

  // Modals
  const [modal, setModal] = useState(null); // { type, device?, logs? }

  // ─── Load Dashboard ───────────────────────────
  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
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

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(() => fetchDashboard(true), 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // ─── Actions ──────────────────────────────────
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

  const handleDelete = async (device) => {
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

  // ─── Loading State ────────────────────────────
  if (loading || !data) {
    return (
      <div className="loading-page">
        <div className="spinner" style={{ width: 32, height: 32 }} />
        <span>Loading dashboard…</span>
      </div>
    );
  }

  const { budget, devices } = data;
  const budgetPct = budget.total > 0 ? Math.round((budget.used / budget.total) * 100) : 0;

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
            <div className="stat-label">Active Nodes</div>
            <div className="stat-value">
              {devices.count}
              <span style={{ fontSize: '16px', color: 'var(--text-muted)', fontWeight: 500 }}> / {devices.max}</span>
            </div>
            <div className="stat-sub">{devices.list.filter(d => d.is_blocked).length} blocked</div>
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

        {/* ─── Devices Section ─── */}
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

        {devices.list.length === 0 ? (
          <div className="card empty-state">
            <div className="icon">📡</div>
            <p>No devices connected. Install the VS Code extension on a device to begin tracking.</p>
          </div>
        ) : (
          <div className="devices-grid">
            {devices.list.map(device => (
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

        {/* ─── Token Cost Reference ─── */}
        <div className="cost-ref">
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
          Token Tracker v1.0 · Centralized Copilot Usage Management<br />
          <span className="server-url">server: 192.168.100.6:3000</span>
        </div>
      </main>

      {/* ─── Modals ─── */}
      {modal?.type === 'transfer' && (
        <TransferModal
          devices={devices.list}
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
          onConfirm={() => handleDelete(modal.device)}
        />
      )}
    </>
  );
}
