/**
 * BenchmarkSummaryCards.jsx — Per-backend summary stat cards
 * ============================================================
 * Shows one card per backend with avg processing time, job count,
 * and online/offline status indicator.
 */

import { useMemo } from 'react';

// ── Protocol config ──────────────────────────────────────────────────────────
const PROTOCOL_META = {
  dml: {
    icon: '⚡',
    name: '⚡⚡ DirectML',
    machine: 'AMD RX 7800 XT · PC Tower',
    colorClass: 'benchmark-card--dml',
    comingSoon: false,
  },
  yolo: {
    icon: '🍎',
    name: 'Metal',
    machine: 'Apple M4 Pro · Mac Mini',
    colorClass: 'benchmark-card--yolo',
    comingSoon: false,
  },
  cuda: {
    icon: '🟢',
    name: 'CUDA',
    machine: 'NVIDIA RTX 2060 · Laptop',
    colorClass: 'benchmark-card--cuda',
    comingSoon: true,
  },
  'on-device': {
    icon: '📱',
    name: 'On Device',
    machine: 'Browser · Client GPU/WASM',
    colorClass: 'benchmark-card--ondevice',
    comingSoon: false,
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function formatMs(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function isOnline(rows) {
  if (!rows.length) return false;
  const latest = new Date(rows[0].created_at);
  const ageHrs = (Date.now() - latest) / 3_600_000;
  return ageHrs < 2; // considered online if processed a job in the last 2 hours
}

// ── Component ─────────────────────────────────────────────────────────────────
export function BenchmarkSummaryCards({ data }) {
  const byProtocol = useMemo(() => {
    const map = {};
    for (const row of data) {
      const p = row.protocol || 'opencv';
      if (!map[p]) map[p] = [];
      map[p].push(row);
    }
    return map;
  }, [data]);

  const protocols = ['dml', 'yolo', 'cuda', 'on-device'];

  return (
    <div className="benchmark-cards">
      {protocols.map(protocol => {
        const meta = PROTOCOL_META[protocol] || { icon: '?', name: protocol, machine: '', colorClass: '' };
        const rows = byProtocol[protocol] || [];
        const times = rows.map(r => r.processing_time_ms).filter(Boolean);
        const avgMs = mean(times);
        const online = meta.comingSoon ? null : isOnline(rows);

        return (
          <div
            key={protocol}
            className={`benchmark-card ${meta.colorClass} ${meta.comingSoon ? 'benchmark-card--coming-soon' : ''}`}
          >
            <div className="benchmark-card__header">
              <span className="benchmark-card__icon">{meta.icon}</span>
              {meta.comingSoon ? (
                <span className="benchmark-card__status benchmark-card__status--soon">
                  Coming Soon
                </span>
              ) : online ? (
                <span className="benchmark-card__status benchmark-card__status--online">
                  ● Online
                </span>
              ) : (
                <span className="benchmark-card__status benchmark-card__status--offline">
                  ○ Offline
                </span>
              )}
            </div>

            <div className="benchmark-card__name">{meta.name}</div>
            <div className="benchmark-card__machine">{meta.machine}</div>

            {meta.comingSoon ? (
              <div className="benchmark-card__metric">—</div>
            ) : (
              <div className="benchmark-card__metric">
                {formatMs(avgMs)}
                {avgMs !== null && <span className="benchmark-card__metric-unit">avg</span>}
              </div>
            )}
            <div className="benchmark-card__metric-label">
              {meta.comingSoon ? 'NVIDIA laptop — deploying tomorrow' : 'Processing time'}
            </div>

            <div className="benchmark-card__footer">
              <span>{rows.length} job{rows.length !== 1 ? 's' : ''}</span>
              {rows.length > 0 && (
                <span>
                  Last: {new Date(rows[0].created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
