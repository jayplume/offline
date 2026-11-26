/** Quiet confirmations at the bottom of the screen ("Saved on this device"). */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ToastItem {
  id: number;
  text: string;
  /** `sticky` keeps the toast until it is acted on or dismissed (e.g. a waiting update). */
  action?: { label: string; run: () => void; sticky?: boolean };
}

const Ctx = createContext<(text: string, action?: ToastItem['action']) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const show = useCallback((text: string, action?: ToastItem['action']) => {
    const id = next.current++;
    setItems((p) => [...p.slice(-2), { id, text, action }]);
    if (!action?.sticky) window.setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), action ? 6000 : 3200);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action?.run();
                  setItems((p) => p.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            {t.action?.sticky ? (
              <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}>
                <X aria-hidden />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
