export function ProgressBar({ used, allocated, size = 'default' }) {
  const pct = allocated > 0 ? (used / allocated) * 100 : 0;
  // Cap at 100 for visual bar, but text can show >100%
  const widthPct = Math.min(pct, 100);

  let colorClass = 'low';
  if (pct >= 90) colorClass = 'full';
  else if (pct >= 75) colorClass = 'high';
  else if (pct >= 50) colorClass = 'mid';

  return (
    <div className={`progress-section ${size}`} style={{ marginBottom: '16px' }}>
      <div className="progress-labels" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
        <span>{Math.round(pct)}% used</span>
        <span className="mono">{used} / {allocated}</span>
      </div>
      <div className="progress-bar" style={{ height: '8px', background: 'var(--bg-input)', borderRadius: '99px', position: 'relative', overflow: 'hidden' }}>
        <div
          className={`progress-fill ${colorClass}`}
          style={{ width: `${widthPct}%`, height: '100%', borderRadius: '99px', transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </div>
    </div>
  );
}
