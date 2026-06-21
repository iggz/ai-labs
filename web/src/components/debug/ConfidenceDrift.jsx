/**
 * @file ConfidenceDrift.jsx
 * @description SVG line chart showing avgConfidence trends across runs,
 * grouped and colored by method.
 *
 * - X-axis: run numbers (chronological)
 * - Y-axis: avgConfidence (0–1, displayed as 0%–100%)
 * - One polyline per method, colored by method palette
 * - Dots at each data point; selected run dot rendered larger (r=5 vs r=3)
 * - Grid lines at 25%, 50%, 75%, 100%
 *
 * @param {{ runs: Array, selectedRunKey?: string }} props
 */
import React, { useMemo } from 'react';

const METHOD_COLORS = {
  dnn: '#f97316',
  yolo: '#8b5cf6',
  'on-device': '#06b6d4',
};

/** Chart layout constants */
const PADDING = { top: 16, right: 20, bottom: 36, left: 46 };
const VIEWBOX_W = 600;
const VIEWBOX_H = 260;
const CHART_W = VIEWBOX_W - PADDING.left - PADDING.right;
const CHART_H = VIEWBOX_H - PADDING.top - PADDING.bottom;

/** Y-axis grid ticks */
const Y_TICKS = [0.25, 0.5, 0.75, 1.0];

export default function ConfidenceDrift({ runs = [], selectedRunKey }) {
  /** Filter to runs with confidence data, sorted chronologically */
  const validRuns = useMemo(
    () =>
      runs
        .filter((r) => r.accuracy?.avgConfidence != null && r.run_number != null)
        .sort((a, b) => a.run_number - b.run_number),
    [runs],
  );

  /** Group valid runs by method */
  const { methodGroups, runNumbers } = useMemo(() => {
    const groups = {};
    const nums = new Set();
    for (const r of validRuns) {
      const m = r.method || 'unknown';
      if (!groups[m]) groups[m] = [];
      groups[m].push(r);
      nums.add(r.run_number);
    }
    return { methodGroups: groups, runNumbers: [...nums].sort((a, b) => a - b) };
  }, [validRuns]);

  if (validRuns.length < 2) {
    return (
      <div className="dbg-card">
        <div className="dbg-card__header">
          <h3 className="dbg-card__title">
            <span className="dbg-card__title-icon">📈</span> Confidence Drift
          </h3>
        </div>
        <div className="dbg-card__body">
          <div className="dbg-empty">
            <span className="dbg-empty__icon">📉</span>
            <p className="dbg-empty__title">Not enough data</p>
            <p className="dbg-empty__text">At least 2 runs with confidence scores are needed to plot trends.</p>
          </div>
        </div>
      </div>
    );
  }

  /** Map a run_number to x pixel coordinate */
  const minRun = runNumbers[0];
  const maxRun = runNumbers[runNumbers.length - 1];
  const xRange = maxRun - minRun || 1;
  const toX = (num) => PADDING.left + ((num - minRun) / xRange) * CHART_W;
  const toY = (conf) => PADDING.top + (1 - conf) * CHART_H;

  /** Determine which x-axis labels to show (avoid overlap) */
  const maxLabels = Math.floor(CHART_W / 40);
  const step = Math.max(1, Math.ceil(runNumbers.length / maxLabels));
  const xLabels = runNumbers.filter((_, i) => i % step === 0 || i === runNumbers.length - 1);

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">📈</span> Confidence Drift
        </h3>
        <span className="dbg-card__badge">{validRuns.length} data points</span>
      </div>
      <div className="dbg-card__body">
        <svg
          className="dbg-svg-chart"
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Y-axis grid lines + labels */}
          {Y_TICKS.map((tick) => {
            const y = toY(tick);
            return (
              <g key={tick}>
                <line
                  className="dbg-svg-grid"
                  x1={PADDING.left}
                  y1={y}
                  x2={VIEWBOX_W - PADDING.right}
                  y2={y}
                />
                <text x={PADDING.left - 6} y={y + 3} textAnchor="end">
                  {(tick * 100).toFixed(0)}%
                </text>
              </g>
            );
          })}

          {/* Baseline at y=0 */}
          <line
            className="dbg-svg-grid"
            x1={PADDING.left}
            y1={toY(0)}
            x2={VIEWBOX_W - PADDING.right}
            y2={toY(0)}
          />
          <text x={PADDING.left - 6} y={toY(0) + 3} textAnchor="end">
            0%
          </text>

          {/* X-axis labels */}
          {xLabels.map((num) => (
            <text
              key={`xl-${num}`}
              x={toX(num)}
              y={VIEWBOX_H - 6}
              textAnchor="middle"
            >
              #{num}
            </text>
          ))}

          {/* Lines + dots per method */}
          {Object.entries(methodGroups).map(([method, groupRuns]) => {
            const color = METHOD_COLORS[method] || '#94a3b8';
            const sorted = [...groupRuns].sort((a, b) => a.run_number - b.run_number);
            const points = sorted.map((r) => ({
              x: toX(r.run_number),
              y: toY(r.accuracy.avgConfidence),
              run: r,
            }));

            const pathD = points
              .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
              .join(' ');

            return (
              <g key={method}>
                {/* Polyline */}
                <path className="dbg-svg-line" d={pathD} stroke={color} />

                {/* Dots */}
                {points.map((p) => {
                  const key = p.run.run_name || String(p.run.run_number);
                  const isSelected = key === selectedRunKey;
                  return (
                    <circle
                      key={key}
                      className="dbg-svg-dot"
                      cx={p.x.toFixed(1)}
                      cy={p.y.toFixed(1)}
                      r={isSelected ? 5 : 3}
                      fill={color}
                      stroke={isSelected ? '#fff' : 'none'}
                      strokeWidth={isSelected ? 1.5 : 0}
                    >
                      <title>
                        #{p.run.run_number} ({method}): {(p.run.accuracy.avgConfidence * 100).toFixed(1)}%
                      </title>
                    </circle>
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="dbg-stacked-legend" style={{ marginTop: 8 }}>
          {Object.keys(methodGroups).map((method) => (
            <div key={method} className="dbg-stacked-legend__item">
              <span
                className="dbg-stacked-legend__swatch"
                style={{ background: METHOD_COLORS[method] || '#94a3b8' }}
              />
              {method}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
