/**
 * @file ServerPhaseBreakdown.jsx
 * @description Stacked horizontal bar per server run showing phase-level timing breakdown.
 *              Filters to server-method runs only (method !== 'on-device').
 *              Phases: inference (green), overlay (yellow), encode (blue),
 *                      postprocess (purple), video_decode (red).
 *
 * @param {Object}   props
 * @param {Array}    props.runs            - Array of unified run objects
 * @param {string}   [props.selectedRunKey] - Currently selected run key
 * @param {Function} [props.onSelectRun]   - Callback when a row is clicked: (runKey) => void
 */
import React, { useMemo, useCallback } from 'react';

/** Phase definitions: key in server_timings → label, color */
const PHASES = [
  { key: 'inference_total_ms', label: 'Inference', color: '#22c55e' },
  { key: 'overlay_render_ms', label: 'Overlay', color: '#eab308' },
  { key: 'video_encode_ms', label: 'Encode', color: '#3b82f6' },
  { key: 'postprocess_ms', label: 'Postprocess', color: '#a855f7' },
  { key: 'video_decode_ms', label: 'Decode', color: '#ef4444' },
];

/** Format milliseconds */
function fmt(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

/** Get the run key used for selection */
function getRunKey(run) {
  return run.run_name || run._key || `run-${run.run_number ?? '?'}`;
}

export default function ServerPhaseBreakdown({ runs = [], selectedRunKey, onSelectRun }) {
  /** Filter to server-method runs that have server_timings */
  const serverRuns = useMemo(
    () =>
      runs.filter((run) => {
        const method = (run.method || '').toLowerCase();
        return method !== 'on-device' && run.server_timings?.total_server_ms > 0;
      }),
    [runs]
  );

  const handleRowClick = useCallback(
    (key) => {
      if (onSelectRun) onSelectRun(key);
    },
    [onSelectRun]
  );

  if (serverRuns.length === 0) {
    return (
      <div className="dbg-card">
        <div className="dbg-card__header">
          <h3 className="dbg-card__title">
            <span className="dbg-card__title-icon">🖥</span> Server Phase Breakdown
          </h3>
        </div>
        <div className="dbg-card__body">
          <div className="dbg-empty">
            <div className="dbg-empty__icon">🖥</div>
            <h4 className="dbg-empty__title">No server runs</h4>
            <p className="dbg-empty__text">
              Server phase data requires DNN or YOLO method runs with server_timings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">🖥</span> Server Phase Breakdown
        </h3>
        <span className="dbg-card__badge">{serverRuns.length} runs</span>
      </div>
      <div className="dbg-card__body">
        <div className="dbg-bar-chart">
          {serverRuns.map((run) => {
            const key = getRunKey(run);
            const st = run.server_timings;
            const totalMs = st.total_server_ms || 1;
            const isSelected = selectedRunKey === key;
            const isCold = !!st.cold_start;
            const label = run.run_number != null
              ? `#${run.run_number}`
              : key.slice(0, 8);

            return (
              <div
                key={key}
                className={`dbg-bar-row${isSelected ? ' dbg-bar-row--selected' : ''}`}
                onClick={() => handleRowClick(key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleRowClick(key);
                  }
                }}
              >
                <span className="dbg-bar-label" title={key}>
                  {label}
                  {isCold && (
                    <>
                      {' '}
                      <span className="dbg-badge dbg-badge--cold">COLD</span>
                    </>
                  )}
                </span>
                <div className="dbg-stacked-bar" style={{ flex: 1 }}>
                  {PHASES.map(({ key: phaseKey, label: phaseLabel, color }) => {
                    const phaseMs = st[phaseKey];
                    if (!phaseMs || phaseMs <= 0) return null;
                    const widthPct = Math.max((phaseMs / totalMs) * 100, 0.5);
                    return (
                      <div
                        key={phaseKey}
                        className="dbg-stacked-segment"
                        style={{ width: `${widthPct}%`, background: color }}
                        data-tooltip={`${phaseLabel}: ${fmt(phaseMs)}`}
                      />
                    );
                  })}
                </div>
                <span className="dbg-bar-value">{fmt(totalMs)}</span>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="dbg-stacked-legend">
          {PHASES.map(({ key, label, color }) => (
            <div key={key} className="dbg-stacked-legend__item">
              <span
                className="dbg-stacked-legend__swatch"
                style={{ background: color }}
              />
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
