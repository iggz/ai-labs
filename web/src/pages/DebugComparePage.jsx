/**
 * DebugComparePage — Mobile-optimized comparison view for Test All results.
 *
 * Route: /debug/compare?batch={batchId}
 *
 * Displays side-by-side metrics for all 3 methods from a Test All run.
 * Designed for phone-in-portrait: pure CSS bars, collapsible sections,
 * no charting library dependency.
 */

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

// ── Helpers ──────────────────────────────────────────────────────────────────

const METHOD_LABELS = {
  dnn: 'DNN',
  yolo: 'YOLO',
  'on-device': 'On-Device',
  ondevice: 'On-Device',
};

const METHOD_COLORS = {
  dnn:        '#f97316',  // orange
  yolo:       '#8b5cf6',  // violet
  'on-device': '#06b6d4', // cyan
  ondevice:   '#06b6d4',
};

function fmt(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtAngle(deg) {
  return deg != null ? `${Math.round(deg)}°` : '—';
}

// ── Bar component ────────────────────────────────────────────────────────────

function TimingBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
      <span style={{ width: '70px', fontSize: '12px', fontWeight: 600, color: '#e2e8f0', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{
        flex: 1, height: '20px', borderRadius: '4px',
        background: 'rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '4px',
          background: `linear-gradient(90deg, ${color}, ${color}aa)`,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ width: '60px', fontSize: '12px', color: '#94a3b8', textAlign: 'right', flexShrink: 0 }}>
        {fmt(value)}
      </span>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DebugComparePage() {
  const [searchParams] = useSearchParams();
  const batchParam = searchParams.get('batch');
  const [batchData, setBatchData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch batch data
  useEffect(() => {
    if (!batchParam) {
      setError('No batch parameter provided. Use ?batch=N');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const batchId = batchParam.replace(/^batch:/, '');
        const apiBase = import.meta.env.PROD ? '/ai-labs' : '';
        const res = await fetch(`${apiBase}/api/debug-batch/${batchId}`);
        if (!res.ok) throw new Error(`Batch not found (${res.status})`);
        const data = await res.json();
        setBatchData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [batchParam]);

  // Parse runs into method-keyed map
  const methods = useMemo(() => {
    if (!batchData?.run_data) return {};
    const map = {};
    for (const run of batchData.run_data) {
      const method = run.method === 'ondevice' ? 'on-device' : run.method;
      map[method] = run;
    }
    return map;
  }, [batchData]);

  const methodKeys = Object.keys(methods);

  // Find the max total time for scaling bars
  const maxTotalMs = useMemo(() => {
    let max = 0;
    for (const run of Object.values(methods)) {
      const total = run.client_timings?.total_round_trip_ms ?? run.server_timings?.total_server_ms ?? 0;
      if (total > max) max = total;
    }
    return max || 1;
  }, [methods]);

  // ── Render ──

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={loadingStyle}>
          <div className="formai-spinner" />
          <p style={{ color: '#94a3b8', marginTop: '12px' }}>Loading batch data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={pageStyle}>
        <div style={{ ...cardStyle, textAlign: 'center', padding: '32px 20px' }}>
          <p style={{ color: '#f97316', fontSize: '14px', marginBottom: '12px' }}>⚠️ {error}</p>
          <Link to="/form-ai" style={linkStyle}>← Back to FormAI</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <Helmet>
        <title>Method Comparison | AI Labs Debug</title>
      </Helmet>

      {/* Header */}
      <div style={{ ...cardStyle, padding: '16px 20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#f1f5f9', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          ⚡ Method Comparison
        </h1>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>
          Batch #{batchData.batch_number} · {batchData.exercise_type ?? 'unknown'} · {methodKeys.length} methods
        </p>
      </div>

      {/* Section: Timing Waterfall */}
      <details open style={cardStyle}>
        <summary style={summaryStyle}>⏱ Timing Waterfall</summary>
        <div style={{ padding: '12px 16px' }}>
          {methodKeys.map(m => {
            const run = methods[m];
            const total = run.client_timings?.total_round_trip_ms ?? run.server_timings?.total_server_ms ?? 0;
            return (
              <TimingBar
                key={m}
                label={METHOD_LABELS[m] ?? m}
                value={total}
                max={maxTotalMs}
                color={METHOD_COLORS[m] ?? '#6366f1'}
              />
            );
          })}
        </div>
      </details>

      {/* Section: Accuracy Comparison */}
      <details open style={cardStyle}>
        <summary style={summaryStyle}>🎯 Accuracy Comparison</summary>
        <div style={{ padding: '8px 12px', overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}></th>
                {methodKeys.map(m => (
                  <th key={m} style={{ ...thStyle, color: METHOD_COLORS[m] }}>
                    {METHOD_LABELS[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={tdLabelStyle}>Reps</td>
                {methodKeys.map(m => (
                  <td key={m} style={tdStyle}>{methods[m].accuracy?.reps ?? '—'}</td>
                ))}
              </tr>
              <tr>
                <td style={tdLabelStyle}>Avg Angle</td>
                {methodKeys.map(m => (
                  <td key={m} style={tdStyle}>{fmtAngle(methods[m].accuracy?.avgPrimaryAngle)}</td>
                ))}
              </tr>
              <tr>
                <td style={tdLabelStyle}>Depth</td>
                {methodKeys.map(m => (
                  <td key={m} style={tdStyle}>
                    {methods[m].accuracy?.depthScorePct != null ? `${methods[m].accuracy.depthScorePct}%` : '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={tdLabelStyle}>Grade</td>
                {methodKeys.map(m => (
                  <td key={m} style={{ ...tdStyle, fontWeight: 700 }}>
                    {methods[m].accuracy?.letterGrade ?? '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={tdLabelStyle}>Confidence</td>
                {methodKeys.map(m => (
                  <td key={m} style={tdStyle}>
                    {methods[m].accuracy?.avgConfidence != null
                      ? `${Math.round(methods[m].accuracy.avgConfidence * 100)}%`
                      : '—'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* Section: Network Breakdown */}
      <details style={cardStyle}>
        <summary style={summaryStyle}>🌐 Network Breakdown</summary>
        <div style={{ padding: '12px 16px' }}>
          {methodKeys.map(m => {
            const run = methods[m];
            const ct = run.client_timings ?? {};
            const isLocal = m === 'on-device' || m === 'ondevice';
            return (
              <div key={m} style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: METHOD_COLORS[m], marginBottom: '4px' }}>
                  {METHOD_LABELS[m]}
                </div>
                {isLocal ? (
                  <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
                    (no network — processed locally)
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>
                    ↑ {fmt(ct.upload_duration_ms)} · ⚙ {fmt(ct.server_processing_ms)} · ↓ {fmt(ct.download_duration_ms)}
                    {ct.effective_upload_bandwidth_mbps != null && (
                      <span style={{ color: '#64748b' }}>
                        {' '}({ct.effective_upload_bandwidth_mbps} Mbps ↑ / {ct.effective_download_bandwidth_mbps ?? '?'} Mbps ↓)
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>

      {/* Section: Server Breakdown */}
      <details style={cardStyle}>
        <summary style={summaryStyle}>🖥 Server Timing Breakdown</summary>
        <div style={{ padding: '12px 16px' }}>
          {methodKeys.filter(m => m !== 'on-device' && m !== 'ondevice').map(m => {
            const st = methods[m].server_timings;
            if (!st) return (
              <div key={m} style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>
                {METHOD_LABELS[m]}: No server timings available
              </div>
            );
            const maxPhase = Math.max(
              st.inference_total_ms ?? 0, st.overlay_render_ms ?? 0,
              st.video_encode_ms ?? 0, st.postprocess_ms ?? 0,
            ) || 1;
            return (
              <div key={m} style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: METHOD_COLORS[m], marginBottom: '6px' }}>
                  {METHOD_LABELS[m]} ({st.frame_count} frames, {st.cold_start ? '🥶 cold' : '♻️ warm'})
                </div>
                <TimingBar label="Inference" value={st.inference_total_ms} max={maxPhase} color="#22c55e" />
                <TimingBar label="Overlay" value={st.overlay_render_ms} max={maxPhase} color="#eab308" />
                <TimingBar label="Encode" value={st.video_encode_ms} max={maxPhase} color="#3b82f6" />
                <TimingBar label="Post" value={st.postprocess_ms} max={maxPhase} color="#a855f7" />
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  Per-frame: avg {fmt(st.inference_per_frame_ms)} · min {fmt(st.inference_min_ms)} · max {fmt(st.inference_max_ms)} · P95 {fmt(st.inference_p95_ms)}
                </div>
              </div>
            );
          })}
        </div>
      </details>

      {/* Section: Per-Rep Angle Divergence */}
      <details style={cardStyle}>
        <summary style={summaryStyle}>📐 Per-Rep Angle Divergence</summary>
        <div style={{ padding: '8px 12px', overflowX: 'auto' }}>
          <PerRepDivergence methods={methods} methodKeys={methodKeys} />
        </div>
      </details>

      {/* Section: Device & Environment */}
      <details style={cardStyle}>
        <summary style={summaryStyle}>📱 Device & Environment</summary>
        <div style={{ padding: '12px 16px', fontSize: '12px', color: '#94a3b8' }}>
          {(() => {
            // Show device info from first available run
            const firstRun = Object.values(methods)[0];
            const d = firstRun?.device;
            if (!d) return <p>No device info available</p>;
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                <span style={{ color: '#64748b' }}>Platform</span><span>{d.platform}</span>
                <span style={{ color: '#64748b' }}>Screen</span><span>{d.screenSize}</span>
                <span style={{ color: '#64748b' }}>Cores</span><span>{d.hardwareConcurrency ?? '?'}</span>
                <span style={{ color: '#64748b' }}>Memory</span><span>{d.deviceMemory ? `${d.deviceMemory} GB` : '?'}</span>
                <span style={{ color: '#64748b' }}>Connection</span><span>{d.connectionType ?? '?'}</span>
                <span style={{ color: '#64748b' }}>Downlink</span><span>{d.connectionDownlink ? `${d.connectionDownlink} Mbps` : '?'}</span>
                <span style={{ color: '#64748b' }}>RTT</span><span>{d.connectionRtt ? `${d.connectionRtt}ms` : '?'}</span>
                <span style={{ color: '#64748b' }}>WASM</span><span>{d.wasmSupported ? '✅' : '❌'}</span>
                <span style={{ color: '#64748b' }}>SAB</span><span>{d.sharedArrayBuffer ? '✅' : '❌'}</span>
              </div>
            );
          })()}
        </div>
      </details>

      {/* Footer actions */}
      <div style={{ ...cardStyle, padding: '12px 16px', display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
        <Link to="/form-ai" style={linkStyle}>← Back</Link>
        <button
          style={shareButtonStyle}
          onClick={() => {
            const json = JSON.stringify(batchData, null, 2);
            navigator.clipboard?.writeText(json)
              .then(() => alert('Copied batch JSON to clipboard'))
              .catch(() => {
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `batch-${batchData.batch_number}.json`;
                a.click();
                URL.revokeObjectURL(url);
              });
          }}
        >
          📋 Share JSON
        </button>
      </div>
    </div>
  );
}

// ── Per-Rep Divergence sub-component ─────────────────────────────────────────

function PerRepDivergence({ methods, methodKeys }) {
  if (!methodKeys.length) {
    return <p style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>No data available</p>;
  }

  // Find the max rep count across methods
  const maxReps = Math.max(
    0, ...methodKeys.map(m => methods[m].accuracy?.perRepAngles?.length ?? 0)
  );

  if (maxReps === 0) {
    return <p style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>No per-rep angle data available</p>;
  }

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Rep</th>
          {methodKeys.map(m => (
            <th key={m} style={{ ...thStyle, color: METHOD_COLORS[m] }}>
              {METHOD_LABELS[m]}
            </th>
          ))}
          <th style={thStyle}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: maxReps }, (_, i) => {
          const angles = methodKeys.map(m => methods[m].accuracy?.perRepAngles?.[i] ?? null);
          const validAngles = angles.filter(a => a != null);
          const delta = validAngles.length >= 2
            ? Math.round(Math.max(...validAngles) - Math.min(...validAngles))
            : null;
          const deltaColor = delta == null ? '#64748b'
            : delta > 5 ? '#ef4444' : delta > 3 ? '#eab308' : '#22c55e';

          return (
            <tr key={i}>
              <td style={tdLabelStyle}>{i + 1}</td>
              {angles.map((a, j) => (
                <td key={j} style={tdStyle}>{fmtAngle(a)}</td>
              ))}
              <td style={{ ...tdStyle, color: deltaColor, fontWeight: 600 }}>
                {delta != null ? `${delta}°` : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Inline styles (no external CSS dependency) ───────────────────────────────

const pageStyle = {
  maxWidth: '480px',
  margin: '0 auto',
  padding: '16px 12px 100px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  height: '100%',
  overflowY: 'auto',
  fontFamily: "'Inter', 'SF Pro', system-ui, sans-serif",
};

const cardStyle = {
  background: 'rgba(15, 23, 42, 0.8)',
  borderRadius: '12px',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  backdropFilter: 'blur(12px)',
  overflow: 'visible',
};

const summaryStyle = {
  padding: '12px 16px',
  fontSize: '14px',
  fontWeight: 600,
  color: '#e2e8f0',
  cursor: 'pointer',
  userSelect: 'none',
  listStyle: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '12px',
};

const thStyle = {
  padding: '6px 8px',
  textAlign: 'center',
  fontWeight: 600,
  fontSize: '11px',
  color: '#64748b',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const tdStyle = {
  padding: '5px 8px',
  textAlign: 'center',
  color: '#cbd5e1',
  borderBottom: '1px solid rgba(255,255,255,0.03)',
  fontFamily: 'monospace',
  fontSize: '12px',
};

const tdLabelStyle = {
  ...tdStyle,
  textAlign: 'left',
  fontWeight: 600,
  fontFamily: 'inherit',
  color: '#94a3b8',
};

const linkStyle = {
  color: '#8b5cf6',
  textDecoration: 'none',
  fontSize: '13px',
  fontWeight: 500,
};

const shareButtonStyle = {
  background: 'rgba(139, 92, 246, 0.15)',
  border: '1px solid rgba(139, 92, 246, 0.3)',
  color: '#a78bfa',
  padding: '6px 14px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
};

const loadingStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '60vh',
};
