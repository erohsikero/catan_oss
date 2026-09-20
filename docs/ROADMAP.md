# Roadmap

Three questions, answered in the order they block each other: how to close the
visual gap, how to reach phones, and how to become a platform that hosts more
than one game.

Each section ends with slices that are independently shippable. None of them
requires finishing the one before it, but the ordering within a section is the
order in which the work gets cheaper.

---

## 1. Closing the graphics gap

### What the reference actually does

Catan Universe is a Unity project, originally built for PC and WebGL with
mobile added later, and the mobile port needed serious optimisation work —
Exozet took it from about 2 FPS to 50–60. That history tells you where the
cost sits in a board game like this, and the techniques they reached for are
the standard ones: texture atlases, baked lighting, and draw-call reduction.

The important thing is not any single technique. It is that **their art is
authored and then baked**. Artists model the tiles and pieces, paint the
textures, and the lighting is precomputed into lightmaps rather than
calculated each frame. The warm, soft, slightly storybook look is the *bake* —
ambient occlusion in every crevice, soft contact shadows, and a graded
palette, all resolved offline where there is no frame budget to respect.

Our board is the opposite: everything is generated at runtime from noise and
primitives. That is why it is asset-free and original, and it is also exactly
why it reads flatter. We have albedo, normal and roughness; we have no
occlusion, no bake, and no post-processing.

### Where the difference actually shows

Ranked by how much each one costs us, not by how hard it is to fix:

1. **No ambient occlusion.** Nothing darkens where surfaces meet. Tiles look
   laid on top of each other rather than seated together, and props look like
   stickers rather than objects standing on ground. This is the single largest
   perceptual gap and it is also the cheapest to fix.
2. **No post-processing.** No bloom on the sea's specular, no colour grading,
   no vignette. The scene is rendered but never *photographed*.
3. **Primitive geometry.** Our pieces are merged cylinders and boxes. Theirs
   are modelled, with bevels catching light along every edge.
4. **Flat material response.** One roughness map and no detail textures, so
   surfaces look uniform at close range.
5. **No baked shadow contact under pieces.** Real-time shadows alone leave
   pieces looking like they hover at their base.

### Slices

- **G1 — Post-processing pass.** `EffectComposer` with SSAO, bloom and colour
  grading. This is the biggest visual return per hour of work in the whole
  list, and it needs no art. It costs frame time, so it wants a quality
  toggle that drops it on weak hardware.
- **G2 — Contact shadows.** A cheap darkened gradient decal under every
  settlement, city, road and prop. Fakes what a lightmap would give, costs
  almost nothing, and fixes the "hovering" problem immediately.
- **G3 — Bake occlusion into the terrain textures.** We already generate a
  height field per terrain and derive a normal map from it. An occlusion term
  falls out of the same data — sample the neighbourhood, darken the pits —
  and feeds `aoMap`. Still no downloaded assets.
- **G4 — Rim darkening on tiles.** Mask the terrain albedo towards the hex
  edge so neighbouring tiles read as separate objects rather than a
  continuous surface.
- **G5 — Authored models.** Replace the primitive pieces and props with GLTF
  assets. This is the one slice that genuinely needs an artist or a licensed
  asset pack; everything above is code. It is also the slice that finally
  closes the remaining distance, so it is worth budgeting for rather than
  approximating forever.
- **G6 — Performance work, once there is more to draw.** Texture atlasing and
  further instancing, in that order, and only against a profile. Our current
  scene is well inside budget; adding this before G5 would be optimising
  nothing.

G1 to G4 are code and can land without changing the art direction. G5 changes
what the game is made of, and should be costed as an art project.

---

## 2. One match, every platform

### What makes cross-play work

Catan Universe compiles a single Unity codebase to PC, macOS, iOS, Android and
the web, and every target talks to one authoritative server. Cross-play is not
a feature they added; it is what falls out of having one client and one
authority.

**We already have the harder half of this.** The rules engine is pure
TypeScript with no I/O. The server is authoritative and validates every
action. The protocol is plain JSON over a websocket. Nothing in the server or
the engine knows or cares what a client is written in — so a native client, a
web client and a bot can already sit at the same table. The remaining question
is only what to run on a phone.

### The three honest options

| Approach | Reuse | Visual ceiling | Cost |
| --- | --- | --- | --- |
| **Web client in a native shell** (Capacitor) | Everything | WebGL in a system webview — good, not native | Low |
| **React Native with a GL binding** | Engine and UI logic, not the renderer | Awkward; the three.js integration is the weak point | Medium |
| **Native client** (Unity or Godot) against the same server | Engine must be reimplemented or run via WASM | Highest | High |

The recommendation is the first, and the reason is not just cost: because the
protocol is the contract rather than the code, choosing it now does not
foreclose the third later. A Unity client could join matches alongside web
clients without the server changing at all. That option stays open only as
long as no game logic leaks into the client, which is worth defending in
review.

### Slices

- **P1 — Make the web client a real installable app.** Manifest, service
  worker, offline shell, icons. Cheap, and it makes the next slices testable.
- **P2 — Touch and small screens.** This is the substantial one. Orbit and
  pinch-zoom on the board, hit targets sized for a thumb rather than a mouse,
  a portrait layout that does not bury the hand behind the board, and safe-area
  insets. Most of the work is the HUD, not the 3D.
- **P3 — Capacitor shells for iOS and Android.** Native splash, status bar,
  back-button handling, store metadata.
- **P4 — Real accounts.** Today identity is a token in local storage, which
  does not survive a reinstall and cannot follow a player between their phone
  and their laptop. Cross-device play needs an actual account before it needs
  anything else.
- **P5 — Push notifications for "your turn".** The single feature that makes
  asynchronous mobile play work at all. It depends on P4.
- **P6 — Store pipeline.** Signing, CI builds, TestFlight and Play internal
  testing.

P4 is worth pulling forward. It is listed fourth because it is not visible,
but every social feature later — ratings, friends, resuming on another device
— is blocked behind it.

---

## 3. Becoming a platform, not a game

### How the model works

Board Game Arena hosts hundreds of games on one set of shared services:
accounts, a lobby, matchmaking, ratings, chat, replays, tournaments and
moderation. Each game is a module implementing a common contract. The platform
knows nothing about any game's rules; a game knows nothing about accounts.

The reason it scales is that the seam is narrow. Everything a game must
provide is state, a validated transition, a per-player view, and a notion of
being over.

### We are closer to this than it looks

The current `shared` package already exposes exactly that shape, because
keeping the engine free of I/O forced it to:

| Platform needs | We already have |
| --- | --- |
| Create a game | `createGame(id, seed, settings)` |
| Validate a move | `applyAction(state, settings, playerId, action, now)` |
| Per-player view | `viewFor(state, playerId, options)` |
| Fill empty seats | `botAction(state, settings, playerId)` |
| Handle a timeout | `forcedAction(state, playerId, pick)` and `clockFor(...)` |
| Know it ended | `state.phase === 'ended'`, `state.winner` |

That is a `GameModule` interface with the names already chosen. Extracting it
is mechanical rather than a redesign.

One asset worth calling out: the engine's RNG is seeded and every action is
validated server-side, so a game is fully described by its seed plus its
action log. **Replays, spectating and server-side verification are nearly free
consequences of that**, and they are expensive to retrofit into an engine that
did not start deterministic. Any second game added to this platform should be
held to the same rule.

### Slices

- **E1 — Extract the `GameModule` interface** and have Hexhaven implement it.
  No behaviour changes; the win is that the seam becomes explicit and the
  compiler starts enforcing it.
- **E2 — Make `Room` generic over a module,** with a registry keyed by game
  id. The server stops importing Hexhaven directly and holds opaque state.
- **E3 — Lobby by game type.** Choosing a game becomes a lobby concept rather
  than an assumption.
- **E4 — Persistence.** Postgres for accounts, finished games and the action
  log. Until this lands, a server restart ends every game in progress, which
  is the real ceiling on running this for other people.
- **E5 — A second game.** Something small and rules-light, chosen to prove the
  seam rather than to be impressive. If adding it requires changing the
  interface, the interface was wrong, and finding that out on a small game is
  the entire point.
- **E6 — Platform services.** Ratings, matchmaking, friends, tournaments.
  These are only worth building on top of a seam that two games have already
  tested.
- **E7 — Replays and spectating,** from the seed and action log.

E5 before E6 matters. It is tempting to build the ratings and matchmaking
first because they feel like the platform, but an abstraction validated by a
single implementation is a guess.

---

## Suggested order across all three

If the goal is a hosted product other people use, the dependency chain runs:

1. **E4 (persistence)** — without it, a deploy ends every game in progress.
2. **P4 (accounts)** — everything social is blocked behind identity.
3. **G1–G2 (post-processing, contact shadows)** — the cheapest large
   improvement to how the game feels, and independent of everything else.
4. **P2 (touch and small screens)** — most players arrive on a phone.
5. **E1–E3 (the module seam)** — before a second game, not after.
6. **G5 (authored art)** — budget it as an art project rather than approximating.
