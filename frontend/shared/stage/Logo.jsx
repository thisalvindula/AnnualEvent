import { useRef } from 'preact/hooks';
import { LOGO_BLUE_D, LOGO_RED_D, LOGO_TRANSFORM, LOGO_VIEWBOX } from './logo-paths.js';

let logoUid = 0;

// AmSafe Bridport wordmark as flat vector paths. `variant`: lockup (full
// wordmark) | mono (single silver ink, for on-glass placement) | mark (crop
// around the red "AM"). `state` is controlled by the consumer: mount with
// "intro", then switch to "idle" after ~2.8s ("static" = no motion).
export function Logo({ variant = 'lockup', state = 'static', size, className = '', style }) {
  const idRef = useRef(null);
  if (idRef.current === null) {
    logoUid += 1;
    idRef.current = logoUid;
  }
  const wipeMaskId = `ev-logo-wipe-${idRef.current}`;
  const shapeMaskId = `ev-logo-shape-${idRef.current}`;
  const sweepGradId = `ev-logo-sweep-${idRef.current}`;
  const viewBox = LOGO_VIEWBOX[variant] || LOGO_VIEWBOX.lockup;
  const mono = variant === 'mono';
  const metalGradId = `ev-logo-metal-${idRef.current}`;
  const redFill = mono ? `url(#${metalGradId})` : 'var(--brand-red)';
  const blueFill = mono ? `url(#${metalGradId})` : 'var(--brand-blue)';

  return (
    <span
      className={`ev-logo ev-logo--${variant} ev-logo--${state} ${className}`}
      style={{ ...(size ? { '--logo-size': `${size}px` } : null), ...style }}
    >
      <svg className="ev-logo__svg" viewBox={viewBox} role="img" aria-label="AmSafe Bridport">
        <defs>
          <mask id={wipeMaskId} maskUnits="userSpaceOnUse" x="-500" y="-500" width="4300" height="1300">
            <rect className="ev-logo__wipe" x="-100" y="-500" width="4300" height="1300" fill="#fff" />
          </mask>
          <mask id={shapeMaskId} maskUnits="userSpaceOnUse" x="-500" y="-500" width="4300" height="1300">
            <g transform={LOGO_TRANSFORM} fill="#fff">
              <path d={LOGO_RED_D} />
              <path d={LOGO_BLUE_D} />
            </g>
          </mask>
          {/* brushed-silver ink for mono: bright top, darker mid-band, soft lower edge
              (path space is y-flipped, so y=2530 is the top of the artwork) */}
          <linearGradient id={metalGradId} gradientUnits="userSpaceOnUse" x1="0" y1="2530" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--silver-100)" />
            <stop offset="42%" stopColor="var(--silver-300)" />
            <stop offset="54%" stopColor="var(--silver-500)" />
            <stop offset="100%" stopColor="var(--silver-200)" />
          </linearGradient>
          <linearGradient id={sweepGradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" className="ev-logo__sweepStop" stopOpacity="0" />
            <stop offset="35%" className="ev-logo__sweepStop ev-logo__sweepStop--edge" stopOpacity=".8" />
            <stop offset="50%" className="ev-logo__sweepStop ev-logo__sweepStop--core" stopOpacity=".95" />
            <stop offset="65%" className="ev-logo__sweepStop ev-logo__sweepStop--edge" stopOpacity=".8" />
            <stop offset="100%" className="ev-logo__sweepStop" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* soft glow behind the mark, opacity-only animation */}
        <g className="ev-logo__glow" transform={LOGO_TRANSFORM} opacity=".55">
          <path d={LOGO_RED_D} fill={redFill} opacity=".8" />
          <path d={LOGO_BLUE_D} fill={blueFill} opacity=".8" />
        </g>

        {/* solid ink, revealed left-to-right on intro via the wipe mask */}
        <g mask={`url(#${wipeMaskId})`}>
          <g transform={LOGO_TRANSFORM}>
            <path d={LOGO_RED_D} fill={redFill} />
            <path d={LOGO_BLUE_D} fill={blueFill} />
          </g>
        </g>

        {/* light sweep, clipped to the letterform silhouette */}
        <g className="ev-logo__sweep" mask={`url(#${shapeMaskId})`}>
          <rect className="ev-logo__sweepBar" x="-1000" y="-500" width="900" height="1300" fill={`url(#${sweepGradId})`} />
        </g>
      </svg>
    </span>
  );
}
