/**
 * MemoryProfile — Before/after JS heap comparison across runs.
 *
 * Shows usedJSHeapSize delta per run, color-coded by severity.
 */

import { useMemo } from 'react';

function fmtMB(bytes) {
  if (bytes == null) return '—';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export default function MemoryProfile({ runs }) {
  const memRuns = useMemo(() => {
    return runs
      .filter(r => r.performance_profile?.memoryBefore?.usedJSHeapSize != null
                 && r.performance_profile?.memoryAfter?.usedJSHeapSize != null)
      .map(r => {
        const before = r.performance_profile.memoryBefore.usedJSHeapSize;
        const after = r.performance_profile.memoryAfter.usedJSHeapSize;
        const delta = after - before;
        const limit = r.performance_profile.memoryBefore.jsHeapSizeLimit || 0;
        return { ...r, before, after, delta, limit };
      });
  }, [runs]);

  const maxHeap = useMemo(() => {
    if (!memRuns.length) return 1;
    return Math.max(...memRuns.map(r => Math.max(r.before, r.after, r.limit || 0)));
  }, [memRuns]);

  const METHOD_COLORS = {
    dnn: '#f97316', yolo: '#8b5cf6', 'on-device': '#06b6d4', ondevice: '#06b6d4',
  };

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">🧠</span>
          Memory Profile
        </h3>
        {memRuns.length > 0 && (
          <span className="dbg-card__badge">{memRuns.length} runs</span>
        )}
      </div>
      <div className="dbg-card__body">
        {memRuns.length === 0 ? (
          <div className="dbg-empty" style={{ padding: '24px 12px' }}>
            <div className="dbg-empty__icon" style={{ fontSize: '1.5rem' }}>🧠</div>
            <p className="dbg-empty__text" style={{ fontSize: '0.75rem' }}>
              No memory profiling data available. Memory tracking requires Chrome.
            </p>
          </div>
        ) : (
          <div className="dbg-bar-chart">
            {memRuns.map(r => {
              const key = r._key || r.run_name;
              const deltaMB = r.delta / 1024 / 1024;
              const severity = deltaMB > 20 ? 'danger' : deltaMB > 5 ? 'warning' : 'success';
              const color = severity === 'danger' ? '#ef4444' : severity === 'warning' ? '#eab308' : '#22c55e';
              const pctBefore = (r.before / maxHeap) * 100;
              const pctAfter = (r.after / maxHeap) * 100;

              return (
                <div key={key} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, width: '72px', flexShrink: 0, color: METHOD_COLORS[r.method] || '#94a3b8' }}>
                      #{r.run_number}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                      {fmtMB(r.before)} → {fmtMB(r.after)}
                    </span>
                    <span className={`dbg-delta dbg-delta--${r.delta > 0 ? 'positive' : r.delta < 0 ? 'negative' : 'neutral'}`}>
                      {r.delta > 0 ? '+' : ''}{fmtMB(r.delta)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '2px', height: '14px' }}>
                    <div style={{
                      width: `${pctBefore}%`, height: '100%', borderRadius: '3px 0 0 3px',
                      background: 'oklch(0.5 0.05 290 / 0.4)',
                    }} />
                    <div style={{
                      width: `${Math.abs(pctAfter - pctBefore)}%`, height: '100%',
                      borderRadius: '0 3px 3px 0',
                      background: color,
                      opacity: 0.6,
                    }} />
                  </div>
                  {r.limit > 0 && (
                    <div style={{ fontSize: '0.6rem', color: '#64748b', marginTop: '2px' }}>
                      Heap limit: {fmtMB(r.limit)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
