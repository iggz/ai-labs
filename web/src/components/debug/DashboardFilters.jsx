/**
 * @file DashboardFilters.jsx
 * @description Filter bar widget for the AI Labs debug dashboard.
 *
 * Provides multi-select method pills, exercise type / version selects,
 * date range pickers, video hash prefix search, and tag filtering.
 *
 * @param {Object}   props
 * @param {Object}   props.filters         - Current filter state
 * @param {string[]} props.filters.methods  - Active methods: 'dnn' | 'yolo' | 'on-device'
 * @param {string}   props.filters.exerciseType
 * @param {string}   props.filters.dateFrom - ISO date string
 * @param {string}   props.filters.dateTo   - ISO date string
 * @param {string}   props.filters.videoHash
 * @param {string}   props.filters.tags     - Comma-separated tag string
 * @param {string}   props.filters.version
 * @param {Function} props.onFiltersChange  - Called with updated filters object
 * @param {Object[]} props.runs             - Full run list (for extracting unique values)
 */
import { useMemo, useCallback } from 'react';

const ALL_METHODS = ['dnn', 'yolo', 'on-device'];

const METHOD_META = {
  dnn:         { label: 'DNN',       cls: 'dbg-method-pill--dnn' },
  yolo:        { label: 'YOLO',      cls: 'dbg-method-pill--yolo' },
  'on-device': { label: 'On-Device', cls: 'dbg-method-pill--ondevice' },
};

const DEFAULT_FILTERS = {
  methods: [...ALL_METHODS],
  exerciseType: '',
  dateFrom: '',
  dateTo: '',
  videoHash: '',
  tags: '',
  version: '',
};

export default function DashboardFilters({ filters, onFiltersChange, runs }) {
  const patch = useCallback(
    (partial) => onFiltersChange({ ...filters, ...partial }),
    [filters, onFiltersChange],
  );

  // --- Derived unique values from runs ---
  const exerciseTypes = useMemo(() => {
    const set = new Set();
    (runs || []).forEach((r) => r.exercise_type && set.add(r.exercise_type));
    return [...set].sort();
  }, [runs]);

  const versions = useMemo(() => {
    const set = new Set();
    (runs || []).forEach((r) => r.version && set.add(r.version));
    return [...set].sort();
  }, [runs]);

  // --- Method toggle ---
  const toggleMethod = useCallback(
    (method) => {
      const cur = filters.methods || [];
      const next = cur.includes(method)
        ? cur.filter((m) => m !== method)
        : [...cur, method];
      // Prevent deselecting all — at least one stays active
      if (next.length === 0) return;
      patch({ methods: next });
    },
    [filters.methods, patch],
  );

  const isDefault =
    (filters.methods || []).length === ALL_METHODS.length &&
    !filters.exerciseType &&
    !filters.dateFrom &&
    !filters.dateTo &&
    !filters.videoHash &&
    !filters.tags &&
    !filters.version;

  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">🔍</span> Filters
        </h3>
        {!isDefault && (
          <button
            className="dbg-filter-clear"
            onClick={() => onFiltersChange({ ...DEFAULT_FILTERS })}
          >
            Clear All
          </button>
        )}
      </div>

      <div className="dbg-filter-bar">
        {/* Method Pills */}
        <div className="dbg-filter-group">
          <span className="dbg-filter-label">Method</span>
          <div className="dbg-method-pills">
            {ALL_METHODS.map((m) => {
              const active = (filters.methods || []).includes(m);
              return (
                <label
                  key={m}
                  className={`dbg-method-pill ${METHOD_META[m].cls}`}
                  data-active={String(active)}
                  onClick={() => toggleMethod(m)}
                >
                  <input type="checkbox" checked={active} readOnly />
                  {METHOD_META[m].label}
                </label>
              );
            })}
          </div>
        </div>

        {/* Exercise Type */}
        <div className="dbg-filter-group">
          <span className="dbg-filter-label">Exercise</span>
          <select
            className="dbg-filter-input"
            value={filters.exerciseType}
            onChange={(e) => patch({ exerciseType: e.target.value })}
          >
            <option value="">All</option>
            {exerciseTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Date Range */}
        <div className="dbg-filter-group">
          <span className="dbg-filter-label">From</span>
          <input
            type="date"
            className="dbg-filter-input"
            value={filters.dateFrom}
            onChange={(e) => patch({ dateFrom: e.target.value })}
          />
        </div>
        <div className="dbg-filter-group">
          <span className="dbg-filter-label">To</span>
          <input
            type="date"
            className="dbg-filter-input"
            value={filters.dateTo}
            onChange={(e) => patch({ dateTo: e.target.value })}
          />
        </div>

        {/* Video Hash */}
        <div className="dbg-filter-group">
          <span className="dbg-filter-label">Video Hash</span>
          <input
            type="text"
            className="dbg-filter-input"
            placeholder="Hash prefix…"
            value={filters.videoHash}
            onChange={(e) => patch({ videoHash: e.target.value })}
          />
        </div>

        {/* Tags */}
        <div className="dbg-filter-group">
          <span className="dbg-filter-label">Tags</span>
          <input
            type="text"
            className="dbg-filter-input"
            placeholder="tag1, tag2…"
            value={filters.tags}
            onChange={(e) => patch({ tags: e.target.value })}
          />
        </div>

        {/* Version */}
        <div className="dbg-filter-group">
          <span className="dbg-filter-label">Version</span>
          <select
            className="dbg-filter-input"
            value={filters.version}
            onChange={(e) => patch({ version: e.target.value })}
          >
            <option value="">All</option>
            {versions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
