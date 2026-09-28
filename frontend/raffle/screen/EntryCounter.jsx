import { useEffect, useRef, useState } from 'preact/hooks';

const DURATION_MS = 450;

// Animated count-up, ported from the old screen.js's animateNumber().
export function EntryCounter({ count }) {
  const [displayed, setDisplayed] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    if (count == null) return undefined;
    const from = shownRef.current;
    const to = count;
    if (from === to) {
      setDisplayed(to);
      return undefined;
    }
    const start = performance.now();
    let rafId;
    function frame(now) {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(Math.round(from + (to - from) * eased));
      if (t < 1) {
        rafId = requestAnimationFrame(frame);
      } else {
        shownRef.current = to;
      }
    }
    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [count]);

  return <div id="entryCount" className="screen-metric">{displayed} entries</div>;
}
