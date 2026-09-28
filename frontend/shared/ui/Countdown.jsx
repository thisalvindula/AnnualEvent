// Shared big-screen countdown clock — identical logic between the raffle and
// voting screens, so it's hoisted here rather than duplicated. Presentational
// only; no raffle/voting-specific data shape beyond plain numbers/strings.
export function Countdown({ isOpen, secondsRemaining, status }) {
  let text = '--:--';
  let cls = '';
  if (isOpen) {
    const m = Math.floor(secondsRemaining / 60);
    const s = String(secondsRemaining % 60).padStart(2, '0');
    text = `${m}:${s}`;
    if (secondsRemaining <= 10) cls = 'critical';
    else if (secondsRemaining <= 60) cls = 'warn';
  } else if (status === 'closed') {
    text = 'Closed';
  }
  return <div id="countdown" className={`screen-clock ${cls}`}>{text}</div>;
}
