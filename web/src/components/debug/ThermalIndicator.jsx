/**
 * ThermalIndicator — Thermal throttling detection summary across runs.
 *
 * Scans performance_profile.thermalThrottlingDetected and flags affected runs.
 */

import { useMemo } from 'react';

const METHOD_LABELS = { dnn: 'DNN', yolo: 'YOLO', 'on-device': 'On-Device', ondevice: 'On-Device' };
const METHOD_COLORS = { dnn: '#f97316', yolo: '#8b5cf6', 'on-device': '#06b6d4', ondevice: '#06b6d4' };

export default function ThermalIndicator({ runs }) {
  const { totalChecked, throttled, clean } = useMemo(() => {
    const withData = runs.filter(r => r.performance_profile != null);
    const flagged = withData.filter(r => r.performance_profile.thermalThrottlingDetected);
    return { totalChecked: withData.length, throttled: flagged, clean: withData.length - flagged.length };
  }, [runs]);

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">🌡</span>
          Thermal Throttling
        </h3>
        {totalChecked > 0 && (
          <span className={`dbg-badge ${throttled.length > 0 ? 'dbg-badge--critical' : 'dbg-badge--ok'}`}>
            {throttled.length > 0 ? `${throttled.length} flagged` : 'All clear'}
          </span>
        )}
      </div>
      <div className="dbg-card__body">
        {totalChecked === 0 ? (
          <div className="dbg-empty" style={{ padding: '24px 12px' }}>
            <div className="dbg-empty__icon" style={{ fontSize: '1.5rem' }}>🌡</div>
            <p className="dbg-empty__text" style={{ fontSize: '0.75rem' }}>
              No thermal data available. Thermal detection runs during on-device inference.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Summary */}
            <div style={{ fontSize: '0.78rem', color: 'var(--cv-text-muted)' }}>
              {throttled.length} of {totalChecked} runs detected thermal throttling
            </div>

            {/* Progress bar */}
            <div style={{ height: '8px', borderRadius: '4px', background: 'oklch(0.18 0.02 290 / 0.6)', overflow: 'hidden' }}>
              <div style={{
                width: `${(clean / totalChecked) * 100}%`,
                height: '100%',
                borderRadius: '4px',
                background: 'linear-gradient(90deg, #22c55e, #86efac)',
                transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--cv-text-muted)' }}>
              <span>✅ {clean} clean</span>
              <span>🔥 {throttled.length} throttled</span>
            </div>

            {/* Flagged runs list */}
            {throttled.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                {throttled.map(r => (
                  <div key={r._key || r.run_name} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '4px 8px', borderRadius: '6px',
                    background: 'oklch(0.55 0.16 30 / 0.08)',
                  }}>
                    <span>🔥</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: METHOD_COLORS[r.method] }}>
                      #{r.run_number}
                    </span>
                    <span className={`dbg-method-tag dbg-method-tag--${r.method === 'on-device' ? 'ondevice' : r.method}`}>
                      {METHOD_LABELS[r.method] || r.method}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
