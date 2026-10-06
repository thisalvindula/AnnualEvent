import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { Avatar, LiveBadge, MetalText } from '../../shared/stage/Stage.jsx';
import { usePrefersReducedMotion } from '../../shared/stage/hooks.js';

const ENTER_MS = 900;
const EXIT_MS = 1100;
const FILL_AT = 0.85; // fraction of the exit at which the board frame fills
const STEPS = 28;

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const lerp = (a, b, t) => a + (b - a) * t;

// Points on a quadratic bezier from p0 to p2 bulging through control point
// p1 — the curved path is what keeps the box from sliding in a straight line.
const bezier = (p0, p1, p2, t) => ({
  x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t ** 2 * p2.x,
  y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t ** 2 * p2.y,
});

// Sampled keyframes (the browser only interpolates linearly between them) for
// a genie-style move: the box travels along a curve while its width narrows
// faster than its height, with a slight tilt mid-flight.
function genie({ from, ctrl, to, scaleFrom, scaleTo, pathEase, scaleEase, tilt, fadeFrom }) {
  const frames = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const p = bezier(from, ctrl, to, pathEase(t));
    const s = scaleEase(t);
    const sx = lerp(scaleFrom.x, scaleTo.x, Math.min(1.2, scaleEase(Math.min(1, t * 1.15))));
    const sy = lerp(scaleFrom.y, scaleTo.y, s);
    const rot = tilt * Math.sin(Math.PI * t);
    const opacity = fadeFrom === undefined ? Math.min(1, t * 4) : t < fadeFrom ? 1 : 1 - (t - fadeFrom) / (1 - fadeFrom);
    frames.push({ transform: `translate(${p.x}px, ${p.y}px) rotate(${rot}deg) scale(${sx}, ${sy})`, opacity, offset: t });
  }
  return frames;
}

// Offset (in the card's own unscaled px) from the card's centre to a rect's
// centre. The stage is scaled with a CSS transform, so measured screen px are
// divided by that scale.
function offsetTo(card, rect) {
  const box = card.getBoundingClientRect();
  const scale = box.width / card.offsetWidth || 1;
  return {
    dx: (rect.left + rect.width / 2 - (box.left + box.width / 2)) / scale,
    dy: (rect.top + rect.height / 2 - (box.top + box.height / 2)) / scale,
    scale,
  };
}

// The winner's box: it "maximizes" out of the drawing column when the reel
// lands, and when `flying` it "minimizes" into the winner's frame on the gift
// board (macOS-style: the whole box scales and travels, fading as it arrives).
// onNear fires just before it lands so the frame can fill; onDone when it's gone.
export function WinnerCard({ winner, originRef, container, flying, onNear, onDone }) {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();
  const premium = winner.tier === 'premium';

  useLayoutEffect(() => {
    const el = ref.current;
    const origin = originRef?.current;
    if (!el || !origin || reduced || typeof el.animate !== 'function') return undefined;
    const { dx, dy } = offsetTo(el, origin.getBoundingClientRect());
    const anim = el.animate(
      genie({
        from: { x: dx, y: dy },
        ctrl: { x: dx * 0.35, y: dy - 140 },
        to: { x: 0, y: 0 },
        scaleFrom: { x: 0.1, y: 0.06 },
        scaleTo: { x: 1, y: 1 },
        pathEase: easeOutCubic,
        scaleEase: easeOutBack,
        tilt: -5,
      }),
      { duration: ENTER_MS, easing: 'linear' }
    );
    return () => anim.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!flying) return undefined;
    const el = ref.current;
    const target = container?.current?.querySelector(`[data-slot="${winner.giftId}:${winner.slot}"]`);
    if (!el || !target || reduced || typeof el.animate !== 'function') {
      onNear?.();
      onDone?.();
      return undefined;
    }
    const to = target.getBoundingClientRect();
    const { dx, dy, scale } = offsetTo(el, to);
    const end = Math.max(0.12, (to.width / scale / el.offsetWidth) * 1.2);
    const lift = { x: 0, y: -22 };
    const anim = el.animate(
      [
        // anticipation: a small lift and swell before the box swoops away
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(${lift.x}px, ${lift.y}px) scale(1.05)`, opacity: 1, offset: 0.14 },
        ...genie({
          from: lift,
          ctrl: { x: dx * 0.15, y: Math.min(dy, 0) - 200 },
          to: { x: dx, y: dy },
          scaleFrom: { x: 1.05, y: 1.05 },
          scaleTo: { x: end * 0.8, y: end },
          pathEase: easeInOutCubic,
          scaleEase: easeInOutCubic,
          tilt: 7,
          fadeFrom: 0.8,
        }).map((f) => ({ ...f, offset: 0.14 + f.offset * 0.86 })),
      ],
      { duration: EXIT_MS, easing: 'linear', fill: 'forwards' }
    );
    const nearTimer = setTimeout(() => onNear?.(), EXIT_MS * FILL_AT);
    anim.onfinish = () => onDone?.();
    return () => {
      clearTimeout(nearTimer);
      anim.onfinish = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flying]);

  return (
    <div ref={ref} className={`ev-glass rf-card ${premium ? 'rf-card--premium' : ''}`}>
      <Avatar name={winner.name} imageName={winner.imageName} size="xl" tier={premium ? 'premium' : 'normal'} />
      <LiveBadge state={premium ? 'final' : 'live'} label={winner.place} />
      <MetalText as="div" tone={premium ? 'gold' : 'silver'} sweep={premium} className="rf-card__name">{winner.name}</MetalText>
      <div className="rf-card__gift">{winner.description}</div>
    </div>
  );
}
