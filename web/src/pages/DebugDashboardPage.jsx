/**
 * DebugDashboardPage — PowerBI-style debug analytics dashboard.
 *
 * Route: /debug/dashboard
 *
 * Desktop-first, data-rich analytics for evaluating historical run data
 * across all 3 processing methods (DNN, YOLO, On-Device).
 *
 * Fetches from Worker KV API:
 *   GET /api/debug-logs      → list of run keys + metadata
 *   GET /api/debug-log/:key  → full run data
 *   GET /api/debug-batches   → batch list
 *   POST /api/debug-log/:key/meta → update name/tags
 *   DELETE /api/debug-log/:key    → delete a run
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import '../components/debug/debug-dashboard.css';

// ── Widget imports ───────────────────────────────────────────────────────────
import DashboardFilters from '../components/debug/DashboardFilters';
import SummaryCards from '../components/debug/SummaryCards';
import TimingChart from '../components/debug/TimingChart';
import ServerPhaseBreakdown from '../components/debug/ServerPhaseBreakdown';
import LatencyPercentiles from '../components/debug/LatencyPercentiles';
import NetworkWaterfall from '../components/debug/NetworkWaterfall';
import AccuracyTable from '../components/debug/AccuracyTable';
import AngleHeatmap from '../components/debug/AngleHeatmap';
import ConfidenceDrift from '../components/debug/ConfidenceDrift';
import MemoryProfile from '../components/debug/MemoryProfile';
import ThermalIndicator from '../components/debug/ThermalIndicator';
import BatteryImpact from '../components/debug/BatteryImpact';
import RunHistoryTable from '../components/debug/RunHistoryTable';
import BatchExplorer from '../components/debug/BatchExplorer';
import ExportControls from '../components/debug/ExportControls';
import RegressionDetector from '../components/debug/RegressionDetector';
import CostAllocator from '../components/debug/CostAllocator';

// ── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.PROD ? '/ai-labs' : '';

/**
 * Safely parse a fetch response as JSON.
 * Detects when the Worker returns HTML (e.g. SPA fallback from an undeployed route)
 * instead of JSON, and throws a clear error instead of a cryptic parse failure.
 */
async function safeJson(res, label = 'API') {
  if (!res.ok) throw new Error(`${label}: ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  if (text.startsWith('<!') || text.startsWith('<html')) {
    throw new Error(`${label}: received HTML instead of JSON (endpoint may not be deployed)`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: invalid JSON response`);
  }
}

async function fetchDebugLogs(params = {}) {
  const qs = new URLSearchParams();
  if (params.method) qs.set('method', params.method);
  if (params.video_hash) qs.set('video_hash', params.video_hash);
  if (params.tag) qs.set('tag', params.tag);
  if (params.batch) qs.set('batch', params.batch);
  if (params.version) qs.set('version', params.version);
  if (params.since) qs.set('since', params.since);
  qs.set('limit', '200');
  const res = await fetch(`${API_BASE}/api/debug-logs?${qs}`);
  return safeJson(res, 'debug-logs');
}

async function fetchDebugLog(key) {
  const res = await fetch(`${API_BASE}/api/debug-log/${encodeURIComponent(key)}`);
  return safeJson(res, 'debug-log');
}

async function fetchBatches() {
  const res = await fetch(`${API_BASE}/api/debug-batches`);
  return safeJson(res, 'debug-batches');
}

async function updateLogMeta(key, updates) {
  const res = await fetch(`${API_BASE}/api/debug-log/${encodeURIComponent(key)}/meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return safeJson(res, 'update-meta');
}

async function deleteLogEntry(key) {
  const res = await fetch(`${API_BASE}/api/debug-log/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
  return safeJson(res, 'delete-log');
}

// ── Default filter state ─────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  methods: ['dnn', 'dml', 'yolo', 'cuda', 'on-device'],
  exerciseType: '',
  dateFrom: '',
  dateTo: '',
  videoHash: '',
  tags: '',
  version: '',
};

// ── Data normalizer ──────────────────────────────────────────────────────────
// The unified debug logger writes snake_case fields (e.g. total_round_trip_ms)
// but the dashboard widgets expect camelCase (e.g. totalRoundTripMs).
// This normalizer runs once per run at load time.

function normalizeRun(raw) {
  const run = { ...raw };

  // Normalize client_timings: snake_case → camelCase
  if (run.client_timings) {
    const ct = run.client_timings;
    run.client_timings = {
      ...ct,
      totalRoundTripMs:               ct.totalRoundTripMs               ?? ct.total_round_trip_ms               ?? null,
      uploadDurationMs:               ct.uploadDurationMs               ?? ct.upload_duration_ms               ?? null,
      downloadDurationMs:             ct.downloadDurationMs             ?? ct.download_duration_ms             ?? null,
      serverProcessingMs:             ct.serverProcessingMs             ?? ct.server_processing_ms             ?? null,
      uploadSizeBytes:                ct.uploadSizeBytes                ?? ct.upload_size_bytes                ?? null,
      downloadSizeBytes:              ct.downloadSizeBytes              ?? ct.download_size_bytes              ?? null,
      effectiveUploadBandwidthMbps:   ct.effectiveUploadBandwidthMbps   ?? ct.effective_upload_bandwidth_mbps   ?? null,
      effectiveDownloadBandwidthMbps: ct.effectiveDownloadBandwidthMbps ?? ct.effective_download_bandwidth_mbps ?? null,
      fileSelectToSubmitMs:           ct.fileSelectToSubmitMs           ?? ct.file_select_to_submit_ms         ?? null,
      resultParseMs:                  ct.resultParseMs                  ?? ct.result_parse_ms                  ?? null,
      videoRenderMs:                  ct.videoRenderMs                  ?? ct.video_render_ms                  ?? null,
    };
  }

  // Normalize server_timings: snake_case → camelCase
  if (run.server_timings) {
    const st = run.server_timings;
    run.server_timings = {
      ...st,
      totalServerMs:        st.totalServerMs        ?? st.total_server_ms        ?? null,
      inferenceMs:          st.inferenceMs          ?? st.inference_ms          ?? null,
      overlayMs:            st.overlayMs            ?? st.overlay_ms            ?? null,
      encodeMs:             st.encodeMs             ?? st.encode_ms             ?? null,
      postprocessMs:        st.postprocessMs        ?? st.postprocess_ms        ?? null,
      videoDecodeMs:        st.videoDecodeMs        ?? st.video_decode_ms       ?? null,
      coldStart:            st.coldStart            ?? st.cold_start            ?? false,
      inferencePerFrameMs:  st.inferencePerFrameMs  ?? st.inference_per_frame_ms ?? null,
    };
  }

  // Normalize performance_profile nested objects
  if (run.performance_profile) {
    const pp = run.performance_profile;
    // Ensure nested memory/battery objects are accessible
    run.performance_profile = {
      ...pp,
      memoryBefore:               pp.memoryBefore               ?? pp.memory_before               ?? null,
      memoryAfter:                pp.memoryAfter                ?? pp.memory_after                ?? null,
      thermalThrottlingDetected:  pp.thermalThrottlingDetected  ?? pp.thermal_throttling_detected ?? false,
      batteryBefore:              pp.batteryBefore              ?? pp.battery_before              ?? null,
      batteryAfter:               pp.batteryAfter               ?? pp.battery_after               ?? null,
    };
  }

  // Also lift top-level memory/battery into performance_profile if they exist
  // (unified logger writes them at top level)
  if (!run.performance_profile && (run.memory || run.battery)) {
    run.performance_profile = {
      memoryBefore: run.memory?.before ?? null,
      memoryAfter: run.memory?.after ?? null,
      batteryBefore: run.battery?.before ?? null,
      batteryAfter: run.battery?.after ?? null,
      thermalThrottlingDetected: false,
    };
  }

  return run;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DebugDashboardPage() {
  // Data state
  const [runIndex, setRunIndex] = useState([]);    // list from /api/debug-logs
  const [runData, setRunData] = useState({});       // key → full run object
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI state
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [selectedRunKey, setSelectedRunKey] = useState(null);

  // ── Initial data fetch ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        // Fetch run index and batches in parallel
        // Batches are non-fatal — the batch endpoint may not be deployed yet
        const [logs, batchList] = await Promise.all([
          fetchDebugLogs(),
          fetchBatches().catch(err => {
            console.warn('[Dashboard] Batch fetch failed (non-fatal):', err.message);
            return [];
          }),
        ]);

        if (cancelled) return;

        setRunIndex(logs);
        setBatches(batchList);

        // Fetch full data for each run (parallel, batched to avoid overwhelming)
        const BATCH_SIZE = 10;
        const fullData = {};

        for (let i = 0; i < logs.length; i += BATCH_SIZE) {
          const batch = logs.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map(entry =>
              fetchDebugLog(entry.key)
                .then(data => ({ key: entry.key, data }))
                .catch(() => null)
            )
          );
          if (cancelled) return;
          for (const result of results) {
            if (result) {
              fullData[result.key] = normalizeRun({ ...result.data, _key: result.key });
            }
          }
        }

        setRunData(fullData);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => { cancelled = true; };
  }, []);

  // ── All runs as array ───────────────────────────────────────────────────

  const allRuns = useMemo(() => Object.values(runData), [runData]);

  // ── Filtered runs ───────────────────────────────────────────────────────

  const filteredRuns = useMemo(() => {
    return allRuns.filter(run => {
      // Method filter — null/unknown methods pass through when all pills are active
      const method = run.method === 'ondevice' ? 'on-device' : (run.method || null);
      if (filters.methods.length > 0 && filters.methods.length < 3 && method && !filters.methods.includes(method)) return false;

      // Exercise type
      if (filters.exerciseType && run.exercise_type !== filters.exerciseType) return false;

      // Date range
      if (filters.dateFrom && run.timestamp < filters.dateFrom) return false;
      if (filters.dateTo && run.timestamp > filters.dateTo + 'T23:59:59Z') return false;

      // Video hash prefix
      if (filters.videoHash && !run.video?.hash?.startsWith(filters.videoHash)) return false;

      // Tags
      if (filters.tags) {
        const filterTags = filters.tags.split(',').map(t => t.trim()).filter(Boolean);
        const runTags = run.tags || [];
        if (!filterTags.some(ft => runTags.includes(ft))) return false;
      }

      // Version
      if (filters.version && run.version !== filters.version) return false;

      return true;
    });
  }, [allRuns, filters]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSelectRun = useCallback((key) => {
    setSelectedRunKey(prev => prev === key ? null : key);
  }, []);

  const handleUpdateMeta = useCallback(async (key, updates) => {
    try {
      await updateLogMeta(key, updates);
      // Update local state
      setRunData(prev => {
        const updated = { ...prev };
        if (updated[key]) {
          updated[key] = { ...updated[key], ...updates };
        }
        return updated;
      });
    } catch (err) {
      console.error('Failed to update metadata:', err);
    }
  }, []);

  const handleDeleteRun = useCallback(async (key) => {
    try {
      await deleteLogEntry(key);
      // Remove from local state
      setRunData(prev => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
      setRunIndex(prev => prev.filter(e => e.key !== key));
      if (selectedRunKey === key) setSelectedRunKey(null);
    } catch (err) {
      console.error('Failed to delete run:', err);
    }
  }, [selectedRunKey]);

  // ── Loading state ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="dbg-dashboard">
        <Helmet>
          <title>Debug Dashboard | AI Labs</title>
        </Helmet>
        <div className="dbg-loading">
          <div className="dbg-spinner" />
          <p style={{ color: 'var(--cv-text-muted)', fontSize: '0.85rem' }}>
            Loading debug telemetry…
          </p>
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="dbg-dashboard">
        <Helmet>
          <title>Debug Dashboard | AI Labs</title>
        </Helmet>
        <div className="dbg-empty">
          <div className="dbg-empty__icon">⚠️</div>
          <h2 className="dbg-empty__title">Failed to load dashboard</h2>
          <p className="dbg-empty__text">{error}</p>
          <button className="dbg-btn dbg-btn--ghost" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────

  if (allRuns.length === 0) {
    return (
      <div className="dbg-dashboard">
        <Helmet>
          <title>Debug Dashboard | AI Labs</title>
        </Helmet>
        <div className="dbg-empty">
          <div className="dbg-empty__icon">📊</div>
          <h2 className="dbg-empty__title">No debug runs yet</h2>
          <p className="dbg-empty__text">
            Run an analysis with debug mode enabled to start collecting telemetry.
            Add <span className="dbg-empty__code">?debug=1</span> to the Form AI page URL.
          </p>
          <Link to="/form-ai?debug=1" className="dbg-btn dbg-btn--primary">
            Go to Form AI (Debug Mode)
          </Link>
        </div>
      </div>
    );
  }

  // ── Dashboard ───────────────────────────────────────────────────────────

  return (
    <div className="dbg-dashboard">
      <Helmet>
        <title>{`Debug Dashboard (${filteredRuns.length} runs) | AI Labs`}</title>
      </Helmet>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="dbg-dashboard__header">
        <div>
          <h1 className="dbg-dashboard__title">
            <span>📊</span>
            <span className="dbg-dashboard__title-accent">Debug Dashboard</span>
          </h1>
          <p className="dbg-dashboard__subtitle">
            {filteredRuns.length} of {allRuns.length} runs
            {selectedRunKey && ' · 1 selected'}
            {batches.length > 0 && ` · ${batches.length} batches`}
          </p>
        </div>
        <div className="dbg-dashboard__actions">
          <Link to="/form-ai?debug=1" className="dbg-btn dbg-btn--ghost">
            ← Form AI
          </Link>
          <Link to="/debug/compare" className="dbg-btn dbg-btn--ghost">
            Compare View
          </Link>
        </div>
      </div>

      {/* ── Filters (full width) ────────────────────────────────────── */}
      <div style={{ maxWidth: '1800px', margin: '0 auto 12px' }}>
        <DashboardFilters
          filters={filters}
          onFiltersChange={setFilters}
          runs={allRuns}
        />
      </div>

      {/* ── Summary Cards (full width) ──────────────────────────────── */}
      <div style={{ maxWidth: '1800px', margin: '0 auto 12px' }}>
        <SummaryCards runs={filteredRuns} allRuns={allRuns} />
      </div>

      {/* ── Widget Grid ─────────────────────────────────────────────── */}
      <div className="dbg-dashboard__grid">

        {/* Row 1: Timing */}
        <div className="dbg-span-2">
          <TimingChart
            runs={filteredRuns}
            selectedRunKey={selectedRunKey}
            onSelectRun={handleSelectRun}
          />
        </div>
        <ServerPhaseBreakdown
          runs={filteredRuns}
          selectedRunKey={selectedRunKey}
          onSelectRun={handleSelectRun}
        />

        {/* Row 2: Network + Percentiles */}
        <NetworkWaterfall
          runs={filteredRuns}
          selectedRunKey={selectedRunKey}
          onSelectRun={handleSelectRun}
        />
        <LatencyPercentiles runs={filteredRuns} />
        <RegressionDetector runs={filteredRuns} />

        {/* Row 3: Accuracy */}
        <div className="dbg-span-full">
          <AccuracyTable
            runs={filteredRuns}
            selectedRunKey={selectedRunKey}
            onSelectRun={handleSelectRun}
          />
        </div>

        {/* Row 4: Heatmap + Confidence + Memory */}
        <div className="dbg-span-2">
          <AngleHeatmap runs={filteredRuns} />
        </div>
        <ConfidenceDrift runs={filteredRuns} selectedRunKey={selectedRunKey} />

        {/* Row 5: Performance */}
        <MemoryProfile runs={filteredRuns} />
        <ThermalIndicator runs={filteredRuns} />
        <BatteryImpact runs={filteredRuns} />

        {/* Row 6: History (full width) */}
        <div className="dbg-span-full">
          <RunHistoryTable
            runs={filteredRuns}
            selectedRunKey={selectedRunKey}
            onSelectRun={handleSelectRun}
            onUpdateMeta={handleUpdateMeta}
            onDeleteRun={handleDeleteRun}
          />
        </div>

        {/* Row 7: Batches + Export + Cost */}
        <BatchExplorer batches={batches} />
        <ExportControls runs={filteredRuns} />
        <CostAllocator runs={filteredRuns} />

      </div>
    </div>
  );
}
