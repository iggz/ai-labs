/**
 * SlingShotPage.jsx — SlingShot Route Wrapper
 * =============================================
 * Forces dark theme and renders SlingShotUploader.
 */

import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { SlingShotUploader } from '../components/cv/SlingShotUploader';
import '../components/cv/cv.css';

export default function SlingShotPage() {
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
        <title>SlingShot — AI Labs</title>
        <meta
          name="description"
          content="Transform your lift into a share-worthy 9:16 vertical video with a velocity trail, speed stats HUD, and watermark."
        />
      </Helmet>
      <main
        className="ai-labs"
        id="main-content"
        style={{ paddingBottom: 'calc(var(--nav-height-mobile) + env(safe-area-inset-bottom))' }}
      >
        <SlingShotUploader />
      </main>
    </>
  );
}
