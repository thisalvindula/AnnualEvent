import { useEffect, useState } from 'preact/hooks';

const START_DELAY_MS = 400;
const MAX_STEP_MS = 220;

// A vertical "cylinder" of names: three are visible — the one above and the
// one below small and shaded, the current one large and bright. Every step the
// whole column rolls up one slot (top leaves, middle moves up, bottom becomes
// the middle, the next name enters at the bottom). `items` is the full
// sequence, `delays` one entry per step; the last item is where it lands.
// Items are keyed by their absolute index, so the same DOM node animates
// between slots instead of being swapped.
export function NameReel({ items, delays, instant = false, tone = 'normal', onLanded }) {
  const [pos, setPos] = useState(1);
  const [stepMs, setStepMs] = useState(MAX_STEP_MS);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    let timer;
    let k = 0;
    function next() {
      if (k >= delays.length) {
        setLanded(true);
        onLanded?.();
        return;
      }
      const d = delays[k];
      setStepMs(Math.min(d, MAX_STEP_MS));
      setPos((p) => p + 1);
      k += 1;
      timer = setTimeout(next, d);
    }
    timer = setTimeout(next, instant ? 0 : START_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = [];
  for (let o = -2; o <= 2; o++) {
    const idx = pos + o;
    if (idx < 0 || idx >= items.length) continue;
    rows.push(
      <div
        key={idx}
        className={`rf-reel__item rf-reel__item--${Math.abs(o)} ${o === 0 && landed ? `rf-reel__item--landed rf-reel__item--${tone}` : ''}`}
        style={{ '--o': o }}
      >
        {items[idx]}
      </div>
    );
  }

  return (
    <div className="rf-reel" style={{ '--step': instant ? '0ms' : `${stepMs}ms` }} aria-live="off">
      {rows}
    </div>
  );
}
