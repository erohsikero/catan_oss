/**
 * Shared harness for the browser tests.
 *
 * These tests used to find a placement target by clicking a grid of up to
 * 260 screen positions and checking the game state after each one — roughly
 * forty seconds per lookup, and the opening alone needs four. That is
 * brute-forcing something the test can simply compute: the board geometry is
 * in the shared package, and the camera is a fixed, known configuration that
 * the scene and this file both read from `camera.json`.
 *
 * So instead of hunting, project the target's world position through the same
 * camera and click that pixel. One click instead of hundreds.
 *
 * The game state comes from tapping the websocket in the page. That is
 * test-only instrumentation installed before the app loads; the application
 * has no idea it is being observed and needs no hooks of its own.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pw from 'playwright-core';
import * as THREE from 'three';
import { edgeToWorld, hexToWorld, parseHexId, vertexToWorld } from '@hexhaven/shared';

const { chromium } = pw;

const CAMERA = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/three/camera.json', import.meta.url)), 'utf8'),
);

/** Must match HEX_SIZE in src/three/theme.ts. */
const HEX_SIZE = 1;
/** Must match SURFACE_Y; targets are drawn just above the tile surface. */
const SURFACE_Y = 0.34;

/**
 * A smaller window than a real player would use.
 *
 * WebGL in CI runs on a software rasteriser, so every frame costs CPU in
 * proportion to its pixel count, and these tests spend most of their time
 * waiting for frames rather than for the game. Hence a window smaller than
 * a player would use.
 *
 * It cannot shrink much further, though: below roughly this size the HUD
 * panels cover enough of the board that computed clicks start landing on an
 * overlay instead of the canvas, and the tests fail for a reason that has
 * nothing to do with what they are testing. 720x500 was tried and does not
 * work.
 */
export const VIEWPORT = { width: 900, height: 620 };

export async function launch({ base, viewport = VIEWPORT } = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    args: [
      '--no-sandbox',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ],
  });
  const page = await (await browser.newContext({ viewport })).newPage();

  // Record what the client sends and what it is told, before it connects.
  await page.addInitScript(() => {
    window.__sent = [];
    window.__view = null;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try {
        const m = JSON.parse(data);
        if (m.t === 'action') window.__sent.push(m.action);
      } catch {
        /* not ours */
      }
      return send.call(this, data);
    };
    class TappedSocket extends WebSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          try {
            const m = JSON.parse(event.data);
            if (m.t !== 'state') return;
            // The board is sent once and omitted afterwards, exactly as the
            // real client caches it.
            if (m.view.board) window.__board = m.view.board;
            window.__view = { ...m.view, board: m.view.board ?? window.__board };
          } catch {
            /* not ours */
          }
        });
      }
    }
    window.WebSocket = TappedSocket;
  });

  if (base) await page.goto(base, { waitUntil: 'domcontentloaded' });
  return { browser, page, viewport };
}

// --- reading the game ------------------------------------------------------

/** The latest view the client received, or null before the first one. */
export function view(page) {
  return page.evaluate(() => window.__view);
}

/** Actions the client has sent, optionally since a marker index. */
export function sentActions(page, from = 0) {
  return page.evaluate((n) => window.__sent.slice(n), from);
}

export function clearSent(page) {
  return page.evaluate(() => {
    window.__sent.length = 0;
  });
}

/**
 * Waits for a predicate over the view, polling inside the page rather than
 * round-tripping once per check.
 */
export async function waitForView(page, predicateSource, timeout = 60000) {
  await page.waitForFunction(
    (src) => {
      const fn = new Function('view', `return (${src})(view)`);
      return window.__view ? Boolean(fn(window.__view)) : false;
    },
    predicateSource,
    { timeout, polling: 100 },
  );
  return view(page);
}

// --- projecting the board to the screen ------------------------------------

function makeCamera(viewport) {
  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    viewport.width / viewport.height,
    CAMERA.near,
    CAMERA.far,
  );
  camera.position.set(...CAMERA.position);
  camera.lookAt(new THREE.Vector3(...CAMERA.target));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

/** World position of a placement target of the given kind. */
export function worldPosition(kind, id) {
  if (kind === 'vertex') {
    const p = vertexToWorld(id, HEX_SIZE);
    return new THREE.Vector3(p.x, SURFACE_Y, p.z);
  }
  if (kind === 'edge') {
    const p = edgeToWorld(id, HEX_SIZE);
    return new THREE.Vector3(p.x, SURFACE_Y, p.z);
  }
  const p = hexToWorld(parseHexId(id), HEX_SIZE);
  return new THREE.Vector3(p.x, SURFACE_Y, p.z);
}

/** Screen pixel for a target, using the scene's own camera configuration. */
export function screenPosition(kind, id, viewport = VIEWPORT) {
  const ndc = worldPosition(kind, id).project(makeCamera(viewport));
  return {
    x: Math.round((ndc.x * 0.5 + 0.5) * viewport.width),
    y: Math.round((1 - (ndc.y * 0.5 + 0.5)) * viewport.height),
  };
}

/**
 * Clicks a target by computing where it is.
 *
 * A handful of nearby offsets are tried if the exact centre does not take —
 * a piece can sit over the middle of a highlight — but this is a few clicks
 * around a known point, not a search of the whole board.
 */
export async function clickTarget(page, kind, id, { viewport = VIEWPORT, settled } = {}) {
  const at = screenPosition(kind, id, viewport);
  const offsets = [
    [0, 0],
    [0, 14],
    [14, 6],
    [-14, 6],
    [0, -12],
  ];
  for (const [dx, dy] of offsets) {
    const x = at.x + dx;
    const y = at.y + dy;
    if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) continue;
    await page.mouse.click(x, y);
    if (!settled) return { x, y };
    try {
      await page.waitForFunction(settled.source ?? settled, settled.arg, {
        timeout: 1500,
        polling: 60,
      });
      return { x, y };
    } catch {
      /* try the next offset */
    }
  }
  return null;
}

/**
 * Whether a pixel would actually reach the board.
 *
 * The HUD floats over the canvas, so a target near the bottom of the screen
 * can project onto the action bar or the log panel. A click there hits the
 * overlay and the board never hears about it — which looks exactly like a
 * broken projection, and sent an earlier version of these tests chasing a
 * maths bug that did not exist.
 */
export function isOnCanvas(page, x, y) {
  return page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.tagName === 'CANVAS',
    [x, y],
  );
}

/**
 * The first of `ids` whose projected pixel is clear of the HUD, so tests can
 * choose a target they can actually reach rather than assuming any will do.
 */
export async function clickableTarget(page, kind, ids, viewport = VIEWPORT) {
  for (const id of ids) {
    const at = screenPosition(kind, id, viewport);
    if (at.x < 4 || at.y < 4 || at.x > viewport.width - 4 || at.y > viewport.height - 4) continue;
    if (await isOnCanvas(page, at.x, at.y)) return { id, at };
  }
  return null;
}

/**
 * Clicks a point until the client actually sends something.
 *
 * Knowing it is our turn and being able to click are not the same instant:
 * the turn arrives over the websocket, and the highlights appear a frame or
 * two later once React and three have rendered them. A single click fired
 * the moment the state changes can land on a board with nothing on it yet,
 * and the test then waits out its timeout for a step that will never
 * advance. Retrying briefly is both simpler and more honest than sleeping
 * for a guessed interval.
 */
export async function clickUntilAction(page, at, { attempts = 5, waitMs = 1500, grace = 3000 } = {}) {
  const before = (await sentActions(page)).length;
  const landed = (timeout) =>
    page.waitForFunction((n) => window.__sent.length > n, before, { timeout, polling: 40 });

  for (let i = 1; i <= attempts; i++) {
    await page.mouse.click(at.x, at.y);
    try {
      await landed(waitMs);
      // Report how many it took, so a test can say what actually happened
      // rather than claim a single clean hit.
      return i;
    } catch {
      /* the board may not have drawn the target yet; try again */
    }
  }
  // Software rendering can push a handler past every window above while the
  // click was perfectly good. Give it one last chance before calling it lost,
  // so the caller does not report a failure that never happened.
  try {
    await landed(grace);
    return attempts;
  } catch {
    return 0;
  }
}

/** Convenience: wait until the client has sent at least `n` actions. */
export async function waitForActions(page, n, timeout = 5000) {
  await page.waitForFunction((count) => window.__sent.length >= count, n, {
    timeout,
    polling: 50,
  });
  return sentActions(page);
}
