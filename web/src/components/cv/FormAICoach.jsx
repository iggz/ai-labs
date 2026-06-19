/**
 * FormAICoach.jsx — FormAI Coach Component
 * ==========================================
 * Multi-step flow:
 *   1. Camera Setup Wizard + Liability Disclaimer (setup)
 *   2. Configure: Exercise selector (incl. Auto-Detect) + Camera Angle + Minimal Overlay (configure)
 *   3. Upload: File drop zone (upload)
 *   4. Processing / Live Progress View (processing)
 *   5. Results: Annotated video + Rep count + Confidence badge (results)
 *
 * Features:
 *   - Feature 5: Auto-Detect exercise option → ExerciseClassifier on backend
 *   - Feature 7: Camera angle auto-detection → AdaptiveUI warnings via tooltips
 *   - Feature 8: Minimal Overlay Toggle → bypasses skeleton/ROM/badges in video
 *
 * Audio: FormAIAudioEngine fires synthesis pings on depth achievement.
 * Privacy: No biometric data reaches the UI — only rep_count, duration_sec,
 *          exercise_type metadata + the annotated video URL.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, CheckCircle, AlertTriangle, Camera, Info, RotateCcw, Video, Download, ChevronLeft, Zap } from 'lucide-react';
import { submitAnalysis } from '../../lib/cvApi';
import { FormAIAudioEngine } from './FormAIAudioEngine';
import { FormStatsDashboard } from './FormStatsDashboard';

// ── Local storage helpers ─────────────────────────────────────────────────────
function loadPref(key, defaultVal) {
  try { const v = localStorage.getItem(key); return v !== null ? v : defaultVal; }
  catch { return defaultVal; }
}
function savePref(key, val) {
  try { localStorage.setItem(key, val); } catch { /* storage unavailable */ }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CAMERA_TIPS = [
  { check: true,  text: 'At hip height (≈ 30–36 inches from floor)' },
  { check: true,  text: '6–8 feet away from you' },
  { check: true,  text: 'Perpendicular to your movement plane (side view)' },
  { check: false, text: 'NOT on the floor angled upward' },
  { check: false, text: 'NOT behind you — front or side view only' },
];

const EXERCISES = [
  { id: 'auto',      label: 'Auto-Detect', icon: '🤖', description: 'AI detects your exercise automatically' },
  { id: 'squat',     label: 'Squat',       icon: '🏋️', description: 'Knee flexion (hip → knee → ankle)' },
  { id: 'deadlift',  label: 'Deadlift',    icon: '💪', description: 'Hip hinge (shoulder → hip → knee)' },
  { id: 'hip_thrust',label: 'Hip Thrust',  icon: '🔥', description: 'Hip extension (shoulder → hip → knee)' },
];

const CAMERA_ANGLES = [
  { id: 'auto',  label: 'Auto' },
  { id: 'side',  label: 'Side' },
  { id: 'front', label: 'Front' },
  { id: '45deg', label: '45°' },
];

const CAMERA_ANGLE_GUIDANCE = {
  side:  '📐 Film from the side for best accuracy on all exercises.',
  front: '📐 Film from the front — note: depth & hinge angles are less accurate from this view.',
  '45deg': '📐 Film at a 45° angle — moderate accuracy for most exercises.',
  auto:  '📐 Auto-detecting your camera angle — filming from the side gives the best results.',
};

// ── Step 1: Camera Setup + Terms ─────────────────────────────────────────────
function CameraSetupAndTermsStep({ onAccept }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="formai-step formai-setup-terms">
      {/* Camera Setup — top & colourful */}
      <div className="formai-setup-terms__camera">
        <div className="formai-camera-setup__header">
          <Camera size={24} className="color-icon" />
          <h2 className="color-title">Camera Setup Guide</h2>
        </div>
        <p className="formai-camera-setup__subtitle">
          For accurate analysis, position your phone or camera:
        </p>
        <ul className="formai-camera-tips" role="list">
          {CAMERA_TIPS.map((tip, i) => (
            <li key={i} className={`formai-camera-tip ${tip.check ? 'tip--good' : 'tip--bad'}`}>
              <span className="tip__icon">{tip.check ? '✅' : '❌'}</span>
              <span>{tip.text}</span>
            </li>
          ))}
        </ul>
        <div className="formai-camera-setup__angles">
          <h3>Ideal view for each exercise:</h3>
          <ul>
            <li>🦵 Squat → Side view (sagittal plane)</li>
            <li>🏋️ Deadlift → Side view (sagittal plane)</li>
            <li>🔥 Hip Thrust → Side view (sagittal plane)</li>
          </ul>
        </div>
      </div>

      {/* Divider */}
      <div className="formai-setup-terms__divider" />

      {/* Liability Terms — below & nonchalant */}
      <div className="formai-setup-terms__liability">
        <h3 className="formai-liability__title">Liability Disclaimer</h3>
        <p className="formai-liability__text-nonchalant">
          FormAI Coach is an educational tool that provides general movement observations. It is not a substitute for professional coaching, medical advice, physical therapy, or rehabilitation. Angle measurements are estimates only; lighting, camera positioning, and body proportions affect accuracy. Cues are general observations and do not replace personalized instructions from your trainer. Stop immediately if you feel pain or discomfort. Heather Holly Body, LLC is not liable for injuries or adverse outcomes resulting from exercise performed while using this tool.
        </p>
      </div>

      {/* Single Checkbox */}
      <label className="formai-checkbox-label">
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
          id="formai-setup-agree"
          className="formai-checkbox"
        />
        <span>I have set up my camera and agree to the terms.</span>
      </label>

      {/* Continue button */}
      <button
        id="formai-setup-btn"
        className="btn btn--primary btn--full"
        disabled={!agreed}
        onClick={onAccept}
      >
        Accept &amp; Continue →
      </button>
    </div>
  );
}

// ── Step 2: Configure (Feature 5, 7, 8) ──────────────────────────────────────
function ConfigureStep({ exercise, setExercise, cameraAngle, setCameraAngle, overlayMode, setOverlayMode, onNext }) {
  return (
    <div className="formai-step formai-configure">
      <h2>Configure Your Analysis</h2>

      {/* Exercise selector (4 options incl. Auto-Detect) */}
      <div>
        <p className="formai-configure__section-label">Exercise Type</p>
        <div className="formai-exercise-grid" role="radiogroup" aria-label="Select exercise">
          {EXERCISES.map(ex => (
            <button
              key={ex.id}
              id={`formai-exercise-${ex.id}`}
              role="radio"
              aria-checked={exercise === ex.id}
              className={`formai-exercise-btn ${exercise === ex.id ? 'active' : ''} ${ex.id === 'auto' ? 'formai-exercise-btn--auto' : ''}`}
              onClick={() => setExercise(ex.id)}
            >
              <span className="formai-exercise-btn__icon">{ex.icon}</span>
              <span className="formai-exercise-btn__label">{ex.label}</span>
              <span className="formai-exercise-btn__desc">{ex.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Camera angle selector (Feature 7) */}
      <div>
        <p className="formai-configure__section-label">
          Camera Angle
          <span className="formai-configure__section-hint"> — helps optimise angle accuracy</span>
        </p>
        <div className="formai-camera-angle-selector" role="radiogroup" aria-label="Select camera angle">
          {CAMERA_ANGLES.map(ang => (
            <button
              key={ang.id}
              id={`formai-angle-${ang.id}`}
              role="radio"
              aria-checked={cameraAngle === ang.id}
              className={`formai-camera-angle-btn ${cameraAngle === ang.id ? 'active' : ''}`}
              onClick={() => setCameraAngle(ang.id)}
            >
              {ang.label}
            </button>
          ))}
        </div>
      </div>

      {/* Minimal overlay toggle (Feature 8) */}
      <div className="formai-overlay-toggle-row">
        <div className="formai-overlay-toggle-info">
          <span className="formai-overlay-toggle-info__title">Minimal Overlay</span>
          <span className="formai-overlay-toggle-info__desc">
            Hides the neon skeleton &amp; ROM gauges — keeps rep counter only
          </span>
        </div>
        <label className="formai-toggle" htmlFor="formai-overlay-toggle" aria-label="Toggle minimal overlay mode">
          <input
            id="formai-overlay-toggle"
            type="checkbox"
            className="formai-toggle__input"
            checked={overlayMode === 'minimal'}
            onChange={e => setOverlayMode(e.target.checked ? 'minimal' : 'full')}
          />
          <span className="formai-toggle__track">
            <span className="formai-toggle__thumb" />
          </span>
        </label>
      </div>

      <button
        id="formai-configure-next-btn"
        className="btn btn--primary btn--full"
        onClick={onNext}
      >
        Next: Upload Video →
      </button>

      <p className="formai-disclaimer-footer">
        <Info size={12} /> Settings are saved automatically for your next session.
      </p>
    </div>
  );
}

// ── Step 3: Upload ────────────────────────────────────────────────────────────
function UploadStep({ onSubmit, onBack, isLoading, cameraAngle, exercise, protocol, setProtocol }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const handleDrop = useCallback(e => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    // iOS Safari can report an empty MIME type for .mov files from the Photos Library;
    // accept any file whose type starts with 'video/' OR has no type (iOS .mov fallback).
    if (dropped && (dropped.type.startsWith('video/') || dropped.type === '')) setFile(dropped);
  }, []);

  const guidanceText = CAMERA_ANGLE_GUIDANCE[cameraAngle] || CAMERA_ANGLE_GUIDANCE.auto;

  return (
    <div className="formai-step formai-upload">
      <div className="formai-upload__header-row">
        <button
          id="formai-back-btn"
          className="btn btn--ghost formai-upload__back-btn"
          onClick={onBack}
          aria-label="Back to settings"
        >
          <ChevronLeft size={16} /> Back to settings
        </button>
        <h2>Upload Video</h2>
      </div>

      {/* Dynamic guidance banner based on selected camera angle */}
      <div className="formai-upload-guidance-banner" role="note" aria-label="Camera guidance">
        {guidanceText}
      </div>

      {/* Protocol toggle — OpenCV DNN vs YOLO */}
      <div className="protocol-toggle" role="radiogroup" aria-label="Inference protocol">
        <div className="protocol-toggle__pills">
          {[{ id: 'opencv', label: 'OpenCV DNN' }, { id: 'yolo', label: 'YOLO' }].map(opt => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={protocol === opt.id}
              className={`protocol-pill ${protocol === opt.id ? 'protocol-pill--active' : ''}`}
              onClick={() => setProtocol(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`formai-drop-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload video file"
        onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
        id="formai-drop-zone"
      >
        {/* iOS: accept="video/*" opens the Photos Library on iPhone;
         omitting the `capture` attribute prevents locking to the live camera. */}
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={e => setFile(e.target.files[0])}
          id="formai-file-input"
        />
        {file ? (
          <>
            <Video size={32} className="drop-zone__icon drop-zone__icon--success" />
            <p className="drop-zone__filename">{file.name}</p>
            <p className="drop-zone__size">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          </>
        ) : (
          <>
            <Upload size={32} className="drop-zone__icon" />
            <p className="drop-zone__label">Drop your video here or click to browse</p>
            <p className="drop-zone__hint">MP4, MOV, up to 100 MB</p>
          </>
        )}
      </div>

      <button
        id="formai-analyze-btn"
        className="btn btn--primary btn--full"
        onClick={() => file && onSubmit(file, exercise)}
        disabled={!file || isLoading}
      >
        {isLoading ? 'Uploading…' : 'Analyze My Form →'}
      </button>

      <p className="formai-disclaimer-footer">
        <Info size={12} /> This is an AI-generated estimate for educational purposes only. Always consult your trainer.
      </p>
    </div>
  );
}

// ── Step 4: Processing ────────────────────────────────────────────────────────
function ProcessingStep({ progress }) {
  const phases = {
    queued: { label: 'In Queue', pct: 15 },
    processing: { label: 'Analyzing…', pct: 65 },
  };
  const current = phases[progress?.phase] || phases.queued;

  return (
    <div className="formai-step formai-processing">
      <div className="formai-processing__spinner" aria-label="Processing" />
      <h2 className="formai-processing__label">{current.label}</h2>
      {progress?.position > 0 && (
        <p className="formai-processing__queue">
          Position in queue: <strong>{progress.position}</strong>
          {progress.estimatedWait && ` · ~${progress.estimatedWait}s wait`}
        </p>
      )}
      <div className="formai-progress-bar" role="progressbar" aria-valuenow={current.pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="formai-progress-bar__fill" style={{ width: `${current.pct}%` }} />
      </div>
      <p className="formai-processing__privacy-note">
        🔒 Your video is processed securely. Angle measurements exist only in memory and are never stored.
      </p>
    </div>
  );
}

// ── Step 5: Results ───────────────────────────────────────────────────────────
function ResultsStep({ result, onReset, getAudioEngine }) {
  const { signed_url, metadata, processing_log } = result;
  const {
    rep_count, duration_sec, exercise_type, stats,
    // Feature 5: auto-detection
    detected_exercise_type, exercise_confidence,
    // Feature 7: camera angle
    camera_angle_warnings,
  } = metadata || {};
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async (e) => {
    e.preventDefault();
    if (!signed_url || isDownloading) return;

    setIsDownloading(true);
    try {
      const response = await fetch(signed_url);
      if (!response.ok) throw new Error('Network response was not ok');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `formai-${exercise_type || 'workout'}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Failed to download video. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    if (rep_count > 0) {
      const audioEngine = getAudioEngine?.();
      if (audioEngine) {
        audioEngine.resume();
        audioEngine.playDepthAchievedPing();
      }
    }
  }, [rep_count, getAudioEngine]);

  // Feature 5: determine if we should show a confidence badge
  const showDetectionBadge = detected_exercise_type && detected_exercise_type !== 'uncertain';
  const detectedLabel = detected_exercise_type
    ? detected_exercise_type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
    : null;
  const confidencePct = exercise_confidence != null ? Math.round(exercise_confidence * 100) : null;
  const isLowConfidence = exercise_confidence != null && exercise_confidence < 0.70;

  return (
    <div className="formai-step formai-results">
      <div className="formai-results__header-row">
        <div className="formai-results__header">
          <CheckCircle size={28} className="formai-results__check" />
          <h2>Analysis Complete</h2>
        </div>
        <button
          id="formai-reset-btn"
          className="btn btn--primary formai-results__reset-btn"
          onClick={onReset}
        >
          <RotateCcw size={16} /> Analyze Another Video
        </button>
      </div>

      {/* Feature 5: Auto-detection confidence badge */}
      {showDetectionBadge && (
        <div
          className={`formai-detected-badge ${isLowConfidence ? 'formai-detected-badge--warn' : 'formai-detected-badge--ok'}`}
          role="status"
          aria-label={`Detected exercise: ${detectedLabel}, confidence ${confidencePct}%`}
        >
          <Zap size={14} />
          <span>
            Detected: <strong>{detectedLabel}</strong>
            {confidencePct != null && <span className="formai-detected-badge__conf"> ({confidencePct}% confidence)</span>}
          </span>
        </div>
      )}

      {/* Feature 5: Low confidence warning */}
      {isLowConfidence && (
        <div className="formai-low-conf-banner" role="alert">
          <AlertTriangle size={16} />
          <span>
            Auto-detection confidence is low ({confidencePct}%). For more accurate results,
            select your exercise type manually in the Configure step.
          </span>
        </div>
      )}

      {/* Stats row */}
      <div className="formai-stats-row">
        <div className="formai-stat">
          <span className="formai-stat__value">{rep_count ?? '—'}</span>
          <span className="formai-stat__label">Reps Detected</span>
        </div>
        <div className="formai-stat">
          <span className="formai-stat__value">{duration_sec ? `${duration_sec}s` : '—'}</span>
          <span className="formai-stat__label">Duration</span>
        </div>
        <div className="formai-stat">
          <span className="formai-stat__value">{exercise_type ? exercise_type.replace('_', ' ') : '—'}</span>
          <span className="formai-stat__label">Exercise</span>
        </div>
      </div>

      {/* Annotated video */}
      {signed_url ? (
        <div className="formai-video-container">
          <video
            controls
            preload="metadata"
            className="formai-video"
            src={signed_url}
            aria-label="Annotated workout analysis video"
          />
        </div>
      ) : (
        <div className="formai-no-video">
          <p>Video processing complete. Link will appear shortly.</p>
        </div>
      )}

      {/* Video actions */}
      {signed_url && (
        <div className="formai-video-actions">
          <button
            id="formai-download-btn"
            className="btn btn--secondary formai-download-btn"
            onClick={handleDownload}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <>
                <div className="formai-download-spinner" aria-hidden="true" />
                <span>Downloading...</span>
              </>
            ) : (
              <>
                <Download size={16} />
                <span>Download Analyzed Video</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Stats Dashboard — slides up after video (Feature 7: passes camera angle warnings) */}
      <FormStatsDashboard
        stats={stats}
        exerciseType={exercise_type}
        processingLog={processing_log}
        cameraAngleWarnings={camera_angle_warnings}
      />

      {/* Processing audit (low-confidence camera elevation flag) */}
      {processing_log?.avg_camera_elevation_deg > 20 && (
        <div className="formai-low-conf-banner" role="alert">
          <AlertTriangle size={16} />
          <span>
            ⚠ Camera angle detected at ~{Math.round(processing_log.avg_camera_elevation_deg)}°.
            Results may be lower accuracy. Review the <a href="#camera-guide">Camera Setup Guide</a>.
          </span>
        </div>
      )}

      <p className="formai-disclaimer-footer">
        <Info size={12} /> This is an AI-generated estimate for educational purposes only. Always consult your trainer.
      </p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function FormAICoach() {
  // Step flow: setup → configure → upload → processing → results
  const [step, setStep] = useState('setup');
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Feature 5/7/8: localStorage-persisted settings
  const [exercise,    setExerciseRaw]    = useState(() => loadPref('hhb_exercise',    'squat'));
  const [cameraAngle, setCameraAngleRaw] = useState(() => loadPref('hhb_camera_angle', 'auto'));
  const [overlayMode, setOverlayModeRaw] = useState(() => loadPref('hhb_overlay_mode', 'full'));
  const [protocol, setProtocolRaw] = useState('opencv');

  // Persist to localStorage on every change
  const setExercise    = useCallback(v => { savePref('hhb_exercise',    v); setExerciseRaw(v);    }, []);
  const setCameraAngle = useCallback(v => { savePref('hhb_camera_angle', v); setCameraAngleRaw(v); }, []);
  const setOverlayMode = useCallback(v => { savePref('hhb_overlay_mode', v); setOverlayModeRaw(v); }, []);
  const setProtocol    = useCallback(v => { setProtocolRaw(v); }, []);

  const audioEngineRef = useRef(null);

  useEffect(() => {
    audioEngineRef.current = new FormAIAudioEngine();
    return () => audioEngineRef.current?.destroy();
  }, []);

  useEffect(() => {
    if (step === 'configure' || step === 'upload') {
      const element = document.getElementById('ai-labs-panel-form-ai');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [step]);

  const handleSubmit = useCallback(async (file, exerciseType) => {
    setIsLoading(true);
    setError(null);
    setStep('processing');

    // Generate a minimal consent token for this session
    const consentToken = crypto.randomUUID();

    try {
      const res = await submitAnalysis(
        file,
        'form-ai',
        {
          exercise_type: exerciseType,
          consent_token: consentToken,
          overlay_mode: overlayMode,  // Feature 8
          protocol,  // Dual protocol toggle
        },
        (prog) => setProgress(prog)
      );
      setResult(res);
      setStep('results');
    } catch (err) {
      setError(err.message);
      setStep('upload');
    } finally {
      setIsLoading(false);
    }
  }, [overlayMode, protocol]);

  const handleReset = useCallback(() => {
    setStep('configure');
    setResult(null);
    setProgress(null);
    setError(null);
  }, []);

  return (
    <section className="formai-coach" aria-label="FormAI Coach">
      <div className="formai-coach__inner">
        {step === 'setup' && (
          <CameraSetupAndTermsStep onAccept={() => setStep('configure')} />
        )}
        {step === 'configure' && (
          <ConfigureStep
            exercise={exercise}
            setExercise={setExercise}
            cameraAngle={cameraAngle}
            setCameraAngle={setCameraAngle}
            overlayMode={overlayMode}
            setOverlayMode={setOverlayMode}
            onNext={() => setStep('upload')}
          />
        )}
        {step === 'upload' && (
          <>
            {error && (
              <div className="formai-error-banner" role="alert">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}
            <UploadStep
              onSubmit={handleSubmit}
              onBack={() => setStep('configure')}
              isLoading={isLoading}
              cameraAngle={cameraAngle}
              exercise={exercise}
              protocol={protocol}
              setProtocol={setProtocol}
            />
          </>
        )}
        {step === 'processing' && (
          <ProcessingStep progress={progress} />
        )}
        {step === 'results' && result && (
          <ResultsStep
            result={result}
            onReset={handleReset}
            getAudioEngine={() => audioEngineRef.current}
          />
        )}
      </div>
    </section>
  );
}
