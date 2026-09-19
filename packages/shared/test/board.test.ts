import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coastalEdges,
  edgeEndpoints,
  generateBoard,
  hexRing,
  hexSpiral,
  makeRng,
  pipsFor,
  vertexEdges,
  vertexNeighbors,
  vertexIdOf,
  edgeIdOf,
  vertexHexes,
  spiralOrder,
} from '../dist/index.js';

test('the island has 19 tiles, 54 corners and 72 edges', () => {
  const board = generateBoard(makeRng(1), { layout: 'classic', shuffleHarbors: false });
  assert.equal(board.tiles.length, 19);
  assert.equal(board.vertices.length, 54);
  assert.equal(board.edges.length, 72);
  assert.equal(hexSpiral(2).length, 19);
  assert.equal(spiralOrder(2).length, 19);
});

test('rings have the expected size and no duplicates', () => {
  for (const r of [0, 1, 2, 3]) {
    const ring = hexRing(r);
    assert.equal(ring.length, r === 0 ? 1 : 6 * r);
    assert.equal(new Set(ring.map((h) => `${h.q},${h.r}`)).size, ring.length);
  }
});

test('the same corner reached from three tiles has one id', () => {
  // The corner shared by (0,0), (1,0) and (0,1) is corner 0 of the origin tile,
  // corner 2 of its eastern neighbour and corner 4 of its south-eastern one.
  const a = vertexIdOf({ q: 0, r: 0 }, 0);
  const b = vertexIdOf({ q: 1, r: 0 }, 2);
  const c = vertexIdOf({ q: 0, r: 1 }, 4);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(a, '0,0|0,1|1,0');
});

test('every corner is agreed on by all three tiles that meet there', () => {
  // Each of a tile's six corners must also be a corner of its two neighbours,
  // which is what makes the canonical ids safe to use as a shared index.
  for (const hex of hexSpiral(2)) {
    for (let k = 0; k < 6; k++) {
      const id = vertexIdOf(hex, k);
      const owners = vertexHexes(id);
      assert.equal(owners.length, 3);
      const rediscovered = owners.flatMap((h) => [0, 1, 2, 3, 4, 5].map((j) => vertexIdOf(h, j)));
      assert.equal(rediscovered.filter((v) => v === id).length, 3, `corner ${id} not shared by three tiles`);
    }
  }
});

test('every corner has exactly three edges and three neighbours', () => {
  const board = generateBoard(makeRng(2), {});
  for (const v of board.vertices) {
    assert.equal(new Set(vertexEdges(v)).size, 3);
    const neighbours = vertexNeighbors(v);
    assert.equal(new Set(neighbours).size, 3);
    // Adjacency is symmetric.
    for (const n of neighbours) assert.ok(vertexNeighbors(n).includes(v));
  }
});

test('every edge joins two of its own endpoints edges', () => {
  const board = generateBoard(makeRng(3), {});
  for (const e of board.edges) {
    const [a, b] = edgeEndpoints(e);
    assert.notEqual(a, b);
    assert.ok(vertexEdges(a).includes(e), `${e} missing from ${a}`);
    assert.ok(vertexEdges(b).includes(e), `${e} missing from ${b}`);
  }
});

test('the coast is a closed loop of 30 distinct edges', () => {
  const coast = coastalEdges(2);
  assert.equal(coast.length, 30);
  assert.equal(new Set(coast.map((c) => c.edge)).size, 30);
  // Consecutive coastal edges share exactly one corner, all the way round.
  for (let i = 0; i < coast.length; i++) {
    const a = new Set(edgeEndpoints(coast[i].edge));
    const b = edgeEndpoints(coast[(i + 1) % coast.length].edge);
    const shared = b.filter((v) => a.has(v));
    assert.equal(shared.length, 1, `coastal edges ${i} and ${i + 1} are not adjacent`);
  }
});

test('nine harbours sit on the coast and never share a corner', () => {
  for (let seed = 0; seed < 25; seed++) {
    const board = generateBoard(makeRng(seed), { shuffleHarbors: true });
    assert.equal(board.harbors.length, 9);
    assert.equal(board.harbors.filter((h) => h.resource === null).length, 4);
    assert.equal(new Set(board.harbors.map((h) => h.resource).filter(Boolean)).size, 5);
    const corners = board.harbors.flatMap((h) => h.vertices);
    assert.equal(new Set(corners).size, corners.length, 'two harbours share a corner');
    for (const h of board.harbors) {
      assert.ok(board.edges.includes(h.edge));
      assert.equal(h.vertices.length, 2);
    }
  }
});

test('terrain and number tokens match the standard mix', () => {
  for (const layout of ['classic', 'random', 'balanced'] as const) {
    const board = generateBoard(makeRng(7), { layout });
    const counts: Record<string, number> = {};
    for (const t of board.tiles) counts[t.terrain] = (counts[t.terrain] ?? 0) + 1;
    assert.deepEqual(counts, { fields: 4, forest: 4, pasture: 4, hills: 3, mountains: 3, desert: 1 }, layout);

    const numbers = board.tiles.map((t) => t.number).filter((n): n is number => n !== null).sort((a, b) => a - b);
    assert.deepEqual(
      numbers,
      [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
      `${layout} number tokens`,
    );
    assert.ok(board.tiles.every((t) => (t.terrain === 'desert') === (t.number === null)));
    assert.ok(board.tiles.every((t) => t.pips === pipsFor(t.number)));
  }
});

test('the balanced layout keeps 6 and 8 apart', () => {
  for (let seed = 0; seed < 40; seed++) {
    const board = generateBoard(makeRng(seed), { layout: 'balanced' });
    const byId = new Map(board.tiles.map((t) => [t.id, t]));
    for (const t of board.tiles) {
      if (t.number !== 6 && t.number !== 8) continue;
      for (const [dq, dr] of [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]) {
        const n = byId.get(`${t.q + dq},${t.r + dr}`);
        assert.ok(!n || (n.number !== 6 && n.number !== 8), `seed ${seed}: ${t.id} touches another red number`);
      }
    }
  }
});

test('edge ids are direction-agnostic', () => {
  assert.equal(edgeIdOf({ q: 0, r: 0 }, 0), edgeIdOf({ q: 1, r: 0 }, 3));
});
