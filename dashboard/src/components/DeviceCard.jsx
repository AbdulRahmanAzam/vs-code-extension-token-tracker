import { ProgressBar } from './ProgressBar';

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function DeviceCard({ device, busy, onBlock, onTransfer, onSetAlloc, onRename, onViewHistory, onDelete }) {
  const { allocation } = device;
  const remaining = allocation.allocated - allocation.used;
  const pct = allocation.allocated > 0 ? Math.round((allocation.used / allocation.allocated) * 100) : 0;

  const isRecentlyActive = device.last_seen &&
    (Date.now() - new Date(device.last_seen).getTime()) < 10 * 60 * 1000;

  const dotClass = device.is_blocked ? 'blocked' : isRecentlyActive ? 'online' : 'inactive';

  const statusBadge = device.is_blocked
    ? <span className="badge red">Blocked</span>
    : remaining <= 0
    ? <span className="badge red">Exhausted</span>
    : remaining <= 5
    ? <span className="badge yellow">Low</span>
    : <span className="badge green">Active</span>;

  return (
    <div className={`device-card${device.is_blocked ? ' blocked' : ''}${busy ? ' busy' : ''}`}>
      <div className="device-header">
        <div>
          <div className="device-name">
            <span className={`dot ${dotClass}`} />
            {device.name}
          </div>
          <div className="device-meta">
            {timeAgo(device.last_seen)} · {new Date(device.created_at).toLocaleDateString()}
          </div>
        </div>
        <div className="device-actions">{statusBadge}</div>
      </div>

      <ProgressBar used={allocation.used} allocated={allocation.allocated} />

      <div className="token-count">
        <span className="used">{allocation.used} used</span>
        <span className={`remaining ${remaining <= 0 ? 'danger' : remaining <= 10 ? 'warning' : 'ok'}`}>
          {remaining} remaining
        </span>
      </div>

      <div className="device-footer">
        <button className="btn btn-sm" onClick={() => onSetAlloc(device)} title="Set allocation">
          Set Limit
        </button>
        <button className="btn btn-sm" onClick={() => onViewHistory(device)} title="View history">
          History
        </button>
        <button
          className={`btn btn-sm ${device.is_blocked ? 'btn-success' : 'btn-warning'}`}
          onClick={() => onBlock(device.id, !device.is_blocked)}
        >
          {device.is_blocked ? 'Unblock' : 'Block'}
        </button>
        <button className="btn btn-sm" onClick={() => onRename(device)} title="Rename">
          Rename
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(device)} title="Delete">
          ✕
        </button>
      </div>
    </div>
  );
}
