import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, Cloud, Lock, Mic, MicOff, RotateCcw, ShieldCheck, Smartphone, Trash2, Eye, History, WifiOff } from 'lucide-react';
import { ArtClasses, ArtFlight, ArtMeeting, ArtSite, Mark } from './art';
import { boxOf, genie } from '../app/ui/genie';

const REPO = 'https://github.com/jayplume/offline';
const HACKATHON = 'https://firebasehybridaihackathon.devpost.com/';

export default function Landing() {
  useEffect(() => {
    document.title = 'Offline: say it now, send it when you choose';
  }, []);
  return (
    <div className="site">
      <Nav />
      <main>
        <Hero />
        <Steps />
        <Moments />
        <WhatWorks />
        <Hybrid />
        <Privacy />
        <Library />
        <Faq />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-row">
        <a className="brand" href="/" aria-label="Offline home">
          <Mark />
          <span>Offline</span>
        </a>
        <nav className="nav-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#offline">What works offline</a>
          <a href="#hybrid">Hybrid AI</a>
          <a href="#privacy">Privacy</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="nav-cta">
          <a className="nav-git" href={REPO}>
            GitHub
          </a>
          <a className="s-btn s-btn-primary" href="/app">
            Open Offline
          </a>
        </div>
      </div>
    </header>
  );
}

/* ───────────── Hero: the one orchestrated moment, a live loop of the real flow ───────────── */

function Hero() {
  return (
    <section className="hero">
      <div className="wrap hero-copy">
        <h1>Say it now. Send it when you choose.</h1>
        <p className="lead">
          Offline records the prompts you'd rather not say to an assistant out loud, even with no signal. It keeps them on your device, helps you shape
          them, and runs them with AI only when you press Send.
        </p>
        <div className="hero-ctas">
          <a className="s-btn s-btn-primary s-btn-lg" href="/app">
            <Mic aria-hidden />
            Open Offline
          </a>
          <a className="s-btn s-btn-line s-btn-lg" href="#how">
            How it works
          </a>
        </div>
        <p className="hero-fine">Free and open source. Runs in your browser and installs like an app.</p>
      </div>
      <div className="hero-stage">
        <ul className="notes notes-left" aria-hidden>
          <li>
            <b>One tap</b>
            Recording starts at once and is saved on the device as you speak.
          </li>
          <li>
            <b>No signal needed</b>
            Captions and drafts work in airplane mode.
          </li>
        </ul>
        <PhoneDemo />
        <ul className="notes notes-right" aria-hidden>
          <li>
            <b>Shaped on the device</b>
            Gemini Nano in Chrome tidies the prompt when your device supports it.
          </li>
          <li>
            <b>Sent when you say so</b>
            You see the exact text and where it runs before it leaves.
          </li>
        </ul>
      </div>
    </section>
  );
}

const SPOKEN = "okay so tell the team we're pushing the launch a week because QA found two checkout bugs, keep it calm".split(' ');
const SHAPED = 'Write a short, calm note to my team: the launch moves one week because QA found two checkout bugs. Fixes are underway.';
const ANSWER = "Hi team, we're moving the launch by one week. QA found two bugs in checkout and we want them fixed properly before release. Fixes are underway and on track.";
const LOOP_MS = 17000;

function PhoneDemo() {
  const [t, setT] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    if (reduce) {
      setT(15500);
      return;
    }
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.2 });
    if (ref.current) io.observe(ref.current);
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (visible && document.visibilityState === 'visible') setT((v) => (v + (now - last)) % LOOP_MS);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [reduce]);

  const phase = t < 1500 ? 'home' : t < 2400 ? 'reveal' : t < 8600 ? 'recording' : t < 9800 ? 'saved' : t < 12600 ? 'draft' : 'answer';

  // The same genie as the app: the recording screen pours out of the tapped microphone.
  const micRef = useRef<HTMLSpanElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const revealing = phase === 'reveal';
  useLayoutEffect(() => {
    if (!revealing || !micRef.current || !surfaceRef.current) return;
    const g = genie(surfaceRef.current, { from: boxOf(micRef.current.getBoundingClientRect()), mode: 'open', duration: 950, zIndex: 4, attach: 'document', ready: true });
    return () => g.cancel();
  }, [revealing]);
  const recMs = Math.max(0, Math.min(t, 8600) - 2400);
  const words = Math.min(SPOKEN.length, Math.floor(recMs / 300));
  const answerChars = phase === 'answer' ? Math.min(ANSWER.length, Math.floor((t - 12600) / 22)) : 0;
  const level = phase === 'recording' ? 0.35 + 0.3 * Math.abs(Math.sin(t / 170)) * Math.abs(Math.sin(t / 530)) : 0;

  return (
    <div ref={ref} className="phone" aria-label="Animated example of Offline: record with no signal, review, then run on the device" role="img">
      <div className="phone-notch" aria-hidden />
      <div className="phone-screen" aria-hidden>
        <div className={`p-home${phase === 'home' || phase === 'reveal' ? ' is-on' : ''}`}>
          <div className="p-bar">
            <span className="p-dots">•••</span>
            <span className="p-word">
              <Mark size={13} /> Offline
            </span>
            <span className="p-chip">
              <WifiOff /> No connection
            </span>
          </div>
          <p className="p-hello">Good evening</p>
          <p className="p-q">What's on your mind?</p>
          <span ref={micRef} className={`p-mic${phase === 'reveal' ? ' is-pressed' : ''}`}>
            <Mic />
          </span>
          <p className="p-tap">Tap to record</p>
        </div>

        <div ref={surfaceRef} className={`p-surface${phase === 'home' ? '' : ' is-open'}${phase === 'draft' || phase === 'answer' ? ' is-paper' : ''}`}>
          {phase === 'recording' || phase === 'saved' || phase === 'reveal' ? (
            <div className="p-rec">
              <div className="p-bar">
                <span className="p-dots">•••</span>
                <span className="p-title">{phase === 'saved' ? 'Saved' : 'Recording'}</span>
                <span className="p-x">×</span>
              </div>
              <p className="p-timer">0:{String(Math.min(59, Math.floor(recMs / 1000))).padStart(2, '0')}</p>
              <p className="p-state">
                <i />
                {phase === 'saved' ? 'Saved on this device' : 'Recording, saved on this device'}
              </p>
              <div className="p-orb" style={{ ['--lvl' as string]: String(level) }}>
                <span className="r3" />
                <span className="r2" />
                <span className="r1" />
                <span className="core">{phase === 'saved' ? <Check /> : <Mic />}</span>
              </div>
              <p className="p-caption">{SPOKEN.slice(0, words).join(' ')}</p>
            </div>
          ) : null}
          {phase === 'draft' || phase === 'answer' ? (
            <div className="p-draft">
              <div className="p-bar">
                <span className="p-dots">•••</span>
                <span className="p-title">{phase === 'answer' ? 'Chat' : 'Draft'}</span>
                <span className="p-x">×</span>
              </div>
              {phase === 'draft' ? (
                <>
                  <span className="p-version">Clearer</span>
                  <p className="p-text">{SHAPED}</p>
                  <div className="p-dest">
                    <Smartphone />
                    <span>
                      <b>On this device</b>
                      <small>Gemini Nano in Chrome, no connection needed</small>
                    </span>
                  </div>
                  <span className="p-send">Send</span>
                </>
              ) : (
                <>
                  <p className="p-bubble">{SHAPED}</p>
                  <p className="p-answer">{ANSWER.slice(0, answerChars)}</p>
                  {answerChars >= ANSWER.length ? (
                    <span className="p-badge">
                      <Smartphone /> On this device
                    </span>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <p className="phone-caption">Illustrative loop of the real flow. On-device AI needs a supported device.</p>
    </div>
  );
}

/* ───────────── Steps: a real sequence, so numbered ───────────── */

function Steps() {
  return (
    <section className="band" id="how" aria-labelledby="how-h">
      <div className="wrap">
        <h2 id="how-h" className="h2">From a passing thought to a finished answer</h2>
        <ol className="steps3">
          <li>
            <span className="n">1</span>
            <h3>Capture it</h3>
            <p>Tap once and speak. Recording starts at once and is saved on your device while you talk. No signal needed.</p>
          </li>
          <li>
            <span className="n">2</span>
            <h3>Shape it</h3>
            <p>Fix a word, make it clearer, answer two quick questions, pick a tone. When Chrome's on-device model is ready, this runs right on your device.</p>
          </li>
          <li>
            <span className="n">3</span>
            <h3>Send it when you choose</h3>
            <p>See the exact text and where it will run before anything leaves. Getting your signal back sends nothing by itself.</p>
          </li>
        </ol>
      </div>
    </section>
  );
}

/* ───────────── Moments: pick a situation, step through what happens ───────────── */

interface Moment {
  id: string;
  label: string;
  art: () => React.ReactElement;
  context: string[];
  said: string;
  sent: string;
  where: 'device' | 'cloud';
  whereNote: string;
  answer: string[];
}

const MOMENTS: Moment[] = [
  {
    id: 'meeting',
    label: 'Leaving a meeting',
    art: ArtMeeting,
    context: ['Corridor', 'Weak signal', 'People nearby'],
    said: "okay so I need to tell the team we're pushing the launch a week because QA found two checkout bugs, um, keep it calm, not alarming",
    sent: 'Write a short, calm note to my team: the launch moves one week because QA found two checkout bugs. Reassure them the fixes are underway.',
    where: 'device',
    whereNote: 'Gemini Nano in Chrome, on the laptop, right after the meeting',
    answer: ["Hi team, we're moving the launch by one week.", 'QA found two bugs in checkout, and we want them fixed properly before release. Fixes are underway and on track.', 'Thanks for the extra care.'],
  },
  {
    id: 'flight',
    label: 'On a flight',
    art: ArtFlight,
    context: ['Airplane mode', 'Quiet cabin'],
    said: "draft an agenda for monday's planning session, we need hiring, the Q1 roadmap and the budget, maybe forty five minutes",
    sent: "Draft a 45-minute agenda for Monday's planning session covering hiring, the Q1 roadmap and the budget.",
    where: 'device',
    whereNote: 'Gemini Nano in Chrome, with no connection at all',
    answer: ['1. Welcome and goals (5 min)', '2. Hiring: open roles and timeline (12 min)', '3. Q1 roadmap: priorities and owners (15 min)', '4. Budget check (10 min)', '5. Decisions and next steps (3 min)'],
  },
  {
    id: 'classes',
    label: 'Between classes',
    art: ArtClasses,
    context: ['Library', 'Talking is awkward'],
    said: "explain the difference between mitosis and meiosis like I've got a quiz in ten minutes",
    sent: 'Explain the difference between mitosis and meiosis in simple terms, as a quick review before a quiz in ten minutes.',
    where: 'cloud',
    whereNote: 'Gemini in the cloud through Firebase AI Logic, sent once she chose to',
    answer: ['Mitosis makes two identical cells for growth and repair. One division, same number of chromosomes.', 'Meiosis makes four different sex cells. Two divisions, half the chromosomes, and shuffled genes.', 'Memory trick: mitosis = "my toes" grow; meiosis = "me" and you make a new person.'],
  },
  {
    id: 'site',
    label: 'Site visit',
    art: ArtSite,
    context: ['Basement', 'No signal'],
    said: 'the pump on the east wall is leaking at the joint, pressure reads two point one bar, needs a new gasket, write this up for the maintenance log',
    sent: 'Write a maintenance log entry: east wall pump leaking at the joint, pressure 2.1 bar, replacement gasket needed.',
    where: 'cloud',
    whereNote: 'Gemini in the cloud, after he was back upstairs and pressed Send',
    answer: ['Asset: East wall pump', 'Issue: Leak at the pipe joint', 'Reading: 2.1 bar', 'Action: Replace gasket; check joint after repair', 'Priority: Medium'],
  },
];

function Moments() {
  const [id, setId] = useState(MOMENTS[0].id);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const m = MOMENTS.find((x) => x.id === id)!;
  const Art = m.art;
  return (
    <section className="band band-tint" aria-labelledby="moments-h">
      <div className="wrap">
        <div className="split-head">
          <h2 id="moments-h" className="h2">
            Some thoughts arrive at the wrong moment
          </h2>
          <p className="sub">
            In a corridor between sessions, on a plane, in a library where talking to an assistant feels awkward. Offline catches the thought now and lets you
            finish it later.
          </p>
        </div>
        <div className="pills" role="tablist" aria-label="Situations">
          {MOMENTS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === id}
              className={`pill${x.id === id ? ' is-on' : ''}`}
              onClick={() => {
                setId(x.id);
                setStep(0);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <article className="moment" key={m.id}>
          <div className="moment-art">
            <Art />
            <div className="moment-context">
              {m.context.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </div>
          <div className="moment-body">
            <div className="seg" role="tablist" aria-label="Steps">
              {['What was said', 'What was sent', 'The answer'].map((label, i) => (
                <button key={label} type="button" role="tab" aria-selected={step === i} className={step === i ? 'is-on' : ''} onClick={() => setStep(i as 0 | 1 | 2)}>
                  <span className="seg-n">{i + 1}</span>
                  {label}
                </button>
              ))}
            </div>
            <div className="moment-panel" key={step}>
              {step === 0 ? (
                <>
                  <p className="said">“{m.said}”</p>
                  <p className="panel-note">
                    <Lock aria-hidden /> Saved on the device as it was spoken. Nothing sent.
                  </p>
                </>
              ) : step === 1 ? (
                <>
                  <p className="sent">{m.sent}</p>
                  <p className={`panel-dest is-${m.where}`}>
                    {m.where === 'device' ? <Smartphone aria-hidden /> : <Cloud aria-hidden />}
                    <span>
                      <b>{m.where === 'device' ? 'On this device' : 'Cloud'}</b> {m.whereNote}
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <div className="answer-block">
                    {m.answer.map((l) => (
                      <p key={l}>{l}</p>
                    ))}
                  </div>
                  <p className="panel-note">
                    {m.where === 'device' ? <Smartphone aria-hidden /> : <Cloud aria-hidden />}
                    Labelled {m.where === 'device' ? 'On this device' : 'Cloud'} in the app and in History. Example answer; real ones vary.
                  </p>
                </>
              )}
            </div>
            <div className="moment-foot">
              {step < 2 ? (
                <button type="button" className="s-btn s-btn-line" onClick={() => setStep((s) => (s + 1) as 0 | 1 | 2)}>
                  Next step
                </button>
              ) : (
                <button type="button" className="s-btn s-btn-line" onClick={() => setStep(0)}>
                  <RotateCcw aria-hidden />
                  Replay
                </button>
              )}
              <a className="s-link" href="/app">
                Try it yourself
              </a>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

/* ───────────── What works offline: honest, per capability ───────────── */

function WhatWorks() {
  const rows: { what: string; offline: boolean; needs: string }[] = [
    { what: 'Record, play back, save drafts and notes', offline: true, needs: 'Nothing. Any modern browser.' },
    { what: 'Live captions while you speak', offline: true, needs: "Chrome's on-device speech pack (one small download)." },
    { what: 'Make it clearer, missing details, summaries, chat', offline: true, needs: 'Gemini Nano in desktop Chrome, on a device that meets its requirements.' },
    { what: 'Turn a saved recording into text', offline: false, needs: 'A connection. Audio goes to Gemini in the cloud; the on-device model reads text and images only.' },
    { what: 'Answers from Gemini in the cloud', offline: false, needs: 'A connection, and your Send.' },
  ];
  return (
    <section className="band" id="offline" aria-labelledby="works-h">
      <div className="wrap">
        <div className="split-head">
          <h2 id="works-h" className="h2">
            Clear about what works offline
          </h2>
          <p className="sub">On-device AI depends on your device. Offline checks what yours can do and tells you before you rely on it.</p>
        </div>
        <div className="works" role="table" aria-label="What works without a connection">
          <div className="works-row works-head" role="row">
            <span role="columnheader">Capability</span>
            <span role="columnheader">With no connection</span>
            <span role="columnheader">What it needs</span>
          </div>
          {rows.map((r) => (
            <div className="works-row" role="row" key={r.what}>
              <span role="cell" className="works-what">
                {r.what}
              </span>
              <span role="cell" className={`works-mark ${r.offline ? 'is-yes' : 'is-no'}`}>
                {r.offline ? <Check aria-hidden /> : <WifiOff aria-hidden />}
                {r.offline ? 'Works' : 'Waits for you'}
              </span>
              <span role="cell" className="works-needs">
                {r.needs}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────── Hybrid AI: for the technically curious ───────────── */

function Hybrid() {
  return (
    <section className="band band-tint" id="hybrid" aria-labelledby="hybrid-h">
      <div className="wrap">
        <div className="split-head">
          <h2 id="hybrid-h" className="h2">
            One call, two places to run
          </h2>
          <p className="sub">
            Every AI step goes through Firebase AI Logic's hybrid inference. A small routing policy picks the mode before anything is sent, and the answer
            reports where it actually ran.
          </p>
        </div>
        <div className="hybrid">
          <div className="flow" aria-label="Each AI step: your words go through a routing policy, then run on the device or in the cloud">
            <div className="flow-node flow-words">
              <span className="flow-dot" aria-hidden />
              <b>Your words</b>
              <small>saved on the device</small>
            </div>
            <span className="flow-arrow" aria-hidden />
            <div className="flow-node flow-policy">
              <b>Routing policy</b>
              <ul>
                <li>Keep on this device only?</li>
                <li>Connected?</li>
                <li>Audio or text?</li>
                <li>How long?</li>
              </ul>
            </div>
            <span className="flow-arrow" aria-hidden />
            <div className="flow-ends">
              <div className="flow-node flow-device">
                <Smartphone aria-hidden />
                <span>
                  <b>On this device</b>
                  <small>Gemini Nano in Chrome. Private, works offline.</small>
                </span>
              </div>
              <div className="flow-node flow-cloud">
                <Cloud aria-hidden />
                <span>
                  <b>In the cloud</b>
                  <small>Gemini through Firebase AI Logic, with App Check.</small>
                </span>
              </div>
            </div>
          </div>
          <div className="hybrid-rules">
            <ul>
              <li>
                <b>Keep on this device only</b> asks for <code>ONLY_ON_DEVICE</code>. If the device can't, AI waits rather than reaching the cloud.
              </li>
              <li>
                <b>No connection</b> runs on the device when its model is ready; otherwise the draft waits, saved.
              </li>
              <li>
                <b>Audio</b> goes to the cloud: on-device input is text and images.
              </li>
              <li>
                <b>Long text</b> prefers the cloud; when it must stay local, summaries are made in parts on the device.
              </li>
              <li>
                <b>Everything else</b> uses <code>PREFER_ON_DEVICE</code>, and if the device fails mid-answer, the cloud steps in and the label says so.
              </li>
            </ul>
          </div>
        </div>
        <pre className="code" aria-label="Code example">
          <code>
            <span className="c">{'// src/lib/ai/engine.ts (simplified)'}</span>
            {'\n'}const model = getGenerativeModel(ai, {'{'}
            {'\n'}  mode: route.mode, <span className="c">{'// chosen per task by route.ts'}</span>
            {'\n'}  inCloudParams: {'{'} model: remote.cloudModel {'}'}, <span className="c">{'// Remote Config'}</span>
            {'\n'}  onDeviceParams: {'{'} createOptions: {'{'} expectedInputs: [{'{'} type: 'text' {'}'}] {'}'} {'}'},
            {'\n'}
            {'}'});
            {'\n'}const {'{'} response {'}'} = await model.generateContent(prompt);
            {'\n'}response.inferenceSource; <span className="c">{"// 'on_device' | 'in_cloud', shown on every answer"}</span>
          </code>
        </pre>
        <div className="stack">
          <span>Firebase AI Logic hybrid inference</span>
          <span>App Check with reCAPTCHA Enterprise</span>
          <span>Remote Config for models and templates</span>
          <span>Firebase Hosting</span>
          <span>Chrome Prompt API and on-device speech</span>
        </div>
      </div>
    </section>
  );
}

/* ───────────── Privacy ───────────── */

function Privacy() {
  const items = [
    { icon: <ShieldCheck />, title: 'Nothing leaves until you press Send', body: 'Reconnecting never sends a draft. Transcription and answers each need your tap.' },
    { icon: <Eye />, title: 'See the exact text and where it goes', body: 'The send preview shows every word and whether it runs on this device or in the cloud.' },
    { icon: <Lock />, title: 'Keep any item on this device only', body: 'Mark a recording, note or chat so it never uses the cloud, whatever the setting.' },
    { icon: <Trash2 />, title: 'Delete exactly what you want', body: 'Just the audio, just the text, or everything. Or let recordings delete themselves.' },
    { icon: <MicOff />, title: 'Quiet by default', body: 'Recording is always visible. Playback asks first when no headphones seem connected.' },
    { icon: <History />, title: 'A record of every request', body: 'History lists each AI step, the mode it asked for, where it ran and how long it took.' },
  ];
  return (
    <section className="band" id="privacy" aria-labelledby="privacy-h">
      <div className="wrap">
        <div className="split-head">
          <h2 id="privacy-h" className="h2">
            Your words stay yours until you send them
          </h2>
          <p className="sub">Private by default, without asking you to trust a promise you can't check.</p>
        </div>
        <ul className="promises">
          {items.map((i) => (
            <li key={i.title}>
              <span className="promise-icon" aria-hidden>
                {i.icon}
              </span>
              <h3>{i.title}</h3>
              <p>{i.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ───────────── Everything in the app ───────────── */

const LIBRARY: { id: string; label: string; items: [string, string][] }[] = [
  {
    id: 'capture',
    label: 'Capture',
    items: [
      ['One-tap recording', 'The microphone is the first thing on the home screen.'],
      ['Shortcuts', 'Record and New note from the installed app icon, or press R.'],
      ['Always-visible recording state', 'A timer, a pulse and plain words while the mic is on.'],
      ['Pause and resume', 'Interrupted? Pause; the time skips the gap.'],
      ['Stop after silence', 'Off by default, with a three-second warning.'],
      ['Your microphone', 'Pick a headset or external mic for noisy places.'],
      ['Low-storage warning', 'Told before you record, not after it fails.'],
    ],
  },
  {
    id: 'offline',
    label: 'Without a connection',
    items: [
      ['Live captions on the device', "Chrome's on-device speech recognition, never the server one."],
      ['Audio-only drafts', 'No captions here? The recording is still saved.'],
      ['What works right now', 'A live checklist: connection, models, storage.'],
      ['On-device model status', 'See if Gemini Nano is ready, and download it in one tap.'],
      ['Clean-up on the device', 'Make it clearer with no connection when the model is ready.'],
      ['No surprise sending', 'Back online? Drafts wait, and the app says so.'],
      ['Retry anything', 'Every failed step says why and offers Try again.'],
    ],
  },
  {
    id: 'shape',
    label: 'Shaping',
    items: [
      ['Edit the words', 'Fix names and terms; the original is kept.'],
      ['Tap a sentence to hear it', 'Timed sentences jump the audio to that moment.'],
      ['What I meant', 'A note in your own words, sent with the prompt.'],
      ['Templates', 'Email, meeting summary, plan and more, served by Remote Config.'],
      ['Make it clearer', 'Same meaning, cleaner words.'],
      ["Ask me what's missing", 'Up to three questions that sharpen the answer.'],
      ['Tone and length', 'Friendly, formal or direct; short or detailed.'],
      ['Versions and compare', 'Every rewrite is a version, with a word-level compare.'],
      ['Send preview', 'The exact text and destination, before it goes.'],
    ],
  },
  {
    id: 'control',
    label: 'Privacy and control',
    items: [
      ['Where it ran', 'On this device or Cloud, on every AI result.'],
      ['Delete by part', 'Audio, text, or everything including the chat.'],
      ['Automatic audio deletion', 'After transcribing, or after 1, 7 or 30 days.'],
      ['App lock', "Your device's own unlock, or a PIN."],
      ['Asks before playing aloud', 'Unless headphones seem connected.'],
      ['Device only, per item', 'Any draft, chat or note can refuse the cloud.'],
      ['History', 'Every AI request, where it ran and how long it took.'],
    ],
  },
];

function Library() {
  const [tab, setTab] = useState(LIBRARY[0].id);
  const group = LIBRARY.find((g) => g.id === tab)!;
  return (
    <section className="band band-tint" aria-labelledby="lib-h">
      <div className="wrap">
        <div className="split-head">
          <h2 id="lib-h" className="h2">
            Everything in the app
          </h2>
          <p className="sub">Thirty details that came from one question: what would make a private voice note genuinely useful later?</p>
        </div>
        <div className="pills" role="tablist" aria-label="Feature groups">
          {LIBRARY.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={g.id === tab} className={`pill${g.id === tab ? ' is-on' : ''}`} onClick={() => setTab(g.id)}>
              {g.label}
              <span className="pill-n">{g.items.length}</span>
            </button>
          ))}
        </div>
        <dl className="lib" key={tab}>
          {group.items.map(([t, d]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ───────────── FAQ ───────────── */

const FAQ: [string, string][] = [
  [
    'Does the AI really work offline?',
    'Partly, and Offline is clear about which part. Recording, notes and drafts always work offline. AI steps (shaping prompts, summaries, chat) run offline only where Chrome’s built-in model, Gemini Nano, is downloaded. Turning a saved recording into text needs a connection, because the on-device model reads text and images, not audio.',
  ],
  [
    'Is my voice uploaded?',
    'Not unless you ask. Recordings stay in your browser’s storage on this device. If you tap Transcribe, that one recording goes to Gemini through Firebase AI Logic. Live captions use Chrome’s on-device speech recognition only; Offline never falls back to the server-based recognizer.',
  ],
  [
    'Which browsers and devices does it need?',
    'Any modern browser can record, save and use the cloud. On-device AI needs desktop Chrome on a computer that meets Chrome’s requirements: for example 16 GB of RAM or a GPU with more than 4 GB, plus about 22 GB of free disk for the one-time download. The status sheet in the app shows what your device can do.',
  ],
  ['What happens when I get my signal back?', 'Nothing, until you choose. Offline shows that your drafts are waiting and that nothing was sent. You review them, then press Send.'],
  ['How do I know where an answer came from?', 'Every AI result is labelled On this device or Cloud. History lists each request with the mode it asked for, where it actually ran, the model and how long it took.'],
  ['Is it free?', 'Yes. Offline is open source under the Apache 2.0 licence. Cloud answers use the free tier of the Gemini Developer API through Firebase.'],
  ['Can I install it?', 'Yes. Chrome offers Install in the address bar. The installed app opens with no connection and has shortcuts for Record and New note.'],
];

function Faq() {
  return (
    <section className="band" id="faq" aria-labelledby="faq-h">
      <div className="wrap faq-wrap">
        <h2 id="faq-h" className="h2">
          Questions
        </h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="closing" aria-labelledby="closing-h">
      <div className="wrap closing-in">
        <h2 id="closing-h">The next good idea won't wait for a signal.</h2>
        <a className="s-btn s-btn-primary s-btn-lg" href="/app">
          <Mic aria-hidden />
          Open Offline
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-row">
        <span className="brand">
          <Mark size={22} />
          <span>Offline</span>
        </span>
        <nav aria-label="Footer">
          <a href="/app">Open the app</a>
          <a href={REPO}>
            Source on GitHub <ArrowUpRight aria-hidden />
          </a>
          <a href={HACKATHON}>
            #BuildHybridAI 2026 <ArrowUpRight aria-hidden />
          </a>
        </nav>
        <p className="foot-fine">Built with Firebase AI Logic. Open source under Apache 2.0.</p>
      </div>
    </footer>
  );
}
