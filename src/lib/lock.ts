/**
 * App lock. Uses the device's own unlock (Touch ID, Windows Hello, Android screen lock) through a
 * WebAuthn platform credential when available, or a PIN stored as a salted PBKDF2 hash.
 *
 * Honest scope: this keeps casual eyes out of the app. It does not encrypt IndexedDB; anyone with
 * full access to this browser profile and developer tools could still read the data.
 */
import type { LockConfig } from './db';

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function biometricAvailable(): Promise<boolean> {
  try {
    return Boolean(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

export async function enrollBiometric(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Offline' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'offline-app-lock', displayName: 'Offline app lock' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No credential was created.');
  return b64(cred.rawId);
}

export async function verifyBiometric(credentialId: string): Promise<boolean> {
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: unb64(credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return Boolean(res);
  } catch {
    return false;
  }
}

async function pbkdf2(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 210_000 }, key, 256);
  return b64(bits);
}

export async function hashPin(pin: string): Promise<{ pinHash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { pinHash: await pbkdf2(pin, salt), salt: b64(salt) };
}

export async function verifyPin(pin: string, lock: LockConfig): Promise<boolean> {
  if (!lock.pinHash || !lock.salt) return false;
  const got = await pbkdf2(pin, unb64(lock.salt));
  // Constant-time-ish compare; the hash never leaves this device anyway.
  let diff = got.length ^ lock.pinHash.length;
  for (let i = 0; i < Math.min(got.length, lock.pinHash.length); i++) diff |= got.charCodeAt(i) ^ lock.pinHash.charCodeAt(i);
  return diff === 0;
}
