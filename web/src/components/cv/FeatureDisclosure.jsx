/**
 * FeatureDisclosure.jsx — On-Device Feature Comparison Banner
 * ============================================================
 * Dismissible banner shown once per session when user first selects
 * "On Device" protocol. Compares available vs unavailable features.
 */

import { X } from 'lucide-react';

const SESSION_KEY = 'formai_on_device_disclosure_shown';

const FEATURES_AVAILABLE = [
  'Pose detection',
  'Rep counting',
  'Skeleton overlay',
  'ROM gauge',
  'Form grade',
  'Angle stats',
];

const FEATURES_UNAVAILABLE = [
  'Exercise auto-detect',
  'Optical flow tracking',
  'Lens correction',
  'Tempo breakdown (ecc/pause/con)',
  'Symmetry analysis',
  'Camera angle warnings',
];

/**
 * FeatureDisclosure — shown when on-device mode is first selected.
 * Uses a key prop change pattern: parent passes a fresh key when
 * protocol switches to on-device so the component remounts cleanly.
 *
 * @param {Object} props
 * @param {boolean} props.show - Controlled visibility from parent
 * @param {string} [props.outputFormat] - 'webm' or 'mp4'
 * @param {Function} [props.onDismiss] - Called when dismissed
 */
export function FeatureDisclosure({ show, outputFormat = 'webm', onDismiss }) {
  if (!show) return null;

  // Already dismissed this session? Don't show.
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return null;
  } catch { /* ignore */ }

  const handleDismiss = () => {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
    onDismiss?.();
  };

  const formatLabel = outputFormat === 'mp4' ? 'MP4' : 'WebM';

  return (
    <div className="feature-disclosure" role="region" aria-label="On-device feature comparison">
      <div className="feature-disclosure__header">
        <span className="feature-disclosure__title">
          🔒 On-Device Mode
        </span>
        <button
          className="feature-disclosure__close"
          onClick={handleDismiss}
          aria-label="Dismiss on-device feature comparison"
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      <div className="feature-disclosure__grid">
        <div className="feature-disclosure__col">
          {FEATURES_AVAILABLE.map(f => (
            <div key={f} className="feature-disclosure__item feature-disclosure__item--yes">
              <span className="feature-disclosure__check">✅</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
        <div className="feature-disclosure__col">
          {FEATURES_UNAVAILABLE.map(f => (
            <div key={f} className="feature-disclosure__item feature-disclosure__item--no">
              <span className="feature-disclosure__check">❌</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="feature-disclosure__footer">
        Output: {formatLabel} · Change in{' '}
        <span className="feature-disclosure__settings-hint">⚙ Settings</span>
      </p>
    </div>
  );
}
