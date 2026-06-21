/**
 * @file SummaryCards.jsx
 * @description Four top-level KPI summary cards for the debug dashboard.
 *
 * - Total Runs: count of filtered runs vs. total
 * - Runs Today: runs whose timestamp matches today's date
 * - Avg Time by Method: mini bar chart of average round-trip time per method
 * - Success Rate: percentage of error-free runs with SVG progress ring
 *
 * @param {Object}   props
 * @param {Object[]} props.runs    - Filtered run data
 * @param {Object[]} props.allRuns - Unfiltered run data (for context)
 */
import { useMemo } from 'react';

const METHOD_COLORS = {
  dnn:         '#f97316',
  yolo:        '#8b5cf6',
  'on-device': '#06b6d4',
};

const METHOD_ABBR = { dnn: 'DNN', yolo: 'YOLO', 'on-device': 'OD' };

/** Format milliseconds for display */
function fmt(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

export default function SummaryCards({ runs = [], allRuns = [] }) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const runsToday = useMemo(
    () => runs.filter((r) => r.timestamp && r.timestamp.slice(0, 10) === todayStr).length,
    [runs, todayStr],
  );

  // --- Avg time per method ---
  const avgByMethod = useMemo(() => {
    const acc = {};
    for (const m of Object.keys(METHOD_COLORS)) acc[m] = { sum: 0, count: 0 };

    runs.forEach((r) => {
      const m = r.method;
      if (!acc[m]) return;
      const time =
        r.client_timings?.totalRoundTripMs ??
        r.server_timings?.total_server_ms ??
        null;
      if (time != null) {
        acc[m].sum += time;
        acc[m].count += 1;
      }
    });

    const result = {};
    for (const [m, { sum, count }] of Object.entries(acc)) {
      result[m] = count > 0 ? sum / count : 0;
    }
    return result;
  }, [runs]);

  const maxAvg = Math.max(...Object.values(avgByMethod), 1);

  // --- Success Rate ---
  const successRate = useMemo(() => {
    if (runs.length === 0) return 100;
    const ok = runs.filter(
      (r) => !r.errors || r.errors.length === 0,
    ).length;
    return Math.round((ok / runs.length) * 100);
  }, [runs]);

  // SVG progress ring geometry
  const ringRadius = 16;
  const circumference = 2 * Math.PI * ringRadius;
  const offset = circumference - (successRate / 100) * circumference;
  const ringColor =
    successRate >= 90
      ? '#22c55e'
      : successRate >= 70
        ? '#eab308'
        : '#ef4444';

  return (
    <div className="dbg-summary-row">
      {/* Card 1: Total Runs */}
      <div className="dbg-summary-card">
        <span className="dbg-summary-card__label">Total Runs</span>
        <span className="dbg-summary-card__value">{runs.length}</span>
        <span className="dbg-summary-card__sub">of {allRuns.length} total</span>
      </div>

      {/* Card 2: Runs Today */}
      <div className="dbg-summary-card">
        <span className="dbg-summary-card__label">Runs Today</span>
        <span className="dbg-summary-card__value">{runsToday}</span>
        <span className="dbg-summary-card__sub">{todayStr}</span>
      </div>

      {/* Card 3: Avg Time by Method */}
      <div className="dbg-summary-card">
        <span className="dbg-summary-card__label">Avg Time by Method</span>
        <div className="dbg-summary-mini-bars">
          {Object.entries(METHOD_COLORS).map(([method, color]) => {
            const avg = avgByMethod[method] || 0;
            const pct = maxAvg > 0 ? (avg / maxAvg) * 100 : 0;
            return (
              <div
                key={method}
                className="dbg-summary-mini-bar"
                style={{
                  height: `${Math.max(pct, 14)}%`,
                  background: color,
                }}
                title={`${METHOD_ABBR[method]}: ${fmt(avg)}`}
              >
                <span className="dbg-summary-mini-bar__label">
                  {METHOD_ABBR[method]} {fmt(avg)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Card 4: Success Rate */}
      <div className="dbg-summary-card">
        <span className="dbg-summary-card__label">Success Rate</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg
            width={40}
            height={40}
            viewBox="0 0 40 40"
            className="dbg-progress-ring"
          >
            <circle
              className="dbg-progress-ring__bg"
              cx={20}
              cy={20}
              r={ringRadius}
              strokeWidth={4}
            />
            <circle
              className="dbg-progress-ring__fill"
              cx={20}
              cy={20}
              r={ringRadius}
              strokeWidth={4}
              stroke={ringColor}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <span className="dbg-summary-card__value">{successRate}%</span>
        </div>
        <span className="dbg-summary-card__sub">
          {runs.filter((r) => !r.errors || r.errors.length === 0).length} of{' '}
          {runs.length} error-free
        </span>
      </div>
    </div>
  );
}
