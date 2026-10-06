import './fonts.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { moduleQrUrl, renderQrDataUrl } from '../qr.js';
import { useAnimatedNumber, useLogoState, usePrefersReducedMotion, useStageScale } from './hooks.js';
import { Logo } from './Logo.jsx';

/* ==========================================================================
   StageBackground — navy gradient, soft breathing glow, particle drift (canvas,
   capped) and vignette. `mood` shifts calm -> live -> celebration.
   ========================================================================== */
const PARTICLE_PALETTE = {
  calm: ['#7fa6ff', '#c3cbda', '#4f7fe0'],
  live: ['#7fa6ff', '#eef1f6', '#4f7fe0'],
  celebration: ['#f5d888', '#7fa6ff', '#eef1f6'],
};


/* ==========================================================================
   StageLights — concert spotlights for the results reveal. Beams hang from the
   top edge and sweep over a lit floor pool; glitter drifts through the light.
   Pure canvas (additive blend), one rAF loop, DPR capped at 2.
   ========================================================================== */
const BEAM_COLORS = [
  [168, 110, 255], // violet
  [255, 96, 200],  // pink
  [245, 216, 136], // gold
  [96, 150, 255],  // blue
];

function makeBeams() {
  // [originX (0..1), rest angle (rad from straight down, + = toward right), colour index]
  const rows = [
    [0.06, 0.52, 0], [0.16, 0.34, 1], [0.27, 0.18, 2], [0.38, 0.07, 3],
    [0.62, -0.07, 3], [0.73, -0.18, 2], [0.84, -0.34, 1], [0.94, -0.52, 0],
  ];
  return rows.map(([x, a, c], i) => ({
    x, a, c,
    sweep: 0.12 + (i % 3) * 0.035,
    speed: 0.22 + (i % 4) * 0.06,
    phase: i * 1.3,
    width: 0.055 + (i % 2) * 0.02,
  }));
}

export function StageLights({ active = true }) {
  const canvasRef = useRef(null);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const beams = makeBeams();
    const glitter = Array.from({ length: reduceMotion ? 0 : 150 }, () => ({
      x: Math.random(), y: Math.random(),
      r: Math.random() * 1.6 + 0.6,
      vy: Math.random() * 0.00022 + 0.00005,
      tw: Math.random() * Math.PI * 2,
      ts: Math.random() * 0.05 + 0.02,
      c: Math.floor(Math.random() * BEAM_COLORS.length),
    }));
    let raf = null;
    let w = 0;
    let h = 0;
    const t0 = performance.now();

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    function draw(now) {
      const t = (now - t0) / 1000;
      // Power-on: beams fade up and start with a wide, fast sweep that settles.
      const power = reduceMotion ? 1 : Math.min(1, t / 2.2);
      const settle = reduceMotion ? 1 : 1 + 2.2 * Math.exp(-t / 2.5);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // Floor pool
      const fy = h * 1.02;
      const pool = ctx.createRadialGradient(w / 2, fy, 0, w / 2, fy, w * 0.5);
      pool.addColorStop(0, `rgba(255,200,130,${0.42 * power})`);
      pool.addColorStop(0.35, `rgba(190,110,255,${0.2 * power})`);
      pool.addColorStop(1, 'rgba(120,80,255,0)');
      ctx.save();
      ctx.translate(0, fy);
      ctx.scale(1, 0.38);
      ctx.translate(0, -fy);
      ctx.fillStyle = pool;
      ctx.fillRect(0, fy - w, w, w * 2);
      ctx.restore();

      for (const b of beams) {
        const col = BEAM_COLORS[b.c];
        const ang = b.a + Math.sin(t * b.speed * settle + b.phase) * b.sweep * settle;
        const ox = b.x * w;
        const len = h * 1.35;
        const dx = Math.sin(ang);
        const dy = Math.cos(ang);
        const tx = ox + dx * len;
        const ty = dy * len;
        const nx = dy; // unit normal
        const ny = -dx;
        const pulse = 0.85 + 0.15 * Math.sin(t * 1.3 + b.phase * 2);

        // three layers: wide haze, body, hot core
        for (const [spread, alpha] of [[1.9, 0.07], [1, 0.12], [0.35, 0.16]]) {
          const half = len * b.width * spread;
          const g = ctx.createLinearGradient(ox, 0, tx, ty);
          g.addColorStop(0, rgba(col, alpha * 2.2 * power * pulse));
          g.addColorStop(0.55, rgba(col, alpha * power * pulse));
          g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(ox - nx * 3, -ny * 3);
          ctx.lineTo(ox + nx * 3, ny * 3);
          ctx.lineTo(tx + nx * half, ty + ny * half);
          ctx.lineTo(tx - nx * half, ty - ny * half);
          ctx.closePath();
          ctx.fill();
        }

        // lamp head
        const lamp = ctx.createRadialGradient(ox, 0, 0, ox, 0, h * 0.09);
        lamp.addColorStop(0, rgba([255, 255, 255], 0.75 * power));
        lamp.addColorStop(0.25, rgba(col, 0.4 * power));
        lamp.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = lamp;
        ctx.fillRect(ox - h * 0.1, 0, h * 0.2, h * 0.1);
      }

      // Glitter drifting up through the light
      for (const p of glitter) {
        p.y -= p.vy * 16;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        p.tw += p.ts;
        const a = (0.35 + 0.65 * Math.max(0, Math.sin(p.tw))) * power;
        const c = BEAM_COLORS[p.c];
        const x = p.x * w;
        const y = p.y * h;
        ctx.fillStyle = rgba(c, a * 0.22);
        ctx.beginPath();
        ctx.arc(x, y, p.r * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba([255, 244, 220], a);
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    }

    resize();
    const ro = new ResizeObserver(() => { resize(); if (reduceMotion) draw(performance.now()); });
    ro.observe(canvas.parentElement);
    raf = requestAnimationFrame(draw);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active, reduceMotion]);

  return <canvas ref={canvasRef} className="ev-stage__lights" />;
}

export function StageBackground({ mood = 'calm', lights = false, children, className = '' }) {
  const canvasRef = useRef(null);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const palette = PARTICLE_PALETTE[mood] || PARTICLE_PALETTE.calm;
    const count = reduceMotion ? 0 : 90;
    let raf = null;
    let w = 0;
    let h = 0;
    let particles = [];

    function seed() {
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.4 + 1,
        s: Math.random() * 0.15 + 0.04,
        drift: (Math.random() - 0.5) * 0.08,
        o: Math.random() * 0.35 + 0.5,
        tw: Math.random() * Math.PI * 2,
        c: palette[Math.floor(Math.random() * palette.length)],
      }));
    }
    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.y -= p.s;
        p.x += p.drift;
        if (p.y < -4) {
          p.y = h + 4;
          p.x = Math.random() * w;
        }
        if (p.x < -4) p.x = w + 4;
        if (p.x > w + 4) p.x = -4;
        p.tw += 0.015;
        const o = p.o * (0.75 + 0.25 * Math.sin(p.tw));
        ctx.fillStyle = p.c;
        // soft halo, then bright core
        ctx.globalAlpha = o * 0.15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = o;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    }

    resize();
    seed();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement);
    draw();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mood, reduceMotion]);

  return (
    <div className={`ev-stage ev-stage--${mood} ${lights ? 'ev-stage--lights' : ''} ${className}`}>
      <div className="ev-stage__glow" />
      {lights ? <StageLights /> : null}
      <div className="ev-stage__grid" />
      <div className="ev-stage__vignette" />
      <canvas ref={canvasRef} className="ev-stage__particles" />
      <div className="ev-stage__content">{children}</div>
    </div>
  );
}

// The full-bleed background plus the fixed 1920x1080 design canvas, scaled to
// fit any projector. `overlay` (confetti) sits above the canvas, unscaled.
export function Stage({ mood, lights, overlay, children }) {
  const scale = useStageScale();
  return (
    <StageBackground mood={mood} lights={lights}>
      <div className="ev-frame" style={{ '--stage-scale': scale }}>
        {children}
      </div>
      {overlay}
    </StageBackground>
  );
}

/* ==========================================================================
   LiveBadge
   ========================================================================== */
const BADGE_LABEL = {
  waiting: 'Waiting',
  'coming-up': 'Coming up',
  live: 'LIVE',
  drawing: 'Drawing',
  sealing: 'Sealing',
  final: 'Final result',
  complete: 'Complete',
};

export function LiveBadge({ state = 'waiting', label }) {
  return (
    <span className={`ev-badge ev-badge--${state}`}>
      <span className="ev-badge__dot" />
      {label || BADGE_LABEL[state] || state}
    </span>
  );
}

// Top bar shared by both screens: logo left, status badge right.
// The brand lockup's deep blue is close to invisible on the navy stage at
// projector distance, so the header uses the design system's single-ink
// silver `mono` variant. Switch to variant="lockup" for full brand colour.
export function StageLogo({ size = 520 }) {
  const logoState = useLogoState();
  return <Logo variant="mono" state={logoState} size={size} />;
}

export function StageHeader({ badge, badgeLabel, hideLogo = false, children }) {
  return (
    <header className={`ev-header ${hideLogo ? 'ev-header--end' : ''}`}>
      {!hideLogo && <StageLogo />}
      {children}
      {badge && <LiveBadge state={badge} label={badgeLabel} />}
    </header>
  );
}

/* ==========================================================================
   Countdown — normal, warning (<=60s, gold), critical (<=10s, pulsing red)
   ========================================================================== */
function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Countdown({ seconds, closed = false }) {
  if (closed) return <div className="ev-countdown ev-countdown--closed">Closed</div>;
  const tier = seconds <= 10 ? 'critical' : seconds <= 60 ? 'warning' : 'normal';
  const text = formatClock(seconds);
  return (
    <div className={`ev-countdown ev-countdown--${tier}`}>
      <span className="ev-countdown__seg" key={text}>{text}</span>
    </div>
  );
}

/* ==========================================================================
   QrSlot — the one deliberate white area on the stage. ScreenQr generates
   the code client-side so the screens never depend on an external service.
   ========================================================================== */
function QrPlaceholderIcon() {
  return (
    <svg className="ev-qr__placeholder" viewBox="0 0 100 100" fill="currentColor">
      <rect x="8" y="8" width="26" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="66" y="8" width="26" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="8" y="66" width="26" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="17" y="17" width="8" height="8" />
      <rect x="75" y="17" width="8" height="8" />
      <rect x="17" y="75" width="8" height="8" />
      <rect x="46" y="8" width="8" height="8" />
      <rect x="46" y="24" width="8" height="8" />
      <rect x="62" y="46" width="8" height="8" />
      <rect x="78" y="46" width="8" height="8" />
      <rect x="46" y="62" width="8" height="8" />
      <rect x="46" y="78" width="8" height="8" />
      <rect x="46" y="46" width="8" height="8" />
    </svg>
  );
}

export function QrSlot({ dataUrl, label = 'Scan to enter', url }) {
  return (
    <div className="ev-qr">
      <div className="ev-qr__card">
        <div className="ev-qr__frame" />
        {dataUrl ? <img className="ev-qr__img" src={dataUrl} alt="QR code" /> : <QrPlaceholderIcon />}
      </div>
      <div className="ev-qr__label">{label}</div>
      {url ? <div className="ev-qr__url">{url}</div> : null}
    </div>
  );
}

// Branded QR for an employee-facing module (raffle | vote). The URL comes from
// the fixed PUBLIC_BASE_URL, so it is identical to the downloadable/printed QR.
export function ScreenQr({ module, label }) {
  const [qr, setQr] = useState({ dataUrl: null, url: '' });

  useEffect(() => {
    let cancelled = false;
    moduleQrUrl(module)
      .then(async ({ url }) => ({ url, dataUrl: await renderQrDataUrl(url, 440) }))
      .then((result) => {
        if (!cancelled) setQr(result);
      });
    return () => {
      cancelled = true;
    };
  }, [module]);

  return <QrSlot dataUrl={qr.dataUrl} label={label} url={qr.url.replace(/^https?:\/\//, '')} />;
}

/* ==========================================================================
   Avatar — photo (from /employee-photos/) or initials on a navy gradient.
   Silver ring by default, gold for a premium (single-winner) moment.
   ========================================================================== */
export function initials(name) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, imageName, size = 'md', tier = 'normal' }) {
  const [failed, setFailed] = useState(false);
  // A different file name (e.g. after an edit) deserves a fresh attempt.
  useEffect(() => setFailed(false), [imageName]);

  return (
    <span className={`ev-avatar ev-avatar--${size} ${tier === 'premium' ? 'ev-avatar--premium' : ''}`}>
      {imageName && !failed ? (
        <img src={`/employee-photos/${encodeURIComponent(imageName)}`} alt={name || ''} onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
      <span className="ev-avatar__ring" />
    </span>
  );
}

/* ==========================================================================
   AnimatedNumber / GlassPanel / MetalText
   ========================================================================== */
export function AnimatedNumber({ value, duration = 700, format }) {
  const display = useAnimatedNumber(value, duration);
  return <span className="ev-num">{format ? format(display) : display.toLocaleString()}</span>;
}

export function GlassPanel({ children, className = '', style }) {
  return <div className={`ev-glass ${className}`} style={style}>{children}</div>;
}

export function MetalText({ children, tone = 'silver', sweep = false, as: Tag = 'span', className = '', style }) {
  return (
    <Tag
      className={`ev-metal ${tone === 'gold' ? 'ev-metal--gold' : ''} ${sweep ? 'ev-metal--sweep' : ''} ${className}`}
      data-text={typeof children === 'string' ? children : undefined}
      style={style}
    >
      {children}
    </Tag>
  );
}

/* ==========================================================================
   Confetti — a burst per new `burstKey`, fired from `originX` (0..1) near the
   top. Sized to its parent (the full-bleed stage). Use two instances (0.15 /
   0.85) for a twin burst.
   ========================================================================== */
export function Confetti({ colors = ['#7fa6ff', '#eef1f6', '#4f7fe0'], originX = 0.5, burstKey, count = 70 }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const rafRef = useRef(null);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (burstKey === undefined || burstKey === null || reduceMotion) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    // Particle sizes/velocities are authored for 1080p; scale to the screen.
    const k = h / 1080;
    const n = Math.min(count, 150);
    const fresh = Array.from({ length: n }, () => ({
      x: w * originX,
      y: h * 0.12,
      vx: (Math.random() - 0.5) * 9 * k,
      vy: -(Math.random() * 7 + 5) * k,
      g: (0.28 + Math.random() * 0.08) * k,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: (6 + Math.random() * 7) * k * 1.6,
      h: (4 + Math.random() * 6) * k * 1.6,
      c: colors[Math.floor(Math.random() * colors.length)],
      life: 0,
      maxLife: 90 + Math.random() * 40,
    }));
    particlesRef.current = particlesRef.current.concat(fresh).slice(-150);

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    function step() {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of particlesRef.current) {
        p.life += 1;
        if (p.life > p.maxLife) continue;
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.g;
        p.rot += p.vr;
        const fade = 1 - Math.max(0, (p.life - p.maxLife * 0.7) / (p.maxLife * 0.3));
        ctx.globalAlpha = Math.max(0, Math.min(1, fade));
        ctx.fillStyle = p.c;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      particlesRef.current = particlesRef.current.filter((p) => p.life <= p.maxLife);
      if (alive) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey]);

  return <canvas ref={canvasRef} className="ev-confetti-canvas" aria-hidden="true" />;
}

// Twin burst from both sides — the grand-finale / final-result gesture.
export function TwinConfetti({ burstKey, colors }) {
  return (
    <>
      <Confetti burstKey={burstKey == null ? null : `l${burstKey}`} originX={0.15} colors={colors} />
      <Confetti burstKey={burstKey == null ? null : `r${burstKey}`} originX={0.85} colors={colors} />
    </>
  );
}

export function IconLock(props) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <rect x="4" y="10.5" width="16" height="10" rx="2" />
      <path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3" />
    </svg>
  );
}
