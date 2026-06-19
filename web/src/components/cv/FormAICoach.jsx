/**
 * FormAICoach.jsx — FormAI Coach Component (Phase 1)
 * ====================================================
 * 3-step flow:
 *   1. Configure + Upload  [configure]
 *   2. Centered Processing [processing]
 *   3. Results: two tabs   [results]
 *      Tab A — Dashboard (loads immediately, internally scrollable)
 *      Tab B — Video (unlocks when canplaythrough fires on hidden preload)
 *
 * On Device protocol silently routes to YOLO via onDeviceShim (Phase 1).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, AlertTriangle, Info, RotateCcw,
  Video, Download, Zap,
} from 'lucide-react';
import { submitAnalysis } from '../../lib/cvApi';
import { FormAIAudioEngine } from './FormAIAudioEngine';
import { FormStatsDashboard } from './FormStatsDashboard';
import { InfoPopover } from './InfoPopover';
import { FeatureDisclosure } from './FeatureDisclosure';

// ── Local storage helpers ─────────────────────────────────────────────────────
function loadPref(key, defaultVal) {
  try { const v = localStorage.getItem(key); return v !== null ? v : defaultVal; }
  catch { return defaultVal; }
}
function savePref(key, val) {
  try { localStorage.setItem(key, val); } catch { /* storage unavailable */ }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const EXERCISES = [
  { id: 'squat',      label: 'Squat'       },
  { id: 'deadlift',   label: 'Deadlift'    },
  { id: 'hip_thrust', label: 'Hip Thrust'  },
  { id: 'auto',       label: 'Auto-Detect' },
];

const CAMERA_ANGLES = [
  { id: 'auto',  label: 'Auto'  },
  { id: 'side',  label: 'Side'  },
  { id: 'front', label: 'Front' },
  { id: '45deg', label: '45°'   },
];

const CAMERA_ANGLE_GUIDANCE = {
  side:    '📐 Side view gives best accuracy for all exercises.',
  front:   '📐 Front view — depth & hinge angles are less accurate.',
  '45deg': '📐 45° angle — moderate accuracy for most exercises.',
  auto:    '📐 Auto-detecting camera angle — side view is best.',
};

const PROTOCOLS = [
  { id: 'opencv',    label: 'DNN'       },
  { id: 'yolo',      label: 'YOLO'      },
  { id: 'on-device', label: 'On Device' },
];

// ── Step: Configure + Upload ──────────────────────────────────────────────────
function ConfigureAndUploadStep({
  exercise, setExercise,
  cameraAngle, setCameraAngle,
  overlayMode, setOverlayMode,
  protocol, setProtocol,
  onSubmit, isLoading,
  error,
}) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [disclosureDismissed, setDisclosureDismissed] = useState(false);
  const fileRef = useRef(null);

  const outputFormat = loadPref('formai_output_format', 'webm');
  const isOnDevice = protocol === 'on-device';

  const handleProtocolChange = useCallback((id) => {
    if (id === 'on-device' && exercise === 'auto') {
      setExercise('squat');
    }
    setProtocol(id);
    if (id === 'on-device') {
      setDisclosureDismissed(false);
      setShowDisclosure(true);
    } else {
      setShowDisclosure(false);
    }
  }, [setProtocol, exercise, setExercise]);

  const handleDrop = useCallback(e => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && (dropped.type.startsWith('video/') || dropped.type === '')) {
      setFile(dropped);
    }
  }, []);

  const guidanceText = CAMERA_ANGLE_GUIDANCE[cameraAngle] || CAMERA_ANGLE_GUIDANCE.auto;

  return (
    <div className="formai-step formai-configure-unified">
      <h2 className="formai-configure__heading">Configure Your Analysis</h2>

      {/* Error banner */}
      {error && (
        <div className="formai-error-banner" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* ── Exercise Type ── */}
      <div className="formai-configure__section">
        <div className="formai-configure__label-row">
          <span className="formai-configure__section-label">Exercise Type</span>
          <InfoPopover id="info-exercise">
            <p>Select your exercise so the AI can focus on the correct joint angles. Auto-Detect works well but requires a server-side classifier — not available in On Device mode.</p>
          </InfoPopover>
        </div>
        <div className="formai-segmented" role="radiogroup" aria-label="Select exercise">
          {EXERCISES.map(ex => {
            const isDisabled = isOnDevice && ex.id === 'auto';
            return (
              <button
                key={ex.id}
                id={`formai-exercise-${ex.id}`}
                type="button"
                role="radio"
                aria-checked={exercise === ex.id}
                aria-disabled={isDisabled}
                className={`formai-segmented__btn ${exercise === ex.id ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
                onClick={() => !isDisabled && setExercise(ex.id)}
                title={isDisabled ? 'Auto-Detect is not available in On Device mode' : undefined}
              >
                {ex.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Camera Angle ── */}
      <div className="formai-configure__section">
        <div className="formai-configure__label-row">
          <span className="formai-configure__section-label">Camera Angle</span>
          <InfoPopover id="info-camera-angle">
            <p>Helps optimise angle accuracy. Side view gives the best results for all exercises. If unsure, leave on Auto.</p>
          </InfoPopover>
        </div>
        <div className="formai-segmented" role="radiogroup" aria-label="Select camera angle">
          {CAMERA_ANGLES.map(ang => (
            <button
              key={ang.id}
              id={`formai-angle-${ang.id}`}
              type="button"
              role="radio"
              aria-checked={cameraAngle === ang.id}
              className={`formai-segmented__btn ${cameraAngle === ang.id ? 'active' : ''}`}
              onClick={() => setCameraAngle(ang.id)}
            >
              {ang.label}
            </button>
          ))}
        </div>
        <p className="formai-configure__guidance">{guidanceText}</p>
      </div>

      {/* ── Protocol ── */}
      <div className="formai-configure__section">
        <div className="formai-configure__label-row">
          <span className="formai-configure__section-label">Processing</span>
          <InfoPopover id="info-protocol">
            <p><strong>DNN</strong> — OpenCV-based, fastest, good for well-lit videos.<br /><strong>YOLO</strong> — Best accuracy, recommended for most users.<br /><strong>On Device</strong> — Routes privately through YOLO in Phase 1; full local inference in Phase 2.</p>
          </InfoPopover>
        </div>
        <div className="formai-segmented" role="radiogroup" aria-label="Processing protocol">
          {PROTOCOLS.map(opt => (
            <button
              key={opt.id}
              id={`formai-protocol-${opt.id}`}
              type="button"
              role="radio"
              aria-checked={protocol === opt.id}
              className={`formai-segmented__btn ${protocol === opt.id ? 'active' : ''} ${opt.id === 'on-device' ? 'formai-segmented__btn--on-device' : ''}`}
              onClick={() => handleProtocolChange(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Privacy badge */}
        <div className={`formai-privacy-badge ${isOnDevice ? 'formai-privacy-badge--on-device' : 'formai-privacy-badge--server'}`}>
          {isOnDevice
            ? '🔒 Your video never leaves this device'
            : '☁️ Video is uploaded securely for processing'}
        </div>
      </div>

      {/* ── Feature Disclosure ── */}
      <FeatureDisclosure
        show={showDisclosure && !disclosureDismissed}
        outputFormat={outputFormat}
        onDismiss={() => setDisclosureDismissed(true)}
      />

      {/* ── Minimal Overlay ── */}
      <div className="formai-configure__section">
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
      </div>

      {/* ── Upload Zone ── */}
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
            <Video size={28} className="drop-zone__icon drop-zone__icon--success" />
            <p className="drop-zone__filename">{file.name}</p>
            <p className="drop-zone__size">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          </>
        ) : (
          <>
            <Upload size={28} className="drop-zone__icon" />
            <p className="drop-zone__label">Drop your video here or tap to browse</p>
            <p className="drop-zone__hint">MP4, MOV, up to 100 MB</p>
          </>
        )}
      </div>

      {/* ── CTA ── */}
      <button
        id="formai-analyze-btn"
        className="btn btn--primary btn--full formai-configure__cta"
        onClick={() => file && onSubmit(file, exercise)}
        disabled={!file || isLoading}
      >
        {isLoading ? 'Uploading…' : 'Analyze My Form →'}
      </button>

      <p className="formai-disclaimer-footer">
        <Info size={12} /> AI-generated estimate for educational purposes only. Always consult your trainer.
      </p>
    </div>
  );
}

// ── Step: Processing (dead-centered) ─────────────────────────────────────────
function ProcessingStep({ progress, protocol }) {
  const isOnDevice = protocol === 'on-device';

  const inferFrames = progress?.totalFrames || 0;
  const framesProcessed = progress?.framesProcessed || 0;

  // Estimate time remaining based on FRAME_STRIDE=2, 15fps output
  let timeRemaining = null;
  if (progress?.phase === 'processing' && progress.startTime && framesProcessed > 2) {
    const elapsed = (Date.now() - progress.startTime) / 1000;
    const rate = framesProcessed / elapsed;
    const remaining = (inferFrames - framesProcessed) / rate;
    if (remaining > 3) {
      timeRemaining = remaining < 60
        ? `~${Math.ceil(remaining)}s left`
        : `~${Math.ceil(remaining / 60)}m left`;
    }
  }

  // Compute progress bar percentage
  let pct;
  if (progress?.phase === 'processing' && inferFrames) {
    pct = Math.round((framesProcessed / inferFrames) * 80) + 10;
  } else if (progress?.phase === 'loading_model') {
    pct = 8;
  } else if (progress?.phase === 'queued') {
    pct = 15;
  } else {
    pct = isOnDevice ? 8 : 15;
  }

  const label = progress?.phase === 'loading_model'
    ? 'Loading AI model…'
    : progress?.phase === 'processing'
    ? 'Analyzing…'
    : 'In Queue…';

  return (
    <div className="formai-processing-centered" role="status" aria-live="polite">
      <div className="formai-processing__spinner" aria-label="Processing" />
      <h2 className="formai-processing__label">{label}</h2>
      {/* Queue position (server path) */}
      {progress?.position > 0 && (
        <p className="formai-processing__queue">
          Position in queue: <strong>{progress.position}</strong>
          {progress.estimatedWait && ` · ~${progress.estimatedWait}s wait`}
        </p>
      )}
      {/* Frame-by-frame progress (on-device path) */}
      {progress?.phase === 'loading_model' && (
        <p className="formai-processing__frames">Loading AI model into browser…</p>
      )}
      {progress?.phase === 'processing' && inferFrames && (
        <p className="formai-processing__frames">
          Frame {framesProcessed} / {inferFrames}
          {timeRemaining && (
            <span className="formai-processing__eta">{timeRemaining}</span>
          )}
          {progress.device && (
            <span className="formai-processing__device-badge">
              {progress.device === 'webgpu' ? '⚡ WebGPU' : '🔧 WASM'}
            </span>
          )}
        </p>
      )}
      {progress?.device === 'wasm' && progress?.phase === 'processing' && (
        <p className="formai-processing__fallback-note">
          WebGPU not available — using WASM (may be slower)
        </p>
      )}
      <div
        className="formai-progress-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="formai-progress-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="formai-processing__privacy-note">
        {isOnDevice
          ? '🔒 Processing entirely on your device — video never leaves your browser.'
          : '🔒 Your video is processed securely and never stored.'}
      </p>
    </div>
  );
}

// ── Step: Results (two-tab layout) ───────────────────────────────────────────
function ResultsStep({ result, onReset, getAudioEngine }) {
  const { signed_url, metadata, processing_log } = result;
  const {
    rep_count, exercise_type, stats,
    camera_angle_warnings,
  } = metadata || {};

  const [activeTab, setActiveTab]     = useState('dashboard');
  // videoReady: true → Video tab is immediately clickable (may still be buffering)
  const [videoReady, setVideoReady]   = useState(false);
  // blobUrl: set once full video is buffered into memory → instant zero-lag playback
  const [blobUrl, setBlobUrl]         = useState(null);
  // 0–100 during background download, -1 once blob is ready
  const [bufferPct, setBufferPct]     = useState(0);
  const blobRef                       = useRef(null); // to revoke on unmount
  const [isDownloading, setIsDownloading] = useState(false);
  const isOnDevice = processing_log?.on_device === true;

  // Audio ping on results
  useEffect(() => {
    if (rep_count > 0) {
      const audioEngine = getAudioEngine?.();
      if (audioEngine) { audioEngine.resume(); audioEngine.playDepthAchievedPing(); }
    }
  }, [rep_count, getAudioEngine]);

  /**
   * Background video prefetch — streams the signed_url into a Blob while the
   * user reads the Dashboard tab. Once complete the video element switches to
   * the blob URL so playback starts instantly with no network buffering.
   *
   * • Tab is made clickable immediately (falls back to signed_url for direct streaming
   *   if the user clicks before the blob is ready).
   * • Files > MAX_BLOB_MB skip the blob path to avoid OOM on mobile — the
   *   signed_url is used directly (browser streams on demand).
   * • Blob is revoked on unmount to release memory.
   */
  useEffect(() => {
    const MAX_BLOB_MB = 150; // skip blob approach above this threshold

    if (!signed_url) {
      setVideoReady(true);
      return;
    }

    let cancelled = false;

    // Unlock the tab immediately so the user isn't blocked
    setVideoReady(true);
    setBufferPct(1); // show that something is happening

    (async () => {
      try {
        const response = await fetch(signed_url, { mode: 'cors' });
        if (!response.ok || !response.body) return;

        const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);

        // Skip blob for very large files
        if (contentLength > MAX_BLOB_MB * 1024 * 1024) {
          if (!cancelled) setBufferPct(100);
          return;
        }

        // Detect MIME from URL or Content-Type header
        const mime =
          response.headers.get('Content-Type') ||
          (signed_url.includes('.webm') ? 'video/webm' : 'video/mp4');

        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (cancelled) { reader.cancel(); break; }
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          if (contentLength > 0 && !cancelled) {
            setBufferPct(Math.min(99, Math.round((received / contentLength) * 100)));
          }
        }

        if (!cancelled && chunks.length > 0) {
          const blob = new Blob(chunks, { type: mime });
          const url  = URL.createObjectURL(blob);
          blobRef.current = url;
          setBlobUrl(url);
          setBufferPct(100);
        }
      } catch {
        // Network or CORS error — video plays directly from signed_url (browser streams it)
        if (!cancelled) setBufferPct(100);
      }
    })();

    return () => {
      cancelled = true;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [signed_url]);

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    const fmt = processing_log?.output_format;
    const ext = fmt === 'mp4' ? '.mp4' : fmt === 'webm' ? '.webm' : '.mp4';
    try {
      // If we already have the blob in memory, reuse it — no second download needed
      if (blobRef.current) {
        const link = document.createElement('a');
        link.href = blobRef.current;
        link.download = `formai-${exercise_type || 'workout'}${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      if (!signed_url) return;
      const response = await fetch(signed_url);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const tempUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = tempUrl;
      link.download = `formai-${exercise_type || 'workout'}.${processing_log?.output_format || 'mp4'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(tempUrl), 1000);
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download video. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="formai-results-v2">

      {/* ── Tab strip — only show Video tab when a video was produced ── */}
      <div className="formai-results-tabs" role="tablist" aria-label="Analysis results">
        <button
          id="results-tab-dashboard"
          role="tab"
          aria-selected={activeTab === 'dashboard'}
          aria-controls="results-panel-dashboard"
          className={`formai-results-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          📊 Dashboard
        </button>
        {signed_url && (
          <button
            id="results-tab-video"
            role="tab"
            aria-selected={activeTab === 'video'}
            aria-controls="results-panel-video"
            className={`formai-results-tab ${activeTab === 'video' ? 'active' : ''}`}
            onClick={() => setActiveTab('video')}
            title="View annotated video"
          >
            {bufferPct >= 100 || blobUrl
              ? '▶ Video'
              : `▶ Video (↓${bufferPct}%)`
            }
          </button>
        )}
      </div>


      {/* ── Dashboard panel (internally scrollable) ── */}
      <div
        id="results-panel-dashboard"
        role="tabpanel"
        aria-labelledby="results-tab-dashboard"
        className={`formai-results-panel ${activeTab !== 'dashboard' ? 'formai-panel--hidden' : ''}`}
      >
        {isOnDevice && (
          <div className="formai-privacy-badge formai-privacy-badge--on-device" role="status">
            🔒 Processed entirely on your device
            {!signed_url && (
              <span className="formai-badge-note"> · Video export not available in this browser</span>
            )}
          </div>
        )}

        <FormStatsDashboard
          stats={stats}
          exerciseType={exercise_type}
          processingLog={processing_log}
          cameraAngleWarnings={camera_angle_warnings}
        />

        {/* Analyze Another — bottom of dashboard */}
        <button
          id="formai-analyze-another-bottom"
          className="btn btn--primary btn--full"
          onClick={onReset}
        >
          <RotateCcw size={16} /> Analyze Another Video
        </button>

        <p className="formai-disclaimer-footer">
          <Info size={12} /> AI-generated estimate for educational purposes only. Always consult your trainer.
        </p>
      </div>

      {/* ── Video panel ── */}
      <div
        id="results-panel-video"
        role="tabpanel"
        aria-labelledby="results-tab-video"
        className={`formai-results-video-panel ${activeTab !== 'video' ? 'formai-panel--hidden' : ''}`}
      >
        {(blobUrl || signed_url) && (
          <video
            controls
            autoPlay
            className="formai-results-video-full"
            src={blobUrl ?? signed_url}
            aria-label="Annotated workout analysis video"
          />
        )}

        {/* Buffer progress bar — shown while blob is being built (tab opened early) */}
        {!blobUrl && bufferPct > 0 && bufferPct < 100 && activeTab === 'video' && (
          <div className="formai-video-buffer-bar" role="progressbar"
            aria-valuenow={bufferPct} aria-valuemin={0} aria-valuemax={100}
            aria-label={`Buffering ${bufferPct}%`}
          >
            <div className="formai-video-buffer-bar__fill" style={{ width: `${bufferPct}%` }} />
            <span className="formai-video-buffer-bar__label">
              Pre-loading for instant playback… {bufferPct}%
            </span>
          </div>
        )}

        <div className="formai-results-video-actions">
          <button
            id="formai-download-btn"
            className="btn btn--secondary"
            onClick={handleDownload}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <><div className="formai-download-spinner" aria-hidden="true" /><span>Downloading…</span></>
            ) : (
              <><Download size={16} /><span>Download Video</span></>
            )}
          </button>
          <button
            id="formai-analyze-another-video"
            className="btn btn--ghost"
            onClick={onReset}
          >
            <RotateCcw size={16} /> Analyze Another
          </button>
        </div>
      </div>

    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function FormAICoach() {
  const [step, setStep]         = useState('configure');
  const [progress, setProgress] = useState(null);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Persisted settings
  const [exercise,    setExerciseRaw]    = useState(() => loadPref('hhb_exercise',     'squat'));
  const [cameraAngle, setCameraAngleRaw] = useState(() => loadPref('hhb_camera_angle', 'auto'));
  const [overlayMode, setOverlayModeRaw] = useState(() => loadPref('hhb_overlay_mode', 'full'));
  const [protocol,    setProtocolRaw]    = useState(() => loadPref('hhb_protocol',     'opencv'));

  const setExercise    = useCallback(v => { savePref('hhb_exercise',     v); setExerciseRaw(v);    }, []);
  const setCameraAngle = useCallback(v => { savePref('hhb_camera_angle', v); setCameraAngleRaw(v); }, []);
  const setOverlayMode = useCallback(v => { savePref('hhb_overlay_mode', v); setOverlayModeRaw(v); }, []);
  const setProtocol    = useCallback(v => { savePref('hhb_protocol',     v); setProtocolRaw(v);   }, []);

  const audioEngineRef = useRef(null);

  useEffect(() => {
    audioEngineRef.current = new FormAIAudioEngine();
    return () => audioEngineRef.current?.destroy();
  }, []);

  const handleSubmit = useCallback(async (file, exerciseType) => {
    setIsLoading(true);
    setError(null);
    setStep('processing');

    const consentToken = crypto.randomUUID();

    try {
      let res;
      if (protocol === 'on-device') {
        const { processVideoOnDevice } = await import('../../lib/inference/onDeviceInference.js');
        const startTime = Date.now();
        res = await processVideoOnDevice(file, {
          exerciseType,
          overlayMode,
          cameraAngle,
          onProgress: (prog) => setProgress({ ...prog, startTime }),
        });
      } else {
        res = await submitAnalysis(
          file,
          'form-ai',
          {
            exercise_type: exerciseType,
            consent_token: consentToken,
            overlay_mode: overlayMode,
            protocol,
            camera_angle: cameraAngle,
          },
          (prog) => setProgress(prog),
        );
      }
      setResult(res);
      setStep('results');
    } catch (err) {
      setError(err.message);
      setStep('configure');
    } finally {
      setIsLoading(false);
    }
  }, [overlayMode, protocol, cameraAngle]);

  const handleReset = useCallback(() => {
    setStep('configure');
    setResult(null);
    setProgress(null);
    setError(null);
  }, []);

  return (
    <section className="formai-coach" aria-label="FormAI Coach">
      <div className="formai-coach__inner">
        {step === 'configure' && (
          <ConfigureAndUploadStep
            exercise={exercise}
            setExercise={setExercise}
            cameraAngle={cameraAngle}
            setCameraAngle={setCameraAngle}
            overlayMode={overlayMode}
            setOverlayMode={setOverlayMode}
            protocol={protocol}
            setProtocol={setProtocol}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            error={error}
          />
        )}
        {step === 'processing' && (
          <ProcessingStep progress={progress} protocol={protocol} />
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
