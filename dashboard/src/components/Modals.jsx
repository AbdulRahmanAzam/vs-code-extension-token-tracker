import { useState } from 'react';
import { Modal } from './Modal';

export function TransferModal({ devices, selectedDevice, onClose, onTransfer }) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState(selectedDevice?.id || '');
  const [tokens, setTokens] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!toId || !tokens || parseInt(tokens) <= 0) return;
    setLoading(true);
    try {
      await onTransfer(toId, parseInt(tokens), fromId || null, reason);
    } finally {
      setLoading(false);
    }
  };

  const sourceDevice = fromId ? devices.find(d => d.id === fromId) : null;
  const maxAvailable = sourceDevice
    ? sourceDevice.allocation.allocated - sourceDevice.allocation.used
    : Infinity;

  return (
    <Modal
      title="🔄 Transfer Tokens"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || !toId || !tokens || parseInt(tokens) <= 0}
          >
            {loading ? <span className="spinner" /> : 'Transfer'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label">From Device (optional — leave blank to add new tokens)</label>
        <select className="form-select" value={fromId} onChange={e => setFromId(e.target.value)}>
          <option value="">— Global pool (add new) —</option>
          {devices.filter(d => d.id !== toId).map(d => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.allocation.allocated - d.allocation.used} available)
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">To Device</label>
        <select className="form-select" value={toId} onChange={e => setToId(e.target.value)}>
          <option value="">— Select device —</option>
          {devices.filter(d => d.id !== fromId).map(d => (
            <option key={d.id} value={d.id}>
              {d.name} (currently {d.allocation.allocated - d.allocation.used} remaining)
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">
          Tokens to Transfer
          {sourceDevice && (
            <span style={{ float: 'right', fontWeight: 400, textTransform: 'none' }}>
              Max: {maxAvailable}
            </span>
          )}
        </label>
        <input
          type="number"
          className="form-input"
          value={tokens}
          onChange={e => setTokens(e.target.value)}
          placeholder="e.g. 10"
          min="1"
          max={sourceDevice ? maxAvailable : 300}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Reason (optional)</label>
        <input
          type="text"
          className="form-input"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Extra allocation for project"
        />
      </div>
    </Modal>
  );
}

export function SetAllocationModal({ device, onClose, onSet }) {
  const [tokens, setTokens] = useState(device?.allocation?.allocated?.toString() || '50');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (parseInt(tokens) < 0) return;
    setLoading(true);
    try {
      await onSet(device.id, parseInt(tokens));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="✎ Set Token Allocation"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Set Allocation'}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
        Setting allocation for <strong>{device.name}</strong>. Current usage: {device.allocation.used} tokens.
      </p>

      <div className="form-group">
        <label className="form-label">Allocated Tokens</label>
        <input
          type="number"
          className="form-input"
          value={tokens}
          onChange={e => setTokens(e.target.value)}
          min="0"
          max="300"
          autoFocus
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[10, 25, 50, 75, 100].map(v => (
          <button key={v} className="btn btn-sm" onClick={() => setTokens(v.toString())}>
            {v}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function RenameModal({ device, onClose, onRename }) {
  const [name, setName] = useState(device.name || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onRename(device.id, name.trim());
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="✏️ Rename Device"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !name.trim()}>
            {loading ? <span className="spinner" /> : 'Rename'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label">Device Name</label>
        <input
          type="text"
          className="form-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Work Laptop"
          autoFocus
        />
      </div>
    </Modal>
  );
}

export function ResetModal({ deviceCount, onClose, onReset }) {
  const [tokens, setTokens] = useState('50');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await onReset(parseInt(tokens));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="🔄 Reset Monthly Allocations"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={handleSubmit} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Reset All'}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
        ⚠️ This will <strong>reset all {deviceCount} devices</strong> to the specified token allocation.
        All existing usage will be cleared for this month.
      </p>

      <div className="form-group">
        <label className="form-label">Tokens per Device</label>
        <input
          type="number"
          className="form-input"
          value={tokens}
          onChange={e => setTokens(e.target.value)}
          min="0"
          max="300"
        />
      </div>

      <div className="form-group" style={{ marginTop: 0 }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Total: {deviceCount} × {tokens} = {deviceCount * parseInt(tokens || 0)} tokens
        </span>
      </div>
    </Modal>
  );
}

export function HistoryModal({ device, logs, onClose }) {
  return (
    <Modal title={`📊 Usage History — ${device.name}`} onClose={onClose}>
      {logs.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📭</div>
          <p>No usage recorded yet for this device.</p>
        </div>
      ) : (
        <div className="table-wrapper" style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th>Type</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id || i}>
                  <td>{new Date(log.created_at).toLocaleString()}</td>
                  <td>
                    <span className={`badge ${log.tokens_used >= 3 ? 'purple' : log.tokens_used === 0 ? 'green' : 'blue'}`}>
                      {log.model_type}
                    </span>
                  </td>
                  <td>{log.request_type}</td>
                  <td style={{ fontWeight: 700 }}>{log.tokens_used}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={handle} disabled={loading}>
            {loading ? <span className="spinner" /> : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{message}</p>
    </Modal>
  );
}
