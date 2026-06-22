/**
 * BenchmarkTimeline.jsx — Scatter plot of processing_time_ms over time
 * ======================================================================
 * Pure SVG scatter plot, colored by protocol. Hoverable dots show job details.
 * Lets you visually spot regressions or improvements over time.
 */

import { useMemo, useState, useCallback } from 'react';

const PROTOCOL_COLORS = {
  dml:        '#f59e0b',
  yolo:       '#34d399',
  cuda:       '#818cf8',
  'on-device':'#c084fc',
  opencv:     '#94a3b8',
};

const PROTOCOL_LABELS = {
  dml:        '⚡⚡ DirectML',
  yolo:       'Metal',
  cuda:       'CUDA',
  'on-device':'On Device',
  opencv:     'DNN',
};

function formatMs(ms) {
  if (!ms) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function BenchmarkTimeline({ data }) {
  const [tooltip, setTooltip] = useState(null);

  const filtered = useMemo(() =>
    data.filter(r => r.processing_time_ms && r.created_at),
    [data]
  );

  const { points, xMin, xMax, yMax } = useMemo(() => {
    if (!filtered.length) return { points: [], xMin: 0, xMax: 1, yMax: 1 };

    const times = filtered.map(r => new Date(r.created_at).getTime());
    const vals   = filtered.map(r => r.processing_time_ms);

    return {
      points: filtered.map((r, i) => ({
        x: times[i],
        y: r.processing_time_ms,
        protocol: r.protocol || 'opencv',
        row: r,
      })),
      xMin: Math.min(...times),
      xMax: Math.max(...times),
      yMax: Math.max(...vals) * 1.1,
    };
  }, [filtered]);

  if (!points.length) {
    return (
      <div className="benchmark-timeline benchmark-empty">
        No timeline data yet
      </div>
    );
  }

  // SVG dimensions
  const W         = 700;
  const H         = 220;
  const padL      = 60;
  const padR      = 20;
  const padT      = 16;
  const padB      = 32;
  const plotW     = W - padL - padR;
  const plotH     = H - padT - padB;

  const xRange = xMax - xMin || 1;

  const toSvgX = (t) => padL + ((t - xMin) / xRange) * plotW;
  const toSvgY = (v) => padT + plotH - (v / yMax) * plotH;

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    val: yMax * f,
    y: padT + plotH - f * plotH,
  }));

  // X-axis ticks (up to 5)
  const xTickCount = Math.min(5, points.length);
  const xTicks = Array.from({ length: xTickCount }, (_, i) => {
    const t = xMin + (i / Math.max(xTickCount - 1, 1)) * xRange;
    return { t, x: toSvgX(t) };
  });

  const handleMouseEnter = useCallback((e, row) => {
    setTooltip({
      x: e.clientX, y: e.clientY,
      protocol: PROTOCOL_LABELS[row.protocol] || row.protocol,
      time: formatMs(row.processing_time_ms),
      date: new Date(row.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }),
      machine: row.machine_id || '—',
    });
  }, []);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const protocols = [...new Set(points.map(p => p.protocol))];

  return (
    <div className="benchmark-timeline">
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Processing time scatter plot over time"
      >
        {/* Grid lines */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={padL} y1={tick.y}
              x2={padL + plotW} y2={tick.y}
              className="benchmark-timeline__grid-line"
            />
            <text
              x={padL - 6}
              y={tick.y}
              textAnchor="end"
              dominantBaseline="middle"
              className="benchmark-timeline__axis-label"
            >
              {formatMs(tick.val)}
            </text>
          </g>
        ))}

        {/* X-axis ticks */}
        {xTicks.map((tick, i) => (
          <text
            key={i}
            x={tick.x}
            y={H - padB + 14}
            textAnchor="middle"
            className="benchmark-timeline__axis-label"
          >
            {new Date(tick.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
        ))}

        {/* Dots */}
        {points.map((pt, i) => (
          <circle
            key={i}
            cx={toSvgX(pt.x)}
            cy={toSvgY(pt.y)}
            r={4}
            fill={PROTOCOL_COLORS[pt.protocol] || '#94a3b8'}
            fillOpacity={0.8}
            stroke="rgba(0,0,0,0.3)"
            strokeWidth={1}
            className="benchmark-timeline__dot"
            onMouseEnter={(e) => handleMouseEnter(e, pt.row)}
            onMouseLeave={handleMouseLeave}
          />
        ))}
      </svg>

      {/* Legend */}
      <div className="benchmark-barchart__legend">
        {protocols.map(p => (
          <span key={p}>
            <span
              className="benchmark-barchart__legend-swatch"
              style={{ background: PROTOCOL_COLORS[p] || '#94a3b8' }}
            />
            {PROTOCOL_LABELS[p] || p}
          </span>
        ))}
      </div>

      {tooltip && (
        <div
          className="benchmark-tooltip"
          style={{ top: tooltip.y + 12, left: tooltip.x + 12 }}
        >
          <strong>{tooltip.protocol}</strong>
          <div>{tooltip.time}</div>
          <div style={{ opacity: 0.7 }}>{tooltip.date}</div>
          <div style={{ opacity: 0.6 }}>Machine: {tooltip.machine}</div>
        </div>
      )}
    </div>
  );
}
