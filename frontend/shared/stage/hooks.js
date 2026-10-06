import { useEffect, useRef, useState } from 'preact/hooks';

export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e) => setReduced(e.matches);
    setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

// Scale that fits the fixed 1920x1080 design canvas inside the viewport.
export function useStageScale() {
  const [scale, setScale] = useState(() => Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT));
  useEffect(() => {
    const update = () => setScale(Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return scale;
}

// Logo intro plays once on mount, then settles into its idle loop.
export function useLogoState(introMs = 2800) {
  const [state, setState] = useState('intro');
  useEffect(() => {
    const t = setTimeout(() => setState('idle'), introMs);
    return () => clearTimeout(t);
  }, [introMs]);
  return state;
}

// Eased count between values (ease-out-expo). Tracks the on-screen value so
// a change mid-animation continues from where the number currently is.
export function useAnimatedNumber(value, duration = 700) {
  const [display, setDisplay] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    const to = value;
    if (from === to) return undefined;
    const start = performance.now();
    let rafId;
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      shownRef.current = Math.round(from + (to - from) * eased);
      setDisplay(shownRef.current);
      if (t < 1) rafId = requestAnimationFrame(step);
    }
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value, duration]);

  return display;
}
