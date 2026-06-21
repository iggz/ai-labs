/**
 * @file ExportControls.jsx
 * @description Export widget for downloading filtered debug run data as CSV or JSON.
 *
 * Generates Blob → Object URL → programmatic <a> click for each format.
 * CSV includes key performance & accuracy fields; JSON exports full objects.
 * Filenames include the current date, e.g. debug-runs-2026-06-19.csv
 *
 * @param {Object}   props
 * @param {Object[]} props.runs - Filtered run data to export
 */
import { useCallback } from 'react';

const CSV_HEADERS = [
  'run_number',
  'method',
  'exercise_type',
  'timestamp',
  'total_time_ms',
  'reps',
  'avgAngle',
  'depthPct',
  'grade',
  'confidence',
  'version',
  'video_hash',
];

/** Escape a CSV field value */
function esc(val) {
  if (val == null) return '';
  const s = String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/** Extract a flat row of key fields from a run object */
function rowFromRun(run) {
  return [
    run.run_number,
    run.method,
    run.exercise_type,
    run.timestamp,
    run.client_timings?.totalRoundTripMs ?? run.server_timings?.total_server_ms ?? '',
    run.accuracy?.reps ?? '',
    run.accuracy?.avgPrimaryAngle ?? '',
    run.accuracy?.depthScorePct ?? '',
    run.accuracy?.letterGrade ?? '',
    run.accuracy?.avgConfidence ?? '',
    run.version,
    run.video?.hash ?? '',
  ];
}

/** Get today's date as YYYY-MM-DD for filenames */
function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

/** Trigger a file download from a Blob */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Clean up after a tick to let the download initiate
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export default function ExportControls({ runs = [] }) {
  const exportCSV = useCallback(() => {
    const header = CSV_HEADERS.map(esc).join(',');
    const rows = runs.map((r) => rowFromRun(r).map(esc).join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `debug-runs-${todayStamp()}.csv`);
  }, [runs]);

  const exportJSON = useCallback(() => {
    const json = JSON.stringify(runs, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, `debug-runs-${todayStamp()}.json`);
  }, [runs]);

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">📤</span> Export
        </h3>
        <span className="dbg-card__badge">{runs.length} runs</span>
      </div>

      <div className="dbg-card__body" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          className="dbg-btn dbg-btn--ghost"
          onClick={exportCSV}
          disabled={runs.length === 0}
        >
          📄 Export CSV
        </button>
        <button
          className="dbg-btn dbg-btn--ghost"
          onClick={exportJSON}
          disabled={runs.length === 0}
        >
          📋 Export JSON
        </button>
        {runs.length === 0 && (
          <span style={{ fontSize: '0.72rem', color: 'var(--cv-text-muted, #94a3b8)' }}>
            No runs to export
          </span>
        )}
      </div>
    </div>
  );
}
