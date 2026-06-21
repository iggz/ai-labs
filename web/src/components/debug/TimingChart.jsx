/**
 * @file TimingChart.jsx
 * @description Grouped bar chart comparing total processing time across methods, per run.
 *              Displays a horizontal bar per run, color-coded by method, with sort toggle.
 *
 * @param {Object}   props
 * @param {Array}    props.runs           - Array of unified run objects
 * @param {string}   [props.selectedRunKey] - Currently selected run key
 * @param {Function} [props.onSelectRun]  - Callback when a bar is clicked: (runKey) => void
 */
import React, { useState, useMemo, useCallback } from 'react';

/** Method → color mapping */
const METHOD_COLORS = {
  dnn: '#f97316',
  yolo: '#8b5cf6',
  'on-device': '#06b6d4',
};

/** Format milliseconds to human-readable string */
function fmt(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

/** Sort modes cycle: run_number → time_asc → time_desc */
const SORT_MODES = ['run_number', 'time_asc', 'time_desc'];
const SORT_LABELS = { run_number: '#', time_asc: '↑', time_desc: '↓' };

/**
 * Derive total time from a run object.
 * Server methods: totalRoundTripMs or total_server_ms.
 * On-device: sum of on_device_phases or totalRoundTripMs.
 */
function getTotalTime(run) {
  const method = (run.method || '').toLowerCase();

  if (method === 'on-device') {
    // Prefer on_device_phases sum if available
    const phases = run.on_device_phases;
    if (phases && typeof phases === 'object') {
      const sum = Object.values(phases).reduce((acc, v) => {
        return acc + (typeof v === 'number' ? v : 0);
      }, 0);
      if (sum > 0) return sum;
    }
    return run.client_timings?.totalRoundTripMs ?? 0;
  }

  // Server-based methods
  return (
    run.client_timings?.totalRoundTripMs ??
    run.server_timings?.total_server_ms ??
    0
  );
}

/** Get the run key used for selection */
function getRunKey(run) {
  return run.run_name || run._key || `run-${run.run_number ?? '?'}`;
}

export default function TimingChart({ runs = [], selectedRunKey, onSelectRun }) {
  const [sortMode, setSortMode] = useState('run_number');

  const cycleSortMode = useCallback(() => {
    setSortMode((prev) => {
      const idx = SORT_MODES.indexOf(prev);
      return SORT_MODES[(idx + 1) % SORT_MODES.length];
    });
  }, []);

  /** Runs with computed total time, filtered and sorted */
  const sortedRuns = useMemo(() => {
    const withTime = runs
      .map((run) => ({ run, total: getTotalTime(run), key: getRunKey(run) }))
      .filter((entry) => entry.total > 0);

    if (sortMode === 'time_asc') {
      withTime.sort((a, b) => a.total - b.total);
    } else if (sortMode === 'time_desc') {
      withTime.sort((a, b) => b.total - a.total);
    } else {
      withTime.sort((a, b) => (a.run.run_number ?? 0) - (b.run.run_number ?? 0));
    }

    return withTime;
  }, [runs, sortMode]);

  const maxTime = useMemo(
    () => Math.max(...sortedRuns.map((e) => e.total), 1),
    [sortedRuns]
  );

  const handleBarClick = useCallback(
    (key) => {
      if (onSelectRun) onSelectRun(key);
    },
    [onSelectRun]
  );

  if (!runs.length || sortedRuns.length === 0) {
    return (
      <div className="dbg-card">
        <div className="dbg-card__header">
          <h3 className="dbg-card__title">
            <span className="dbg-card__title-icon">⏱</span> Timing Comparison
          </h3>
        </div>
        <div className="dbg-card__body">
          <div className="dbg-empty">
            <div className="dbg-empty__icon">⏱</div>
            <h4 className="dbg-empty__title">No timing data</h4>
            <p className="dbg-empty__text">
              Run some analyses to see timing comparisons across methods.
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
          <span className="dbg-card__title-icon">⏱</span> Timing Comparison
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="dbg-card__badge">{sortedRuns.length} runs</span>
          <button
            className="dbg-btn dbg-btn--ghost dbg-btn--sm"
            onClick={cycleSortMode}
            title={`Sort: ${sortMode.replace('_', ' ')}`}
          >
            Sort {SORT_LABELS[sortMode]}
          </button>
        </div>
      </div>
      <div className="dbg-card__body">
        <div className="dbg-bar-chart">
          {sortedRuns.map(({ run, total, key }) => {
            const method = (run.method || 'dnn').toLowerCase();
            const color = METHOD_COLORS[method] || '#94a3b8';
            const widthPct = (total / maxTime) * 100;
            const isSelected = selectedRunKey === key;
            const label = run.run_number != null
              ? `#${run.run_number}`
              : key.slice(0, 8);

            return (
              <div
                key={key}
                className={`dbg-bar-row${isSelected ? ' dbg-bar-row--selected' : ''}`}
                onClick={() => handleBarClick(key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleBarClick(key);
                  }
                }}
              >
                <span className="dbg-bar-label" title={key}>{label}</span>
                <div className="dbg-bar-track">
                  <div
                    className="dbg-bar-fill"
                    style={{
                      width: `${Math.max(widthPct, 1)}%`,
                      background: color,
                    }}
                  />
                </div>
                <span className="dbg-bar-value">{fmt(total)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
