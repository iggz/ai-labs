/**
 * AiLabs.jsx — AI Labs Page
 * ==========================
 * Top-level page integrating FormAI Coach, SlingShot Socials, and SmartFit Guide.
 * Features a premium tabbed interface with animated transitions and optimized
 * 2-column sidebar layout on desktop.
 */

import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Activity, Film, Ruler, Settings } from 'lucide-react';
import { FormAICoach } from '../components/cv/FormAICoach';
import { SlingShotUploader } from '../components/cv/SlingShotUploader';
import { SmartFitGuide } from '../components/cv/SmartFitGuide';
import { getApiBase } from '../lib/cvApi';
import '../components/cv/cv.css';

const TABS = [
  {
    id: 'form-ai',
    label: 'FormAI Coach',
    icon: Activity,
    emoji: '🧠',
    tagline: 'Biomechanical movement analysis',
    description: 'Upload a workout video and get AI-powered form observations with neon skeleton overlay, rep counting, and real-time audio feedback.',
    summary: 'Check your workout form & count reps',
    component: FormAICoach,
    badge: 'Beta',
  },
  {
    id: 'slingshot',
    label: 'SlingShot',
    icon: Film,
    emoji: '⚡',
    tagline: 'Viral barbell tracking videos',
    description: 'Transform your lift into a share-worthy 9:16 vertical video with a velocity trail, speed stats HUD, and watermark.',
    summary: 'Make speed-tracking videos for socials',
    component: SlingShotUploader,
    badge: 'New',
  },
  {
    id: 'smartfit',
    label: 'SmartFit Guide',
    icon: Ruler,
    emoji: '📏',
    tagline: 'AI-powered apparel sizing',
    description: 'Upload a full-body photo and get your personalized size recommendation. Photo is deleted immediately after processing.',
    summary: 'Find your perfect apparel size',
    component: SmartFitGuide,
    badge: null,
  },
];

export default function AiLabs() {
  const [activeTab, setActiveTab] = useState('form-ai');
  const [showSettings, setShowSettings] = useState(false);
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [saveStatus, setSaveStatus] = useState('');

  // Force dark color-scheme on document root to disable browser/extension force-inversion
  useEffect(() => {
    const originalTheme = document.documentElement.getAttribute('data-theme') || 'light';
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');

    return () => {
      document.documentElement.setAttribute('data-theme', originalTheme);
      if (originalTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
  }, []);

  const handleSaveSettings = (e) => {
    e.preventDefault();
    if (apiUrl.trim()) {
      localStorage.setItem('HHB_CV_API_URL', apiUrl.trim());
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

  return (
    <>
      <Helmet>
        <title>AI Labs</title>
        <meta
          name="description"
          content="FormAI Coach, SlingShot video creation, and SmartFit sizing — powered by computer vision. Upload a video to analyze your form, create viral lift videos, or find your perfect size."
        />
      </Helmet>

      <main className="ai-labs" id="main-content">
        <div className="ai-labs__container">
          
          {/* Left Column: Navigation & Tool Info */}
          <div className="ai-labs__sidebar">
            <header className="ai-labs__hero">
              <div className="ai-labs__badge">✨ Computer Vision Suite</div>
              <h1 className="ai-labs__headline">
                AI <span className="ai-labs__headline-accent">Labs</span>
              </h1>
              <p className="ai-labs__subhead">
                Premium computer vision tools for movement analysis.
                Analyze your form, create shareable lift content, and find your perfect fit.
              </p>
            </header>

            {/* Tab Navigation */}
            <nav className="ai-labs__tabs" role="tablist" aria-label="AI Labs tools">
              {TABS.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    id={`ai-labs-tab-${tab.id}`}
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`ai-labs-panel-${tab.id}`}
                    className={`ai-labs__tab ${isActive ? 'ai-labs__tab--active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <span className="ai-labs__tab-emoji">{tab.emoji}</span>
                    <div className="ai-labs__tab-meta">
                      <span className="ai-labs__tab-label">{tab.label}</span>
                      <span className="ai-labs__tab-summary">{tab.summary}</span>
                    </div>
                    {tab.badge && (
                      <span className="ai-labs__tab-badge">{tab.badge}</span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Tool Description Callout */}
            {TABS.filter(t => t.id === activeTab).map(tab => (
              <div key={tab.id} className="ai-labs__tool-desc">
                <span className="ai-labs__tool-tagline">{tab.tagline}</span>
                <p className="ai-labs__tool-description">{tab.description}</p>
              </div>
            ))}

            {/* Privacy Footer */}
            <footer className="ai-labs__privacy-footer">
              <p>
                🔒 <strong>Privacy First:</strong> All computer vision processing runs on a secure local server.
                Raw videos and photos are <strong>never stored</strong> — only your processed results.
              </p>

              {/* Developer Connection Settings */}
              <div className="ai-labs__connection-settings">
                <button
                  className="ai-labs__settings-btn"
                  onClick={() => setShowSettings(!showSettings)}
                  aria-expanded={showSettings}
                >
                  <Settings size={14} className={showSettings ? 'spin' : ''} />
                  <span>Developer Connection Settings</span>
                </button>

                {showSettings && (
                  <form onSubmit={handleSaveSettings} className="ai-labs__settings-form">
                    <p className="ai-labs__settings-help">
                      Connect to your local backend. For testing on the live HTTPS site, paste a secure tunnel URL (e.g. <code>https://*.ngrok-free.app</code>).
                    </p>
                    <div className="ai-labs__settings-input-group">
                      <input
                        type="text"
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        placeholder="http://localhost:8080"
                        className="ai-labs__settings-input"
                      />
                      <div className="ai-labs__settings-actions">
                        <button type="submit" className="btn btn--primary btn--sm">
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={handleResetSettings}
                          className="btn btn--ghost btn--sm"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    {saveStatus === 'saved' && (
                      <span className="ai-labs__settings-status success">✓ Saved!</span>
                    )}
                    {saveStatus === 'reset' && (
                      <span className="ai-labs__settings-status info">✓ Reset to default.</span>
                    )}
                  </form>
                )}
              </div>
            </footer>
          </div>

          {/* Right Column: Work Area / Active Panel */}
          <div className="ai-labs__main">
            <div className="ai-labs__content">
              {TABS.map(tab => (
                <div
                  key={tab.id}
                  id={`ai-labs-panel-${tab.id}`}
                  role="tabpanel"
                  aria-labelledby={`ai-labs-tab-${tab.id}`}
                  hidden={activeTab !== tab.id}
                  className="ai-labs__panel"
                >
                  {activeTab === tab.id && <tab.component />}
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Animated ambient glow */}
        <div className="ai-labs__glow" aria-hidden="true" />
      </main>
    </>
  );
}
