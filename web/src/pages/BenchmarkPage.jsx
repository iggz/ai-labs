/**
 * BenchmarkPage.jsx — Backend Performance Comparison Dashboard
 * =============================================================
 * Queries Supabase cv_analyses via the Cloudflare Worker /api/benchmarks
 * endpoint to compare processing times across AMD DirectML (PC), CoreML
 * Metal (Mac), CUDA (laptop — coming soon), and On Device.
 *
 * Route: /benchmark
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { BenchmarkSummaryCards } from '../components/benchmark/BenchmarkSummaryCards';
import { BenchmarkBarChart }     from '../components/benchmark/BenchmarkBarChart';
import { BenchmarkTimeline }     from '../components/benchmark/BenchmarkTimeline';
import { BenchmarkDetailCard }   from '../components/benchmark/BenchmarkDetailCard';
import { BenchmarkTable }        from '../components/benchmark/BenchmarkTable';
import '../components/benchmark/benchmark.css';

// ── API helper ────────────────────────────────────────────────────────────────
async function fetchBenchmarks(limit = 200) {
  // The Cloudflare Worker exposes /api/benchmarks which reads from Supabase.
  // In production the worker is at the same origin as the app.
  // In development (localhost) we fall back to the production Worker URL.
  const workerBase = import.meta.env.PROD
    ? ''  // same origin in production
    : 'https://ilovetoridemybicycle.com/ai-labs';

  const url = `${workerBase}/api/benchmarks?limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Protocols to show in detail cards ─────────────────────────────────────────
const DETAIL_PROTOCOLS = ['dml', 'yolo', 'cuda', 'on-device'];

// ── Component ─────────────────────────────────────────────────────────────────
export default function BenchmarkPage() {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [limit,   setLimit]   = useState(200);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchBenchmarks(limit);
      setData(rows);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  // Group by protocol for detail cards
  const byProtocol = DETAIL_PROTOCOLS.reduce((acc, p) => {
    acc[p] = data.filter(r => r.protocol === p);
    return acc;
  }, {});

  const totalJobs = data.length;

  return (
    <>
      <Helmet>
        <title>Benchmark Dashboard — AI Labs</title>
        <meta
          name="description"
          content="Real-time performance comparison across AMD DirectML, Apple CoreML Metal, NVIDIA CUDA, and on-device inference backends."
        />
      </Helmet>

      <div className="benchmark-page">
        <div className="benchmark-page__inner">

          {/* ── Header ── */}
          <header className="benchmark-header">
            <div className="benchmark-header__top">
              <div>
                <h1 className="benchmark-header__title">⚡ Benchmark Dashboard</h1>
                <p className="benchmark-header__sub">
                  Real-time comparison across all inference backends
                </p>
              </div>
              <Link to="/form-ai" className="benchmark-header__back">
                ← FormAI
              </Link>
            </div>

            <div className="benchmark-header__meta">
              <span className="benchmark-header__meta-pill">
                {totalJobs} total jobs
              </span>
              {lastUpdated && (
                <span className="benchmark-header__meta-pill">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
              <button
                id="benchmark-refresh-btn"
                className={`benchmark-refresh-btn ${loading ? 'benchmark-refresh-btn--loading' : ''}`}
                onClick={load}
                disabled={loading}
                aria-label="Refresh benchmark data"
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
                </svg>
                {loading ? 'Loading…' : 'Refresh'}
              </button>
              <select
                id="benchmark-limit-select"
                value={limit}
                onChange={e => setLimit(Number(e.target.value))}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: 'var(--cv-text-muted)',
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
                aria-label="Number of records to fetch"
              >
                <option value={100}>Last 100</option>
                <option value={200}>Last 200</option>
                <option value={500}>Last 500</option>
              </select>
            </div>
          </header>

          {/* ── Error state ── */}
          {error && (
            <div className="benchmark-error" role="alert">
              ⚠ Failed to load benchmark data: {error}
              <button
                onClick={load}
                style={{ marginLeft: '1rem', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5' }}
              >
                Retry
              </button>
            </div>
          )}

          {/* ── Loading state ── */}
          {loading && !data.length && (
            <div className="benchmark-loading" role="status" aria-live="polite">
              <div className="benchmark-spinner" aria-hidden="true" />
              <span>Loading benchmark data…</span>
            </div>
          )}

          {/* ── Content ── */}
          {!loading && !error && data.length === 0 && (
            <div className="benchmark-empty" role="status">
              No benchmark data yet. Run some analyses on FormAI to populate this dashboard.
            </div>
          )}

          {data.length > 0 && (
            <>
              {/* ── Summary Cards ── */}
              <section className="benchmark-section" aria-labelledby="summary-heading">
                <h2 id="summary-heading" className="benchmark-section__title">Backend Overview</h2>
                <BenchmarkSummaryCards data={data} />
              </section>

              {/* ── Bar Chart ── */}
              <section className="benchmark-section" aria-labelledby="barchart-heading">
                <h2 id="barchart-heading" className="benchmark-section__title">
                  Head-to-Head · Processing Time (p50 vs p95)
                </h2>
                <BenchmarkBarChart data={data} />
              </section>

              {/* ── Timeline ── */}
              <section className="benchmark-section" aria-labelledby="timeline-heading">
                <h2 id="timeline-heading" className="benchmark-section__title">
                  Timeline · Processing Time Over Time
                </h2>
                <BenchmarkTimeline data={data} />
              </section>

              {/* ── Detail Cards ── */}
              <section className="benchmark-section" aria-labelledby="detail-heading">
                <h2 id="detail-heading" className="benchmark-section__title">
                  Per-Backend Detail
                </h2>
                <div className="benchmark-detail-cards">
                  {DETAIL_PROTOCOLS.map(p => (
                    byProtocol[p]?.length > 0 && (
                      <BenchmarkDetailCard
                        key={p}
                        protocol={p}
                        rows={byProtocol[p]}
                      />
                    )
                  ))}
                  {DETAIL_PROTOCOLS.every(p => !byProtocol[p]?.length) && (
                    <div className="benchmark-empty">
                      No detailed data available yet
                    </div>
                  )}
                </div>
              </section>

              {/* ── Raw Data Table ── */}
              <section className="benchmark-section" aria-labelledby="table-heading">
                <h2 id="table-heading" className="benchmark-section__title">
                  Raw Job Data ({data.length} rows · click columns to sort)
                </h2>
                <BenchmarkTable data={data} />
              </section>
            </>
          )}

        </div>
      </div>
    </>
  );
}
