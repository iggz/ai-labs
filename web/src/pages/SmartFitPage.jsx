/**
 * SmartFitPage.jsx — SmartFit Route Wrapper
 * ==========================================
 * Forces dark theme and renders SmartFitGuide.
 */

import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { SmartFitGuide } from '../components/cv/SmartFitGuide';
import '../components/cv/cv.css';

export default function SmartFitPage() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');
    return () => {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.classList.remove('dark');
    };
  }, []);

  return (
    <>
      <Helmet>
        <title>SmartFit Guide — AI Labs</title>
        <meta
          name="description"
          content="Upload a full-body photo and get your personalized size recommendation. Photo is deleted immediately after processing."
        />
      </Helmet>
      <main
        className="ai-labs"
        id="main-content"
        style={{ paddingBottom: 'calc(var(--nav-height-mobile, 60px) + env(safe-area-inset-bottom, 0px))' }}
      >
        <SmartFitGuide />
      </main>
    </>
  );
}
