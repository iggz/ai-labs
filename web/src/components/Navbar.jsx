/**
 * Navbar.jsx — Responsive Navigation Bar
 * ========================================
 * Mobile (<768px): iOS-style bottom tab bar with glassmorphism.
 * Desktop (≥768px): Sticky top horizontal navbar with pill nav links.
 *
 * Settings gear opens a native <dialog> modal with:
 *   - CV Engine URL input
 *   - On-Device output format toggle (WebM / MP4)
 *   - Reset FormAI Setup button
 */

import { useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, Film, Ruler, Settings, Home, X } from 'lucide-react';
import { getApiBase } from '../lib/cvApi';
import './Navbar.css';

const NAV_LINKS = [
  { to: '/',         label: 'Home',    icon: Home,     id: 'nav-home'     },
  { to: '/form-ai',  label: 'FormAI',  icon: Activity, id: 'nav-formai'   },
  { to: '/slingshot',label: 'SlingShot',icon: Film,    id: 'nav-slingshot'},
  { to: '/smartfit', label: 'SmartFit',icon: Ruler,    id: 'nav-smartfit' },
];

function loadOutputFormat() {
  try {
    return localStorage.getItem('formai_output_format') || 'webm';
  } catch {
    return 'webm';
  }
}

export function Navbar() {
  const dialogRef = useRef(null);

  // Connection settings — read from localStorage at mount time via useState initializer
  const [apiUrl, setApiUrl] = useState(() => getApiBase());
  const [saveStatus, setSaveStatus] = useState('');

  // Output format toggle
  const [outputFormat, setOutputFormatState] = useState(loadOutputFormat);


  const openSettings = () => dialogRef.current?.showModal();
  const closeSettings = () => dialogRef.current?.close();

  const handleSaveSettings = (e) => {
    e.preventDefault();
    const trimmed = apiUrl.trim();
    if (trimmed) {
      localStorage.setItem('HHB_CV_API_URL', trimmed);
      setSaveStatus('saved');
    } else {
      localStorage.removeItem('HHB_CV_API_URL');
      setApiUrl(getApiBase());
      setSaveStatus('reset');
    }
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const handleResetSettings = () => {
    localStorage.removeItem('HHB_CV_API_URL');
    setApiUrl(getApiBase());
    setSaveStatus('reset');
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const handleOutputFormatSelect = (fmt) => {
    setOutputFormatState(fmt);
    try { localStorage.setItem('formai_output_format', fmt); } catch { /* ignore */ }
  };

  const handleResetFormAI = () => {
    try { localStorage.removeItem('formai_onboarded'); } catch { /* ignore */ }
    setSaveStatus('formai-reset');
    setTimeout(() => setSaveStatus(''), 3000);
  };

  // Close dialog on backdrop click
  const handleDialogClick = (e) => {
    if (e.target === dialogRef.current) closeSettings();
  };

  return (
    <>
      {/* ── Desktop top navbar ── */}
      <header className="navbar navbar--desktop" role="banner">
        <div className="navbar__inner">
          <NavLink to="/" className="navbar__brand" aria-label="AI Labs home">
            AI <span className="navbar__brand-accent">Labs</span>
          </NavLink>

          <nav className="navbar__links" role="navigation" aria-label="Main navigation">
            {NAV_LINKS.filter(l => l.to !== '/').map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                id={`${link.id}-desktop`}
                className={({ isActive }) =>
                  `navbar__link ${isActive ? 'navbar__link--active' : ''}`
                }
              >
                <link.icon size={15} aria-hidden="true" />
                <span>{link.label}</span>
              </NavLink>
            ))}
          </nav>

          <button
            className="navbar__settings-btn"
            onClick={openSettings}
            aria-label="Open settings"
            id="navbar-settings-btn-desktop"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* ── Mobile bottom tab bar ── */}
      <nav
        className="navbar navbar--mobile"
        role="navigation"
        aria-label="Main navigation"
      >
        {NAV_LINKS.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            id={`${link.id}-mobile`}
            className={({ isActive }) =>
              `navbar__tab ${isActive ? 'navbar__tab--active' : ''}`
            }
            end={link.to === '/'}
          >
            <link.icon size={22} aria-hidden="true" className="navbar__tab-icon" />
            <span className="navbar__tab-label">{link.label}</span>
          </NavLink>
        ))}
        <button
          className="navbar__tab navbar__tab--settings"
          onClick={openSettings}
          aria-label="Open settings"
          id="navbar-settings-btn-mobile"
        >
          <Settings size={22} aria-hidden="true" className="navbar__tab-icon" />
          <span className="navbar__tab-label">Settings</span>
        </button>
      </nav>

      {/* ── Settings modal ── */}
      <dialog
        ref={dialogRef}
        className="settings-modal"
        aria-label="Settings"
        onClick={handleDialogClick}
      >
        <div className="settings-modal__panel">
          <div className="settings-modal__header">
            <h2 className="settings-modal__title">
              <Settings size={16} aria-hidden="true" /> Settings
            </h2>
            <button
              className="settings-modal__close"
              onClick={closeSettings}
              aria-label="Close settings"
              id="settings-modal-close-btn"
            >
              <X size={18} />
            </button>
          </div>

          {/* Section 1 — Connection */}
          <section className="settings-modal__section" aria-labelledby="settings-connection-heading">
            <h3 className="settings-modal__section-title" id="settings-connection-heading">
              Connection
            </h3>
            <p className="settings-modal__help">
              Connect to your local backend. For testing on the live HTTPS site,
              paste a secure tunnel URL (e.g.{' '}
              <code>https://*.ngrok-free.app</code>).
            </p>
            <form onSubmit={handleSaveSettings} className="settings-modal__form">
              <input
                type="text"
                value={apiUrl}
                onChange={e => setApiUrl(e.target.value)}
                placeholder="http://localhost:8080"
                className="settings-modal__input"
                id="settings-api-url-input"
                aria-label="CV Engine URL"
              />
              <div className="settings-modal__actions">
                <button
                  type="submit"
                  className="btn btn--primary btn--sm"
                  id="settings-save-btn"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleResetSettings}
                  className="btn btn--ghost btn--sm"
                  id="settings-reset-btn"
                >
                  Reset
                </button>
              </div>
              {saveStatus === 'saved' && (
                <span className="settings-modal__status settings-modal__status--success">
                  ✓ Saved!
                </span>
              )}
              {saveStatus === 'reset' && (
                <span className="settings-modal__status settings-modal__status--info">
                  ✓ Reset to default.
                </span>
              )}
            </form>
          </section>

          {/* Section 2 — Output Format */}
          <section className="settings-modal__section" aria-labelledby="settings-format-heading">
            <h3 className="settings-modal__section-title" id="settings-format-heading">
              On-Device Output Format
            </h3>

            {/* Segmented control */}
            <div className="format-selector" role="radiogroup" aria-label="Output format">
              {[
                { id: 'webm', label: 'WebM' },
                { id: 'mp4',  label: 'MP4'  },
              ].map(f => (
                <button
                  key={f.id}
                  id={`settings-format-${f.id}`}
                  type="button"
                  role="radio"
                  aria-checked={outputFormat === f.id}
                  className={`format-selector__btn ${outputFormat === f.id ? 'active' : ''}`}
                  onClick={() => handleOutputFormatSelect(f.id)}
                >
                  {outputFormat === f.id && <span aria-hidden="true">✓ </span>}{f.label}
                </button>
              ))}
            </div>

            {/* Current setting description */}
            <p className="format-selector__desc">
              {outputFormat === 'webm'
                ? 'Currently: WebM — plays on iOS 17+ and all modern browsers.'
                : 'Currently: MP4 — plays everywhere including iOS 16+. Requires ~50 KB extra encoder on first use; processing takes slightly longer.'}
            </p>
            <p className="settings-modal__format-note">
              Only applies when using On Device mode.
            </p>
          </section>

          {/* Section 3 — FormAI Setup */}
          <section className="settings-modal__section" aria-labelledby="settings-formai-heading">
            <h3 className="settings-modal__section-title" id="settings-formai-heading">
              FormAI Setup
            </h3>
            <p className="settings-modal__help">
              Reset the camera setup and terms acceptance. You'll see the setup
              screen again on your next visit to FormAI.
            </p>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={handleResetFormAI}
              id="settings-reset-formai-btn"
            >
              Reset Camera Setup &amp; Terms
            </button>
            {saveStatus === 'formai-reset' && (
              <span className="settings-modal__status settings-modal__status--info">
                ✓ FormAI setup reset.
              </span>
            )}
          </section>
        </div>
      </dialog>
    </>
  );
}
