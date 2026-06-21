/**
 * CostAllocator — Estimated server compute cost per run.
 *
 * Configurable $/hr rate, SVG donut chart showing cost by method,
 * total + per-run cost breakdown.
 */

import { useState, useMemo } from 'react';

const METHOD_LABELS = { dnn: 'DNN', yolo: 'YOLO', 'on-device': 'On-Device', ondevice: 'On-Device' };
const METHOD_COLORS = { dnn: '#f97316', yolo: '#8b5cf6', 'on-device': '#06b6d4', ondevice: '#06b6d4' };

export default function CostAllocator({ runs }) {
  const [hourlyRate, setHourlyRate] = useState(0.50);

  // Filter to server-only runs (on-device has no server cost)
  const serverRuns = useMemo(() =>
    runs.filter(r => r.method !== 'on-device' && r.method !== 'ondevice' && r.server_timings?.total_server_ms),
    [runs]
  );

  // Cost per run and grouped totals
  const { perRun, byMethod, totalCost } = useMemo(() => {
    const costs = serverRuns.map(r => ({
      key: r._key || r.run_name,
      method: r.method,
      runNumber: r.run_number,
      ms: r.server_timings.total_server_ms,
      cost: (r.server_timings.total_server_ms / 3600000) * hourlyRate,
    }));

    const groups = {};
    let total = 0;
    for (const c of costs) {
      total += c.cost;
      if (!groups[c.method]) groups[c.method] = { method: c.method, cost: 0, count: 0 };
      groups[c.method].cost += c.cost;
      groups[c.method].count++;
    }

    return { perRun: costs, byMethod: Object.values(groups), totalCost: total };
  }, [serverRuns, hourlyRate]);

  // SVG donut chart data
  const donutSegments = useMemo(() => {
    if (totalCost === 0) return [];
    let offset = 0;
    const circumference = 2 * Math.PI * 35; // radius=35
    return byMethod.map(g => {
      const pct = g.cost / totalCost;
      const dash = pct * circumference;
      const segment = { ...g, pct, dash, offset, color: METHOD_COLORS[g.method] || '#94a3b8' };
      offset += dash;
      return segment;
    });
  }, [byMethod, totalCost]);

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">💰</span>
          Cost Allocation
        </h3>
        <div className="dbg-cost-input">
          <span style={{ color: 'var(--cv-text-muted)', fontSize: '0.7rem' }}>$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={hourlyRate}
            onChange={e => setHourlyRate(Math.max(0, parseFloat(e.target.value) || 0))}
            aria-label="Hourly rate"
          />
          <span style={{ color: 'var(--cv-text-muted)', fontSize: '0.7rem' }}>/hr</span>
        </div>
      </div>
      <div className="dbg-card__body">
        {serverRuns.length === 0 ? (
          <div className="dbg-empty" style={{ padding: '24px 12px' }}>
            <div className="dbg-empty__icon" style={{ fontSize: '1.5rem' }}>💰</div>
            <p className="dbg-empty__text" style={{ fontSize: '0.75rem' }}>
              No server runs available. On-device runs have no server compute cost.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Total cost */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--cv-text)' }}>
                ${totalCost.toFixed(4)}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--cv-text-muted)' }}>
                Total estimated cost · {serverRuns.length} runs
              </div>
            </div>

            {/* Donut chart + legend */}
            <div className="dbg-donut">
              <svg width="90" height="90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="35" fill="none" stroke="oklch(0.20 0.02 290)" strokeWidth="10" />
                {donutSegments.map((seg, i) => (
                  <circle
                    key={seg.method}
                    cx="40" cy="40" r="35"
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="10"
                    strokeDasharray={`${seg.dash} ${2 * Math.PI * 35 - seg.dash}`}
                    strokeDashoffset={-seg.offset}
                    transform="rotate(-90 40 40)"
                    style={{ transition: 'stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease' }}
                  />
                ))}
              </svg>
              <div className="dbg-donut__legend">
                {byMethod.map(g => (
                  <div key={g.method} className="dbg-donut__legend-item">
                    <div className="dbg-stacked-legend__swatch" style={{ background: METHOD_COLORS[g.method] }} />
                    <span style={{ fontWeight: 600, color: METHOD_COLORS[g.method] }}>
                      {METHOD_LABELS[g.method]}
                    </span>
                    <span>${g.cost.toFixed(4)} ({g.count} runs)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Avg cost per run by method */}
            <div style={{ fontSize: '0.68rem', color: 'var(--cv-text-muted)', borderTop: '1px solid oklch(0.22 0.03 290 / 0.6)', paddingTop: '8px' }}>
              {byMethod.map(g => (
                <div key={g.method} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{METHOD_LABELS[g.method]} avg/run</span>
                  <span style={{ fontFamily: 'var(--dbg-mono)' }}>${(g.cost / g.count).toFixed(5)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
