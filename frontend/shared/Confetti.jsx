import { useEffect, useRef } from 'preact/hooks';

const DEFAULT_COLORS = ['#7fa6ff', '#c3cbda', '#ffffff', '#4f7fe0'];

// Canvas confetti burst, ported from app/core/public/confetti.js into a
// self-contained component (no window.fireConfetti global). `burst` is
// { id, configs: [{ colors, count, originX, spread }] }; a new `id` fires a
// new burst (or several simultaneous bursts, for the grand-finale double
// origin), without resetting particles already in flight. Shared by both
// screen entries (raffle winner reveal, voting final result).
export function Confetti({ burst }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    let rafId;
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const particles = particlesRef.current;
      if (particles.length) {
        const next = [];
        for (const p of particles) {
          p.vy += 0.22;
          p.vx *= 0.995;
          p.x += p.vx;
          p.y += p.vy;
          p.rotation += p.spin;
          p.life++;
          if (p.y < canvas.height + 30 && p.life < p.maxLife) next.push(p);
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - p.life / p.maxLife);
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
          ctx.restore();
        }
        particlesRef.current = next;
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (!burst) return;
    const canvas = canvasRef.current;
    let added = [];
    for (const cfg of burst.configs) {
      const colors = cfg.colors || DEFAULT_COLORS;
      const count = cfg.count || 150;
      const originX = canvas.width * (cfg.originX ?? 0.5);
      const spread = cfg.spread ?? 0.35;
      const particles = Array.from({ length: count }, () => ({
        x: originX + (Math.random() - 0.5) * canvas.width * spread,
        y: canvas.height * 0.32,
        vx: (Math.random() - 0.5) * 11,
        vy: Math.random() * -11 - 4,
        size: Math.random() * 6 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        spin: (Math.random() - 0.5) * 22,
        life: 0,
        maxLife: 200 + Math.random() * 60,
      }));
      added = added.concat(particles);
    }
    particlesRef.current = particlesRef.current.concat(added);
  }, [burst]);

  return <canvas ref={canvasRef} className="confetti-canvas" />;
}
