import { useEffect, useRef, useState } from 'preact/hooks';
import { useEventSource } from '../../shared/useEventSource.js';
import { usePolling } from '../../shared/usePolling.js';
import {
  AnimatedNumber,
  Countdown,
  GlassPanel,
  IconLock,
  LiveBadge,
  MetalText,
  ScreenQr,
  Stage,
  StageHeader,
  StageLogo,
  TwinConfetti,
  Confetti,
} from '../../shared/stage/Stage.jsx';
import { RankFrame } from '../../shared/stage/RankFrame.jsx';
import { WinnerReveal } from './WinnerReveal.jsx';
import { WinnerCard } from './WinnerCard.jsx';

const token = new URLSearchParams(location.search).get('token') ?? '';
const STREAM_URL = `/screen/raffle/stream?token=${encodeURIComponent(token)}`;
const PROGRESS_URL = `/screen/raffle/progress?token=${encodeURIComponent(token)}`;
const ENTRANTS_URL = `/screen/raffle/entrants?token=${encodeURIComponent(token)}`;

// Single-winner prizes (1st place, 2nd place...) get the gold treatment;
// multi-winner prizes (e.g. 10 consolation prizes) the blue one.
const tierFor = (quantity) => (quantity === 1 ? 'premium' : 'normal');

const winnerKey = (w) => `${w.giftId}:${w.slot}`;

// Splits items into rows of the given sizes, then rows of `rest` for whatever is left.
function chunk(items, sizes, rest = 5) {
  const rows = [];
  let at = 0;
  for (const n of sizes) {
    if (at >= items.length) break;
    rows.push(items.slice(at, at + n));
    at += n;
  }
  while (at < items.length) {
    rows.push(items.slice(at, at + rest));
    at += rest;
  }
  return rows;
}

function Frame({ rank, winner, size, slotKey }) {
  return <RankFrame rank={rank} name={winner?.name} imageName={winner?.imageName ?? null} filled={!!winner} size={size} slotKey={slotKey} />;
}

// The board shows frames only (names live in the drawing panel): rank 1 on
// top with ranks 2-3 flanking it a little lower, the remaining ranks in rows
// below, then the consolation winners in a single row. Rank = podium draw
// order.
function DrawLayout({ gifts, winners }) {
  const byGift = new Map();
  for (const w of winners) byGift.set(winnerKey(w), w);

  const podium = gifts.filter((g) => g.section === 'podium');
  const consolation = gifts.filter((g) => g.section !== 'podium');
  const ranked = (g, i, size) => <Frame key={g.id} rank={i + 1} winner={byGift.get(`${g.id}:1`)} size={size} slotKey={`${g.id}:1`} />;
  const rest = podium.slice(3);
  const slots = consolation.flatMap((g) =>
    Array.from({ length: g.quantity }, (_, i) => (
      <Frame key={`${g.id}:${i + 1}`} rank="consolation" winner={byGift.get(`${g.id}:${i + 1}`)} size="xs" slotKey={`${g.id}:${i + 1}`} />
    ))
  );
  // Ranks 4+ widen downward (3, 4, 5 per row, then 5 each); consolation is 5 per row.
  const rows = [...chunk(rest.map((g, i) => ranked(g, i + 3, 'sm')), [3, 4, 5]), ...chunk(slots, [], 5)];

  return (
    <div className="rf-board">
      {podium.length > 0 && (
        <div className="rf-top">
          {podium[1] && <div className="rf-top__side">{ranked(podium[1], 1, 'lg')}</div>}
          <div className="rf-top__hero">{ranked(podium[0], 0, 'xl')}</div>
          {podium[2] && <div className="rf-top__side">{ranked(podium[2], 2, 'lg')}</div>}
        </div>
      )}
      {rows.map((row, i) => (
        <div key={i} className="rf-row">{row}</div>
      ))}
    </div>
  );
}

export function App() {
  const events = useEventSource(STREAM_URL, ['entry_count', 'registrations_sealed', 'winner', 'closed', 'reset', 'server_shutdown', 'snapshot']);
  const status = usePolling('/raffle/api/status', 1000);
  const progress = usePolling(PROGRESS_URL, 3000);

  const [entryCount, setEntryCount] = useState(0);
  const [seal, setSeal] = useState(null);
  const [totalPrizes, setTotalPrizes] = useState(0);
  const [drawnCount, setDrawnCount] = useState(0);
  const [currentWinner, setCurrentWinner] = useState(null);
  const [entrantNames, setEntrantNames] = useState([]);
  const [gifts, setGifts] = useState([]);
  const [winners, setWinners] = useState([]);
  const [showReveal, setShowReveal] = useState(false);
  const [grandFinale, setGrandFinale] = useState(false);
  const [confettiBurst, setConfettiBurst] = useState(null);
  const [revealedKey, setRevealedKey] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [flying, setFlying] = useState(false);
  const [filled, setFilled] = useState(false);
  const areaRef = useRef(null);
  const drawRef = useRef(null);

  useEffect(() => {
    if (events.server_shutdown) setReconnecting(true);
  }, [events.server_shutdown]);

  // Cleared once anything newer arrives on the stream after the shutdown
  // notice — proof the browser's automatic EventSource reconnect succeeded.
  useEffect(() => {
    if (!reconnecting) return;
    const shutdownAt = events.server_shutdown?.receivedAt ?? 0;
    const latestOther = Math.max(
      events.entry_count?.receivedAt ?? 0,
      events.registrations_sealed?.receivedAt ?? 0,
      events.winner?.receivedAt ?? 0,
      events.closed?.receivedAt ?? 0,
      events.snapshot?.receivedAt ?? 0
    );
    if (latestOther > shutdownAt) setReconnecting(false);
  }, [events, reconnecting]);

  useEffect(() => {
    if (status && typeof status.entryCount === 'number') setEntryCount(status.entryCount);
  }, [status]);

  useEffect(() => {
    if (events.entry_count) setEntryCount(events.entry_count.data.entryCount);
  }, [events.entry_count]);

  useEffect(() => {
    if (events.registrations_sealed) setSeal(events.registrations_sealed.data);
  }, [events.registrations_sealed]);

  // The admin's "Start over" wipes entries/draws in the database, but
  // drawnCount/currentWinner/seal are otherwise sticky (drawnCount only ever
  // grows, currentWinner/seal are never cleared) so a screen left open across
  // a reset would keep showing the previous round's winner the moment the
  // next round closes. Snap everything draw-related back to its pre-round
  // state explicitly instead of waiting for it to (never) settle on its own.
  useEffect(() => {
    if (!events.reset) return;
    setSeal(null);
    setDrawnCount(0);
    setCurrentWinner(null);
    setEntrantNames([]);
    setWinners([]);
    setShowReveal(false);
    setGrandFinale(false);
    setConfettiBurst(null);
    setRevealedKey(null);
    setFlying(false);
    setFilled(false);
  }, [events.reset]);

  // Fetched once the list is final — cached for the rest of the session so a
  // draw never has to wait on (or be broken by) the network; WinnerReveal
  // falls back to a plain character scramble if this is empty. Gated on
  // registration being closed (required before any draw can happen at all),
  // not on the "lock the entry list" step — that step is optional/skippable,
  // so waiting on it would leave this stuck empty whenever it's skipped.
  useEffect(() => {
    if (status?.status !== 'closed' || entrantNames.length > 0) return;
    let cancelled = false;
    fetch(ENTRANTS_URL, { credentials: 'same-origin' })
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled && Array.isArray(body?.names)) setEntrantNames(body.names);
      })
      .catch(() => {
        // keep the random-character scramble fallback on transient network errors
      });
    return () => {
      cancelled = true;
    };
  }, [status?.status, entrantNames.length]);

  // Sent once, right after connecting (mirrors the voting screen's initial
  // 'tally' snapshot) — resumes the stage's on-screen state (current/recent
  // winners, the sealed-list banner) after a reload, instead of only showing
  // it again once the next live event happens to fire.
  useEffect(() => {
    const data = events.snapshot?.data;
    if (!data) return;
    if (data.sealed) setSeal(data.sealed);
    setTotalPrizes(data.totalPrizes);
    setDrawnCount((prev) => Math.max(prev, data.drawnCount));
    setGifts(data.gifts ?? []);
    setWinners((prev) => (prev.length > (data.winners ?? []).length ? prev : data.winners ?? []));
  }, [events.snapshot]);

  // Totals come from the server, so editing the gift list (or reloading the
  // screen mid-draw) is picked up without a page refresh.
  useEffect(() => {
    if (!progress) return;
    setTotalPrizes(progress.totalPrizes);
    setDrawnCount((prev) => Math.max(prev, progress.drawnCount));
    setGifts(progress.gifts ?? []);
    setWinners((prev) => (prev.length > (progress.winners ?? []).length ? prev : progress.winners ?? []));
  }, [progress]);

  useEffect(() => {
    const data = events.winner?.data;
    if (!data) return;
    setTotalPrizes(data.totalPrizes);
    setDrawnCount(data.drawnCount);
    setCurrentWinner({ ...data, tier: tierFor(data.quantity) });
    setFlying(false);
    setFilled(false);
    setShowReveal(true);
    setWinners((prev) =>
      prev.some((w) => w.giftId === data.giftId && w.slot === data.slot)
        ? prev
        : [...prev, { giftId: data.giftId, slot: data.slot, empId: data.empId, name: data.name, imageName: data.imageName }]
    );
  }, [events.winner]);

  // The revealed winner's card lingers briefly, then minimizes into their slot
  // on the board (WinnerCard); the frame fills just before the card lands
  // (see fillSlot) and the card unmounts when it is done (see landWinner).
  useEffect(() => {
    if (!showReveal || !currentWinner || revealedKey !== winnerKey(currentWinner)) return undefined;
    const timer = setTimeout(() => setFlying(true), grandFinale ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [revealedKey, showReveal, currentWinner, grandFinale]);

  function fillSlot() {
    setFilled(true);
  }

  function landWinner() {
    setFlying(false);
    setFilled(false);
    setShowReveal(false);
  }

  function handleWinnerRevealed(winner) {
    setRevealedKey(winnerKey(winner));
    const finale = winner.remaining === 0;
    if (finale) setGrandFinale(true);
    setConfettiBurst({ id: Date.now(), tier: finale ? 'finale' : winner.tier });
  }

  const sealed = Boolean(seal);
  const allDrawn = totalPrizes > 0 && drawnCount >= totalPrizes;

  // view: waiting | open | sealing | draw
  let view = 'waiting';
  let badge = { state: 'waiting' };
  let phase = 'Checking status…';
  if (status?.isOpen) {
    view = 'open';
    badge = { state: 'live' };
  } else if (status?.status === 'closed') {
    if (allDrawn || sealed || drawnCount > 0) {
      view = 'draw';
      badge = allDrawn ? { state: 'complete' } : { state: 'drawing' };
    } else {
      view = 'sealing';
      badge = { state: 'sealing' };
      phase = 'Registration closed — sealing the list';
    }
  } else if (status) {
    badge = { state: 'coming-up' };
    phase = 'Registration has not opened yet';
  }

  const currentKey = currentWinner ? winnerKey(currentWinner) : null;
  const revealedNow = currentKey !== null && currentKey === revealedKey;
  const celebrating = grandFinale || (revealedNow && currentWinner.tier === 'premium');
  const mood = celebrating ? 'celebration' : view === 'open' || view === 'draw' ? 'live' : 'calm';

  // Confetti: winner colours by tier; the grand finale fires from both sides.
  const burstColors =
    confettiBurst?.tier === 'normal'
      ? ['#7fa6ff', '#c3cbda', '#eef1f6', '#4f7fe0']
      : ['#f5d888', '#e0b64c', '#eef1f6', '#7fa6ff'];
  const overlay =
    confettiBurst?.tier === 'finale' ? (
      <TwinConfetti burstKey={confettiBurst.id} colors={burstColors} />
    ) : (
      <Confetti burstKey={confettiBurst?.id ?? null} originX={0.5} colors={burstColors} />
    );

  // A winner stays off the board until their avatar has landed.
  const visibleWinners = winners.filter((w) => !(showReveal && !filled && currentKey === winnerKey(w)));
  const panelWinner = showReveal ? currentWinner : null;

  return (
    <Stage mood={mood} overlay={overlay}>
      {view !== 'draw' && (
        <StageHeader badge={reconnecting ? 'waiting' : badge.state} badgeLabel={reconnecting ? 'Reconnecting…' : undefined} />
      )}

      <main className="ev-main">
        {view === 'open' && (
          <div className="rf-open ev-fade-in">
            <div className="rf-open__info">
              <div className="ev-eyebrow">Annual Event</div>
              <MetalText as="h1" className="ev-title ev-title--display" sweep>Grand Prize Giveaway</MetalText>
              <div className="rf-open__clock">
                <div className="ev-label">Registration closes in</div>
                <Countdown seconds={status.secondsRemaining ?? 0} />
              </div>
              <div className="rf-entries">
                <span className="ev-numeral rf-entries__count"><AnimatedNumber value={entryCount} /></span>
                <span className="ev-label">{entryCount === 1 ? 'entry' : 'entries'}</span>
              </div>
            </div>
            <ScreenQr module="raffle" label="Scan to enter" />
          </div>
        )}

        {(view === 'waiting' || view === 'sealing') && (
          <div className="ev-center ev-fade-in" key={view}>
            <div className="ev-eyebrow">Annual Event</div>
            <MetalText as="h1" className="ev-title ev-title--display" sweep>Grand Prize Giveaway</MetalText>
            <div className="rf-phase">{phase}</div>
            {view === 'sealing' && <div className="ev-numeral rf-entries__count"><AnimatedNumber value={entryCount} /> <span className="ev-label">entries</span></div>}
          </div>
        )}

        {view === 'draw' && (
          <div className="rf-draw" ref={drawRef}>
            <div className="rf-draw__body">
              <div className="rf-side">
                <div className="rf-headline">
                  {grandFinale || allDrawn ? (
                    <MetalText as="h1" tone="gold" sweep className="ev-title">All {totalPrizes} prizes awarded!</MetalText>
                  ) : (
                    <MetalText as="h1" className="ev-title">Grand Prize Giveaway</MetalText>
                  )}
                  <div id="seal" className="rf-seal__line">
                    <IconLock className="rf-seal__lock" />
                    {seal?.count ?? entryCount} {(seal?.count ?? entryCount) === 1 ? 'entry' : 'entries'}
                  </div>
                  {reconnecting && <LiveBadge state="waiting" label="Reconnecting…" />}
                </div>
                <WinnerReveal
                winner={panelWinner}
                onRevealed={handleWinnerRevealed}
                namePool={entrantNames}
                complete={allDrawn}
                areaRef={areaRef}
                />
              </div>
              <div className="rf-card-slot">
                {panelWinner && revealedNow && (
                  <WinnerCard
                    key={currentKey}
                    winner={panelWinner}
                    originRef={areaRef}
                    container={drawRef}
                    flying={flying}
                    onNear={fillSlot}
                    onDone={landWinner}
                  />
                )}
              </div>
              <DrawLayout gifts={gifts} winners={visibleWinners} />
            </div>

            <div className="rf-draw__logo">
              <StageLogo size={360} />
            </div>
          </div>
        )}
      </main>
    </Stage>
  );
}
