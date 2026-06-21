/**
 * App.jsx — Root Application with React Router
 * ==============================================
 * Phase 1: Full multi-page routing with persistent Navbar.
 * Debug routes are lazy-loaded — zero impact on main bundle.
 */

import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Navbar } from './components/Navbar';
import HomePage from './pages/HomePage';
import FormAIPage from './pages/FormAIPage';
import FormAISetupPage from './pages/FormAISetupPage';
import SlingShotPage from './pages/SlingShotPage';
import SmartFitPage from './pages/SmartFitPage';

// Debug routes — lazy-loaded (only imported when accessed)
const DebugComparePage = lazy(() => import('./pages/DebugComparePage'));
const DebugDashboardPage = lazy(() => import('./pages/DebugDashboardPage'));

export default function App() {
  return (
    <HelmetProvider>
      <BrowserRouter basename={import.meta.env.PROD ? '/ai-labs' : '/'}>
        <Navbar />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/form-ai" element={<FormAIPage />} />
          <Route path="/form-ai/setup" element={<FormAISetupPage />} />
          <Route path="/slingshot" element={<SlingShotPage />} />
          <Route path="/smartfit" element={<SmartFitPage />} />

          {/* Debug routes — accessible without ?debug=1 (URL itself is the gate) */}
          <Route path="/debug/compare" element={
            <Suspense fallback={
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', color: '#94a3b8' }}>
                Loading comparison…
              </div>
            }>
              <DebugComparePage />
            </Suspense>
          } />
          <Route path="/debug/dashboard" element={
            <Suspense fallback={
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', color: '#94a3b8' }}>
                Loading dashboard…
              </div>
            }>
              <DebugDashboardPage />
            </Suspense>
          } />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
}
