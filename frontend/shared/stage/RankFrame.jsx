import { useEffect, useId, useState } from 'preact/hooks';
import { usePrefersReducedMotion } from './hooks.js';
import { initials } from './Stage.jsx';

/* ==========================================================================
   RankFrame — animated vector avatar frame that stands in for a gift on the
   raffle board. Rank 1..15 each get their own palette and ornament level;
   'consolation' is one shared illustration. Pure SVG (no raster assets): the
   metal shading is an animated repeating gradient, plus CSS glints.
   ========================================================================== */

// [light, mid, dark]
const PALETTES = {
  1: ['#fff1b0', '#e0b64c', '#8a5a10'], // gold
  2: ['#ffffff', '#c3cad6', '#6b7586'], // silver
  3: ['#ffd2a1', '#cd7f32', '#6e3a12'], // bronze
  4: ['#b9ffd9', '#2fbf71', '#0d5a34'], // emerald
  5: ['#bcd8ff', '#3b82f6', '#123a8a'], // sapphire
  6: ['#ffc2cc', '#e11d48', '#7a0a26'], // ruby
  7: ['#e4c8ff', '#9b5de5', '#4a1d84'], // amethyst
  8: ['#b7fff5', '#14b8a6', '#0b5d55'], // teal
  9: ['#ffd0ea', '#ec4899', '#8a1d55'], // rose
  10: ['#ffe1a8', '#f59e0b', '#8a4b04'], // amber
  11: ['#dbe5f0', '#7f93ab', '#36465c'], // steel
  12: ['#c9ccff', '#6366f1', '#26288a'], // indigo
  13: ['#eaffb0', '#84cc16', '#3f6a07'], // lime
  14: ['#ffd9c2', '#c2683a', '#6a2f14'], // copper
  15: ['#e2e8f0', '#64748b', '#263041'], // slate
  consolation: ['#cfe2ff', '#7fa6ff', '#28437f'],
};

// Ornament level falls off with rank: crown -> crest -> gem -> bare ring.
function configFor(rank) {
  if (rank === 'consolation') return { top: 'star', leaves: 4, ribbon: true };
  if (rank === 1) return { top: 'crown', leaves: 7 };
  if (rank <= 3) return { top: 'crest', leaves: 7 };
  if (rank <= 6) return { top: 'gem', leaves: 6 };
  if (rank <= 10) return { top: 'gem', leaves: 4 };
  return { top: 'none', leaves: 3 };
}

const CX = 100;
const CY = 96;
const LEAF = 'M0 0C9-8 9-26 0-38C-9-26-9-8 0 0Z';

function leafTransforms(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = 14 + (i * 92) / Math.max(count - 1, 1); // degrees up from the bottom
    const r = (a * Math.PI) / 180;
    const x = Math.sin(r) * 62;
    const y = Math.cos(r) * 62;
    const phi = 90 - a + 22;
    const s = 0.78 + 0.1 * (1 - i / Math.max(count - 1, 1));
    out.push(
      `translate(${CX + x} ${CY + y}) rotate(${phi}) scale(${s})`,
      `translate(${CX - x} ${CY + y}) rotate(${-phi}) scale(${-s} ${s})`
    );
  }
  return out;
}

function Ornament({ top, fill, light }) {
  switch (top) {
    case 'crown':
      return (
        <g>
          <path d="M76 42L79 16L91 30L100 8L109 30L121 16L124 42Z" fill={fill} stroke={light} stroke-width="1" />
          <circle cx="79" cy="14" r="3.4" fill={light} />
          <circle cx="100" cy="6" r="3.8" fill={light} />
          <circle cx="121" cy="14" r="3.4" fill={light} />
        </g>
      );
    case 'crest':
      return (
        <g>
          <path d="M80 44Q92 32 100 8Q108 32 120 44Z" fill={fill} stroke={light} stroke-width="1" />
          <circle cx="100" cy="30" r="4.5" fill={light} />
        </g>
      );
    case 'gem':
      return <path d="M100 18L111 32L100 47L89 32Z" fill={fill} stroke={light} stroke-width="1" />;
    case 'star':
      return <path d="M100 14l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill={fill} stroke={light} stroke-width="1" />;
    default:
      return null;
  }
}

function Glint({ x, y, delay }) {
  return (
    <path
      className="rf-glint"
      d="M0-9Q1-1 9 0Q1 1 0 9Q-1 1-9 0Q-1-1 0-9Z"
      transform={`translate(${x} ${y})`}
      style={{ animationDelay: `${delay}s` }}
    />
  );
}

export function RankFrame({ rank, name, imageName, filled = false, size = 'sm', slotKey }) {
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageName]);

  const key = PALETTES[rank] ? rank : 15;
  const [light, mid, dark] = PALETTES[key];
  const { top, leaves, ribbon } = configFor(rank);
  const gid = `rfg${uid}`;
  const label = rank === 'consolation' ? '★' : String(rank);
  const grand = rank !== 'consolation' && rank <= 3;
  const delay = typeof rank === 'number' ? (rank % 5) * 0.7 : 0.3;

  return (
    <div
      className={`rf-frame rf-frame--${size} ${filled ? 'rf-frame--filled' : ''} ${grand ? 'rf-frame--grand' : ''}`}
      style={{ '--rf-glow': mid }}
      role="img"
      aria-label={filled ? `${label}: ${name}` : `${label}: not drawn yet`}
    >
      <div className="rf-frame__photo" data-slot={slotKey}>
        {filled && imageName && !failed ? (
          <img src={`/employee-photos/${encodeURIComponent(imageName)}`} alt="" onError={() => setFailed(true)} />
        ) : (
          <span aria-hidden="true">{filled ? initials(name) : label}</span>
        )}
      </div>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          {/* Repeating metal gradient; sliding it by exactly one period gives a seamless sheen. */}
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="90" y2="90" spreadMethod="repeat">
            <stop offset="0" stop-color={mid} />
            <stop offset=".22" stop-color={light} />
            <stop offset=".5" stop-color={mid} />
            <stop offset=".78" stop-color={dark} />
            <stop offset="1" stop-color={mid} />
            {!reduced && filled && (
              <animateTransform
                attributeName="gradientTransform"
                type="translate"
                from="0 0"
                to="90 90"
                dur={`${grand ? 4 : 6}s`}
                repeatCount="indefinite"
              />
            )}
          </linearGradient>
        </defs>
        {ribbon && (
          <g fill={`url(#${gid})`}>
            <path d="M92 172L78 200L92 194L100 200Z" />
            <path d="M108 172L122 200L108 194L100 200Z" />
          </g>
        )}
        <g fill={`url(#${gid})`} stroke={dark} stroke-width=".8" stroke-opacity=".6">
          {leafTransforms(leaves).map((t) => (
            <path key={t} d={LEAF} transform={t} />
          ))}
        </g>
        <circle cx={CX} cy={CY} r="58" fill="none" stroke={`url(#${gid})`} stroke-width="11" />
        <circle cx={CX} cy={CY} r="63.5" fill="none" stroke={light} stroke-opacity=".55" stroke-width="1" />
        <circle cx={CX} cy={CY} r="52.5" fill="none" stroke={dark} stroke-opacity=".7" stroke-width="1.2" />
        <Ornament top={top} fill={`url(#${gid})`} light={light} />
        <circle cx={CX} cy="166" r="17" fill={`url(#${gid})`} stroke={dark} stroke-width="1.2" />
        <circle cx={CX} cy="166" r="12.5" fill={dark} fill-opacity=".85" />
        <text x={CX} y="166" text-anchor="middle" dominant-baseline="central" font-size={label.length > 1 ? 15 : 17} font-weight="800" fill={light} font-family="var(--font-display)">
          {label}
        </text>
        {filled && !reduced && rank !== 'consolation' && rank <= 10 && (
          <g fill="#fff">
            <Glint x={142} y={52} delay={delay} />
            <Glint x={60} y={118} delay={delay + 1.6} />
          </g>
        )}
      </svg>
    </div>
  );
}
