/**
 * HomePage.jsx — AI Labs Landing Page
 * =====================================
 * Hero section + 3 tool cards linking to each tool's route.
 * Replaces the old tab-based AiLabs.jsx layout.
 */

import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Activity, Film, Ruler, ArrowRight } from 'lucide-react';
import '../components/cv/cv.css';

const TOOLS = [
  {
    id: 'form-ai',
    to: '/form-ai',
    icon: Activity,
    emoji: '🧠',
    label: 'FormAI Coach',
    tagline: 'Biomechanical movement analysis',
    description:
      'Upload a workout video and get AI-powered form observations with neon skeleton overlay, rep counting, and real-time audio feedback.',
    badge: 'Beta',
    accentColor: 'var(--cv-rose)',
  },
  {
    id: 'slingshot',
    to: '/slingshot',
    icon: Film,
    emoji: '⚡',
    label: 'SlingShot',
    tagline: 'Viral barbell tracking videos',
    description:
      'Transform your lift into a share-worthy 9:16 vertical video with a velocity trail, speed stats HUD, and watermark.',
    badge: 'New',
    accentColor: 'var(--cv-amber)',
  },
  {
    id: 'smartfit',
    to: '/smartfit',
    icon: Ruler,
    emoji: '📏',
    label: 'SmartFit Guide',
    tagline: 'AI-powered apparel sizing',
    description:
      'Upload a full-body photo and get your personalized size recommendation. Photo is deleted immediately after processing.',
    badge: null,
    accentColor: 'var(--cv-mint)',
  },
];

export default function HomePage() {
  return (
    <main className="home-page ai-labs" id="main-content">
      <Helmet>
        <title>AI Labs — Computer Vision Suite</title>
        <meta
          name="description"
          content="FormAI Coach, SlingShot video creation, and SmartFit sizing — powered by computer vision. Upload a video to analyze your form, create viral lift videos, or find your perfect size."
        />
      </Helmet>

      {/* Ambient glow */}
      <div className="ai-labs__glow" aria-hidden="true" />

      <div className="home-page__container">
        {/* Hero */}
        <header className="home-page__hero">
          <div className="ai-labs__badge">✨ Computer Vision Suite</div>
          <h1 className="ai-labs__headline">
            AI <span className="ai-labs__headline-accent">Labs</span>
          </h1>
          <p className="ai-labs__subhead">
            Premium computer vision tools for movement analysis.
            Analyze your form, create shareable lift content, and find your perfect fit.
          </p>
        </header>

        {/* Tool cards grid */}
        <div className="home-page__grid" role="list">
          {TOOLS.map(tool => (
            <Link
              key={tool.id}
              to={tool.to}
              id={`home-card-${tool.id}`}
              className="home-page__card"
              role="listitem"
              aria-label={`Launch ${tool.label} — ${tool.tagline}`}
              style={{ '--card-accent': tool.accentColor }}
            >
              <div className="home-page__card-header">
                <span className="home-page__card-emoji" aria-hidden="true">
                  {tool.emoji}
                </span>
                {tool.badge && (
                  <span className="home-page__card-badge">{tool.badge}</span>
                )}
              </div>
              <h2 className="home-page__card-title">{tool.label}</h2>
              <p className="home-page__card-tagline">{tool.tagline}</p>
              <p className="home-page__card-desc">{tool.description}</p>
              <div className="home-page__card-cta" aria-hidden="true">
                Launch <ArrowRight size={14} />
              </div>
            </Link>
          ))}
        </div>

        {/* Privacy footer */}
        <footer className="home-page__footer" role="contentinfo">
          <p>
            🔒 <strong>Privacy First:</strong> All computer vision processing
            runs on a secure server. Raw videos and photos are{' '}
            <strong>never stored</strong> — only your processed results.
          </p>
        </footer>
      </div>
    </main>
  );
}
