/**
 * App.jsx — Root Application with React Router
 * ==============================================
 * Phase 1: Full multi-page routing with persistent Navbar.
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Navbar } from './components/Navbar';
import HomePage from './pages/HomePage';
import FormAIPage from './pages/FormAIPage';
import FormAISetupPage from './pages/FormAISetupPage';
import SlingShotPage from './pages/SlingShotPage';
import SmartFitPage from './pages/SmartFitPage';

export default function App() {
  return (
    <HelmetProvider>
      <BrowserRouter basename="/ai-labs">
        <Navbar />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/form-ai" element={<FormAIPage />} />
          <Route path="/form-ai/setup" element={<FormAISetupPage />} />
          <Route path="/slingshot" element={<SlingShotPage />} />
          <Route path="/smartfit" element={<SmartFitPage />} />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
}
