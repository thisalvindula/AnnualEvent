import { useEffect, useMemo, useState } from 'preact/hooks';
import { usePrefersReducedMotion } from '../../shared/stage/hooks.js';
import { NameReel } from './NameReel.jsx';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const TRIGGER_MS = 900;
const SCRAMBLE_MS = 4000;
const MIN_TICK_MS = 45;
const MAX_TICK_MS = 260;

const REDUCED_SCRAMBLE_MS = 900;
const REDUCED_TICK_MS = 70;

function randomCode() {
  let s = '';
  for (let i = 0; i < 12; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

// Decelerating step delays (slow -> slower), one per reel step.
function stepDelays(totalMs, minTick, maxTick) {
  const out = [];
  let t = 0;
  while (t < totalMs) {
    const d = minTick + (maxTick - minTick) * (t / totalMs) ** 3;
    out.push(d);
    t += d;
  }
  return out;
}

// The sequence the reel rolls through: random entrants (never the same name
// twice in a row, never the winner) from the real sealed list when it's
// loaded, random codes otherwise — ending on the winner with a couple of
// names after it so the slot below is never empty.
function buildSequence(count, winnerName, namePool) {
  const pool = (namePool ?? []).filter((n) => n && n !== winnerName);
  const pick = (prev) => {
    if (pool.length === 0) return randomCode();
    let n = pool[Math.floor(Math.random() * pool.length)];
    for (let i = 0; i < 4 && n === prev && pool.length > 1; i++) n = pool[Math.floor(Math.random() * pool.length)];
    return n;
  };
  const items = [];
  // items[0] is the (hidden) slot above the first name; the reel starts on items[1].
  for (let i = 0; i < count + 1; i++) items.push(pick(items[i - 1]));
  items.push(winnerName);
  items.push(pick(winnerName), pick());
  return items;
}

function CursorIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none" {...props}>
      <path d="M4 2v16l4-3.5L10.5 20l2.5-1-2.5-5.5H16z" />
    </svg>
  );
}

// Left-hand drawing column. Idle: a "waiting" message. On a draw: the
// decorative "DRAW" button-press beat, then the name reel decelerates and
// lands on the winner, at which point onRevealed fires once (confetti +
// grand-finale check). The winner card and the flight to the board are the
// parent's job.
export function WinnerReveal({ winner, onRevealed, namePool, complete = false, areaRef }) {
  const reduceMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState('idle'); // idle | press | spin
  const key = winner ? `${winner.giftId}:${winner.slot}:${winner.empId}` : null;

  useEffect(() => {
    if (!winner) {
      setPhase('idle');
      return undefined;
    }
    if (reduceMotion) {
      setPhase('spin');
      return undefined;
    }
    setPhase('press');
    const timer = setTimeout(() => setPhase('spin'), TRIGGER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const delays = useMemo(
    () => (reduceMotion ? stepDelays(REDUCED_SCRAMBLE_MS, REDUCED_TICK_MS, REDUCED_TICK_MS) : stepDelays(SCRAMBLE_MS, MIN_TICK_MS, MAX_TICK_MS)),
    [key, reduceMotion]
  );
  const items = useMemo(
    () => (winner ? buildSequence(delays.length, winner.name, namePool) : []),
    // the entrant pool is fixed for the draw; only a new winner rebuilds the reel
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, delays]
  );

  const pressing = phase === 'press';

  return (
    <div className="rf-panel-col">
      <div className="rf-stage-area" ref={areaRef}>
        {winner && phase === 'spin' ? (
          <NameReel key={key} items={items} delays={delays} instant={reduceMotion} tone={winner.tier} onLanded={() => onRevealed?.(winner)} />
        ) : (
          <div className="rf-idle">
            <div className="rf-idle__title">{complete ? 'All prizes awarded' : 'Waiting for the next draw'}</div>
            <div className="rf-idle__sub">{complete ? 'Congratulations to all our winners' : 'The next winner will appear here'}</div>
          </div>
        )}
      </div>
      <div className="rf-drawbtn">
        <div key={pressing ? key : 'idle'} className={`rf-trigger__button ${pressing ? 'rf-trigger__button--press' : ''}`}>Draw</div>
        {pressing && <CursorIcon className="rf-trigger__cursor" />}
      </div>
    </div>
  );
}
