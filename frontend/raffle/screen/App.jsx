import { useEffect, useState } from 'preact/hooks';
import { useEventSource } from '../../shared/useEventSource.js';
import { usePolling } from '../../shared/usePolling.js';
import { Countdown } from '../../shared/ui/Countdown.jsx';
import { ScreenQr } from '../../shared/ui/ScreenQr.jsx';
import { Confetti } from '../../shared/Confetti.jsx';
import { WinnerReveal } from './WinnerReveal.jsx';
import { EntryCounter } from './EntryCounter.jsx';
import { GiftProgressDots } from './GiftProgressDots.jsx';

const TOTAL_GIFTS = 25;
const token = new URLSearchParams(location.search).get('token') ?? '';
const STREAM_URL = `/screen/raffle/stream?token=${encodeURIComponent(token)}`;

export function App() {
  const events = useEventSource(STREAM_URL, ['entry_count', 'registrations_sealed', 'winner', 'closed']);
  const status = usePolling('/raffle/api/status', 1000);

  const [entryCount, setEntryCount] = useState(0);
  const [seal, setSeal] = useState(null);
  const [filledSeqs, setFilledSeqs] = useState(() => new Set());
  const [drawnCount, setDrawnCount] = useState(0);
  const [currentWinner, setCurrentWinner] = useState(null);
  const [recentWinners, setRecentWinners] = useState([]);
  const [grandFinale, setGrandFinale] = useState(false);
  const [confettiBurst, setConfettiBurst] = useState(null);

  useEffect(() => {
    if (status && typeof status.entryCount === 'number') setEntryCount(status.entryCount);
  }, [status]);

  useEffect(() => {
    if (events.entry_count) setEntryCount(events.entry_count.data.entryCount);
  }, [events.entry_count]);

  useEffect(() => {
    if (events.registrations_sealed) setSeal(events.registrations_sealed.data);
  }, [events.registrations_sealed]);

  useEffect(() => {
    const data = events.winner?.data;
    if (!data) return;
    setDrawnCount(TOTAL_GIFTS - data.remaining);
    setFilledSeqs((prev) => new Set(prev).add(data.seq));
    setCurrentWinner(data);
  }, [events.winner]);

  function handleWinnerRevealed(winner) {
    const colors =
      winner.tier === 'premium'
        ? ['#f5d888', '#e0b64c', '#ffffff', '#7fa6ff']
        : ['#7fa6ff', '#c3cbda', '#ffffff', '#4f7fe0'];

    setRecentWinners((prev) => [{ seq: winner.seq, tier: winner.tier, name: winner.name, gift: winner.gift }, ...prev]);

    if (winner.remaining === 0) {
      setGrandFinale(true);
      setConfettiBurst({
        id: Date.now(),
        configs: [
          { colors, originX: 0.2 },
          { colors, originX: 0.8 },
        ],
      });
    } else {
      setConfettiBurst({ id: Date.now(), configs: [{ colors }] });
    }
  }

  const sealed = Boolean(seal);
  let phase = 'Checking status…';
  let liveBadge = { text: 'Waiting', live: false };

  if (status?.isOpen) {
    phase = 'Registration is open — scan the QR code to enter';
    liveBadge = { text: 'LIVE', live: true };
  } else if (status?.status === 'closed') {
    if (drawnCount >= TOTAL_GIFTS && drawnCount > 0) {
      liveBadge = { text: 'Complete', live: false };
    } else if (sealed) {
      phase = 'Drawing the grand prizes on stage';
      liveBadge = { text: 'DRAWING', live: true };
    } else {
      phase = 'Registration closed — sealing the list';
      liveBadge = { text: 'Sealing', live: false };
    }
  } else if (status) {
    phase = 'Registration has not opened yet';
    liveBadge = { text: 'Coming up', live: false };
  }

  const showQr = Boolean(status?.isOpen);

  return (
    <div className={`screen-body ${grandFinale ? 'grand-finale' : ''}`}>
      <Confetti burst={confettiBurst} />
      <div className="screen-shell">
        <div className="screen-header">
          <div className="screen-eyebrow">Annual Event</div>
          <h1>Grand Prize Giveaway</h1>
          <div className={`screen-live-badge ${liveBadge.live ? '' : 'idle'}`}>
            <span className="live-dot" />
            <span>{liveBadge.text}</span>
          </div>
          <div className="screen-phase">
            {grandFinale ? <span className="grand-finale-banner">All 25 prizes have been awarded!</span> : phase}
          </div>
        </div>

        <div className="screen-main">
          {showQr && <ScreenQr path="/raffle" label="register" />}
          <div className="screen-main-content">
            <div className="screen-clock-wrap">
              <Countdown
                isOpen={Boolean(status?.isOpen)}
                secondsRemaining={status?.secondsRemaining ?? 0}
                status={status?.status}
              />
              <EntryCounter count={entryCount} />
            </div>

            {seal && (
              <div id="seal" className="seal-badge">
                <span className="lock">&#128274;</span>Sealed &mdash; {seal.count} entries &mdash; SHA-256 {seal.sha256}
              </div>
            )}

            <GiftProgressDots visible={sealed || drawnCount > 0} filledSeqs={filledSeqs} drawnCount={drawnCount} />

            <div className="winner-stage">
              <WinnerReveal winner={currentWinner} onRevealed={handleWinnerRevealed} />
            </div>

            <div id="recentWinners" className="recent-winners">
              {recentWinners.map((w) => (
                <div key={w.seq} className={`recent-winner-chip tier-${w.tier}`}>
                  <span>{w.name}</span>
                  <span className="chip-gift">{w.gift}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
