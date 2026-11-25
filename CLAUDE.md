# Forward Two: notes for Claude

An open-world 3D river game on Strata's web kit. Plain ES modules, no build
step, no npm install for the game or the server. Read `README.md`,
`docs/rfc/0001-forward-two.md` and `CHANGELOG.md` first.

## Layout

- `web/` is the whole game (static files). `web/engine/` is the prebuilt
  Strata engine (`tools/build-engine.sh` rebuilds it from `engine/bridge.cpp`
  with emsdk 6.0.11; emsdk needs Python 3.10 or newer, and `emsdk_env.sh`
  unsets `EMSDK_PYTHON`, so set it before and after sourcing). The build is
  reproducible: an unchanged bridge rebuilds byte for byte. New bridge exports
  must be added to the export list in `tools/build-engine.sh`.
  `web/engine/strata-kit.js` is Strata's kit with one local fix: `kit.pan`
  used a mirrored screen-right. Keep the fix when updating the kit until
  Strata ships it.
- Big static meshes are passed with a rebuild function (`bridge.mesh(m, rebuild)`),
  so the engine keeps no copy of them; after a lost WebGL context
  `game.onRestore()` rebuilds them (the forest from the seed, in the world worker).
- `web/src/world/` builds the valley (pure; runs in a Worker via
  `world/worker.js`, on the main thread if the worker fails).
- `web/src/sim/` boat physics and rapids (pure).
- `web/src/game/` the Game, places, jobs, journal, races, `camera.js`,
  `coach.js` (first-minutes coach and nudges), `progress.js` (ranks, gear,
  Wren's letters, river finds, the lighthouse), `save.js` (localStorage, see
  below) and `perf.js` (device tier).
- `web/src/render/` the bridge, static meshes (`meshes.js`), boats and crew
  (`boats.js`, `crew.js`) and water, spray and light effects (`effects.js`).
- `web/src/net/` the live client (`net.js`), ghost codec, remote boats.
- `web/src/ui/` HUD, input, panels, `badges.js` (journal badge art),
  `errors.js` (friendly error screens).
- `server/` the dependency-free Node relay: WebSocket rooms, group races,
  the ghost/board HTTP API. It imports `web/src/game/courses.js` to
  gate-check ghosts.

`world/` and `sim/` must never touch the DOM: the tests import them directly.

## Test

```sh
npm test            # node --test tests/*.test.js, ~5 s, Node 22
```

- `tests/save.test.js` covers save integrity; add a test for every new save
  field or recovery path.
- `tests/server.test.js` runs a real relay on an ephemeral port with raw
  WebSocket clients; `tests/net.test.js` drives the client with a fake socket.
- CI (`.github/workflows/ci.yml`) also boots the game in headless Chromium
  with `tools/shot.cjs` and fails on any `pageerror`.

## Run

```sh
node server/main.js --static web --port 8790          # game + relay together
python3 -m http.server 8834 --bind 127.0.0.1 --directory web   # game only
PORT=8794 HOST=127.0.0.1 F2_DATA=/tmp/f2-data node server/main.js  # relay only
```

URL options: `?world=small|full|tiny`, `?detail=0-2`, `?seed=N`, `?hour=6.5`,
`?new=1`, `?nosave=1`, `?skip=1` (no title card), `?coach=0|1`, `?server=ws://127.0.0.1:8794`
or `?server=off`, `?room=name`, `?perf=1` (timings overlay), `?fps=1` (the
kit's frame stats), `?quality=0-2` (pins the kit's tier), `?drive=1` (no
animation loop; tools call `__strataKit.drive(t)`), `?meshcopy=1` (the engine
keeps its old wasm copy of every mesh). Never point a dev build at
the hosted relay; use a local one.

## Headless playtests

Install Playwright where you like and point `NODE_PATH` at it. Use
`?drive=1` and `canvas.toDataURL` for stills (`page.screenshot` hangs with
SwiftShader); on a busy box, step the sim by hand rather than rely on the
render loop. Serialise headless runs on a shared box (for example
`flock <lockfile> timeout 900 <cmd>`), keep them on the small or tiny world,
and put evidence in `docs/playtests/<version>/<lane>/`.

## Saves (the owner's #1 fear)

`f2.save.v1` must never be corrupted or lost. `game/save.js` validates on
load (`normalizeSave`), keeps unknown fields, snapshots the session's
starting save to `f2.save.v1.bak`, keeps unreadable text in `.corrupt`,
moves "Start over" saves to `.prev`, reads every write back, and writes on
`pagehide`. Some loads make the session read-only (`save.readOnly`): a save
from a newer version (kept in `.newer`), a damaged save that couldn't be
copied aside, or a 0.1.0 save from another seed whose slot is taken; a
read-only session never writes. New fields: add them to `Save.data()`/`apply()`, default them
when missing, and add a test. Other seeds save under `f2.save.v1.s<seed>`.

## Conventions

- British spelling in player-facing text ("colour"), plain words, no emoji.
- Keep the relay dependency-free; validate every client message in
  `server/validate.js` and strike, never throw.
