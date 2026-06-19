/**
 * FormStatsDashboard.jsx — FormAI Session Statistics Dashboard
 * =============================================================
 * Renders below the annotated video in ResultsStep. Shows:
 *   - Circular SVG gauge (0–100) with letter grade (Option A)
 *   - Horizontal progress bar with "Good / Fair / Needs Work" label (Option B)
 *   - Stat cards: Rep count, Best rep, Avg angle, Consistency, Tempo
 *   - Per-rep sparkline: one bar per rep, coloured green/yellow/red vs threshold
 *   - Data quality accordion (camera confidence)
 *
 * Privacy: receives only the ephemeral `stats` object — no PII, no storage.
 *
 * Props:
 *   stats               {object}  — from result.metadata.stats (may be null/undefined)
 *   exerciseType        {string}  — 'squat' | 'deadlift' | 'hip_thrust'
 *   processingLog       {object}  — from result.processing_log
 *   cameraAngleWarnings {object}  — Feature 7: stat_field → warning message mapping
 */

import { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';

// ── Exercise config ───────────────────────────────────────────────────────────
const EXERCISE_META = {
  squat: {
    label: 'Squat',
    emoji: '🏋️',
    primaryMetricName: 'Depth Score',
    primaryMetricUnit: '%',
    angleLabel: 'Knee Flexion',
    angleUnit: '°',
    angleGoodLabel: 'Deepest',
    angleBadLabel: 'Shallowest',
    angleGoodNote: '≤90° = depth achieved',
    // For sparkline: bars coloured by how far below 90° the rep is
    targetAngle: 90,
    angleIsLowerBetter: true,
    accentColor: 'var(--cv-lilac)',
    accentSoft: 'var(--cv-lilac-soft)',
  },
  deadlift: {
    label: 'Deadlift',
    emoji: '💪',
    primaryMetricName: 'Lockout Rate',
    primaryMetricUnit: '%',
    angleLabel: 'Hip Extension',
    angleUnit: '°',
    angleGoodLabel: 'Best Lockout',
    angleBadLabel: 'Worst Lockout',
    angleGoodNote: '≥170° = full lockout',
    targetAngle: 170,
    angleIsLowerBetter: false,
    accentColor: 'var(--cv-amber)',
    accentSoft: 'var(--cv-amber, oklch(0.75 0.12 80 / 0.15))',
  },
  hip_thrust: {
    label: 'Hip Thrust',
    emoji: '🔥',
    primaryMetricName: 'Full Extension Rate',
    primaryMetricUnit: '%',
    angleLabel: 'Hip Extension',
    angleUnit: '°',
    angleGoodLabel: 'Peak Extension',
    angleBadLabel: 'Weakest Rep',
    angleGoodNote: '≥170° = full glute activation',
    targetAngle: 170,
    angleIsLowerBetter: false,
    accentColor: 'var(--cv-rose)',
    accentSoft: 'var(--cv-rose-soft)',
  },
};

// ── Grade → colour ────────────────────────────────────────────────────────────
function gradeColor(grade) {
  if (!grade) return 'var(--cv-text-muted)';
  if (grade === 'A') return 'var(--cv-mint)';
  if (grade === 'B') return 'oklch(0.78 0.15 140)';
  if (grade === 'C') return 'var(--cv-amber)';
  if (grade === 'D') return 'oklch(0.72 0.15 50)';
  return 'oklch(0.65 0.18 20)'; // F — red
}

// ── Progress bar label → colour ───────────────────────────────────────────────
function labelColor(label) {
  if (!label) return 'var(--cv-text-muted)';
  if (label === 'Excellent' || label === 'Good') return 'var(--cv-mint)';
  if (label === 'Fair') return 'var(--cv-amber)';
  return 'oklch(0.65 0.18 20)';
}

// ── Sparkline bar colour per rep (solid-bar fallback) ────────────────────────
function repColor(angle, targetAngle, isLowerBetter) {
  if (angle == null) return 'var(--cv-border)';
  const diff = isLowerBetter ? targetAngle - angle : angle - targetAngle;
  if (diff >= 0) return 'var(--cv-mint)';           // on target
  if (diff >= -10) return 'var(--cv-amber)';         // close
  return 'oklch(0.65 0.18 20)';                      // off
}

// ── Animated counter hook ─────────────────────────────────────────────────────
function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (target == null) { setValue(null); return; }
    const start = performance.now();
    const startVal = 0;
    const end = Number(target);

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(startVal + (end - startVal) * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

// ── Circular SVG Gauge ────────────────────────────────────────────────────────
function CircularGauge({ score, grade, exerciseMeta }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const animScore = useCountUp(score, 1000);
  const fillPct = animScore != null ? animScore / 100 : 0;
  const strokeDashoffset = circumference * (1 - fillPct);
  const color = gradeColor(grade);

  return (
    <div className="stats-gauge" aria-label={`Form score: ${score ?? 'N/A'}%`}>
      <svg viewBox="0 0 130 130" className="stats-gauge__svg" role="img" aria-hidden="true">
        {/* Glow filter */}
        <defs>
          <filter id="gauge-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Track */}
        <circle
          cx="65" cy="65" r={radius}
          fill="none"
          stroke="var(--cv-border)"
          strokeWidth="9"
        />
        {/* Fill arc */}
        <circle
          cx="65" cy="65" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform="rotate(-90 65 65)"
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)', filter: 'url(#gauge-glow)' }}
        />
        {/* Score number */}
        <text
          x="65" y="60"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="24"
          fontWeight="800"
          fill={color}
          style={{ fontFamily: "'Outfit', sans-serif" }}
        >
          {animScore ?? '—'}
        </text>
        {/* /100 label */}
        <text
          x="65" y="78"
          textAnchor="middle"
          fontSize="9"
          fill="var(--cv-text-muted)"
          style={{ fontFamily: "'Outfit', sans-serif" }}
        >
          / 100
        </text>
      </svg>

      {/* Letter grade badge */}
      <div
        className="stats-gauge__grade"
        style={{ color, borderColor: color, boxShadow: `0 0 12px ${color}40` }}
        aria-label={`Letter grade: ${grade ?? 'N/A'}`}
      >
        {grade ?? '—'}
      </div>

      <p className="stats-gauge__metric-name">{exerciseMeta.primaryMetricName}</p>
    </div>
  );
}

// ── Horizontal progress bar ───────────────────────────────────────────────────
function ProgressBar({ score, label }) {
  const animScore = useCountUp(score, 1000);
  const color = labelColor(label);

  return (
    <div className="stats-progress" role="progressbar" aria-valuenow={score ?? 0} aria-valuemin={0} aria-valuemax={100}>
      <div className="stats-progress__track">
        <div
          className="stats-progress__fill"
          style={{
            width: `${animScore ?? 0}%`,
            background: `linear-gradient(90deg, ${color}99, ${color})`,
            boxShadow: `0 0 8px ${color}60`,
          }}
        />
      </div>
      <div className="stats-progress__labels">
        <span className="stats-progress__pct" style={{ color }}>
          {animScore != null ? `${animScore}%` : '—'}
        </span>
        <span className="stats-progress__label" style={{ color }}>
          {label ?? 'Insufficient data'}
        </span>
      </div>
    </div>
  );
}

// ── Individual stat card with optional camera-angle accuracy tooltip (Feature 7) ─
function StatCard({ label, value, unit, subtext, color }) {
  const numericVal = typeof value === 'number' ? value : null;
  const animVal = useCountUp(numericVal, 800);

  const displayVal = numericVal != null
    ? `${animVal}${unit || ''}`
    : (value != null ? `${value}${unit || ''}` : '—');

  return (
    <div className="stats-card" style={{ '--card-accent': color || 'var(--cv-rose)' }}>
      <span
        className="stats-card__value"
        style={{ color: color || 'var(--cv-text)' }}
        aria-label={`${label}: ${displayVal}`}
      >
        {displayVal}
      </span>
      <span className="stats-card__label">{label}</span>
      {subtext && <span className="stats-card__sub">{subtext}</span>}
    </div>
  );
}

/**
 * Wraps a StatCard with an info-icon tooltip when a camera-angle accuracy
 * warning applies to this stat field (Feature 7).
 */
function StatCardWithTooltip({ warningText, children }) {
  const [showTip, setShowTip] = useState(false);

  if (!warningText) return children;

  return (
    <div
      className="stat-card-with-tooltip"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      onFocus={() => setShowTip(true)}
      onBlur={() => setShowTip(false)}
    >
      {children}
      <button
        className="stat-tooltip-icon"
        aria-label={`Camera angle note: ${warningText}`}
        tabIndex={0}
        type="button"
      >
        <Info size={13} />
      </button>
      {showTip && (
        <div className="stat-tooltip" role="tooltip">
          {warningText}
        </div>
      )}
    </div>
  );
}

//// ── Per-rep sparkline (supports stacked tempo bars when phase data provided) ──
function RepSparkline({ perRepAngles, perRepPhases, targetAngle, isLowerBetter, exerciseLabel }) {
  const [tooltip, setTooltip] = useState(null);

  if (!perRepAngles || perRepAngles.length === 0) return null;

  // Determine whether we have tempo phase data for stacked bars
  const hasPhaseData = Array.isArray(perRepPhases) && perRepPhases.length === perRepAngles.length;

  const computeHeightPct = (angle) => {
    if (angle == null) return 15;
    if (isLowerBetter) {
      // Squat: 180° (standing) -> 15% height, 0° (deepest possible) -> 100% height
      const val = 15 + ((180 - angle) / 180) * 85;
      return Math.max(15, Math.min(100, val));
    } else {
      // Deadlift/Hip Thrust: 60° (bottom) -> 15% height, 180° (lockout) -> 100% height
      const val = 15 + ((angle - 60) / 120) * 85;
      return Math.max(15, Math.min(100, val));
    }
  };

  // Compute stacked segment height proportions for a single rep
  const stackedSegments = (phase) => {
    if (!phase) return null;
    const total = (phase.ecc_sec ?? 0) + (phase.pause_sec ?? 0) + (phase.con_sec ?? 0);
    if (total <= 0) return null;
    return {
      ecc:   ((phase.ecc_sec   ?? 0) / total) * 100,
      pause: ((phase.pause_sec ?? 0) / total) * 100,
      con:   ((phase.con_sec   ?? 0) / total) * 100,
    };
  };

  return (
    <div className="stats-sparkline" aria-label={`Per-rep angles for ${exerciseLabel}`}>
      <p className="stats-sparkline__title">
        {hasPhaseData ? 'Per-Rep Tempo Breakdown' : 'Per-Rep Breakdown'}
      </p>
      <div className="stats-sparkline__bars" role="list">
        {perRepAngles.map((angle, i) => {
          const phase = hasPhaseData ? perRepPhases[i] : null;
          const segs  = stackedSegments(phase);
          const solidColor = repColor(angle, targetAngle, isLowerBetter);
          const heightPct  = computeHeightPct(angle);

          const tooltipContent = segs
            ? `Rep ${i + 1}: ${angle != null ? `${angle}°` : '—'} · Ecc ${phase.ecc_sec?.toFixed(1)}s · Pause ${phase.pause_sec?.toFixed(1)}s · Con ${phase.con_sec?.toFixed(1)}s`
            : `Rep ${i + 1}: ${angle != null ? `${angle}°` : 'not detected'}`;

          return (
            <div
              key={i}
              className="stats-sparkline__bar-wrap"
              role="listitem"
              onMouseEnter={() => setTooltip({ i, content: tooltipContent })}
              onMouseLeave={() => setTooltip(null)}
              onFocus={() => setTooltip({ i, content: tooltipContent })}
              onBlur={() => setTooltip(null)}
              tabIndex={0}
              aria-label={tooltipContent}
            >
              <div className="stats-sparkline__bar-container">
                {segs ? (
                  // ── Stacked eccentric/pause/concentric bar ──────────────
                  <div
                    className="stats-sparkline__stacked-bar"
                    style={{ height: `${heightPct}%`, animationDelay: `${i * 50}ms` }}
                  >
                    {/* Concentric on top */}
                    <div className="stats-sparkline__seg stats-sparkline__seg--con"
                      style={{ flex: segs.con }} />
                    {/* Pause in middle */}
                    <div className="stats-sparkline__seg stats-sparkline__seg--pause"
                      style={{ flex: segs.pause }} />
                    {/* Eccentric at bottom */}
                    <div className="stats-sparkline__seg stats-sparkline__seg--ecc"
                      style={{ flex: segs.ecc }} />
                  </div>
                ) : (
                  // ── Solid fallback bar ──────────────────────────────────
                  <div
                    className="stats-sparkline__bar"
                    style={{
                      height: `${heightPct}%`,
                      background: solidColor,
                      boxShadow: `0 0 6px ${solidColor}80`,
                      animationDelay: `${i * 50}ms`,
                    }}
                  >
                    <span className="stats-sparkline__bar-val">
                      {angle != null ? `${Math.round(angle)}°` : '—'}
                    </span>
                  </div>
                )}
              </div>
              <span className="stats-sparkline__rep-num">{i + 1}</span>
              {tooltip?.i === i && (
                <div className="stats-sparkline__tooltip" role="tooltip">
                  {tooltip.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="stats-sparkline__legend">
        {hasPhaseData ? (
          <>
            <span style={{ color: 'var(--cv-mint)' }}>■</span> Eccentric
            <span style={{ color: 'var(--cv-amber)' }}>■</span> Pause
            <span style={{ color: 'var(--cv-rose)' }}>■</span> Concentric
          </>
        ) : (
          <>
            <span style={{ color: 'var(--cv-mint)' }}>■</span> On target
            <span style={{ color: 'var(--cv-amber)' }}>■</span> Close
            <span style={{ color: 'oklch(0.65 0.18 20)' }}>■</span> Off target
          </>
        )}
      </div>
    </div>
  );
}

// ── Symmetry Score Card ───────────────────────────────────────────────────────
function SymmetryCard({ symmetry }) {
  if (!symmetry) return null;
  const { symmetry_score, dominant_side, lateral_shift_px, knee_angle_diff_deg, observations } = symmetry;
  const animScore = useCountUp(symmetry_score, 900);

  // Split-bar: left fill width represents left-lean, right fill represents right-lean
  // When balanced: both halves are 50%
  const isLeft    = dominant_side === 'left';
  const isRight   = dominant_side === 'right';
  const shiftMag  = Math.min(Math.abs(lateral_shift_px) / 50.0, 1.0);  // 0–1
  // leftPct: 50% ± shift. Shift left means right-dominant (more load on right)
  const leftPct   = isLeft ? 50 + shiftMag * 50 : isRight ? 50 - shiftMag * 50 : 50;
  const rightPct  = 100 - leftPct;

  const sideBadgeColor = dominant_side === 'balanced'
    ? 'var(--cv-mint)'
    : dominant_side === 'left' ? 'var(--cv-mint)' : 'var(--cv-rose)';

  return (
    <div className="stats-symmetry" aria-label={`Symmetry score: ${symmetry_score}`}>
      <div className="stats-symmetry__header">
        <span className="stats-symmetry__title">⚖ Symmetry</span>
        <span
          className="stats-symmetry__score"
          style={{ color: symmetry_score >= 80 ? 'var(--cv-mint)' : symmetry_score >= 60 ? 'var(--cv-amber)' : 'oklch(0.65 0.18 20)' }}
        >
          {animScore ?? '—'}<span style={{ fontSize: '0.8em', opacity: 0.7 }}>/100</span>
        </span>
      </div>

      {/* Split progress bar */}
      <div className="stats-symmetry__bar-row">
        <span className="stats-symmetry__side-label">L</span>
        <div className="stats-symmetry__split-bar" aria-hidden="true">
          <div
            className="stats-symmetry__left-fill"
            style={{ width: `${leftPct}%`, transition: 'width 1s cubic-bezier(0.4,0,0.2,1)' }}
          />
          <div className="stats-symmetry__needle" />
          <div
            className="stats-symmetry__right-fill"
            style={{ width: `${rightPct}%`, transition: 'width 1s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </div>
        <span className="stats-symmetry__side-label">R</span>
      </div>

      {/* Dominant side badge */}
      <div className="stats-symmetry__badges">
        <span
          className="stats-symmetry__side-badge"
          style={{ color: sideBadgeColor, borderColor: sideBadgeColor }}
        >
          {dominant_side === 'balanced' ? '✓ BALANCED' : `${dominant_side.toUpperCase()}-DOMINANT`}
        </span>
        {knee_angle_diff_deg != null && (
          <span className="stats-symmetry__detail">
            L/R knee Δ {knee_angle_diff_deg}°
          </span>
        )}
      </div>

      {/* Observations */}
      {observations?.length > 0 && (
        <ul className="stats-symmetry__observations">
          {observations.map((obs, i) => (
            <li key={i}>{obs}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tempo Card ────────────────────────────────────────────────────────────────
function TempoCard({ tempoLabel, avgEccSec, avgPauseSec, avgConSec }) {
  const [showTip, setShowTip] = useState(false);
  if (!tempoLabel || tempoLabel === '—') return null;

  const tooltip = [
    avgEccSec   != null ? `Eccentric: ${avgEccSec}s`    : null,
    avgPauseSec != null ? `Pause: ${avgPauseSec}s`       : null,
    avgConSec   != null ? `Concentric: ${avgConSec}s`    : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className="stats-tempo-card"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      onFocus={() => setShowTip(true)}
      onBlur={() => setShowTip(false)}
      tabIndex={0}
      aria-label={`Average tempo: ${tempoLabel}. ${tooltip}`}
    >
      <span className="stats-tempo-card__label">{tempoLabel}</span>
      <span className="stats-card__label">Tempo (ecc:pause:con)</span>
      {showTip && tooltip && (
        <div className="stats-tempo-card__tooltip" role="tooltip">{tooltip}</div>
      )}
    </div>
  );
}

// ── Data quality accordion ───────────────────────────────────────────────────────
function DataQualityAccordion({ avgConfidence, cameraElevation }) {
  const [open, setOpen] = useState(false);
  if (avgConfidence == null) return null;

  const confPct = Math.round(avgConfidence * 100);
  const confColor = confPct >= 70 ? 'var(--cv-mint)' : confPct >= 50 ? 'var(--cv-amber)' : 'oklch(0.65 0.18 20)';

  return (
    <div className="stats-quality">
      <button
        className="stats-quality__toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="stats-quality-body"
        id="stats-quality-header"
      >
        <span className="stats-quality__icon">📡</span>
        <span>Data Quality</span>
        <span className="stats-quality__badge" style={{ color: confColor, borderColor: confColor }}>
          {confPct}% confidence
        </span>
        <span className="stats-quality__chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
      {open && (
        <div id="stats-quality-body" className="stats-quality__body" role="region" aria-labelledby="stats-quality-header">
          <div className="stats-quality__row">
            <span>Model confidence</span>
            <div className="stats-quality__conf-bar">
              <div style={{ width: `${confPct}%`, background: confColor }} className="stats-quality__conf-fill" />
            </div>
            <span style={{ color: confColor }}>{confPct}%</span>
          </div>
          {cameraElevation != null && cameraElevation > 10 && (
            <p className="stats-quality__warn">
              ⚠ Camera angle ~{Math.round(cameraElevation)}° — for best results, keep the camera at hip height, level with the floor.
            </p>
          )}
          <p className="stats-quality__note">
            Confidence reflects keypoint detection quality and camera position. Scores below 60% may indicate re-filming is needed for reliable feedback.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Sentiment headline ────────────────────────────────────────────────────────
function sentimentLine(grade, exerciseLabel) {
  const map = {
    A: `Excellent ${exerciseLabel} form! 💪`,
    B: `Solid ${exerciseLabel} session! 🌟`,
    C: `Good effort — a few reps to refine 🎯`,
    D: `Building that ${exerciseLabel} strength 🌱`,
    F: `Keep going — every rep counts! 💗`,
  };
  return map[grade] || `${exerciseLabel} analysis complete`;
}

// ── Main component ────────────────────────────────────────────────────────────
export function FormStatsDashboard({ stats, exerciseType, processingLog, cameraAngleWarnings = {} }) {
  const meta = EXERCISE_META[exerciseType] || EXERCISE_META.squat;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Defer mount by one frame so the slide-up animation triggers
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!stats || stats.depth_score_pct == null) {
    return (
      <div className={`stats-dashboard stats-dashboard--empty ${mounted ? 'stats-dashboard--visible' : ''}`}>
        <p className="stats-dashboard__empty-msg">
          📊 Not enough reps detected to generate form statistics.
          Try recording a set with at least 2 complete reps for a full breakdown.
        </p>
      </div>
    );
  }

  const {
    depth_score_pct,
    avg_primary_angle,
    best_rep_angle,
    worst_rep_angle,
    angle_std_dev,
    tempo_sec_per_rep,
    avg_confidence,
    per_rep_angles,
    letter_grade,
    form_label,
    // New Tier-1 fields
    per_rep_phases,
    avg_ecc_sec,
    avg_pause_sec,
    avg_con_sec,
    tempo_label,
    symmetry,
  } = stats;

  const cameraElevation = processingLog?.avg_camera_elevation_deg;

  // Consistency: translate std_dev to a % (lower std = closer to 100%)
  // Std dev of ≤5° = 100%, ≥20° = 0%
  const consistencyPct = angle_std_dev != null
    ? Math.max(0, Math.round(100 - (angle_std_dev / 20) * 100))
    : null;

  return (
    <section
      className={`stats-dashboard ${mounted ? 'stats-dashboard--visible' : ''}`}
      aria-label={`${meta.label} form analysis dashboard`}
      id="formai-stats-dashboard"
    >
      {/* ── Header ── */}
      <div className="stats-header">
        <div className="stats-header__pill" style={{ background: meta.accentSoft, borderColor: meta.accentColor }}>
          <span>{meta.emoji}</span>
          <span style={{ color: meta.accentColor }}>{meta.label.toUpperCase()}</span>
        </div>
        <p className="stats-header__sentiment">
          {sentimentLine(letter_grade, meta.label)}
        </p>
      </div>

      {/* ── Hero: Circular gauge (A) + Progress bar (B) ── */}
      <div className="stats-hero">
        <CircularGauge
          score={depth_score_pct}
          grade={letter_grade}
          exerciseMeta={meta}
        />
        <div className="stats-hero__bar-area">
          <ProgressBar score={depth_score_pct} label={form_label} />
          <p className="stats-hero__threshold-note">{meta.angleGoodNote}</p>
        </div>
      </div>

      {/* ── Stat cards row ── */}
      <div className="stats-cards" role="list" aria-label="Session statistics">
        <div role="listitem">
          <StatCard
            label="Reps"
            value={per_rep_angles?.length ?? null}
            color={meta.accentColor}
          />
        </div>
        <div role="listitem">
          {/* Feature 7: info-icon tooltip on best rep angle if camera angle reduces accuracy */}
          <StatCardWithTooltip warningText={cameraAngleWarnings?.['best_rep_angle']}>
            <StatCard
              label={meta.angleGoodLabel}
              value={best_rep_angle}
              unit="°"
              color="var(--cv-mint)"
            />
          </StatCardWithTooltip>
        </div>
        <div role="listitem">
          {/* Feature 7: info-icon tooltip on avg angle if camera angle reduces accuracy */}
          <StatCardWithTooltip warningText={cameraAngleWarnings?.['avg_primary_angle']}>
            <StatCard
              label={`Avg ${meta.angleLabel}`}
              value={avg_primary_angle}
              unit="°"
              color="var(--cv-text)"
            />
          </StatCardWithTooltip>
        </div>
        <div role="listitem">
          <StatCard
            label="Consistency"
            value={consistencyPct}
            unit="%"
            subtext={angle_std_dev != null ? `±${angle_std_dev}° std dev` : null}
            color={consistencyPct >= 70 ? 'var(--cv-mint)' : consistencyPct >= 50 ? 'var(--cv-amber)' : 'oklch(0.65 0.18 20)'}
          />
        </div>

        {/* Show detailed TempoCard when available; fall back to basic tempo card */}
        {tempo_label && tempo_label !== '—' ? (
          <div role="listitem">
            <TempoCard
              tempoLabel={tempo_label}
              avgEccSec={avg_ecc_sec}
              avgPauseSec={avg_pause_sec}
              avgConSec={avg_con_sec}
            />
          </div>
        ) : tempo_sec_per_rep != null ? (
          <div role="listitem">
            <StatCard
              label="Tempo"
              value={tempo_sec_per_rep}
              unit="s / rep"
              color="var(--cv-lilac)"
            />
          </div>
        ) : null}
      </div>

      {/* ── Symmetry card ── */}
      <SymmetryCard symmetry={symmetry} />

      {/* ── Per-rep sparkline ── */}
      <RepSparkline
        perRepAngles={per_rep_angles}
        perRepPhases={per_rep_phases}
        targetAngle={meta.targetAngle}
        isLowerBetter={meta.angleIsLowerBetter}
        exerciseLabel={meta.label}
      />

      {/* ── Data quality accordion ── */}
      <DataQualityAccordion
        avgConfidence={avg_confidence}
        cameraElevation={cameraElevation}
      />

      {/* ── Disclaimer footer ── */}
      <p className="stats-dashboard__disclaimer">
        📋 These metrics are AI-generated estimates for educational reference only.
        Always review your form with a certified trainer.
      </p>
    </section>
  );
}
