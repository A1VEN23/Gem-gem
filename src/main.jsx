import { createRoot } from 'react-dom/client'
  import './index.css'
  import App from './App.jsx'

  // ─── Global reset: increment this version to wipe all users' localStorage ───
  const RESET_VERSION = "v2";
  const RESET_KEY = "gem_reset_version";

  if (localStorage.getItem(RESET_KEY) !== RESET_VERSION) {
    // Clear every gem_* key so users see the initial screen again
    const keysToDelete = Object.keys(localStorage).filter(k => k.startsWith("gem_") || k.startsWith("mock_"));
    keysToDelete.forEach(k => localStorage.removeItem(k));
    localStorage.setItem(RESET_KEY, RESET_VERSION);
  }

  createRoot(document.getElementById('root')).render(<App />)
  // Deploy: Sun May 17 2026
  