import { useEffect, useState } from 'preact/hooks';
import { EmployeePhoto } from '../../shared/ui/EmployeePhoto.jsx';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const SCRAMBLE_MS = 1000;

function randomScramble() {
  let s = '';
  for (let i = 0; i < 12; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

// Winner reveal card: scramble-reveal text effect ported from the old
// public/screen.js, then calls onRevealed once (for confetti + recent-winner
// chip + grand-finale check) exactly when the name settles.
export function WinnerReveal({ winner, onRevealed }) {
  const [scrambledText, setScrambledText] = useState(' ');
  const [revealed, setRevealed] = useState(false);
  const [show, setShow] = useState(false);

  const winnerKey = winner ? `${winner.seq}:${winner.empId}` : null;

  useEffect(() => {
    if (!winner) return undefined;
    setRevealed(false);
    setShow(false);

    const showRaf = requestAnimationFrame(() => setShow(true));

    let frameRaf;
    const start = performance.now();
    function frame(now) {
      const t = now - start;
      if (t < SCRAMBLE_MS) {
        setScrambledText(randomScramble());
        frameRaf = requestAnimationFrame(frame);
      } else {
        setRevealed(true);
        onRevealed?.(winner);
      }
    }
    frameRaf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(showRaf);
      cancelAnimationFrame(frameRaf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winnerKey]);

  if (!winner) return <div className="winner-card" />;

  const classes = ['winner-card', `tier-${winner.tier}`];
  if (!revealed) classes.push('shuffling');
  if (show) classes.push('show');

  return (
    <div className={classes.join(' ')}>
      <div className="winner-tier-badge">{winner.tier === 'premium' ? 'Grand Prize' : 'Prize Winner'}</div>
      {revealed && <EmployeePhoto empId={winner.empId} name={winner.name} size="lg" />}
      <div className="winner-name">{revealed ? `${winner.name} (${winner.empId})` : scrambledText}</div>
      <div className="winner-gift">{winner.gift}</div>
    </div>
  );
}
