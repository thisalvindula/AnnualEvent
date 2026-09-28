const NORMAL_COUNT = 10;
const TOTAL_GIFTS = 25;
const SEQS = Array.from({ length: TOTAL_GIFTS }, (_, i) => i + 1);

export function GiftProgressDots({ visible, filledSeqs, drawnCount }) {
  if (!visible) return null;
  return (
    <div id="progressWrap">
      <div className="gift-progress-label">{drawnCount} of {TOTAL_GIFTS} prizes awarded</div>
      <div id="progressDots" className="gift-progress">
        {SEQS.map((seq) => (
          <div
            key={seq}
            className={`gift-dot ${seq <= NORMAL_COUNT ? 'tier-normal' : 'tier-premium'} ${filledSeqs.has(seq) ? 'filled' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
