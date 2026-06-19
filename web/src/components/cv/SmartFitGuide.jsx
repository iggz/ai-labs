/**
 * SmartFitGuide.jsx — SmartFit Body Sizing Component
 * ====================================================
 * Privacy-first photo-based sizing recommendation.
 * Photo is processed in memory only — NEVER stored.
 * Only the size recommendation (e.g. "M") is returned.
 *
 * Steps:
 *   1. Privacy consent (BIPA-grade language)
 *   2. Photo upload
 *   3. Processing (fast — images are quick)
 *   4. Size recommendation with garment breakdown
 */

import { useState, useRef, useCallback } from 'react';
import { Upload, Camera, Lock, CheckCircle, RotateCcw, AlertTriangle, Ruler, ShoppingBag } from 'lucide-react';
import { submitAnalysis } from '../../lib/cvApi';

const GARMENT_TYPES = ['crop_top', 'leggings', 'hoodie', 'shorts'];
const GARMENT_LABELS = {
  crop_top: 'Crop Top',
  leggings: 'Leggings',
  hoodie: 'Hoodie',
  shorts: 'Shorts',
};
const GARMENT_ICONS = {
  crop_top: '👕',
  leggings: '🩱',
  hoodie: '🧥',
  shorts: '🩳',
};

const CONSENT_COPY = `To recommend your ideal size, SmartFit analyzes your photo using AI to estimate body proportions. Here's how we protect your privacy:

• Your photo is processed EXCLUSIVELY IN MEMORY on our secure server. It is never saved to any disk, database, or cloud storage.
• No body measurements, silhouettes, or biometric data are retained after processing. Only your size recommendation (e.g., "M") is returned.
• Your photo is permanently deleted from server memory within seconds of processing.
• We do not sell, share, or use your image for any purpose other than generating your size recommendation.

PURPOSE: Size recommendation for apparel.
RETENTION: Zero. Photo deleted immediately after processing.`;

function ConsentStep({ onAccept }) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="smartfit-step smartfit-consent">
      <div className="smartfit-consent__header">
        <Lock size={24} className="smartfit-consent__icon" />
        <h2>Privacy &amp; Consent — SmartFit Body Sizing</h2>
      </div>

      <div className="smartfit-consent__body">
        <pre className="formai-disclaimer__text">{CONSENT_COPY}</pre>
      </div>

      <label className="formai-checkbox-label" htmlFor="smartfit-consent-agree">
        <input
          id="smartfit-consent-agree"
          type="checkbox"
          className="formai-checkbox"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
        />
        <span>
          I consent to the one-time processing of my photo for size recommendation as described above.
        </span>
      </label>

      <button
        id="smartfit-accept-btn"
        className="btn btn--primary btn--full"
        onClick={onAccept}
        disabled={!agreed}
      >
        Get My Size →
      </button>
    </div>
  );
}

function PhotoUploadStep({ onSubmit, isLoading }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const handleFile = useCallback(f => {
    if (!f?.type.startsWith('image/')) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }, []);

  const handleDrop = useCallback(e => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  return (
    <div className="smartfit-step smartfit-upload">
      <h2>📸 Upload a Full-Body Photo</h2>
      <p className="smartfit-upload__hint">
        Stand facing the camera in a front-facing, full-body view for best results.
        Wear form-fitting clothes if possible.
      </p>

      <div
        id="smartfit-drop-zone"
        className={`formai-drop-zone smartfit-drop-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
        aria-label="Upload your photo"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="user"
          className="sr-only"
          id="smartfit-file-input"
          onChange={e => handleFile(e.target.files[0])}
        />
        {preview ? (
          <div className="smartfit-preview">
            <img src={preview} alt="Your photo preview" className="smartfit-preview__img" />
            <p className="smartfit-preview__change">Click to change photo</p>
          </div>
        ) : (
          <>
            <Camera size={36} className="drop-zone__icon" />
            <p className="drop-zone__label">Tap to take photo or browse gallery</p>
            <p className="drop-zone__hint">JPEG, PNG, up to 10 MB</p>
          </>
        )}
      </div>

      <button
        id="smartfit-analyze-btn"
        className="btn btn--primary btn--full"
        onClick={() => file && onSubmit(file)}
        disabled={!file || isLoading}
      >
        {isLoading ? 'Analyzing…' : '✨ Find My Size'}
      </button>

      <p className="formai-processing__privacy-note">
        🔒 Photo never stored. Deleted from server memory immediately after processing.
      </p>
    </div>
  );
}

function ProcessingStep() {
  return (
    <div className="formai-step formai-processing">
      <div className="formai-processing__spinner" aria-label="Processing photo" />
      <h2>Analyzing your proportions…</h2>
      <p className="formai-processing__queue">Usually takes 5–15 seconds</p>
      <div className="formai-progress-bar">
        <div className="formai-progress-bar__fill" style={{ width: '60%' }} />
      </div>
      <p className="formai-processing__privacy-note">
        🔒 Your photo is being analyzed in secure memory and will be deleted immediately.
      </p>
    </div>
  );
}

function ResultsStep({ result, onReset }) {
  const { recommended_sizes, base_size, confidence } = result;

  const confidenceLabel =
    confidence >= 0.8 ? { text: 'High Confidence', color: 'var(--color-success)' } :
    confidence >= 0.6 ? { text: 'Good Confidence', color: 'var(--color-warning)' } :
    { text: 'Lower Confidence — retake in better lighting', color: 'var(--color-muted)' };

  return (
    <div className="smartfit-step smartfit-results">
      <div className="formai-results__header">
        <CheckCircle size={28} className="formai-results__check" />
        <h2>Your Size Recommendation</h2>
      </div>

      {/* Hero size display */}
      <div className="smartfit-hero-size">
        <div className="smartfit-hero-size__label">Your Base Size</div>
        <div className="smartfit-hero-size__value" aria-label={`Recommended size: ${base_size}`}>
          {base_size}
        </div>
        <div
          className="smartfit-confidence-badge"
          style={{ color: confidenceLabel.color }}
        >
          <Ruler size={12} />
          {confidenceLabel.text}
        </div>
      </div>

      {/* Per-garment breakdown */}
      {recommended_sizes && Object.keys(recommended_sizes).length > 0 && (
        <div className="smartfit-garments">
          <h3 className="smartfit-garments__title">
            <ShoppingBag size={16} /> Sizes by Garment
          </h3>
          <div className="smartfit-garment-grid">
            {GARMENT_TYPES
              .filter(g => recommended_sizes[g])
              .map(garment => (
                <div key={garment} className="smartfit-garment-card">
                  <span className="smartfit-garment-card__icon">{GARMENT_ICONS[garment]}</span>
                  <span className="smartfit-garment-card__name">{GARMENT_LABELS[garment]}</span>
                  <span className="smartfit-garment-card__size" aria-label={`${GARMENT_LABELS[garment]}: ${recommended_sizes[garment]}`}>
                    {recommended_sizes[garment]}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="smartfit-size-note">
        <p>
          Sizing is based on estimated body proportions and may vary.
          Check the <a href="/shop#size-guide" className="link">full size guide</a> or
          consult your trainer for a personalized fit check.
        </p>
      </div>

      <p className="formai-processing__privacy-note" style={{ marginTop: '1rem' }}>
        ✅ Your photo has been deleted. No measurements were stored.
      </p>

      <button id="smartfit-reset-btn" className="btn btn--ghost btn--full" onClick={onReset}>
        <RotateCcw size={16} /> Try Again
      </button>
    </div>
  );
}

function ErrorStep({ message, onRetry }) {
  return (
    <div className="smartfit-step smartfit-error">
      <AlertTriangle size={40} className="smartfit-error__icon" />
      <h2>Couldn&apos;t Detect Your Proportions</h2>
      <p className="smartfit-error__message">{message}</p>
      <ul className="smartfit-error__tips">
        <li>✅ Stand in a front-facing, full-body view</li>
        <li>✅ Ensure good lighting (no strong backlight)</li>
        <li>✅ Wear form-fitting clothes if possible</li>
        <li>✅ Make sure your full body is visible</li>
      </ul>
      <button id="smartfit-retry-btn" className="btn btn--primary btn--full" onClick={onRetry}>
        Try Again
      </button>
    </div>
  );
}

export function SmartFitGuide() {
  const [step, setStep] = useState('consent'); // consent | upload | processing | results | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = useCallback(async (file) => {
    setIsLoading(true);
    setStep('processing');

    const consentToken = crypto.randomUUID();

    try {
      const res = await submitAnalysis(
        file,
        'smartfit',
        {
          garment_types: GARMENT_TYPES.join(','),
          consent_token: consentToken,
        },
        null
      );

      if (res?.success === false) {
        setErrorMsg(res.error || 'Could not detect proportions from this photo.');
        setStep('error');
      } else {
        setResult(res);
        setStep('results');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Processing failed. Please try again.');
      setStep('error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setStep('consent');
    setResult(null);
    setErrorMsg('');
  }, []);

  return (
    <section className="smartfit-guide" aria-label="SmartFit Guide">
      <div className="smartfit-guide__inner">
        {step === 'consent' && <ConsentStep onAccept={() => setStep('upload')} />}
        {step === 'upload' && <PhotoUploadStep onSubmit={handleSubmit} isLoading={isLoading} />}
        {step === 'processing' && <ProcessingStep />}
        {step === 'results' && result && <ResultsStep result={result} onReset={handleReset} />}
        {step === 'error' && <ErrorStep message={errorMsg} onRetry={() => setStep('upload')} />}
      </div>
    </section>
  );
}
