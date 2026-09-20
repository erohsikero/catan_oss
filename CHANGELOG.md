# Changelog

## v0.1.0

First playable build.

**Rules.** The complete base game: snake-draft setup, production with the
bank-shortage rule, the robber and forced discards, all five development cards
with the one-per-turn and not-the-turn-you-bought-it restrictions, harbour
trade rates, player-to-player trades, and both awards. Longest Road is an
exact longest-trail search, so branches, loops and routes cut by an opposing
settlement all score correctly.

**Multiplayer.** An authoritative websocket server. Clients send intentions
and receive redacted views: opponents' hands, the development deck order and
the RNG state never reach the wire. Rooms carry four-letter codes and optional
passwords. A dropped socket holds its seat for two minutes while bots cover
its turns, and reconnecting with the stored token restores it mid-game.

**Turn clock.** Every step is budgeted separately. Completing a trade buys
extra time, and each player holds a personal reserve spent automatically
before any move is forced. When time is truly gone the server rolls or passes
— it never spends your resources on a build you did not ask for.

**Board.** A 3D scene with no downloaded assets: terrain painted into canvases
at load time with normal maps derived from the height field, models built from
primitives, an animated sea, and a pre-filtered procedural sky for reflections.

**Testing.** 43 tests, including 24 complete bot-vs-bot games asserting
resource conservation, development-deck conservation, piece counts, the
distance rule and single award holders after every individual action; an
end-to-end game over real websockets; and a clock check where a connected
client does nothing at all and the server drives the game correctly.

### Known gaps

- Graphics are procedural and good, but short of a hand-authored art pipeline.
  See `docs/ROADMAP.md`.
- Web only. The server and protocol are already platform-neutral.
- One game type. The engine is shaped like a module but not yet behind a
  module interface.
- No accounts, persistence, ratings or replays; state lives in server memory.
