/**
 * @file NetworkWaterfall.jsx
 * @description Upload / Server / Download stacked waterfall bars per run.
 *              Server methods show 3 segments from client_timings.
 *              On-device runs show a 'Local processing' label instead.
 *              Bandwidth annotation displayed below each bar when available.
 *
 * @param {Object}   props
 * @param {Array}    props.runs            - Array of unified run objects
 * @param {string}   [props.selectedRunKey] - Currently selected run key
 * @param {Function} [props.onSelectRun]   - Callback when a row is clicked: (runKey) => void
 */
import React, { useMemo, useCallback } from 'react';

/** Segment definitions */
const SEGMENTS = [
  { key: 'upload', label: 'Upload', color: '#22c55e' },
  { key: 'server', label: 'Server', color: '#eab308' },
  { key: 'download', label: 'Download', color: '#3b82f6' },
];

/** Format milliseconds */
function fmt(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

/** Format bandwidth in Mbps */
function fmtBw(mbps) {
  if (mbps == null) return null;
  return mbps.toFixed(1) + ' Mbps';
}

/** Get the run key used for selection */
function getRunKey(run) {
  return run.run_name || run._key || `run-${run.run_number ?? '?'}`;
}

/**
 * Derive waterfall segments for a server-method run.
 * Returns { upload, server, download, total, bandwidth }.
 */
function getSegments(run) {
  const ct = run.client_timings;
  if (!ct) return null;

  const upload = ct.uploadDurationMs ?? 0;
  const download = ct.downloadDurationMs ?? 0;
  const total = ct.totalRoundTripMs ?? 0;
  const server = Math.max(total - upload - download, 0);

  return {
    upload,
    server,
    download,
    total: total || upload + server + download || 1,
    uploadBw: fmtBw(ct.effectiveUploadBandwidthMbps),
    downloadBw: fmtBw(ct.effectiveDownloadBandwidthMbps),
  };
}

export default function NetworkWaterfall({ runs = [], selectedRunKey, onSelectRun }) {
  const handleRowClick = useCallback(
    (key) => {
      if (onSelectRun) onSelectRun(key);
    },
    [onSelectRun]
  );

  /** Processed run entries with waterfall data */
  const entries = useMemo(
    () =>
      runs.map((run) => ({
        run,
        key: getRunKey(run),
        method: (run.method || '').toLowerCase(),
        segments: getSegments(run),
      })),
    [runs]
  );

  /** Max total for scaling bar widths consistently */
  const maxTotal = useMemo(
    () =>
      Math.max(
        ...entries
          .filter((e) => e.segments)
          .map((e) => e.segments.total),
        1
      ),
    [entries]
  );

  if (!runs.length) {
    return (
      <div className="dbg-card">
        <div className="dbg-card__header">
          <h3 className="dbg-card__title">
            <span className="dbg-card__title-icon">🌐</span> Network Waterfall
          </h3>
        </div>
        <div className="dbg-card__body">
          <div className="dbg-empty">
            <div className="dbg-empty__icon">🌐</div>
            <h4 className="dbg-empty__title">No network data</h4>
            <p className="dbg-empty__text">
              Run analyses to see upload/server/download timing waterfalls.
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
          <span className="dbg-card__title-icon">🌐</span> Network Waterfall
        </h3>
        <span className="dbg-card__badge">{entries.length} runs</span>
      </div>
      <div className="dbg-card__body">
        <div className="dbg-bar-chart">
          {entries.map(({ run, key, method, segments }) => {
            const isSelected = selectedRunKey === key;
            const isOnDevice = method === 'on-device';
            const label = run.run_number != null
              ? `#${run.run_number}`
              : key.slice(0, 8);

            return (
              <div key={key} style={{ marginBottom: '4px' }}>
                <div
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
                  <span className="dbg-bar-label" title={key}>{label}</span>

                  {isOnDevice ? (
                    /* On-device: no network bar, show label */
                    <div
                      className="dbg-bar-track"
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span
                        className="dbg-method-tag dbg-method-tag--on-device"
                        style={{ fontSize: '0.62rem' }}
                      >
                        Local processing
                      </span>
                    </div>
                  ) : segments ? (
                    /* Server methods: stacked bar */
                    <div className="dbg-stacked-bar" style={{ flex: 1 }}>
                      {SEGMENTS.map(({ key: segKey, label: segLabel, color }) => {
                        const ms = segments[segKey];
                        if (!ms || ms <= 0) return null;
                        const widthPct = Math.max(
                          (ms / segments.total) * 100,
                          0.5
                        );
                        return (
                          <div
                            key={segKey}
                            className="dbg-stacked-segment"
                            style={{ width: `${widthPct}%`, background: color }}
                            data-tooltip={`${segLabel}: ${fmt(ms)}`}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    /* No client_timings available */
                    <div className="dbg-bar-track" style={{ flex: 1 }}>
                      <div
                        className="dbg-bar-fill"
                        style={{ width: '0%', background: '#94a3b8' }}
                      />
                    </div>
                  )}

                  <span className="dbg-bar-value">
                    {isOnDevice
                      ? '—'
                      : fmt(segments?.total)}
                  </span>
                </div>

                {/* Bandwidth annotation */}
                {segments && (segments.uploadBw || segments.downloadBw) && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      paddingLeft: '80px',
                      marginTop: '1px',
                      marginBottom: '2px',
                    }}
                  >
                    {segments.uploadBw && (
                      <span
                        style={{
                          fontSize: '0.6rem',
                          color: '#22c55e',
                          fontFamily: 'var(--dbg-mono)',
                          opacity: 0.8,
                        }}
                      >
                        ↑ {segments.uploadBw}
                      </span>
                    )}
                    {segments.downloadBw && (
                      <span
                        style={{
                          fontSize: '0.6rem',
                          color: '#3b82f6',
                          fontFamily: 'var(--dbg-mono)',
                          opacity: 0.8,
                        }}
                      >
                        ↓ {segments.downloadBw}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="dbg-stacked-legend">
          {SEGMENTS.map(({ key, label, color }) => (
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
