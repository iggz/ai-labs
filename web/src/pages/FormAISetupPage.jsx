/**
 * FormAISetupPage.jsx — FormAI Onboarding Gate
 * ==============================================
 * One-time camera setup guide + liability disclaimer.
 * Checkbox + CTA are pinned to the bottom (never scroll-hidden).
 * Scrollable content area sits above.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Camera } from 'lucide-react';
import '../components/cv/cv.css';

const CAMERA_TIPS = [
  { check: true,  text: 'At hip height (≈ 30–36 inches from floor)' },
  { check: true,  text: '6–8 feet away from you' },
  { check: true,  text: 'Perpendicular to your movement plane (side view)' },
  { check: false, text: 'NOT on the floor angled upward' },
  { check: false, text: 'NOT behind you — front or side view only' },
];

const ANGLE_TABLE = [
  { exercise: '🦵 Squat',     angle: 'Side view (sagittal plane)' },
  { exercise: '🏋️ Deadlift',  angle: 'Side view (sagittal plane)' },
  { exercise: '🔥 Hip Thrust', angle: 'Side view (sagittal plane)' },
];

export default function FormAISetupPage() {
  const [agreed, setAgreed] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const navigate = useNavigate();

  // Force dark theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');
    return () => {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.classList.remove('dark');
    };
  }, []);

  const handleContinue = () => {
    try { localStorage.setItem('formai_onboarded', 'true'); } catch { /* ignore */ }
    navigate('/form-ai');
  };

  return (
    <main className="formai-setup-page ai-labs" id="main-content" style={{ overflow: 'hidden' }}>
      <Helmet>
        <title>FormAI Setup — AI Labs</title>
        <meta
          name="description"
          content="Set up your camera and review the disclaimer before using FormAI Coach for biomechanical movement analysis."
        />
      </Helmet>

      <div className="ai-labs__glow" aria-hidden="true" />

      {/* Fullscreen wrapper: scroll area + pinned footer */}
      <div className="formai-setup-page__fixed-wrapper">

        {/* ── Scrollable content ── */}
        <div className="formai-setup-page__scroll-area">
          <div className="formai-setup-page__inner-content">

            {/* Camera Setup Card */}
            <div className="formai-setup-page__card formai-setup-page__card--camera">
              <div className="formai-camera-setup__header">
                <Camera size={22} className="color-icon" aria-hidden="true" />
                <h1 className="color-title">Camera Setup Guide</h1>
              </div>

              <p className="formai-camera-setup__subtitle">
                For accurate analysis, position your phone or camera:
              </p>

              <ul className="formai-camera-tips" role="list">
                {CAMERA_TIPS.map((tip, i) => (
                  <li key={i} className={`formai-camera-tip ${tip.check ? 'tip--good' : 'tip--bad'}`}>
                    <span className="tip__icon" aria-hidden="true">{tip.check ? '✅' : '❌'}</span>
                    <span>{tip.text}</span>
                  </li>
                ))}
              </ul>

              {/* Angle table */}
              <div className="formai-setup-page__angle-table">
                <h2 className="formai-setup-page__angle-title">Ideal view per exercise</h2>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Exercise</th>
                      <th scope="col">Best angle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ANGLE_TABLE.map(row => (
                      <tr key={row.exercise}>
                        <td>{row.exercise}</td>
                        <td>{row.angle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Collapsible "why" */}
              <details
                className="formai-setup-page__detail"
                open={showDetail}
                onToggle={e => setShowDetail(e.target.open)}
              >
                <summary className="formai-setup-page__detail-summary">
                  Why does camera position matter?
                </summary>
                <p className="formai-setup-page__detail-body">
                  The AI estimates joint angles from 2D video. When the camera is
                  at hip height and perpendicular to your movement, it captures
                  the full range of motion without foreshortening. Low, angled, or
                  behind-you shots skew the angle calculations and reduce accuracy.
                </p>
              </details>
            </div>

            {/* Liability Card */}
            <div className="formai-setup-page__card formai-setup-page__card--liability">
              <h2 className="formai-liability__title">Liability Disclaimer</h2>
              <p className="formai-liability__text-nonchalant">
                FormAI Coach is an educational tool that provides general movement
                observations. It is not a substitute for professional coaching,
                medical advice, physical therapy, or rehabilitation. Angle
                measurements are estimates only; lighting, camera positioning, and
                body proportions affect accuracy. Cues are general observations and
                do not replace personalized instructions from your trainer. Stop
                immediately if you feel pain or discomfort. Heather Holly Body, LLC
                is not liable for injuries or adverse outcomes resulting from
                exercise performed while using this tool.
              </p>
            </div>

          </div>
        </div>

        {/* ── Sticky footer — always visible ── */}
        <div className="formai-setup-page__sticky-footer">
          <label className="formai-checkbox-label" htmlFor="formai-setup-agree">
            <input
              type="checkbox"
              id="formai-setup-agree"
              className="formai-checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
            />
            <span>I've set up my camera and agree to the terms.</span>
          </label>

          <button
            id="formai-setup-continue-btn"
            className="btn btn--primary btn--full"
            disabled={!agreed}
            onClick={handleContinue}
          >
            Continue to FormAI →
          </button>
        </div>

      </div>
    </main>
  );
}
