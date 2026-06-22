/**
 * BenchmarkDetailCard.jsx — Expandable per-backend detail card
 * =============================================================
 * Shows processing time distribution (min/p25/p50/p75/p95/max),
 * queue wait distribution, avg file size, and job count by exercise type.
 */

import { useState, useMemo } from 'react';

const PROTOCOL_LABELS = {
  dml:        '⚡⚡ DirectML',
  yolo:       'Metal',
  cuda:       'CUDA',
  'on-device':'On Device',
  opencv:     'DNN',
};

const PROTOCOL_ICONS = {
  dml:        '⚡',
  yolo:       '🍎',
  cuda:       '🟢',
  'on-device':'📱',
  opencv:     '🔧',
};

const PROTOCOL_COLORS = {
  dml:        '#f59e0b',
  yolo:       '#34d399',
  cuda:       '#818cf8',
  'on-device':'#c084fc',
  opencv:     '#94a3b8',
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function formatMs(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatBytes(b) {
  if (!b) return '—';
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}

function PercentileBar({ sorted, color }) {
  const pcts = [0, 25, 50, 75, 95, 100];
  const vals = pcts.map(p => {
    if (p === 0) return sorted[0] || 0;
    if (p === 100) return sorted[sorted.length - 1] || 0;
    return percentile(sorted, p);
  });
  const maxVal = vals[vals.length - 1] || 1;
  const labels = ['min', 'p25', 'p50', 'p75', 'p95', 'max'];

  return (
    <div className="benchmark-detail-percentiles">
      {vals.map((v, i) => (
        <div key={i} className="benchmark-percentile-bar">
          <div
            className="benchmark-percentile-bar__fill"
            style={{
              height: `${Math.max(4, (v / maxVal) * 60)}px`,
              background: color,
              opacity: 0.3 + (i / vals.length) * 0.7,
            }}
          />
          <div className="benchmark-percentile-bar__label">
            <div style={{ fontWeight: 700, fontSize: '0.65rem', color: 'var(--cv-text)' }}>
              {formatMs(v)}
            </div>
            <div>{labels[i]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BenchmarkDetailCard({ protocol, rows }) {
  const [open, setOpen] = useState(false);

  const stats = useMemo(() => {
    const times = rows.map(r => r.processing_time_ms).filter(Boolean).sort((a, b) => a - b);
    const queues = rows.map(r => r.queue_wait_ms).filter(Boolean).sort((a, b) => a - b);
    const sizes = rows.map(r => r.file_size_bytes).filter(Boolean);
    const avgSize = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : null;

    const lastSeen = rows.length ? rows[0].created_at : null;

    return { times, queues, avgSize, lastSeen };
  }, [rows]);

  const color = PROTOCOL_COLORS[protocol] || '#94a3b8';
  const label = PROTOCOL_LABELS[protocol] || protocol;
  const icon  = PROTOCOL_ICONS[protocol] || '?';

  if (!rows.length) return null;

  return (
    <div className="benchmark-detail-card">
      <div
        className="benchmark-detail-card__header"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setOpen(o => !o)}
        id={`benchmark-detail-${protocol}`}
      >
        <div className="benchmark-detail-card__title">
          <span>{icon}</span>
          <span style={{ color }}>{label}</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--cv-text-muted)', fontWeight: 400 }}>
            {rows.length} jobs
          </span>
        </div>
        <svg
          className={`benchmark-detail-card__chevron ${open ? 'benchmark-detail-card__chevron--open' : ''}`}
          width={16} height={16} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && (
        <div className="benchmark-detail-card__body">
          {/* Processing time distribution */}
          <div style={{ marginTop: '0.75rem' }}>
            <div className="benchmark-section__title" style={{ marginBottom: '0.5rem' }}>
              Processing Time Distribution
            </div>
            {stats.times.length > 0
              ? <PercentileBar sorted={stats.times} color={color} />
              : <div style={{ color: 'var(--cv-text-muted)', fontSize: '0.8rem' }}>No data</div>
            }
          </div>

          {/* Summary stats */}
          <div className="benchmark-detail-card__stats">
            <div className="benchmark-detail-stat">
              <div className="benchmark-detail-stat__value">{formatMs(stats.times[0])}</div>
              <div className="benchmark-detail-stat__label">Fastest</div>
            </div>
            <div className="benchmark-detail-stat">
              <div className="benchmark-detail-stat__value">
                {formatMs(percentile(stats.times, 50))}
              </div>
              <div className="benchmark-detail-stat__label">Median</div>
            </div>
            <div className="benchmark-detail-stat">
              <div className="benchmark-detail-stat__value">
                {formatMs(stats.times[stats.times.length - 1])}
              </div>
              <div className="benchmark-detail-stat__label">Slowest</div>
            </div>
          </div>

          {/* Queue wait (if available) */}
          {stats.queues.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <div className="benchmark-section__title" style={{ marginBottom: '0.25rem' }}>
                Queue Wait
              </div>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem' }}>
                <span>Median: <strong>{formatMs(percentile(stats.queues, 50))}</strong></span>
                <span>p95: <strong>{formatMs(percentile(stats.queues, 95))}</strong></span>
              </div>
            </div>
          )}

          {/* Avg file size */}
          {stats.avgSize && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--cv-text-muted)' }}>
              Avg upload size: <strong style={{ color: 'var(--cv-text)' }}>{formatBytes(stats.avgSize)}</strong>
            </div>
          )}

          {/* Last seen */}
          {stats.lastSeen && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.7rem', color: 'var(--cv-text-muted)' }}>
              Last job: {new Date(stats.lastSeen).toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
