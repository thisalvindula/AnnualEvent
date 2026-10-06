import { useLayoutEffect, useRef } from 'preact/hooks';
import { AnimatedNumber, Avatar } from '../../shared/stage/Stage.jsx';

function LeaderboardRow({ finalist, rank, isLeader, maxVotes, avatarSize, rowRef }) {
  return (
    <div ref={rowRef} className={`vt-row ${isLeader ? 'vt-row--leader' : ''}`}>
      <div className={`vt-rank vt-rank--${rank <= 3 ? rank : 'n'}`}>{rank}</div>
      <Avatar name={finalist.name} imageName={finalist.imageName} size={avatarSize} tier={isLeader ? 'premium' : 'normal'} />
      <div className="vt-row__main">
        <div className="vt-row__label">
          <span className="vt-row__who">
            <span className="vt-row__name">{finalist.name}</span>
            {finalist.song ? <span className="vt-row__song">{finalist.song}</span> : null}
          </span>
          <span className="ev-numeral vt-row__votes"><AnimatedNumber value={finalist.votes} duration={500} /></span>
        </div>
        <div className="vt-bar">
          <div className={`vt-bar__fill ${isLeader ? 'vt-bar__fill--leader' : ''}`} style={{ width: `${(finalist.votes / maxVotes) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

// FLIP-style reorder animation: each render's row offset is compared with the
// one captured in the previous run, and any delta is inverted via a transform
// that's released on the next frame. offsetTop (layout units) is used rather
// than getBoundingClientRect so the animation is correct under the stage's
// scale transform.
export function LiveVoteBars({ tally }) {
  const sorted = [...tally].sort((a, b) => b.votes - a.votes || a.position - b.position);
  const max = Math.max(1, ...sorted.map((f) => f.votes));
  const rowNodes = useRef(new Map());
  const prevTops = useRef(new Map());

  // Competition ranking: finalists tied on votes share the same rank (and
  // the same leader styling), with the next rank skipping ahead by the
  // number of finalists that tied for the spot above it.
  let rank = 0;
  let prevVotes = null;
  const ranked = sorted.map((f, i) => {
    if (f.votes !== prevVotes) {
      rank = i + 1;
      prevVotes = f.votes;
    }
    return { finalist: f, rank };
  });

  // Many finalists share one screen: shrink avatars past five rows.
  const dense = sorted.length > 5;

  useLayoutEffect(() => {
    const nextTops = new Map();
    rowNodes.current.forEach((el, id) => {
      if (!el) return;
      const top = el.offsetTop;
      nextTops.set(id, top);
      const prev = prevTops.current.get(id);
      if (prev !== undefined && prev !== top) {
        el.style.transition = 'none';
        el.style.transform = `translateY(${prev - top}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.7s cubic-bezier(.16, 1, .3, 1)';
          el.style.transform = '';
        });
      }
    });
    prevTops.current = nextTops;
  });

  return (
    <div id="bars" className={`vt-board ${dense ? 'vt-board--dense' : ''}`}>
      {ranked.map(({ finalist: f, rank: r }) => (
        <LeaderboardRow
          key={f.id}
          finalist={f}
          rank={r}
          isLeader={r === 1 && f.votes > 0}
          maxVotes={max}
          avatarSize={dense ? 'sm' : 'md'}
          rowRef={(el) => {
            if (el) rowNodes.current.set(f.id, el);
            else rowNodes.current.delete(f.id);
          }}
        />
      ))}
    </div>
  );
}
