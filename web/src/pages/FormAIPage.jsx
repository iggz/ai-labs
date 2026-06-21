/**
 * FormAIPage.jsx — FormAI Route Wrapper
 * ========================================
 * Handles the onboarding gate (redirects to /form-ai/setup if not completed),
 * forces dark theme, and renders FormAICoach.
 */

import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { FormAICoach } from '../components/cv/FormAICoach';
import '../components/cv/cv.css';

function isOnboarded() {
  try {
    return localStorage.getItem('formai_onboarded') === 'true';
  } catch {
    return false;
  }
}

export default function FormAIPage() {
  // Force dark theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');
    return () => {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.classList.remove('dark');
    };
  }, []);

  // Redirect to setup if not yet onboarded
  if (!isOnboarded()) {
    return <Navigate to="/form-ai/setup" replace />;
  }

  return (
    <>
      <Helmet>
        <title>FormAI Coach — AI Labs</title>
        <meta
          name="description"
          content="Upload a workout video and get AI-powered form analysis with neon skeleton overlay, rep counting, and real-time audio feedback."
        />
      </Helmet>
      <main
        className="ai-labs"
        id="main-content"
        style={{ paddingBottom: 'calc(var(--nav-height-mobile, 60px) + env(safe-area-inset-bottom, 0px))' }}
      >
        <FormAICoach />
      </main>
    </>
  );
}
