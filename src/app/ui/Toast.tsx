/** Quiet confirmations at the bottom of the screen ("Saved on this device"). */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
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
    window.setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), action ? 6000 : 3200);
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
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
