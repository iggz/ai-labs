/**
 * RegressionDetector — Detect performance regressions between sequential runs.
 *
 * Groups runs by method + exercise, compares each to its predecessor,
 * flags >10% degradation.
 */

import { useMemo } from 'react';

const METHOD_LABELS = { dnn: 'DNN', yolo: 'YOLO', 'on-device': 'On-Device', ondevice: 'On-Device' };
const METHOD_COLORS = { dnn: '#f97316', yolo: '#8b5cf6', 'on-device': '#06b6d4', ondevice: '#06b6d4' };

function getTime(run) {
  return run.client_timings?.totalRoundTripMs
    ?? run.server_timings?.total_server_ms
    ?? 0;
}

function fmt(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

export default function RegressionDetector({ runs }) {
  const comparisons = useMemo(() => {
    // Group by method + exercise
    const groups = {};
    for (const r of runs) {
      const m = r.method === 'ondevice' ? 'on-device' : r.method;
      const key = `${m}:${r.exercise_type || 'unknown'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }

    const results = [];

    for (const [groupKey, groupRuns] of Object.entries(groups)) {
      // Sort by run_number ascending
      const sorted = [...groupRuns].sort((a, b) => (a.run_number ?? 0) - (b.run_number ?? 0));

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const prevTime = getTime(prev);
        const currTime = getTime(curr);

        if (prevTime <= 0) continue;

        const delta = currTime - prevTime;
        const pct = (delta / prevTime) * 100;

        let severity = 'ok';
        if (pct > 10) severity = 'critical';
        else if (pct > 5) severity = 'warn';

        results.push({
          groupKey,
          method: curr.method,
          exercise: curr.exercise_type,
          runNumber: curr.run_number,
          prevRunNumber: prev.run_number,
          prevTime, currTime, delta, pct, severity,
        });
      }
    }

    return results;
  }, [runs]);

  const regressions = comparisons.filter(c => c.severity !== 'ok');

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">📉</span>
          Regression Detection
        </h3>
        {comparisons.length > 0 && (
          <span className={`dbg-badge ${regressions.length > 0 ? 'dbg-badge--critical' : 'dbg-badge--ok'}`}>
            {regressions.length > 0 ? `${regressions.length} flagged` : 'Stable'}
          </span>
        )}
      </div>
      <div className="dbg-card__body">
        {comparisons.length === 0 ? (
          <div className="dbg-empty" style={{ padding: '24px 12px' }}>
            <div className="dbg-empty__icon" style={{ fontSize: '1.5rem' }}>📉</div>
            <p className="dbg-empty__text" style={{ fontSize: '0.75rem' }}>
              Need 2+ runs per method to detect regressions.
            </p>
          </div>
        ) : (
          <div className="dbg-table-wrapper">
            <table className="dbg-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Method</th>
                  <th>Previous</th>
                  <th>Current</th>
                  <th>Δ</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map(c => (
                  <tr key={`${c.method}-${c.runNumber}`}>
                    <td className="dbg-cell-mono">#{c.runNumber}</td>
                    <td>
                      <span className={`dbg-method-tag dbg-method-tag--${c.method === 'on-device' ? 'ondevice' : c.method}`}>
                        {METHOD_LABELS[c.method] || c.method}
                      </span>
                    </td>
                    <td className="dbg-cell-mono">{fmt(c.prevTime)}</td>
                    <td className="dbg-cell-mono">{fmt(c.currTime)}</td>
                    <td className={`dbg-delta dbg-delta--${c.pct > 0 ? 'positive' : c.pct < 0 ? 'negative' : 'neutral'}`}>
                      {c.pct > 0 ? '+' : ''}{c.pct.toFixed(1)}%
                    </td>
                    <td>
                      <span className={`dbg-badge dbg-badge--${c.severity}`}>
                        {c.severity === 'critical' ? '🔴 Regression' : c.severity === 'warn' ? '🟡 Minor' : '🟢 Stable'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
