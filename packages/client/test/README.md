# Browser tests

Three checks that need a real browser, because the bugs they cover are
invisible to everything else: the engine accepted the actions perfectly well,
and only a real click showed that the thing offering them could not be hit.

They are run on demand rather than in CI — they need a browser and a running
server, and the slowest plays a real game.

```bash
npm run build
PORT=8081 HEXHAVEN_BOT_THINK_MS=0 node packages/server/dist/index.js &

export BASE=http://127.0.0.1:8081
export CHROME_PATH=/path/to/chrome      # any Chromium build

node packages/client/test/projection.mjs    # ~10s
node packages/client/test/click-guard.mjs   # ~15s
node packages/client/test/city-upgrade.mjs  # ~5min, plays a real game
```

**Kill the server when you are done.** These leave nothing behind themselves,
but a forgotten `node packages/server/dist/index.js` will sit there for ever.

## How they find things on the board

They do not search for it. An earlier version clicked a grid of up to 260
screen positions and checked the game state after each one — about forty
seconds per lookup, and the opening alone needs four.

Instead `harness.mjs` projects a target's world position through the scene's
own camera, read from `src/three/camera.json` so a camera change cannot
silently leave the tests clicking empty sea. One click instead of hundreds.

Two things the harness has to allow for, both learned the hard way:

- **The HUD floats over the canvas**, so a corner near the bottom of the
  screen can project onto the action bar. `clickableTarget` picks a target
  whose pixel actually reaches the canvas. Without it a test fails looking
  exactly like a broken projection.
- **A turn arriving is not the same instant as the board being drawn.** The
  state comes over the websocket; the highlights appear a frame or two later.
  `clickUntilAction` retries briefly rather than sleeping for a guessed
  interval.

Game state comes from tapping the websocket in the page before the app loads.
The application has no test hooks in it and does not know it is being
watched.

## What each one is for

| Test | Covers |
| --- | --- |
| `projection.mjs` | The harness itself: a computed pixel hits the corner it aimed at. Fails fast and legibly if the camera changes. |
| `click-guard.mjs` | A burst of clicks sends exactly one action, and the board still responds afterwards. |
| `city-upgrade.mjs` | Upgrading a settlement by clicking it — the bug that started all of this. Trades at the bank so it does not depend on the opening producing ore. |
