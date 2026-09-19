/**
 * Axial hex-grid maths for a pointy-top board.
 *
 * Axial coordinates (q, r) with the implied cube coordinate s = -q - r.
 * World space uses the XZ plane (Y is up), with +X east and +Z south, so the
 * direction angles below are measured in the XZ plane:
 *
 *      dir index : 0=E(0deg) 1=SE(60) 2=SW(120) 3=W(180) 4=NW(240) 5=NE(300)
 *      corner k  : angle 30 + 60k, shared with DIRS[k] and DIRS[k+1]
 *      edge k    : angle 60k, spans corner k-1 -> corner k
 *
 * Vertices and edges are identified structurally rather than by index: a vertex
 * *is* the set of the three hexes meeting at it, and an edge *is* the set of the
 * two hexes sharing it. Canonicalising those sets into a sorted string key means
 * the same corner reached from three different tiles always produces one id, so
 * adjacency never needs a lookup table.
 */

export interface Hex {
  readonly q: number;
  readonly r: number;
}

/** Unique id for a hex tile, e.g. "1,-2". */
export type HexId = string;
/** Unique id for a corner: three sorted hex ids, e.g. "0,0|1,-1|1,0". */
export type VertexId = string;
/** Unique id for an edge: two sorted hex ids. */
export type EdgeId = string;

export const DIRS: readonly Hex[] = [
  { q: 1, r: 0 }, // 0 E
  { q: 0, r: 1 }, // 1 SE
  { q: -1, r: 1 }, // 2 SW
  { q: -1, r: 0 }, // 3 W
  { q: 0, r: -1 }, // 4 NW
  { q: 1, r: -1 }, // 5 NE
];

export const DIR_NAMES = ['E', 'SE', 'SW', 'W', 'NW', 'NE'] as const;
export type DirName = (typeof DIR_NAMES)[number];

export function dirIndex(name: DirName): number {
  return DIR_NAMES.indexOf(name);
}

export function hexId(h: Hex): HexId {
  return `${h.q},${h.r}`;
}

export function parseHexId(id: HexId): Hex {
  const [q, r] = id.split(',').map(Number);
  return { q, r };
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexNeighbor(h: Hex, dir: number): Hex {
  return hexAdd(h, DIRS[((dir % 6) + 6) % 6]);
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Cube distance from the origin hex. */
export function hexDistanceFromOrigin(h: Hex): number {
  return (Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r)) / 2;
}

export function hexDistance(a: Hex, b: Hex): number {
  return hexDistanceFromOrigin({ q: a.q - b.q, r: a.r - b.r });
}

/** All hexes within `radius` of the origin, ordered row by row (top to bottom). */
export function hexSpiral(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let r = -radius; r <= radius; r++) {
    const qMin = Math.max(-radius, -r - radius);
    const qMax = Math.min(radius, -r + radius);
    for (let q = qMin; q <= qMax; q++) out.push({ q, r });
  }
  return out;
}

function canonicalKey(hexes: Hex[]): string {
  return hexes
    .map(hexId)
    .sort()
    .join('|');
}

/** The corner at index `k` (0..5) of `h`, as a canonical vertex id. */
export function vertexIdOf(h: Hex, k: number): VertexId {
  const i = ((k % 6) + 6) % 6;
  return canonicalKey([h, hexNeighbor(h, i), hexNeighbor(h, (i + 1) % 6)]);
}

/** The edge at index `k` (0..5) of `h`, as a canonical edge id. */
export function edgeIdOf(h: Hex, k: number): EdgeId {
  const i = ((k % 6) + 6) % 6;
  return canonicalKey([h, hexNeighbor(h, i)]);
}

/** The (up to three) hexes that meet at a vertex, including off-board ones. */
export function vertexHexes(v: VertexId): Hex[] {
  return v.split('|').map(parseHexId);
}

/** The two hexes that share an edge, including off-board ones. */
export function edgeHexes(e: EdgeId): Hex[] {
  return e.split('|').map(parseHexId);
}

/** The six corners of a hex, in clockwise order. */
export function hexVertices(h: Hex): VertexId[] {
  return [0, 1, 2, 3, 4, 5].map((k) => vertexIdOf(h, k));
}

/** The six edges of a hex, in clockwise order. */
export function hexEdges(h: Hex): EdgeId[] {
  return [0, 1, 2, 3, 4, 5].map((k) => edgeIdOf(h, k));
}

/**
 * The two vertices an edge connects.
 *
 * For an edge shared by A and B, the endpoints are the corners where a third
 * hex joins them, i.e. the two hexes adjacent to both A and B.
 */
export function edgeEndpoints(e: EdgeId): [VertexId, VertexId] {
  const [a, b] = edgeHexes(e);
  const shared: Hex[] = [];
  for (let i = 0; i < 6; i++) {
    const n = hexNeighbor(a, i);
    if (hexDistance(n, b) === 1) shared.push(n);
  }
  if (shared.length !== 2) {
    throw new Error(`edge ${e} does not have exactly two endpoint hexes`);
  }
  return [canonicalKey([a, b, shared[0]]), canonicalKey([a, b, shared[1]])];
}

/** The three edges radiating from a vertex. */
export function vertexEdges(v: VertexId): EdgeId[] {
  const [a, b, c] = vertexHexes(v);
  return [canonicalKey([a, b]), canonicalKey([a, c]), canonicalKey([b, c])];
}

/** The three vertices one edge-step away from a vertex. */
export function vertexNeighbors(v: VertexId): VertexId[] {
  const out: VertexId[] = [];
  for (const e of vertexEdges(v)) {
    const [p, q] = edgeEndpoints(e);
    out.push(p === v ? q : p);
  }
  return out;
}

/** True when the edge touches the vertex. */
export function edgeTouchesVertex(e: EdgeId, v: VertexId): boolean {
  const [p, q] = edgeEndpoints(e);
  return p === v || q === v;
}

// ---------------------------------------------------------------------------
// World-space projection
// ---------------------------------------------------------------------------

export interface Point2 {
  x: number;
  z: number;
}

/** Centre of a hex in world space, for a hex of circumradius `size`. */
export function hexToWorld(h: Hex, size: number): Point2 {
  return {
    x: size * Math.sqrt(3) * (h.q + h.r / 2),
    z: size * 1.5 * h.r,
  };
}

/**
 * A corner sits at the centroid of the three hexes meeting there, which on a
 * regular grid is exactly the shared corner point.
 */
export function vertexToWorld(v: VertexId, size: number): Point2 {
  const pts = vertexHexes(v).map((h) => hexToWorld(h, size));
  return {
    x: (pts[0].x + pts[1].x + pts[2].x) / 3,
    z: (pts[0].z + pts[1].z + pts[2].z) / 3,
  };
}

/** Midpoint of an edge: the midpoint of the two hex centres it separates. */
export function edgeToWorld(e: EdgeId, size: number): Point2 {
  const pts = edgeHexes(e).map((h) => hexToWorld(h, size));
  return { x: (pts[0].x + pts[1].x) / 2, z: (pts[0].z + pts[1].z) / 2 };
}

/** Rotation about Y (radians) that aligns a box with an edge. */
export function edgeAngle(e: EdgeId, size: number): number {
  const [v1, v2] = edgeEndpoints(e);
  const a = vertexToWorld(v1, size);
  const b = vertexToWorld(v2, size);
  return Math.atan2(b.z - a.z, b.x - a.x);
}
