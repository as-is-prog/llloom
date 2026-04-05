import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Unregister service worker and clear caches
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister();
  });
  caches.keys().then((names) => {
    for (const name of names) caches.delete(name);
  });
}

// GitHub Pages SPA redirect handling
const redirect = sessionStorage.getItem('redirect');
if (redirect) {
  sessionStorage.removeItem('redirect');
  const url = new URL(redirect, window.location.origin);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
