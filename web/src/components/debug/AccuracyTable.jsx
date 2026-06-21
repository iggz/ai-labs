/**
 * @file AccuracyTable.jsx
 * @description Sortable data table with expandable rows for accuracy analysis.
 *
 * Columns: Run#, Method, Exercise, Reps, Avg Angle, Depth%, Grade, Confidence
 * - Click column headers to sort (toggle asc/desc)
 * - Click a row to expand and reveal video metadata + full accuracy detail
 * - Selected row highlighted via `selectedRunKey`
 *
 * @param {{ runs: Array, selectedRunKey?: string, onSelectRun?: (key: string) => void }} props
 */
import React, { useState, useMemo, useCallback } from 'react';

/** Format bytes to a human-readable string */
function fmtBytes(b) {
  if (b == null) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

/** Format seconds to mm:ss */
function fmtDur(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Column definitions: key = accessor path, label = header text */
const COLUMNS = [
  { key: 'run_number',             label: 'Run#' },
  { key: 'method',                 label: 'Method' },
  { key: 'exercise_type',          label: 'Exercise' },
  { key: 'accuracy.reps',          label: 'Reps' },
  { key: 'accuracy.avgPrimaryAngle', label: 'Avg Angle' },
  { key: 'accuracy.depthScorePct', label: 'Depth%' },
  { key: 'accuracy.letterGrade',   label: 'Grade' },
  { key: 'accuracy.avgConfidence', label: 'Confidence' },
];

/** Resolve a dot-path accessor on an object */
function get(obj, path) {
  return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

/** Normalize method string to a CSS-safe class suffix */
function methodClass(m) {
  if (!m) return '';
  return m === 'on-device' ? 'ondevice' : m.toLowerCase();
}

/** Map letter grade to its CSS class suffix (first char, lowercase) */
function gradeClass(g) {
  if (!g) return '';
  const first = g.charAt(0).toLowerCase();
  return ['a', 'b', 'c', 'd', 'f'].includes(first) ? first : '';
}

export default function AccuracyTable({ runs = [], selectedRunKey, onSelectRun }) {
  const [sortCol, setSortCol] = useState('run_number');
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedKey, setExpandedKey] = useState(null);

  const handleSort = useCallback((colKey) => {
    setSortCol((prev) => {
      if (prev === colKey) {
        setSortAsc((a) => !a);
        return colKey;
      }
      setSortAsc(true);
      return colKey;
    });
  }, []);

  const sortedRuns = useMemo(() => {
    const copy = [...runs];
    copy.sort((a, b) => {
      let va = get(a, sortCol);
      let vb = get(b, sortCol);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return copy;
  }, [runs, sortCol, sortAsc]);

  const handleRowClick = useCallback((run) => {
    const key = run.run_name || String(run.run_number);
    setExpandedKey((prev) => (prev === key ? null : key));
    if (onSelectRun) onSelectRun(key);
  }, [onSelectRun]);

  if (!runs.length) {
    return (
      <div className="dbg-card">
        <div className="dbg-card__header">
          <h3 className="dbg-card__title">
            <span className="dbg-card__title-icon">🎯</span> Accuracy Analysis
          </h3>
        </div>
        <div className="dbg-card__body">
          <div className="dbg-empty">
            <span className="dbg-empty__icon">📭</span>
            <p className="dbg-empty__title">No runs available</p>
            <p className="dbg-empty__text">Import run data to see accuracy analysis.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">🎯</span> Accuracy Analysis
        </h3>
        <span className="dbg-card__badge">{runs.length} runs</span>
      </div>
      <div className="dbg-card__body--flush">
        <div className="dbg-table-wrapper">
          <table className="dbg-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} onClick={() => handleSort(col.key)}>
                    {col.label}
                    <span
                      className={`dbg-sort-arrow${sortCol === col.key ? ' dbg-sort-arrow--active' : ''}`}
                    >
                      {sortCol === col.key ? (sortAsc ? '▲' : '▼') : '▲'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRuns.map((run) => {
                const key = run.run_name || String(run.run_number);
                const isSelected = key === selectedRunKey;
                const isExpanded = key === expandedKey;
                const acc = run.accuracy || {};
                const grade = acc.letterGrade || '';

                return (
                  <React.Fragment key={key}>
                    <tr
                      className={[
                        'dbg-row--expandable',
                        isSelected ? 'dbg-row--selected' : '',
                      ].join(' ').trim()}
                      onClick={() => handleRowClick(run)}
                    >
                      <td className="dbg-cell-mono">{run.run_number ?? '—'}</td>
                      <td className={`dbg-cell-method dbg-cell-method--${methodClass(run.method)}`}>
                        {run.method ?? '—'}
                      </td>
                      <td>{run.exercise_type ?? '—'}</td>
                      <td className="dbg-cell-mono">{acc.reps ?? '—'}</td>
                      <td className="dbg-cell-mono">
                        {acc.avgPrimaryAngle != null ? acc.avgPrimaryAngle.toFixed(1) + '°' : '—'}
                      </td>
                      <td className="dbg-cell-mono">
                        {acc.depthScorePct != null ? acc.depthScorePct.toFixed(0) + '%' : '—'}
                      </td>
                      <td className={`dbg-grade--${gradeClass(grade)}`}>
                        {grade || '—'}
                      </td>
                      <td className="dbg-cell-mono">
                        {acc.avgConfidence != null ? (acc.avgConfidence * 100).toFixed(1) + '%' : '—'}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr>
                        <td colSpan={COLUMNS.length} style={{ padding: '12px 18px', background: 'oklch(0.11 0.015 290 / 0.6)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '0.72rem' }}>
                            {/* Video metadata */}
                            <div>
                              <strong style={{ color: 'var(--cv-text-muted)', textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.04em' }}>
                                Video Metadata
                              </strong>
                              <table style={{ marginTop: 6, borderCollapse: 'collapse', width: '100%' }}>
                                <tbody>
                                  {[
                                    ['Hash', run.video?.hash?.slice(0, 12)],
                                    ['Size', fmtBytes(run.video?.fileSizeBytes)],
                                    ['Duration', fmtDur(run.video?.durationSec)],
                                    ['Resolution', run.video?.resolution],
                                    ['FPS', run.video?.fps],
                                    ['Codec', run.video?.codec],
                                  ].map(([lbl, val]) => (
                                    <tr key={lbl}>
                                      <td style={{ padding: '2px 8px 2px 0', color: 'var(--cv-text-muted)' }}>{lbl}</td>
                                      <td className="dbg-cell-mono">{val ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {/* Accuracy detail */}
                            <div>
                              <strong style={{ color: 'var(--cv-text-muted)', textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.04em' }}>
                                Accuracy Detail
                              </strong>
                              <table style={{ marginTop: 6, borderCollapse: 'collapse', width: '100%' }}>
                                <tbody>
                                  {[
                                    ['Exercise', acc.exerciseType],
                                    ['Reps', acc.reps],
                                    ['Avg Angle', acc.avgPrimaryAngle != null ? acc.avgPrimaryAngle.toFixed(1) + '°' : null],
                                    ['Confidence', acc.avgConfidence != null ? (acc.avgConfidence * 100).toFixed(1) + '%' : null],
                                    ['Depth Score', acc.depthScorePct != null ? acc.depthScorePct.toFixed(0) + '%' : null],
                                    ['Grade', acc.letterGrade],
                                    ['Symmetry', acc.symmetryScore != null ? acc.symmetryScore.toFixed(2) : null],
                                    ['Per-Rep Angles', acc.perRepAngles?.length ? acc.perRepAngles.map((a) => a.toFixed(0) + '°').join(', ') : null],
                                  ].map(([lbl, val]) => (
                                    <tr key={lbl}>
                                      <td style={{ padding: '2px 8px 2px 0', color: 'var(--cv-text-muted)' }}>{lbl}</td>
                                      <td className="dbg-cell-mono" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>{val ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
