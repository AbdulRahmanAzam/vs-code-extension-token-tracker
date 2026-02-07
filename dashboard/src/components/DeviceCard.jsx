import { ProgressBar } from './ProgressBar';

function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function DeviceCard({ device, onBlock, onTransfer, onSetAlloc, onRename, onViewHistory, onDelete }) {
  const { allocation } = device;
  const remaining = allocation.allocated - allocation.used;

  const isRecentlyActive = device.last_seen &&
    (Date.now() - new Date(device.last_seen).getTime()) < 10 * 60 * 1000;

  const dotClass = device.is_blocked ? 'blocked' : isRecentlyActive ? 'online' : 'inactive';

  return (
    <div className={`device-card ${device.is_blocked ? 'blocked' : ''}`}>
      <div className="device-header">
        <div>
          <div className="device-name">
            <span className={`dot ${dotClass}`} />
            {device.name}
          </div>
          <div className="device-meta">
            Last seen: {timeAgo(device.last_seen)} &nbsp;·&nbsp; Created: {new Date(device.created_at).toLocaleDateString()}
          </div>
        </div>
        <div className="device-actions">
          {device.is_blocked ? (
            <span className="badge red">BLOCKED</span>
          ) : remaining <= 5 && remaining > 0 ? (
            <span className="badge yellow">LOW</span>
          ) : remaining <= 0 ? (
            <span className="badge red">EXHAUSTED</span>
          ) : (
            <span className="badge green">ACTIVE</span>
          )}
        </div>
      </div>

      <ProgressBar used={allocation.used} allocated={allocation.allocated} />

      <div className="token-count">
        <span className="used">Used: {allocation.used}</span>
        <span className={`remaining ${remaining <= 0 ? 'danger' : remaining <= 10 ? 'warning' : 'ok'}`}>
          Remaining: {remaining}
        </span>
      </div>

      <div className="device-footer">
        <button className="btn btn-sm btn-primary" onClick={() => onTransfer(device)}>
          ↗ Transfer
        </button>
        <button className="btn btn-sm" onClick={() => onSetAlloc(device)}>
          ✎ Set Limit
        </button>
        <button className="btn btn-sm" onClick={() => onViewHistory(device)}>
          📊 History
        </button>
        <button
          className={`btn btn-sm ${device.is_blocked ? 'btn-success' : 'btn-warning'}`}
          onClick={() => onBlock(device.id, !device.is_blocked)}
        >
          {device.is_blocked ? '🔓 Unblock' : '🔒 Block'}
        </button>
        <button className="btn btn-sm" onClick={() => onRename(device)} title="Rename">
          ✏️
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(device)} title="Delete">
          🗑
        </button>
      </div>
    </div>
  );
}
