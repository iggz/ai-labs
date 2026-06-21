/**
 * @file LatencyPercentiles.jsx
 * @description Percentile statistics for per-frame inference latency, grouped by method.
 *              Displays P50, P75, P95, P99 plus min, max, avg in a table.
 *              Headers color-coded by method.
 *
 * @param {Object} props
 * @param {Array}  props.runs - Array of unified run objects
 */
import React, { useMemo } from 'react';

/** Method → color mapping */
const METHOD_COLORS = {
  dnn: '#f97316',
  yolo: '#8b5cf6',
  'on-device': '#06b6d4',
};

/** Method display labels */
const METHOD_LABELS = {
  dnn: 'DNN',
  yolo: 'YOLO',
  'on-device': 'On-Device',
};

/** Format milliseconds */
function fmt(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

/**
 * Compute a percentile from a sorted array of numbers.
 * @param {number[]} sorted - Pre-sorted ascending array
 * @param {number}   p      - Percentile (0–100)
 * @returns {number|null}
 */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export default function LatencyPercentiles({ runs = [] }) {
  /** Compute per-method statistics */
  const methodStats = useMemo(() => {
    const groups = {};

    for (const run of runs) {
      const method = (run.method || '').toLowerCase();
      const perFrame = run.server_timings?.inference_per_frame_ms;

      // Accept a single number or skip if not available
      if (perFrame == null || perFrame <= 0) continue;

      if (!groups[method]) groups[method] = [];
      groups[method].push(perFrame);
    }

    // Build stats per method
    return Object.entries(groups)
      .map(([method, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        return {
          method,
          label: METHOD_LABELS[method] || method.toUpperCase(),
          color: METHOD_COLORS[method] || '#94a3b8',
          count: sorted.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          avg: sum / sorted.length,
          p50: percentile(sorted, 50),
          p75: percentile(sorted, 75),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
        };
      })
      .sort((a, b) => (a.method < b.method ? -1 : 1));
  }, [runs]);

  if (methodStats.length === 0) {
    return (
      <div className="dbg-card">
        <div className="dbg-card__header">
          <h3 className="dbg-card__title">
            <span className="dbg-card__title-icon">📊</span> Latency Percentiles
          </h3>
        </div>
        <div className="dbg-card__body">
          <div className="dbg-empty">
            <div className="dbg-empty__icon">📊</div>
            <h4 className="dbg-empty__title">No latency data</h4>
            <p className="dbg-empty__text">
              Per-frame inference latency requires server runs with&nbsp;
              <span className="dbg-empty__code">inference_per_frame_ms</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const columns = ['P50', 'P75', 'P95', 'P99', 'Min', 'Max', 'Avg', 'N'];

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">📊</span> Latency Percentiles
        </h3>
        <span className="dbg-card__badge">per-frame inference</span>
      </div>
      <div className="dbg-card__body dbg-card__body--flush">
        <div className="dbg-table-wrapper">
          <table className="dbg-table">
            <thead>
              <tr>
                <th>Method</th>
                {columns.map((col) => (
                  <th key={col} style={{ textAlign: 'right' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {methodStats.map((stat) => {
                const methodClass = stat.method === 'on-device' ? 'on-device' : stat.method;
                return (
                  <tr key={stat.method}>
                    <td>
                      <span
                        className={`dbg-cell-method dbg-cell-method--${methodClass}`}
                        style={{ color: stat.color }}
                      >
                        {stat.label}
                      </span>
                    </td>
                    <td className="dbg-cell-mono" style={{ textAlign: 'right' }}>
                      {fmt(stat.p50)}
                    </td>
                    <td className="dbg-cell-mono" style={{ textAlign: 'right' }}>
                      {fmt(stat.p75)}
                    </td>
                    <td className="dbg-cell-mono" style={{ textAlign: 'right' }}>
                      {fmt(stat.p95)}
                    </td>
                    <td className="dbg-cell-mono" style={{ textAlign: 'right' }}>
                      {fmt(stat.p99)}
                    </td>
                    <td className="dbg-cell-mono" style={{ textAlign: 'right' }}>
                      {fmt(stat.min)}
                    </td>
                    <td className="dbg-cell-mono" style={{ textAlign: 'right' }}>
                      {fmt(stat.max)}
                    </td>
                    <td className="dbg-cell-mono" style={{ textAlign: 'right' }}>
                      {fmt(stat.avg)}
                    </td>
                    <td className="dbg-cell-mono" style={{ textAlign: 'right' }}>
                      {stat.count}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
