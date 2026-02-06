export function ProgressBar({ used, allocated, size = 'default' }) {
  const pct = allocated > 0 ? (used / allocated) * 100 : 0;
  const displayPct = Math.round(pct);

  let level = 'low';
  if (pct >= 95) level = 'full';
  else if (pct >= 75) level = 'high';
  else if (pct >= 50) level = 'mid';

  // Ensure a minimum visible width when used > 0 so it never looks empty
  const barWidth = used > 0 ? Math.max(pct, 3) : 0;

  return (
    <div className={`progress-section ${size}`}>
      <div className="progress-labels">
        <span>{displayPct}% used</span>
        <span>{used} / {allocated}</span>
      </div>
      <div className="progress-bar">
        <div
          className={`progress-fill ${level}`}
          style={{ width: `${barWidth}%` }}
        >
          {pct >= 15 && <span className="progress-text">{displayPct}%</span>}
        </div>
        {used > 0 && (
          <div className="progress-glow-tip" style={{ left: `${barWidth}%` }} />
        )}
      </div>
    </div>
  );
}
