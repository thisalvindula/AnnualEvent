import { useEffect, useRef, useState } from 'preact/hooks';
import { useEventSource } from '../../shared/useEventSource.js';
import { usePolling } from '../../shared/usePolling.js';
import { Countdown } from '../../shared/ui/Countdown.jsx';
import { ScreenQr } from '../../shared/ui/ScreenQr.jsx';
import { Confetti } from '../../shared/Confetti.jsx';
import { EmployeePhoto } from '../../shared/ui/EmployeePhoto.jsx';
import { LiveVoteBars } from './LiveVoteBars.jsx';

const RESULT_COLORS = ['#f5d888', '#e0b64c', '#ffffff', '#7fa6ff'];
const token = new URLSearchParams(location.search).get('token') ?? '';
const STREAM_URL = `/screen/vote/stream?token=${encodeURIComponent(token)}`;

function useAnimatedTotal(value) {
  const [displayed, setDisplayed] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    const to = value;
    if (from === to) return undefined;
    const start = performance.now();
    let rafId;
    function frame(now) {
      const t = Math.min(1, (now - start) / 500);
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
  }, [value]);

  return displayed;
}

export function App() {
  const events = useEventSource(STREAM_URL, ['started', 'tally', 'closed']);
  const status = usePolling('/vote/api/status', 1000);

  const [tally, setTally] = useState([]);
  const [totalVotes, setTotalVotes] = useState(0);
  const [confettiBurst, setConfettiBurst] = useState(null);
  const firedFinaleRef = useRef(false);

  // The vote window expires by time (closes_at), which /vote/api/status
  // reports as soon as the countdown reaches zero — independent of whether
  // an admin has clicked "Close now" yet. The winner reveal follows that
  // polled status rather than waiting for the admin's explicit close action.
  const final = status?.status === 'closed';

  useEffect(() => {
    const data = events.tally?.data;
    if (!data) return;
    setTally(data.tally);
    setTotalVotes(data.totalVotes);
  }, [events.tally]);

  useEffect(() => {
    const data = events.closed?.data;
    if (!data) return;
    setTally(data.tally);
    setTotalVotes(data.totalVotes);
  }, [events.closed]);

  useEffect(() => {
    if (!final || firedFinaleRef.current || tally.length === 0) return;
    const sorted = [...tally].sort((a, b) => b.votes - a.votes);
    if (sorted[0].votes > 0) {
      firedFinaleRef.current = true;
      setConfettiBurst({ id: Date.now(), configs: [{ colors: RESULT_COLORS }] });
    }
  }, [final, tally]);

  const animatedTotal = useAnimatedTotal(totalVotes);

  let phase = 'Checking status…';
  let liveBadge = { text: 'Waiting', live: false };
  if (status?.isOpen) {
    phase = 'Voting is open — cast your vote by scanning the QR code';
    liveBadge = { text: 'LIVE', live: true };
  } else if (status?.status === 'closed') {
    phase = 'Voting has closed — final result';
    liveBadge = { text: 'Final result', live: false };
  } else if (status) {
    phase = 'Voting has not opened yet';
    liveBadge = { text: 'Coming up', live: false };
  }

  const sorted = [...tally].sort((a, b) => b.votes - a.votes);
  const topVotes = sorted[0]?.votes ?? 0;
  const winners = topVotes > 0 ? sorted.filter((f) => f.votes === topVotes) : [];
  const isTie = winners.length > 1;
  const showResultHero = final && winners.length > 0;
  const showQr = Boolean(status?.isOpen);

  return (
    <div className="screen-body">
      <Confetti burst={confettiBurst} />
      <div className="screen-shell">
        <div className="screen-header">
          <div className="screen-eyebrow">Annual Event</div>
          <h1>Best Singer — Live Vote</h1>
          <div className={`screen-live-badge ${liveBadge.live ? '' : 'idle'}`}>
            <span className="live-dot" />
            <span>{liveBadge.text}</span>
          </div>
          <div className="screen-phase">{phase}</div>
        </div>

        <div className="screen-main">
          {showQr && <ScreenQr path="/vote" label="vote" />}
          <div className="screen-main-content">
            <div className="screen-clock-wrap">
              <Countdown
                isOpen={Boolean(status?.isOpen)}
                secondsRemaining={status?.secondsRemaining ?? 0}
                status={status?.status}
              />
            </div>

            {showResultHero && (
              <div id="resultHero" className={`result-hero show ${isTie ? 'tie' : ''}`}>
                <span className="crown-lg">&#128081;</span>
                <span className="result-label">{isTie ? 'Audience Favorites — It’s a Tie!' : 'Audience Favorite'}</span>
                <div className="result-winners">
                  {winners.map((w) => (
                    <div className="result-winner" key={w.id}>
                      <EmployeePhoto empId={w.empId} name={w.name} size="lg" />
                      <span className="result-name">{w.name}</span>
                    </div>
                  ))}
                </div>
                <span className="result-votes">{topVotes} of {totalVotes} votes</span>
              </div>
            )}

            {!showResultHero && <LiveVoteBars tally={tally} />}
            <div id="total" className="screen-total">{animatedTotal} votes cast</div>
          </div>
        </div>
      </div>
    </div>
  );
}
