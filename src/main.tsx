import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import './styles/tokens.css';
import './styles/base.css';

// One build, two entry experiences: the product site at / and the app at /app.
// Each is its own chunk, so the installed app never downloads the marketing page.
const isApp = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');

const App = lazy(() => Promise.all([import('./app/App'), import('./styles/app.css')]).then(([m]) => m));
const Landing = lazy(() => Promise.all([import('./landing/Landing'), import('./styles/landing.css')]).then(([m]) => m));

document.documentElement.dataset.view = isApp ? 'app' : 'site';

createRoot(document.getElementById('root')!).render(
  // StrictMode is kept for the site only: the app's microphone and IndexedDB effects are
  // deliberately single-run (StrictMode would start the recorder twice in development).
  isApp ? (
    <Suspense fallback={<div className="boot" />}>
      <App />
    </Suspense>
  ) : (
    <StrictMode>
      <Suspense fallback={<div className="boot" />}>
        <Landing />
      </Suspense>
    </StrictMode>
  ),
);
