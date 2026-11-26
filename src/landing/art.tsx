/**
 * Original illustrations for the Offline site. Flat, geometric, in the product palette only:
 * sky, soft blue, ash, white, ink. Drawn for this project; no stock or third-party assets.
 */

const SKY = '#9dd4f4';
const SKY_L = '#c8e8fb';
const SKY_XL = '#e3f3fd';
const BLUE = '#3c8dd0';
const ASH = '#dde2e7';
const ASH_D = '#98a2ad';
const INK = '#1b232b';

/** Leaving a meeting: a door left ajar, light from the room, a phone held low. */
export function ArtMeeting() {
  return (
    <svg viewBox="0 0 200 150" role="img" aria-label="A door left ajar after a meeting">
      <rect x="0" y="0" width="200" height="150" rx="18" fill={SKY_XL} />
      <rect x="0" y="118" width="200" height="32" fill="#f5f7f9" />
      <rect x="54" y="22" width="64" height="98" rx="3" fill="#fff" stroke={ASH} strokeWidth="3" />
      <path d="M57 25 L57 117 L96 108 L96 34 Z" fill={SKY} />
      <path d="M96 34 L96 108 L112 104 L112 38 Z" fill={SKY_L} />
      <circle cx="91" cy="72" r="2.6" fill={INK} />
      <rect x="128" y="30" width="22" height="9" rx="2" fill={ASH} />
      <g transform="translate(138 74)">
        <rect x="0" y="0" width="22" height="38" rx="5" fill={INK} />
        <rect x="3" y="4" width="16" height="28" rx="2.5" fill="#fff" />
        <circle cx="11" cy="17" r="5" fill={SKY} />
        <circle cx="11" cy="17" r="2" fill={INK} />
      </g>
      <path d="M150 60 q8 -6 16 0" stroke={BLUE} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M146 52 q12 -10 24 0" stroke={SKY} strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** On a flight: a cabin window, clouds below, airplane mode on. */
export function ArtFlight() {
  return (
    <svg viewBox="0 0 200 150" role="img" aria-label="A plane window above the clouds">
      <rect x="0" y="0" width="200" height="150" rx="18" fill="#f5f7f9" />
      <rect x="58" y="16" width="84" height="118" rx="40" fill="#fff" stroke={ASH} strokeWidth="4" />
      <rect x="68" y="26" width="64" height="98" rx="31" fill={SKY_L} />
      <clipPath id="win">
        <rect x="68" y="26" width="64" height="98" rx="31" />
      </clipPath>
      <g clipPath="url(#win)">
        <rect x="60" y="20" width="80" height="44" fill={SKY_XL} />
        <circle cx="80" cy="96" r="18" fill="#fff" />
        <circle cx="104" cy="102" r="22" fill="#fff" />
        <circle cx="126" cy="94" r="16" fill="#fff" />
        <rect x="60" y="104" width="80" height="30" fill="#fff" />
      </g>
      <g transform="translate(152 22)">
        <rect x="0" y="0" width="30" height="30" rx="15" fill={INK} />
        <path d="M15 7 L15 23 M8 17 L15 13 L22 17 M11 22 L15 20 L19 22" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Between classes: a stack of books, a pencil, a quiet desk lamp glow. */
export function ArtClasses() {
  return (
    <svg viewBox="0 0 200 150" role="img" aria-label="Books on a desk between classes">
      <rect x="0" y="0" width="200" height="150" rx="18" fill={SKY_XL} />
      <circle cx="150" cy="40" r="26" fill="#fff" opacity="0.8" />
      <rect x="0" y="112" width="200" height="38" fill="#f5f7f9" />
      <rect x="44" y="92" width="92" height="20" rx="3" fill={BLUE} />
      <rect x="50" y="72" width="80" height="20" rx="3" fill={SKY} />
      <rect x="40" y="52" width="88" height="20" rx="3" fill="#fff" stroke={ASH} strokeWidth="2.5" />
      <rect x="48" y="98" width="40" height="3" rx="1.5" fill="#fff" opacity="0.7" />
      <rect x="58" y="78" width="30" height="3" rx="1.5" fill="#fff" />
      <rect x="48" y="59" width="44" height="3" rx="1.5" fill={ASH_D} />
      <g transform="rotate(-24 150 98)">
        <rect x="120" y="94" width="58" height="8" rx="2" fill={INK} />
        <path d="M178 94 L188 98 L178 102 Z" fill={SKY} />
      </g>
    </svg>
  );
}

/** Site visit: a pipe run on a wall, a gauge, and a signal icon with a slash. */
export function ArtSite() {
  return (
    <svg viewBox="0 0 200 150" role="img" aria-label="A pump room with no phone signal">
      <rect x="0" y="0" width="200" height="150" rx="18" fill="#f5f7f9" />
      <rect x="0" y="116" width="200" height="34" fill={ASH} opacity="0.55" />
      <rect x="20" y="56" width="120" height="14" rx="7" fill={SKY} />
      <rect x="126" y="56" width="14" height="60" rx="7" fill={SKY} />
      <rect x="66" y="48" width="12" height="30" rx="3" fill={BLUE} />
      <circle cx="44" cy="96" r="18" fill="#fff" stroke={ASH} strokeWidth="3" />
      <path d="M44 96 L54 88" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="44" cy="96" r="2.5" fill={INK} />
      <path d="M86 78 q2 6 0 10 q-2 -4 0 -10" fill={BLUE} />
      <g transform="translate(150 22)">
        <rect x="0" y="16" width="5" height="10" rx="1.5" fill={ASH_D} />
        <rect x="8" y="10" width="5" height="16" rx="1.5" fill={ASH_D} />
        <rect x="16" y="4" width="5" height="22" rx="1.5" fill={ASH_D} />
        <rect x="24" y="-2" width="5" height="28" rx="1.5" fill={ASH_D} />
        <path d="M-3 28 L32 -4" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/**
 * The hybrid diagram: your words → routing policy → Gemini Nano on the device, or Gemini in the
 * cloud through Firebase AI Logic (App Check, Remote Config).
 */
export function ArtHybrid() {
  return (
    <svg viewBox="0 0 760 330" role="img" aria-label="Diagram: a routing policy sends each AI step to Gemini Nano on the device or to Gemini in the cloud through Firebase AI Logic">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={ASH_D} />
        </marker>
      </defs>
      {/* words */}
      <rect x="10" y="125" width="150" height="80" rx="18" fill="#fff" stroke={ASH} strokeWidth="2" />
      <circle cx="44" cy="165" r="16" fill={SKY} />
      <circle cx="44" cy="165" r="6" fill={INK} />
      <text x="70" y="160" fontSize="15" fontWeight="650" fill={INK}>Your words</text>
      <text x="70" y="180" fontSize="12.5" fill="#66717d">saved on device</text>
      {/* policy */}
      <path d="M160 165 L236 165" stroke={ASH_D} strokeWidth="2" markerEnd="url(#arr)" />
      <rect x="240" y="95" width="200" height="140" rx="20" fill={SKY_XL} stroke={SKY_L} strokeWidth="2" />
      <text x="262" y="126" fontSize="15" fontWeight="650" fill={INK}>Routing policy</text>
      {['Keep on device only?', 'Connected?', 'Audio or text?', 'Length?'].map((t, i) => (
        <g key={t} transform={`translate(262 ${146 + i * 21})`}>
          <circle cx="4" cy="-4" r="3" fill={BLUE} />
          <text x="14" y="0" fontSize="12.5" fill="#4d5864">{t}</text>
        </g>
      ))}
      {/* device */}
      <path d="M440 140 C 480 140, 480 70, 520 70" stroke={ASH_D} strokeWidth="2" fill="none" markerEnd="url(#arr)" />
      <rect x="524" y="22" width="226" height="96" rx="18" fill="#fff" stroke={ASH} strokeWidth="2" />
      <rect x="544" y="44" width="32" height="52" rx="7" fill={INK} />
      <rect x="548" y="50" width="24" height="40" rx="4" fill="#fff" />
      <circle cx="560" cy="70" r="7" fill={SKY} />
      <text x="592" y="58" fontSize="15" fontWeight="650" fill={INK}>On this device</text>
      <text x="592" y="78" fontSize="12.5" fill="#66717d">Gemini Nano in Chrome</text>
      <text x="592" y="96" fontSize="12.5" fill="#66717d">private, works offline</text>
      {/* cloud */}
      <path d="M440 190 C 480 190, 480 260, 520 260" stroke={ASH_D} strokeWidth="2" fill="none" markerEnd="url(#arr)" />
      <rect x="524" y="212" width="226" height="96" rx="18" fill={SKY_XL} stroke={SKY_L} strokeWidth="2" />
      <path d="M552 270 h30 a12 12 0 0 0 0 -24 a16 16 0 0 0 -30 -4 a10 10 0 0 0 0 28 z" fill="#fff" stroke={SKY} strokeWidth="2" />
      <text x="596" y="248" fontSize="15" fontWeight="650" fill={INK}>In the cloud</text>
      <text x="596" y="268" fontSize="12.5" fill="#66717d">Gemini via Firebase AI Logic</text>
      <text x="596" y="286" fontSize="12.5" fill="#66717d">App Check, Remote Config</text>
    </svg>
  );
}

/** Small brand mark, same as the app's. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="15" fill={SKY} />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" strokeWidth="2.2" opacity="0.9" />
      <circle cx="16" cy="16" r="4" fill={INK} />
    </svg>
  );
}
