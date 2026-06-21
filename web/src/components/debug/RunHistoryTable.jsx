/**
 * @file RunHistoryTable.jsx
 * @description Paginated, sortable run history table for the debug dashboard.
 *
 * Features:
 * - Sortable columns (click header to toggle asc/desc)
 * - Inline editing for run_name and tags
 * - Pagination with 25 rows per page
 * - Row selection with onSelectRun callback
 * - Delete action with confirmation dialog
 * - Relative timestamp formatting (e.g. "2h ago", "Yesterday")
 *
 * @param {Object}   props
 * @param {Object[]} props.runs          - Filtered run data array
 * @param {string}   props.selectedRunKey - Currently selected run key (run_number)
 * @param {Function} props.onSelectRun   - Called with run_number on row click
 * @param {Function} props.onUpdateMeta  - Called with (runKey, { field: value })
 * @param {Function} props.onDeleteRun   - Called with runKey to delete
 */
import { useState, useMemo, useCallback } from 'react';

const PAGE_SIZE = 25;

const COLUMNS = [
  { key: 'run_number',    label: 'Run#',      width: '60px' },
  { key: 'run_name',      label: 'Name',      width: 'auto',  editable: true },
  { key: 'method',        label: 'Method',     width: '80px' },
  { key: 'exercise_type', label: 'Exercise',   width: '90px' },
  { key: 'timestamp',     label: 'Timestamp',  width: '110px' },
  { key: 'video_hash',    label: 'Video Hash', width: '85px' },
  { key: 'batch_id',      label: 'Batch',      width: '90px' },
  { key: 'tags',          label: 'Tags',       width: 'auto',  editable: true },
  { key: 'version',       label: 'Version',    width: '80px' },
  { key: '_actions',      label: '',           width: '50px',  sortable: false },
];

/** Format a timestamp into a human-readable relative string */
function relativeTime(iso) {
  if (!iso) return '—';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 0) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Return CSS class suffix for method styling */
function methodCls(method) {
  if (method === 'on-device') return 'ondevice';
  return method || '';
}

export default function RunHistoryTable({
  runs = [],
  selectedRunKey,
  onSelectRun,
  onUpdateMeta,
  onDeleteRun,
}) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ key: 'run_number', dir: 'desc' });
  const [editCell, setEditCell] = useState(null); // { runKey, field, value }

  // --- Sorting ---
  const handleSort = useCallback((key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
    setPage(0);
  }, []);

  const sorted = useMemo(() => {
    const arr = [...runs];
    const { key, dir } = sort;
    arr.sort((a, b) => {
      let va = key === 'video_hash' ? a.video?.hash : a[key];
      let vb = key === 'video_hash' ? b.video?.hash : b[key];
      if (key === 'tags') {
        va = Array.isArray(va) ? va.join(',') : '';
        vb = Array.isArray(vb) ? vb.join(',') : '';
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return dir === 'asc' ? va - vb : vb - va;
      return dir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return arr;
  }, [runs, sort]);

  // --- Pagination ---
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRuns = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Clamp page if data shrinks
  if (page >= totalPages && page > 0) setPage(totalPages - 1);

  // --- Inline editing ---
  const startEdit = useCallback((runKey, field, currentValue) => {
    setEditCell({
      runKey,
      field,
      value: Array.isArray(currentValue) ? currentValue.join(', ') : (currentValue || ''),
    });
  }, []);

  const commitEdit = useCallback(() => {
    if (!editCell || !onUpdateMeta) return;
    const { runKey, field, value } = editCell;
    const payload =
      field === 'tags'
        ? { tags: value.split(',').map((t) => t.trim()).filter(Boolean) }
        : { [field]: value };
    onUpdateMeta(runKey, payload);
    setEditCell(null);
  }, [editCell, onUpdateMeta]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') setEditCell(null);
    },
    [commitEdit],
  );

  // --- Delete ---
  const handleDelete = useCallback(
    (e, runKey, runName) => {
      e.stopPropagation();
      if (!onDeleteRun) return;
      if (window.confirm(`Delete run ${runName || runKey}? This cannot be undone.`)) {
        onDeleteRun(runKey);
      }
    },
    [onDeleteRun],
  );

  // --- Render helpers ---
  const renderSortArrow = (colKey) => {
    const active = sort.key === colKey;
    const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲';
    return (
      <span className={`dbg-sort-arrow${active ? ' dbg-sort-arrow--active' : ''}`}>
        {arrow}
      </span>
    );
  };

  const renderCell = (run, col) => {
    const runKey = run.run_number;

    // Editable cells
    if (col.editable && editCell?.runKey === runKey && editCell?.field === col.key) {
      return (
        <input
          className="dbg-editable"
          autoFocus
          value={editCell.value}
          onChange={(e) => setEditCell((p) => ({ ...p, value: e.target.value }))}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      );
    }

    switch (col.key) {
      case 'run_number':
        return <span className="dbg-cell-mono">#{runKey}</span>;

      case 'run_name':
        return (
          <span
            style={{ cursor: 'text' }}
            onClick={(e) => { e.stopPropagation(); startEdit(runKey, 'run_name', run.run_name); }}
            title="Click to edit"
          >
            {run.run_name || '—'}
          </span>
        );

      case 'method':
        return (
          <span className={`dbg-cell-method dbg-cell-method--${methodCls(run.method)}`}>
            {(run.method || '').toUpperCase()}
          </span>
        );

      case 'exercise_type':
        return run.exercise_type || '—';

      case 'timestamp':
        return (
          <span title={run.timestamp}>{relativeTime(run.timestamp)}</span>
        );

      case 'video_hash':
        return (
          <span className="dbg-cell-mono">
            {run.video?.hash ? run.video.hash.slice(0, 8) : '—'}
          </span>
        );

      case 'batch_id':
        return run.batch_id ? (
          <span className="dbg-cell-mono">{run.batch_id}</span>
        ) : '—';

      case 'tags':
        return (
          <span
            style={{ display: 'flex', gap: 3, flexWrap: 'wrap', cursor: 'text' }}
            onClick={(e) => { e.stopPropagation(); startEdit(runKey, 'tags', run.tags); }}
            title="Click to edit tags"
          >
            {Array.isArray(run.tags) && run.tags.length > 0
              ? run.tags.map((t) => (
                  <span key={t} className="dbg-tag">{t}</span>
                ))
              : '—'}
          </span>
        );

      case 'version':
        return <span className="dbg-cell-mono">{run.version || '—'}</span>;

      case '_actions':
        return (
          <button
            className="dbg-btn dbg-btn--danger dbg-btn--sm"
            title="Delete run"
            onClick={(e) => handleDelete(e, runKey, run.run_name)}
          >
            🗑
          </button>
        );

      default:
        return '—';
    }
  };

  if (runs.length === 0) {
    return (
      <div className="dbg-card">
        <div className="dbg-card__header">
          <h3 className="dbg-card__title">
            <span className="dbg-card__title-icon">📋</span> Run History
          </h3>
        </div>
        <div className="dbg-card__body">
          <div className="dbg-empty">
            <span className="dbg-empty__icon">📭</span>
            <h4 className="dbg-empty__title">No runs match your filters</h4>
            <p className="dbg-empty__text">Try adjusting the filters above or run a new analysis.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">📋</span> Run History
        </h3>
        <span className="dbg-card__badge">{runs.length} runs</span>
      </div>

      <div className="dbg-card__body--flush">
        <div className="dbg-table-wrapper">
          <table className="dbg-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    style={{ width: col.width }}
                    onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
                  >
                    {col.label}
                    {col.sortable !== false && col.label && renderSortArrow(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRuns.map((run, idx) => {
                const key = run._key || run.run_number || `row-${idx}`;
                const selected = selectedRunKey != null && (String(selectedRunKey) === String(run._key) || String(selectedRunKey) === String(run.run_number));
                return (
                  <tr
                    key={key}
                    className={`dbg-row--expandable${selected ? ' dbg-row--selected' : ''}`}
                    onClick={() => onSelectRun?.(run._key || run.run_number)}
                  >
                    {COLUMNS.map((col) => (
                      <td key={col.key}>{renderCell(run, col)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="dbg-pagination">
          <span>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of{' '}
            {sorted.length}
          </span>
          <div className="dbg-pagination__controls">
            <button
              className="dbg-pagination__btn"
              disabled={page === 0}
              onClick={() => setPage(0)}
            >
              ««
            </button>
            <button
              className="dbg-pagination__btn"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              «
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              // Show pages around current page
              let pageNum;
              if (totalPages <= 7) {
                pageNum = i;
              } else if (page < 4) {
                pageNum = i;
              } else if (page > totalPages - 5) {
                pageNum = totalPages - 7 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <button
                  key={pageNum}
                  className={`dbg-pagination__btn${pageNum === page ? ' dbg-pagination__btn--active' : ''}`}
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum + 1}
                </button>
              );
            })}
            <button
              className="dbg-pagination__btn"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              »
            </button>
            <button
              className="dbg-pagination__btn"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
            >
              »»
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
