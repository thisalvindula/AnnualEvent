import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { EmployeePhoto } from '../../shared/ui/EmployeePhoto.jsx';

function useAnimatedNumber(value) {
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

function LeaderboardRow({ finalist, rank, isLeader, maxVotes, rowRef }) {
  const displayedVotes = useAnimatedNumber(finalist.votes);
  return (
    <div ref={rowRef} className={`leaderboard-row ${isLeader ? 'leader' : ''}`}>
      <div className={`rank-badge rank-${rank}`}>
        {rank === 1 ? (
          <>
            <span className="crown">&#128081;</span>
            {rank}
          </>
        ) : (
          rank
        )}
      </div>
      <EmployeePhoto empId={finalist.empId} name={finalist.name} size="sm" />
      <div className="leaderboard-main">
        <div className="leaderboard-label">
          <span>
            <span className="leaderboard-name">{finalist.name}</span>
            <span className="leaderboard-song">{finalist.song ? ` — ${finalist.song}` : ''}</span>
          </span>
          <span className="leaderboard-votes">{displayedVotes}</span>
        </div>
        <div className="bar-track">
          <div
            className={`bar-fill ${isLeader ? 'leader' : ''}`}
            style={{ width: `${(finalist.votes / maxVotes) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// FLIP-style reorder animation: each render's row DOM position is compared
// against the position captured in the previous run, and any delta is
// inverted via a transform that's then released on the next frame — porting
// the manual FLIP logic from the old public/screen.js's renderTally().
export function LiveVoteBars({ tally }) {
  const sorted = [...tally].sort((a, b) => b.votes - a.votes || a.position - b.position);
  const max = Math.max(1, ...sorted.map((f) => f.votes));
  const rowNodes = useRef(new Map());
  const prevRects = useRef(new Map());

  // Competition ranking: finalists tied on votes share the same rank (and
  // the same crown/leader styling), with the next rank skipping ahead by
  // the number of finalists that tied for the spot above it.
  let rank = 0;
  let prevVotes = null;
  const ranked = sorted.map((f, i) => {
    if (f.votes !== prevVotes) {
      rank = i + 1;
      prevVotes = f.votes;
    }
    return { finalist: f, rank };
  });

  useLayoutEffect(() => {
    const nextRects = new Map();
    rowNodes.current.forEach((el, id) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      nextRects.set(id, rect);
      const prev = prevRects.current.get(id);
      if (prev) {
        const dy = prev.top - rect.top;
        if (dy) {
          el.style.transition = 'none';
          el.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => {
            el.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
            el.style.transform = '';
          });
        }
      }
    });
    prevRects.current = nextRects;
  });

  return (
    <div id="bars" className="leaderboard">
      {ranked.map(({ finalist: f, rank }) => (
        <LeaderboardRow
          key={f.id}
          finalist={f}
          rank={rank}
          isLeader={rank === 1 && f.votes > 0}
          maxVotes={max}
          rowRef={(el) => {
            if (el) rowNodes.current.set(f.id, el);
            else rowNodes.current.delete(f.id);
          }}
        />
      ))}
    </div>
  );
}
