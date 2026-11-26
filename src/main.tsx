import { Component, StrictMode, Suspense, lazy, type ReactNode } from 'react';
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

/**
 * Last resort: if the app can't start (for example a file from an older version is gone after an
 * update), offer a reload instead of a blank screen. Saved data lives in the browser and is kept.
 */
class Crash extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[offline] could not start:', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', fontFamily: 'inherit' }}>
        <div style={{ maxWidth: 340 }}>
          <p style={{ fontWeight: 650, fontSize: '1.125rem', margin: '0 0 8px' }}>Offline needs a reload</p>
          <p style={{ color: '#5b6772', margin: '0 0 20px', lineHeight: 1.5 }}>Something went wrong while starting. Your recordings, chats and notes are saved on this device.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  // StrictMode is kept for the site only: the app's microphone and IndexedDB effects are
  // deliberately single-run (StrictMode would start the recorder twice in development).
  isApp ? (
    <Crash>
      <Suspense fallback={<div className="boot" />}>
        <App />
      </Suspense>
    </Crash>
  ) : (
    <StrictMode>
      <Suspense fallback={<div className="boot" />}>
        <Landing />
      </Suspense>
    </StrictMode>
  ),
);
