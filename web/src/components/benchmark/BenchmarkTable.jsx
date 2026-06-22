/**
 * BenchmarkTable.jsx — Sortable raw data table
 * =============================================
 * Displays recent jobs with timestamp, protocol, machine,
 * processing_time_ms, queue_wait_ms, file_size_bytes, exercise_type, camera_angle.
 */

import { useState, useMemo } from 'react';

const PROTOCOL_LABELS = {
  dml:        '⚡⚡ DML',
  yolo:       'Metal',
  cuda:       'CUDA',
  'on-device':'On Device',
  opencv:     'DNN',
};

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

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const COLUMNS = [
  { key: 'created_at',         label: 'Time',         fmt: formatDate },
  { key: 'protocol',           label: 'Backend',      fmt: null       },
  { key: 'machine_id',         label: 'Machine',      fmt: null       },
  { key: 'inference_backend',  label: 'Inference',    fmt: null       },
  { key: 'processing_time_ms', label: 'Proc. Time',   fmt: formatMs   },
  { key: 'queue_wait_ms',      label: 'Queue Wait',   fmt: formatMs   },
  { key: 'file_size_bytes',    label: 'File Size',    fmt: formatBytes },
  { key: 'camera_angle',       label: 'Angle',        fmt: null       },
];

export function BenchmarkTable({ data }) {
  const [sortKey, setSortKey]   = useState('created_at');
  const [sortDir, setSortDir]   = useState('desc');

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av === null || av === undefined) av = sortDir === 'asc' ? Infinity : -Infinity;
      if (bv === null || bv === undefined) bv = sortDir === 'asc' ? Infinity : -Infinity;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  if (!data.length) {
    return <div className="benchmark-empty">No data rows to display</div>;
  }

  return (
    <div className="benchmark-table-wrap">
      <table className="benchmark-table" aria-label="Benchmark data table">
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th
                key={col.key}
                className={sortKey === col.key ? 'sorted' : ''}
                onClick={() => handleSort(col.key)}
                aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {col.label}
                <span className="sort-arrow" aria-hidden="true">
                  {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.id || i}>
              {COLUMNS.map(col => {
                const val = row[col.key];
                if (col.key === 'protocol') {
                  const label = PROTOCOL_LABELS[val] || val || '—';
                  return (
                    <td key={col.key}>
                      <span className={`benchmark-protocol-badge benchmark-protocol-badge--${val || 'opencv'}`}>
                        {label}
                      </span>
                    </td>
                  );
                }
                return (
                  <td key={col.key}>
                    {col.fmt ? col.fmt(val) : (val ?? '—')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
