/**
 * BatteryImpact — Battery drain per method.
 *
 * Shows level drop from performance_profile.batteryBefore → batteryAfter,
 * grouped by method.
 */

import { useMemo } from 'react';

const METHOD_LABELS = { dnn: 'DNN', yolo: 'YOLO', 'on-device': 'On-Device', ondevice: 'On-Device' };
const METHOD_COLORS = { dnn: '#f97316', yolo: '#8b5cf6', 'on-device': '#06b6d4', ondevice: '#06b6d4' };

export default function BatteryImpact({ runs }) {
  const batteryRuns = useMemo(() => {
    return runs
      .filter(r =>
        r.performance_profile?.batteryBefore?.level != null &&
        r.performance_profile?.batteryAfter?.level != null
      )
      .map(r => ({
        ...r,
        beforeLevel: r.performance_profile.batteryBefore.level,
        afterLevel: r.performance_profile.batteryAfter.level,
        drain: r.performance_profile.batteryBefore.level - r.performance_profile.batteryAfter.level,
        chargingBefore: r.performance_profile.batteryBefore.charging,
        chargingAfter: r.performance_profile.batteryAfter.charging,
      }));
  }, [runs]);

  // Group by method for aggregate
  const byMethod = useMemo(() => {
    const groups = {};
    for (const r of batteryRuns) {
      const m = r.method === 'ondevice' ? 'on-device' : r.method;
      if (!groups[m]) groups[m] = [];
      groups[m].push(r);
    }
    return Object.entries(groups).map(([method, methodRuns]) => ({
      method,
      avgDrain: methodRuns.reduce((s, r) => s + r.drain, 0) / methodRuns.length,
      count: methodRuns.length,
      runs: methodRuns,
    }));
  }, [batteryRuns]);

  const maxDrain = useMemo(() => {
    return Math.max(0.01, ...batteryRuns.map(r => Math.abs(r.drain)));
  }, [batteryRuns]);

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">🔋</span>
          Battery Impact
        </h3>
        {batteryRuns.length > 0 && (
          <span className="dbg-card__badge">{batteryRuns.length} runs</span>
        )}
      </div>
      <div className="dbg-card__body">
        {batteryRuns.length === 0 ? (
          <div className="dbg-empty" style={{ padding: '24px 12px' }}>
            <div className="dbg-empty__icon" style={{ fontSize: '1.5rem' }}>🔋</div>
            <p className="dbg-empty__text" style={{ fontSize: '0.75rem' }}>
              No battery data available. Battery API is only available on some devices.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Aggregate by method */}
            {byMethod.map(({ method, avgDrain, count }) => (
              <div key={method}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span className={`dbg-method-tag dbg-method-tag--${method === 'on-device' ? 'ondevice' : method}`}>
                    {METHOD_LABELS[method]}
                  </span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--cv-text-muted)' }}>
                    avg {(avgDrain * 100).toFixed(1)}% drain · {count} runs
                  </span>
                </div>
                <div className="dbg-bar-track" style={{ height: '16px' }}>
                  <div className="dbg-bar-fill" style={{
                    width: `${(Math.abs(avgDrain) / maxDrain) * 100}%`,
                    background: METHOD_COLORS[method],
                    opacity: 0.7,
                  }} />
                </div>
              </div>
            ))}

            {/* Individual runs */}
            <div style={{ fontSize: '0.65rem', color: 'var(--cv-text-muted)', marginTop: '4px', borderTop: '1px solid oklch(0.22 0.03 290 / 0.6)', paddingTop: '8px' }}>
              {batteryRuns.map(r => (
                <div key={r._key || r.run_name} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>
                    <span style={{ color: METHOD_COLORS[r.method], fontWeight: 600 }}>#{r.run_number}</span>
                    {' '}{Math.round(r.beforeLevel * 100)}% → {Math.round(r.afterLevel * 100)}%
                  </span>
                  <span>
                    {r.drain > 0 ? `−${(r.drain * 100).toFixed(1)}%` : 'No drain'}
                    {(r.chargingBefore || r.chargingAfter) && ' ⚡'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
