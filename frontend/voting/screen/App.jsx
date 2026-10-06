import { useEffect, useState } from 'preact/hooks';
import { useEventSource } from '../../shared/useEventSource.js';
import { usePolling } from '../../shared/usePolling.js';
import { AnimatedNumber, Avatar, Countdown, MetalText, ScreenQr, Stage, StageHeader } from '../../shared/stage/Stage.jsx';
import { LiveVoteBars } from './LiveVoteBars.jsx';

const token = new URLSearchParams(location.search).get('token') ?? '';
const STREAM_URL = `/screen/vote/stream?token=${encodeURIComponent(token)}`;

// Minimal plinth: a slim dark-glass cylinder on a thin base plate, with a
// fine gold rim. The avatar stands at the centre of the top lid.
function Podium() {
  return (
    <svg className="vt-podium" viewBox="0 0 620 150" aria-hidden="true">
      <defs>
        <linearGradient id="podSide" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#070d20" />
          <stop offset=".22" stop-color="#1b2a55" />
          <stop offset=".38" stop-color="#27386b" />
          <stop offset=".6" stop-color="#13204a" />
          <stop offset="1" stop-color="#070d20" />
        </linearGradient>
        <linearGradient id="podShade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#000" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity=".5" />
        </linearGradient>
        <radialGradient id="podLid" cx=".5" cy=".4" r=".7">
          <stop offset="0" stop-color="#34467d" />
          <stop offset=".6" stop-color="#1a2a58" />
          <stop offset="1" stop-color="#0e1737" />
        </radialGradient>
        <radialGradient id="podFloor" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#f5d888" stop-opacity=".28" />
          <stop offset="1" stop-color="#f5d888" stop-opacity="0" />
        </radialGradient>
        <filter id="podGlow" x="-10%" y="-80%" width="120%" height="260%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <ellipse cx="310" cy="128" rx="330" ry="34" fill="url(#podFloor)" />
      {/* base plate */}
      <path d="M20 84V98A290 34 0 0 0 600 98V84Z" fill="#0b132d" />
      <ellipse cx="310" cy="84" rx="290" ry="34" fill="#121d42" />
      <path d="M20 84A290 34 0 0 0 600 84" fill="none" stroke="#f5d888" stroke-width="1" stroke-opacity=".35" />
      {/* plinth */}
      <path d="M70 40V86A240 28 0 0 0 550 86V40Z" fill="url(#podSide)" />
      <path d="M70 40V86A240 28 0 0 0 550 86V40Z" fill="url(#podShade)" />
      <ellipse cx="310" cy="40" rx="240" ry="28" fill="url(#podLid)" />
      <ellipse cx="310" cy="40" rx="240" ry="28" fill="none" stroke="#f5d888" stroke-width="1.5" stroke-opacity=".9" />
      <path d="M70 40A240 28 0 0 0 550 40" fill="none" stroke="#f5d888" stroke-width="2" filter="url(#podGlow)" />
      <ellipse cx="310" cy="42" rx="120" ry="12" fill="#000" opacity=".35" />
    </svg>
  );
}

export function App() {
  const events = useEventSource(STREAM_URL, ['started', 'tally', 'closed', 'server_shutdown']);
  const status = usePolling('/vote/api/status', 1000);

  const [tally, setTally] = useState([]);
  const [totalVotes, setTotalVotes] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (events.server_shutdown) setReconnecting(true);
  }, [events.server_shutdown]);

  // Cleared once anything newer arrives on the stream after the shutdown
  // notice — proof the browser's automatic EventSource reconnect succeeded.
  useEffect(() => {
    if (!reconnecting) return;
    const shutdownAt = events.server_shutdown?.receivedAt ?? 0;
    const latestOther = Math.max(events.started?.receivedAt ?? 0, events.tally?.receivedAt ?? 0, events.closed?.receivedAt ?? 0);
    if (latestOther > shutdownAt) setReconnecting(false);
  }, [events, reconnecting]);

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

  let badge = 'waiting';
  let phase = 'Checking status…';
  if (status?.isOpen) {
    badge = 'live';
  } else if (final) {
    badge = 'final';
    phase = 'Voting has closed';
  } else if (status) {
    badge = 'coming-up';
    phase = 'Voting has not opened yet';
  }

  const sorted = [...tally].sort((a, b) => b.votes - a.votes);
  const topVotes = sorted[0]?.votes ?? 0;
  const winners = topVotes > 0 ? sorted.filter((f) => f.votes === topVotes) : [];
  const isTie = winners.length > 1;
  const showResultHero = final && winners.length > 0;
  const mood = showResultHero ? 'celebration' : status?.isOpen ? 'live' : 'calm';

  return (
    <Stage mood={mood} lights={showResultHero}>
      <StageHeader badge={reconnecting ? 'waiting' : badge} badgeLabel={reconnecting ? 'Reconnecting…' : undefined} />

      <main className="ev-main">
        {showResultHero ? (
          <div id="resultHero" className="vt-final ev-fade-in">
            <header className="vt-final__head">
              <div className="ev-eyebrow">Best Singer</div>
              <MetalText as="div" tone="gold" className="vt-final__label">
                {isTie ? 'Audience Favorites — It’s a Tie!' : 'Audience Favorite'}
              </MetalText>
            </header>
            <div className={`vt-final__winners ${isTie ? 'vt-final__winners--tie' : ''}`}>
              {winners.map((w) => (
                <div className="vt-final__winner" key={w.id}>
                  <MetalText as="div" tone="gold" sweep className="vt-final__name">{w.name}</MetalText>
                  {w.song ? <div className="vt-final__song">{w.song}</div> : null}
                  <div className="vt-final__stand">
                    <Avatar name={w.name} imageName={w.imageName} size={isTie ? 'lg' : 'xl'} tier="premium" />
                    <Podium />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="vt-live">
            <section className="vt-live__board">
              <div className="vt-live__head">
                <MetalText as="h1" className="ev-title">Best Singer — Live Vote</MetalText>
                <div id="total" className="vt-total">
                  <span className="ev-numeral vt-total__count"><AnimatedNumber value={totalVotes} /></span>
                  <span className="ev-caption">votes cast</span>
                </div>
              </div>
              <LiveVoteBars tally={tally} />
            </section>

            <aside className="vt-live__side">
              {status?.isOpen ? (
                <>
                  <div className="vt-live__clock">
                    <div className="ev-label">Voting closes in</div>
                    <Countdown seconds={status.secondsRemaining ?? 0} />
                  </div>
                  <ScreenQr module="vote" label="Scan to vote" />
                </>
              ) : final ? (
                <Countdown closed />
              ) : (
                <div className="vt-phase">{phase}</div>
              )}
            </aside>
          </div>
        )}
      </main>
    </Stage>
  );
}
