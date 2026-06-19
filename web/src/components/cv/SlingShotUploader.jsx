/**
 * SlingShotUploader.jsx — SlingShot Socials Component
 * ======================================================
 * Upload flow for creating vertical 9:16 barbell tracking videos.
 * Email-gate with CAN-SPAM compliant dual opt-in consent.
 *
 * Steps:
 *   1. Email gate + privacy consent (CAN-SPAM compliant)
 *   2. Video upload with drag-and-drop
 *   3. Processing progress
 *   4. Before/after comparison + download + share
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, Mail, Lock, Download, Share2, Video, RotateCcw, CheckCircle, AlertTriangle } from 'lucide-react';
import { submitAnalysis } from '../../lib/cvApi';

const CONSENT_TEXT = `Your original video is processed in memory and never stored. Your traced video will be stored and available for download indefinitely. You can request deletion at any time by contacting privacy@heatherhollybody.com. By submitting, you consent to the processing described above.`;

function EmailGateStep({ onSubmit }) {
  const [email, setEmail] = useState('');
  const [consentVideo, setConsentVideo] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!consentVideo) {
      setError('Please accept the processing consent to continue.');
      return;
    }
    setError('');
    onSubmit(email, consentVideo, consentMarketing);
  };

  return (
    <div className="slingshot-step slingshot-email-gate">
      <div className="slingshot-email-gate__header">
        <Mail size={24} />
        <h2>Enter Your Email to View Your Traced Lift</h2>
      </div>

      <div className="slingshot-privacy-notice">
        <Lock size={14} />
        <p>{CONSENT_TEXT}</p>
      </div>

      <div className="form-group">
        <label htmlFor="slingshot-email" className="form-label">Email Address</label>
        <input
          id="slingshot-email"
          type="email"
          className="form-input"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          autoComplete="email"
        />
      </div>

      {/* Consent checkbox 1: Required for video delivery */}
      <label className="formai-checkbox-label" htmlFor="slingshot-consent-video">
        <input
          id="slingshot-consent-video"
          type="checkbox"
          className="formai-checkbox"
          checked={consentVideo}
          onChange={e => setConsentVideo(e.target.checked)}
        />
        <span>I consent to the processing and terms above <span className="required-star">*</span></span>
      </label>

      {/* Consent checkbox 2: Optional marketing (CAN-SPAM compliant — separate, unchecked by default) */}
      <label className="formai-checkbox-label" htmlFor="slingshot-consent-marketing">
        <input
          id="slingshot-consent-marketing"
          type="checkbox"
          className="formai-checkbox"
          checked={consentMarketing}
          onChange={e => setConsentMarketing(e.target.checked)}
        />
        <span>I&apos;d also like training tips &amp; offers from HHB (optional)</span>
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button
        id="slingshot-email-submit-btn"
        className="btn btn--primary btn--full"
        onClick={handleSubmit}
        disabled={!consentVideo}
      >
        Continue to Upload →
      </button>
    </div>
  );
}

function UploadStep({ onSubmit, isLoading }) {
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

  return (
    <div className="slingshot-step slingshot-upload">
      <h2>🎬 Upload Your Lift Video</h2>
      <p className="slingshot-upload__subtitle">
        We&apos;ll automatically crop to vertical 9:16 and add a neon trail &amp; speed stats.
      </p>

      <div
        id="slingshot-drop-zone"
        className={`formai-drop-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
        aria-label="Upload lift video"
      >
        {/* iOS: accept="video/*" opens the Photos Library on iPhone;
             omitting the `capture` attribute prevents locking to the live camera. */}
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={e => setFile(e.target.files[0])}
          id="slingshot-file-input"
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
            <p className="drop-zone__hint">Horizontal landscape video recommended · Up to 100 MB</p>
          </>
        )}
      </div>

      <div className="slingshot-features">
        <div className="slingshot-feature">⚡ Neon velocity trail</div>
        <div className="slingshot-feature">📐 Auto 9:16 crop</div>
        <div className="slingshot-feature">📊 Speed analytics HUD</div>
        <div className="slingshot-feature">💧 HHB watermark</div>
      </div>

      <button
        id="slingshot-process-btn"
        className="btn btn--primary btn--full"
        onClick={() => file && onSubmit(file)}
        disabled={!file || isLoading}
      >
        {isLoading ? 'Uploading…' : 'Create My SlingShot →'}
      </button>
    </div>
  );
}

function ProcessingStep({ progress }) {
  return (
    <div className="formai-step formai-processing">
      <div className="formai-processing__spinner" aria-label="Processing" />
      <h2>Creating Your SlingShot Video…</h2>
      {progress?.position > 0 && (
        <p className="formai-processing__queue">
          Position: <strong>{progress.position}</strong>
          {progress.estimatedWait && ` · ~${progress.estimatedWait}s wait`}
        </p>
      )}
      <div className="formai-progress-bar">
        <div className="formai-progress-bar__fill" style={{ width: progress?.phase === 'processing' ? '70%' : '15%' }} />
      </div>
      <p className="slingshot-processing__steps">
        📍 Tracking barbell path → 📐 Calculating 9:16 crop → ⚡ Rendering velocity trail…
      </p>
      <p className="formai-processing__privacy-note">
        🔒 Your original video is never stored — processed in memory only.
      </p>
    </div>
  );
}

function ResultStep({ result, onReset }) {
  const { signed_url, stats } = result || {};
  const [copied, setCopied] = useState(false);
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
      link.download = 'my-slingshot-lift.mp4';
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

  const handleShare = async () => {
    if (navigator.share && signed_url) {
      try {
        await navigator.share({
          title: 'Check out my lift! 🏋️ — via Heather Holly Body',
          url: signed_url,
        });
      } catch { /* user cancelled */ }
    } else if (signed_url) {
      await navigator.clipboard.writeText(signed_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="slingshot-step slingshot-result">
      <div className="formai-results__header">
        <CheckCircle size={28} className="formai-results__check" />
        <h2>Your SlingShot is Ready! 🎬</h2>
      </div>

      {/* Speed stats */}
      {stats && (
        <div className="formai-stats-row">
          <div className="formai-stat">
            <span className="formai-stat__value">{stats.peak_speed_kmh ?? '—'}</span>
            <span className="formai-stat__label">Peak km/h</span>
          </div>
          <div className="formai-stat">
            <span className="formai-stat__value">{stats.avg_speed_kmh ?? '—'}</span>
            <span className="formai-stat__label">Avg km/h</span>
          </div>
          <div className="formai-stat">
            <span className="formai-stat__value">{stats.total_distance_cm ? `${stats.total_distance_cm}cm` : '—'}</span>
            <span className="formai-stat__label">Bar Distance</span>
          </div>
        </div>
      )}

      {/* Video preview */}
      {signed_url ? (
        <div className="formai-video-container">
          <video
            controls
            preload="metadata"
            className="formai-video formai-video--vertical"
            src={signed_url}
            aria-label="SlingShot traced lift video"
          />
        </div>
      ) : (
        <p className="slingshot-result__pending">Video link will appear shortly…</p>
      )}

      {/* Action buttons */}
      <div className="slingshot-actions">
        {signed_url && (
          <button
            id="slingshot-download-btn"
            className="btn btn--primary"
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
                <span>Download MP4</span>
              </>
            )}
          </button>
        )}
        <button
          id="slingshot-share-btn"
          className="btn btn--secondary"
          onClick={handleShare}
        >
          <Share2 size={16} /> {copied ? 'Link Copied!' : 'Share'}
        </button>
      </div>

      <p className="formai-disclaimer-footer">
        Your video is stored by default. You can delete it anytime from your AI Labs dashboard.
      </p>

      <button id="slingshot-reset-btn" className="btn btn--ghost btn--full" onClick={onReset}>
        <RotateCcw size={16} /> Process Another Video
      </button>
    </div>
  );
}

export function SlingShotUploader() {
  const [step, setStep] = useState('upload'); // email | upload | processing | result
  const [email, setEmail] = useState('test@example.com');
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEmailSubmit = useCallback((emailVal) => {
    setEmail(emailVal);
    setStep('upload');
  }, []);

  const handleUploadSubmit = useCallback(async (file) => {
    setIsLoading(true);
    setError(null);
    setStep('processing');

    const consentToken = crypto.randomUUID();

    try {
      const res = await submitAnalysis(
        file,
        'slingshot',
        { email, consent_token: consentToken },
        prog => setProgress(prog)
      );
      setResult(res);
      setStep('result');
    } catch (err) {
      setError(err.message);
      setStep('upload');
    } finally {
      setIsLoading(false);
    }
  }, [email]);

  const handleReset = useCallback(() => {
    setStep('upload');
    setResult(null);
    setProgress(null);
    setError(null);
    setEmail('test@example.com');
  }, []);

  return (
    <section className="slingshot-uploader" aria-label="SlingShot Socials">
      <div className="slingshot-uploader__inner">
        {step === 'email' && <EmailGateStep onSubmit={handleEmailSubmit} />}
        {step === 'upload' && (
          <>
            {error && (
              <div className="formai-error-banner" role="alert">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}
            <UploadStep onSubmit={handleUploadSubmit} isLoading={isLoading} />
          </>
        )}
        {step === 'processing' && <ProcessingStep progress={progress} />}
        {step === 'result' && <ResultStep result={result} onReset={handleReset} />}
      </div>
    </section>
  );
}
