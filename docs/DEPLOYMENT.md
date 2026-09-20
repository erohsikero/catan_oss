# Deployment and the single-engine architecture

How one rules engine serves every client and every environment, what it takes
to run it for real people, and what has to change to reach the visual target.

The guiding constraint throughout: **the engine is the only place that knows
the rules, and it runs on the server.** Everything else — web, mobile, a
native client, a bot, a replay viewer — is a consumer of the same protocol.
Every decision below is downstream of keeping that true.

---

## Part 1 — Can we reach the target in three.js?

### The honest answer

Yes, and the engine is not what is standing in the way.

Catan Universe is a Unity project whose WebGL build is one of five targets
from one codebase. But the thing we are actually comparing ourselves to — the
warm, soft, seated look — is **authored art with baked lighting**. Artists
model the pieces and paint the textures; the ambient occlusion and soft
shadowing are computed offline and stored in texture maps. None of that is an
engine feature. three.js renders baked lightmaps, PBR materials, compressed
textures and glTF models perfectly well.

What we are missing is a **pipeline**, not a renderer:

| They have | We have | Gap |
| --- | --- | --- |
| Modelled assets | Merged primitives | Needs Blender and an artist |
| Baked AO and lightmaps | Runtime lights only | Needs a bake step |
| Per-platform compressed textures | Runtime-painted canvases | Needs KTX2 |
| Atlased draw calls | Per-tile materials | Needs atlasing, once there is more to draw |
| A tuned post chain | Bloom, grading, contact shadows (shipped) | Ambient occlusion still to verify |

A board game is close to the easiest case a 3D engine ever gets: a static
scene, a few hundred objects, no physics, no skinned animation, a fixed
camera envelope. We are nowhere near three.js's ceiling.

### When Unity would actually be the right call

Not "if we want it to look better" — for these reasons only:

- **Native iOS and Android with maximum fidelity is the priority**, and a
  webview is judged not good enough after being tried.
- **An art team wants an editor.** Unity's real advantage here is the
  authoring loop and its lightmapper, not its renderer.
- **Console or Steam** becomes a target.

What it costs, stated plainly: the rules engine is TypeScript. Unity is C#.
You would either reimplement the engine (two implementations of the rules is
the worst outcome available — they will diverge, and the bugs will be
invisible), run it as WASM behind a bridge, or keep it server-only and make
the Unity client a pure view. **Only the third is acceptable**, and it is
already the architecture we have, which is the point: a Unity client can join
the same match tomorrow without the server changing, because the protocol is
the contract.

**Recommendation: stay on three.js and buy the pipeline.** Revisit only
against the three criteria above, and never in the middle of a feature.

### The asset pipeline, concretely

This is the work that closes the visual gap. It belongs in the repo as
scripts, not as folklore in an artist's head — otherwise every re-export is a
hand operation and the build stops being reproducible.

```
art/                      Blender sources, committed
  tiles/*.blend
  pieces/*.blend
  props/*.blend
scripts/build-assets.mjs  headless Blender -> glb -> optimise -> public/
packages/client/public/models/*.glb    generated, gitignored
```

Stages:

1. **Model** in Blender. Low-poly, hard-surface, bevelled edges — bevels are
   most of why authored pieces read as solid: they catch a highlight along
   every edge.
2. **Bake** ambient occlusion and, for the tiles, a full lightmap. This is the
   single step that produces the look. Blender's Cycles baker runs headless
   from a script, so it is CI-able.
3. **Export** glTF 2.0 binary (`.glb`).
4. **Optimise** with `gltf-transform`: Draco or meshopt for geometry, and
   **KTX2 / Basis Universal** for textures. KTX2 is the web's answer to
   Unity's per-platform texture compression — one file transcodes to ASTC,
   ETC2 or BC on the device, so a phone gets a format its GPU reads natively
   instead of decompressing a PNG into memory.
5. **Load** with `GLTFLoader` + `KTX2Loader` + `MeshoptDecoder`.

Licensing matters here and is easy to get wrong. The whole point of the
current procedural art is that it is unambiguously ours. Replacements must be
either commissioned with rights assigned, or CC0 — and the licence recorded
per asset in `art/CREDITS.md`, not assumed.

### Graphics slices

- **G1 — Post-processing.** *Shipped.* Bloom, grading, vignette, tone mapping
  moved into the composer, behind quality tiers.
- **G2 — Contact shadows.** *Shipped.* Baked once per board change.
- **G3 — Verify ambient occlusion on a GPU.** Implemented and opt-in;
  measured as doing nothing on a software renderer. One line of detection
  changes once it is confirmed.
- **G4 — Bake occlusion into the terrain textures.** We already generate a
  height field per terrain and derive normals from it; an occlusion term
  falls out of the same data and needs no artist.
- **G5 — Asset pipeline skeleton.** `build-assets.mjs`, KTX2 and meshopt
  loaders wired, one real `.glb` replacing one primitive, end to end. Do this
  with a single placeholder asset *before* commissioning anything, so the
  pipeline is proven before the art budget is spent.
- **G6 — Authored tiles and pieces.** The art project proper.
- **G7 — Atlasing and draw-call work,** against a profile, once G6 has made
  the scene heavy enough to need it.

---

## Part 2 — One engine, every client

```
                     ┌──────────────────────────┐
                     │  @hexhaven/shared        │
                     │  rules · protocol · bots │   one source of truth
                     └───────────┬──────────────┘
                                 │ imported by
              ┌──────────────────┴───────────────────┐
              │                                      │
      ┌───────▼────────┐                     ┌───────▼────────┐
      │  game-server   │◄─── websocket ─────►│  web client    │
      │  authoritative │      (protocol)     │  three.js      │
      └───────┬────────┘                     └────────────────┘
              │                                      ▲
              │        the protocol is the contract  │
              │                                      │
              │   ┌──────────────┐   ┌───────────────┴──┐
              └──►│ mobile shell │   │ native client    │
                  │ (Capacitor)  │   │ (Unity, later)   │
                  └──────────────┘   └──────────────────┘
```

The client imports the engine only for things that are **derived from public
state** — highlighting legal placements, previewing a cost. It never decides
anything. That is enforceable in review with one question: *if a modified
client sent this, would the server still be correct?*

---

## Part 3 — Environments

Four, each with a job:

| Environment | Purpose | Data | Deploys |
| --- | --- | --- | --- |
| **local** | development | Docker Compose Postgres | n/a |
| **preview** | one per pull request | ephemeral, seeded | automatic on push |
| **staging** | release rehearsal, load tests | anonymised | automatic from `main` |
| **production** | real players | real | promoted from staging |

Preview environments matter more than usual here: this is a multiplayer game,
and the only honest way to review a gameplay change is for two people to open
the same branch and play it.

### The problem that shapes everything: rooms are stateful

A websocket game server holds live games in memory. Two consequences:

**Scaling.** A room cannot be load-balanced per request. Route by room code
with sticky sessions, so a room lives on exactly one instance. Rooms are
small and independent, so this scales horizontally a long way before it needs
anything cleverer. Redis pub/sub only earns its place when a *single* room
must span instances, which for a four-player board game it never does.

**Deploys.** Today a deploy ends every game in progress. That is the real
ceiling on running this for other people, and it is why persistence is the
first slice rather than a later nicety:

1. Persist state after every action. A game is a few kilobytes, and the
   engine already produces a clean serialisable snapshot.
2. On boot, rehydrate live rooms from the store.
3. On deploy: stop accepting new rooms, snapshot, drain, let the new instance
   rehydrate.

The engine's seeded RNG makes this cheaper than it sounds. A game is fully
described by its seed plus its action log, so the snapshot can be a log
rather than a state dump, and the same log gives replays and server-side
verification for free.

### Runtime topology

```
        CDN (static client, immutable hashed assets)
                        │
   ─── HTTPS/WSS ───►  edge / load balancer  ── sticky by room code
                        │
              ┌─────────┴─────────┐
              │  game-server × N  │  stateless boot, stateful rooms
              └─────────┬─────────┘
                        │
          ┌─────────────┼──────────────┐
      Postgres       (Redis)      object storage
      games, users   presence     replays, assets
```

Redis is in brackets deliberately: do not add it until presence across
instances is an actual requirement.

### Configuration

Twelve-factor, and validated at boot by a typed config module that **fails
fast and loudly** on anything missing. A server that starts with a silently
absent `DATABASE_URL` and falls back to memory is how a Friday becomes a
weekend.

| Variable | Purpose |
| --- | --- |
| `PORT` | listen port |
| `DATABASE_URL` | Postgres |
| `NODE_ENV` | `development` / `production` |
| `HEXHAVEN_BOT_THINK_MS` | bot pacing; `0` in tests |
| `PUBLIC_WS_URL` | when the client is hosted separately |
| `SENTRY_DSN` | error reporting, optional |
| `LOG_LEVEL` | structured log verbosity |

### Pipeline

**On every pull request:** case-collision check → typecheck → engine tests →
build → websocket smoke test → preview deploy.

**On merge to `main`:** build and push one image → migrate staging →
deploy staging → smoke → hold for promotion → migrate production → deploy
with drain → smoke.

One image is promoted through the environments. It is never rebuilt per
environment; that is how staging and production quietly diverge.

### What to watch

Health alone is not enough — a server can be healthy and the game still
broken. Worth a dashboard:

- rooms live, players connected, games started and finished per hour
- **rejected actions by error code** — a spike means a client and the server
  disagree about the rules, which is the failure mode that matters most here
- **forced moves per game** — a spike means the clock is too aggressive, or
  people are disconnecting
- action apply latency (p50/p99), reconnects, bot substitution rate

### Deployment slices

- **D1 — Persistence.** Postgres, schema, snapshot on action, rehydrate on
  boot. Unlocks everything else; without it no deploy is safe.
- **D2 — Config module and health probes.** Typed, fail-fast config;
  `/healthz` (alive) separated from `/readyz` (has a database, ready for
  traffic). Small, and everything after depends on it.
- **D3 — Graceful drain.** Handle `SIGTERM`: stop new rooms, snapshot, close
  sockets with a code the client understands as "reconnect shortly".
- **D4 — Compose for local and CI.** Server plus Postgres, one command,
  identical in both.
- **D5 — CI to staging.** Build once, migrate, deploy, smoke.
- **D6 — Preview environments per pull request.**
- **D7 — Sticky routing and horizontal scale.** Only when one instance is
  actually the limit — measure first.
- **D8 — Observability.** Structured logs, the metrics above, error tracking.
- **D9 — Backups and restore rehearsal.** A backup nobody has restored is a
  hypothesis, not a backup.

---

## Part 4 — Suggested order

Dependencies, not preferences:

1. **D1, D2, D3** — persistence, config, drain. Until these land, every
   deploy is an outage for anyone mid-game.
2. **D4, D5** — Compose and CI to staging. Makes everything after repeatable.
3. **G3, G4** — verify AO on real hardware; bake occlusion into the terrain.
   Cheap, and independent of the platform work.
4. **G5** — the asset pipeline skeleton, with one placeholder model. Prove
   the pipeline before spending the art budget.
5. **P-series** (see `ROADMAP.md`) — accounts, then touch and mobile shells.
6. **G6** — commission the art, against a pipeline that already works.
7. **E-series** — the module seam and a second game.
8. **D6–D9** — previews, scale, observability, as usage justifies each.

## What is needed from outside this environment

Nothing above is blocked on tooling except where noted:

- **A GPU** to verify G3. Everything else in the graphics list is code.
- **Docker daemon** to build and run the image rather than replaying the
  Dockerfile step by step.
- **Blender** for G5 onwards; it runs headless and scripts cleanly, so it fits
  CI once available.
- **A Postgres instance** for D1, or permission to develop against Compose.
- **An artist or a CC0 asset pack** for G6 — the only item on this list that
  code cannot substitute for.
- **A Mac with Xcode** for the iOS shell. Android needs only the SDK.
