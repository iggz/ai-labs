/**
 * BenchmarkBarChart.jsx — Head-to-head horizontal bar chart
 * ===========================================================
 * Pure SVG (no charting library). Compares p50 and p95
 * processing_time_ms per protocol using the design tokens.
 */

import { useMemo, useState } from 'react';

// Protocol colours (oklch from design system)
const PROTOCOL_COLORS = {
  dml:        '#f59e0b',  // amber
  yolo:       '#34d399',  // mint
  cuda:       '#818cf8',  // indigo
  'on-device':'#c084fc',  // lilac
  opencv:     '#94a3b8',  // slate
};

const PROTOCOL_LABELS = {
  dml:        '⚡⚡ DirectML',
  yolo:       'Metal',
  cuda:       'CUDA',
  'on-device':'On Device',
  opencv:     'DNN',
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function BenchmarkBarChart({ data }) {
  const [tooltip, setTooltip] = useState(null);

  const stats = useMemo(() => {
    const map = {};
    for (const row of data) {
      if (!row.processing_time_ms) continue;
      const p = row.protocol || 'opencv';
      if (!map[p]) map[p] = [];
      map[p].push(row.processing_time_ms);
    }

    return Object.entries(map).map(([protocol, times]) => {
      const sorted = [...times].sort((a, b) => a - b);
      return {
        protocol,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        count: sorted.length,
      };
    }).sort((a, b) => (a.p50 || 0) - (b.p50 || 0)); // fastest first
  }, [data]);

  if (!stats.length) {
    return (
      <div className="benchmark-barchart benchmark-empty">
        No processing time data yet
      </div>
    );
  }

  // Chart dimensions
  const labelWidth  = 110;
  const barAreaWidth = 560;
  const rowHeight   = 38;
  const gap         = 6;
  const barH        = 14;
  const paddingTop  = 12;
  const paddingBottom = 20;
  const totalH = paddingTop + stats.length * (rowHeight) + paddingBottom;

  const maxVal = Math.max(...stats.flatMap(s => [s.p50 || 0, s.p95 || 0]));

  const scale = (v) => v === null ? 0 : Math.round((v / maxVal) * barAreaWidth);

  const formatMs = (ms) => {
    if (ms === null) return '—';
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  };

  return (
    <div className="benchmark-barchart">
      <svg
        width="100%"
        viewBox={`0 0 ${labelWidth + barAreaWidth + 60} ${totalH}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Processing time comparison bar chart"
      >
        {/* Background grid lines */}
        {[0.25, 0.5, 0.75, 1].map(frac => (
          <line
            key={frac}
            x1={labelWidth + Math.round(frac * barAreaWidth)}
            y1={paddingTop}
            x2={labelWidth + Math.round(frac * barAreaWidth)}
            y2={totalH - paddingBottom}
            className="benchmark-timeline__grid-line"
          />
        ))}

        {/* Axis labels (top) */}
        {[0.25, 0.5, 0.75, 1].map(frac => (
          <text
            key={frac}
            x={labelWidth + Math.round(frac * barAreaWidth)}
            y={totalH - paddingBottom + 12}
            textAnchor="middle"
            className="benchmark-timeline__axis-label"
          >
            {formatMs(maxVal * frac)}
          </text>
        ))}

        {/* Bars */}
        {stats.map((s, i) => {
          const y = paddingTop + i * rowHeight;
          const color = PROTOCOL_COLORS[s.protocol] || '#94a3b8';
          const label = PROTOCOL_LABELS[s.protocol] || s.protocol;
          const p50w = scale(s.p50);
          const p95w = scale(s.p95);

          return (
            <g key={s.protocol} className="benchmark-barchart__row">
              {/* Protocol label */}
              <text
                x={labelWidth - 8}
                y={y + rowHeight / 2 - 2}
                textAnchor="end"
                className="benchmark-barchart__label"
              >
                {label}
              </text>

              {/* p50 bar */}
              <rect
                x={labelWidth}
                y={y + gap}
                width={p50w}
                height={barH}
                fill={color}
                opacity={0.85}
                rx={4}
                className="benchmark-barchart__bar"
                onMouseEnter={(e) => setTooltip({
                  x: e.clientX, y: e.clientY,
                  content: `${label}\np50: ${formatMs(s.p50)}\np95: ${formatMs(s.p95)}\n${s.count} jobs`,
                })}
                onMouseLeave={() => setTooltip(null)}
              />
              {/* Value label */}
              <text
                x={labelWidth + p50w + 6}
                y={y + gap + barH / 2}
                className="benchmark-barchart__value"
                fontSize={10}
              >
                {formatMs(s.p50)}
              </text>

              {/* p95 bar (below) */}
              <rect
                x={labelWidth}
                y={y + gap + barH + 3}
                width={p95w}
                height={barH - 4}
                fill={color}
                opacity={0.35}
                rx={3}
                className="benchmark-barchart__bar"
                onMouseEnter={(e) => setTooltip({
                  x: e.clientX, y: e.clientY,
                  content: `${label} p95\n${formatMs(s.p95)}`,
                })}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="benchmark-barchart__legend">
        <span>
          <span className="benchmark-barchart__legend-swatch" style={{ background: 'rgba(255,255,255,0.8)' }} />
          Bright bar = p50 (median)
        </span>
        <span>
          <span className="benchmark-barchart__legend-swatch" style={{ background: 'rgba(255,255,255,0.3)' }} />
          Dim bar = p95 (tail latency)
        </span>
        <span style={{ marginLeft: 'auto' }}>Lower is faster</span>
      </div>

      {/* Tooltip (rendered outside SVG for correct stacking) */}
      {tooltip && (
        <div
          className="benchmark-tooltip"
          style={{ top: tooltip.y + 12, left: tooltip.x + 12 }}
        >
          {tooltip.content.split('\n').map((line, i) => (
            <div key={i}>{i === 0 ? <strong>{line}</strong> : line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
