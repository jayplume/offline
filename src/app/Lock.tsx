/**
 * Lock screen. Shown on start and after the chosen idle time when app lock is on.
 * Device unlock (WebAuthn platform authenticator) or a PIN. Nothing behind it renders until unlocked.
 */
import { useEffect, useRef, useState } from 'react';
import { Fingerprint, Lock as LockIcon } from 'lucide-react';
import { verifyBiometric, verifyPin } from '../lib/lock';
import type { LockConfig } from '../lib/db';
import { LogoMark } from './Home';

export function LockScreen({ lock, onUnlock }: { lock: LockConfig; onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tryBiometric = async () => {
    if (!lock.credentialId) return;
    setBusy(true);
    setError(null);
    const ok = await verifyBiometric(lock.credentialId);
    setBusy(false);
    if (ok) onUnlock();
    else setError("That didn't unlock Offline. Try again.");
  };

  useEffect(() => {
    if (lock.method === 'pin') inputRef.current?.focus();
  }, [lock.method]);

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await verifyPin(pin, lock);
    setBusy(false);
    if (ok) onUnlock();
    else {
      setError('Wrong PIN.');
      setPin('');
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <LogoMark size={44} />
        <h1>Offline is locked</h1>
        <p className="muted">Your drafts stay on this device.</p>
        {lock.method === 'biometric' ? (
          <button type="button" className="btn btn-primary btn-block" onClick={() => void tryBiometric()} disabled={busy}>
            <Fingerprint aria-hidden />
            Unlock
          </button>
        ) : (
          <form onSubmit={(e) => void submitPin(e)} className="lock-pin">
            <label className="sr-only" htmlFor="lock-pin">
              PIN
            </label>
            <input
              id="lock-pin"
              ref={inputRef}
              inputMode="numeric"
              autoComplete="current-password"
              type="password"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="PIN"
            />
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || pin.length < 4}>
              <LockIcon aria-hidden />
              Unlock
            </button>
          </form>
        )}
        {error ? (
          <p className="lock-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
