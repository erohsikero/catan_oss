import type { Resource } from '@hexhaven/shared';

/**
 * Inline SVG icons.
 *
 * The HUD originally used emoji, which renders inconsistently — or not at all
 * — depending on the system's fonts. Drawing the glyphs as SVG keeps the
 * interface identical everywhere and lets each one inherit the resource
 * colour from the palette.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const box = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true as const,
});

export function BrickIcon({ size = 24 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="2" y="6" width="9" height="4.6" rx="1" fill="#c0653e" stroke="#7d3a1f" strokeWidth="1" />
      <rect x="13" y="6" width="9" height="4.6" rx="1" fill="#ae5734" stroke="#7d3a1f" strokeWidth="1" />
      <rect x="7" y="12.6" width="9" height="4.6" rx="1" fill="#c96f47" stroke="#7d3a1f" strokeWidth="1" />
      <rect x="2" y="12.6" width="3.4" height="4.6" rx="1" fill="#ae5734" stroke="#7d3a1f" strokeWidth="1" />
      <rect x="17.6" y="12.6" width="4.4" height="4.6" rx="1" fill="#ae5734" stroke="#7d3a1f" strokeWidth="1" />
    </svg>
  );
}

export function LumberIcon({ size = 24 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path d="M12 2.4 5.4 12h13.2L12 2.4Z" fill="#3f8c46" stroke="#22562a" strokeWidth="1" strokeLinejoin="round" />
      <path d="M12 7.6 4 18.4h16L12 7.6Z" fill="#4d9e52" stroke="#22562a" strokeWidth="1" strokeLinejoin="round" />
      <rect x="10.6" y="17.4" width="2.8" height="4.4" rx="0.6" fill="#6b4a2c" stroke="#3d2a17" strokeWidth="0.9" />
    </svg>
  );
}

export function WoolIcon({ size = 24 }: IconProps) {
  return (
    <svg {...box(size)}>
      <ellipse cx="12.6" cy="12.4" rx="7.4" ry="5.6" fill="#f2efe4" stroke="#b6b0a0" strokeWidth="1" />
      <circle cx="7.5" cy="9.6" r="2.6" fill="#faf8f1" stroke="#b6b0a0" strokeWidth="0.8" />
      <circle cx="17.4" cy="9.4" r="2.4" fill="#faf8f1" stroke="#b6b0a0" strokeWidth="0.8" />
      <circle cx="5.4" cy="12.8" r="2.8" fill="#41382f" />
      <circle cx="4.5" cy="12" r="0.6" fill="#f2efe4" />
      <path d="M8.5 17.6v3M12.4 18v3M16.6 17.4v3" stroke="#41382f" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function GrainIcon({ size = 24 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path d="M12 21.6V8.4" stroke="#a97b23" strokeWidth="1.6" strokeLinecap="round" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <path
            d={`M12 ${9 + i * 3.1} q-4 -0.6 -4.6 3 q3.4 0.7 4.6 -1.4Z`}
            fill="#e0b13d"
            stroke="#a97b23"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
          <path
            d={`M12 ${9 + i * 3.1} q4 -0.6 4.6 3 q-3.4 0.7 -4.6 -1.4Z`}
            fill="#eec358"
            stroke="#a97b23"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
        </g>
      ))}
      <path d="M12 8.6 q-1.6 -3 0 -5.6 q1.6 2.6 0 5.6Z" fill="#f2d072" stroke="#a97b23" strokeWidth="0.8" />
    </svg>
  );
}

export function OreIcon({ size = 24 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path d="M2.2 19.4 9 6.6l5.2 7.4 2.6-3.4 5 8.8H2.2Z" fill="#6f7d88" stroke="#3d4750" strokeWidth="1" strokeLinejoin="round" />
      <path d="M9 6.6 5.6 13l3.4-1.4 2.2 2.4L9 6.6Z" fill="#9aa7b2" />
      <path d="M16.8 10.6 14.7 13.4l2.4 1 1.8-1.8-2.1-2Z" fill="#9aa7b2" />
      <circle cx="12.8" cy="17" r="1.1" fill="#c9a24a" />
      <circle cx="6.4" cy="17.6" r="0.8" fill="#c9a24a" />
    </svg>
  );
}

const RESOURCE_ICONS: Record<Resource, (p: IconProps) => JSX.Element> = {
  brick: BrickIcon,
  lumber: LumberIcon,
  wool: WoolIcon,
  grain: GrainIcon,
  ore: OreIcon,
};

export function ResourceIcon({ resource, size = 24 }: { resource: Resource; size?: number }) {
  const Icon = RESOURCE_ICONS[resource];
  return <Icon size={size} />;
}

// --- small HUD glyphs ------------------------------------------------------

export function CardsIcon({ size = 13 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="3" y="5" width="11" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.5 3.8h7A2.5 2.5 0 0 1 19 6.3v11" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function ScrollIcon({ size = 13 }: IconProps) {
  return (
    <svg {...box(size)}>
      <rect x="4" y="3.5" width="14" height="17" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 8h7M7.5 11.6h7M7.5 15.2h4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function KnightIcon({ size = 13 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path
        d="M12 2.6 6.4 5v6.4c0 4 2.3 7.4 5.6 9 3.3-1.6 5.6-5 5.6-9V5L12 2.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 7.4v7M9 10.4h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function RoadIcon({ size = 13 }: IconProps) {
  return (
    <svg {...box(size)}>
      <path d="M4 20.5 9 3.5M20 20.5 15 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 5v2.6M12 10.8v2.6M12 16.6v2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
