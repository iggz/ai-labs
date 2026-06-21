/**
 * @file AngleHeatmap.jsx
 * @description Grid heatmap visualizing per-rep angle values across runs.
 *
 * Rows represent runs (labeled by run# + method tag).
 * Columns represent rep numbers.
 * Cell color reflects divergence from that run's mean angle:
 *   - Within ±2°: cool (green)
 *   - Within ±5°: warm (yellow)
 *   - Beyond ±5°: hot (red)
 *
 * @param {{ runs: Array }} props
 */
import React, { useMemo } from 'react';

/** Normalize method name to CSS class suffix */
function methodClass(m) {
  if (!m) return '';
  return m === 'on-device' ? 'ondevice' : m.toLowerCase();
}

export default function AngleHeatmap({ runs = [] }) {
  /** Filter to runs that have perRepAngles data and compute derived values */
  const { filteredRuns, maxReps } = useMemo(() => {
    const valid = runs
      .filter((r) => r.accuracy?.perRepAngles?.length)
      .map((r) => {
        const angles = r.accuracy.perRepAngles;
        const mean = angles.reduce((s, v) => s + v, 0) / angles.length;
        return { run: r, angles, mean };
      });
    const max = valid.reduce((m, d) => Math.max(m, d.angles.length), 0);
    return { filteredRuns: valid, maxReps: max };
  }, [runs]);

  if (!filteredRuns.length) {
    return (
      <div className="dbg-card">
        <div className="dbg-card__header">
          <h3 className="dbg-card__title">
            <span className="dbg-card__title-icon">📐</span> Angle Heatmap
          </h3>
        </div>
        <div className="dbg-card__body">
          <div className="dbg-empty">
            <span className="dbg-empty__icon">📭</span>
            <p className="dbg-empty__title">No angle data</p>
            <p className="dbg-empty__text">Runs with per-rep angle data will appear here.</p>
          </div>
        </div>
      </div>
    );
  }

  // Grid columns: label column + one column per rep
  const colCount = maxReps + 1;
  const gridStyle = {
    gridTemplateColumns: `120px repeat(${maxReps}, minmax(36px, 1fr))`,
  };

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">📐</span> Angle Heatmap
        </h3>
        <span className="dbg-card__badge">{filteredRuns.length} runs</span>
      </div>
      <div className="dbg-card__body--flush" style={{ overflowX: 'auto' }}>
        <div className="dbg-heatmap" style={gridStyle}>
          {/* Header row */}
          <div className="dbg-heatmap__header" />
          {Array.from({ length: maxReps }, (_, i) => (
            <div key={`h-${i}`} className="dbg-heatmap__header">
              Rep {i + 1}
            </div>
          ))}

          {/* Data rows */}
          {filteredRuns.map(({ run, angles, mean }) => {
            const key = run.run_name || String(run.run_number);
            const mc = methodClass(run.method);

            return (
              <React.Fragment key={key}>
                {/* Label cell */}
                <div
                  className="dbg-heatmap__header"
                  style={{
                    justifyContent: 'flex-start',
                    paddingLeft: 8,
                    gap: 6,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontFamily: 'var(--dbg-mono)', fontSize: '0.65rem' }}>
                    #{run.run_number}
                  </span>
                  <span className={`dbg-method-tag dbg-method-tag--${mc}`}>
                    {run.method}
                  </span>
                </div>

                {/* Angle cells */}
                {Array.from({ length: maxReps }, (_, i) => {
                  const angle = angles[i];
                  if (angle == null) {
                    return (
                      <div
                        key={`${key}-${i}`}
                        className="dbg-heatmap__cell"
                        style={{ opacity: 0.15 }}
                      >
                        —
                      </div>
                    );
                  }
                  const diff = Math.abs(angle - mean);
                  let heatClass = 'dbg-heat--cool';
                  if (diff > 5) heatClass = 'dbg-heat--hot';
                  else if (diff > 2) heatClass = 'dbg-heat--warm';

                  return (
                    <div
                      key={`${key}-${i}`}
                      className={`dbg-heatmap__cell ${heatClass}`}
                      title={`${angle.toFixed(1)}° (mean ${mean.toFixed(1)}°, Δ${diff.toFixed(1)}°)`}
                    >
                      {angle.toFixed(0)}°
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
