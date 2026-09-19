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
export declare function BrickIcon({ size }: IconProps): import("react").JSX.Element;
export declare function LumberIcon({ size }: IconProps): import("react").JSX.Element;
export declare function WoolIcon({ size }: IconProps): import("react").JSX.Element;
export declare function GrainIcon({ size }: IconProps): import("react").JSX.Element;
export declare function OreIcon({ size }: IconProps): import("react").JSX.Element;
export declare function ResourceIcon({ resource, size }: {
    resource: Resource;
    size?: number;
}): import("react").JSX.Element;
export declare function CardsIcon({ size }: IconProps): import("react").JSX.Element;
export declare function ScrollIcon({ size }: IconProps): import("react").JSX.Element;
export declare function KnightIcon({ size }: IconProps): import("react").JSX.Element;
export declare function RoadIcon({ size }: IconProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Icons.d.ts.map