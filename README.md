# Forward Two

An open-world river game for the browser. Paddle the Long Water from Tarn
Spring in the mountains, over the High Falls, through the Meadows and the
Gorge, across Mirror Lake and out to the sea at Saltmouth. Run rapids on the
guide's call, carry cargo between camps, race the buoyed courses against other
paddlers' ghosts, and share the river with whoever else is on it.

Forward Two is the sequel to [Forward One](https://github.com/McElyea/forward-one)
by Jon McElyea. It keeps Forward One's guide calls and timing gate, and opens
the map: travel is the game, and rhythm is how you get through the hard water.

**Play it:** <https://forward-two.play.danielstephenson.dev> (desktop or phone)

![The raft on the Long Water in the evening](docs/media/river.png)

| | |
|---|---|
| ![Running the Throat, the class V heart of the gorge](docs/media/rapids.png) | ![The High Falls](docs/media/falls.png) |
| **The Throat.** Class V whitewater in the gorge, run on the guide's calls. | **The High Falls.** Sixteen metres. Run it or carry round. |
| ![Mirror Lake in the morning](docs/media/lake.png) | ![Meadow Fork camp at night](docs/media/night-camp.png) |
| **Mirror Lake.** Open water, a lone pine island, and race buoys. | **Camps at night.** Campfires and lanterns; fireflies over the meadows. |
| ![Ashore at a camp](docs/media/ashore.png) | ![Saltmouth and its lighthouse at dusk](docs/media/saltmouth.png) |
| **Ashore.** Step off at a camp and walk: the fire, the job board, the boat rack, the shuttle truck. | **Saltmouth.** The town where the Long Water meets the sea. |

<p align="center"><img src="docs/media/map.png" width="560" alt="The map of the Long Water, with camps and landmarks found and the fog lifted where you've paddled"></p>
<p align="center"><em>The map: camps, landmarks and rivers, with the fog lifting where you've been.</em></p>

## New in 0.2.0

| | |
|---|---|
| ![The raft and its crew of four on Mirror Lake](docs/media/0.2.0/boat-raft.jpg) | ![The kayak](docs/media/0.2.0/boat-kayak.jpg) |
| **The raft** and its crew, who paddle with your strokes. | **The kayak**, a decked boat with a spray deck. |
| ![The canoe](docs/media/0.2.0/boat-canoe.jpg) | ![The dory](docs/media/0.2.0/boat-dory.jpg) |
| **The canoe**, with seats and cargo. | **The dory**, on its oars with two passengers. |
| ![A swim beside the upturned raft](docs/media/0.2.0/swim.jpg) | ![Saltmouth Light restored at dusk](docs/media/0.2.0/light.jpg) |
| **A swim.** Two strokes to climb back in. | **Saltmouth Light,** restored in four stages with your pay. |
| ![A lantern on the boat at night](docs/media/0.2.0/lantern.jpg) | ![The coach in the first minutes](docs/media/0.2.0/coach.jpg) |
| **Night on the river,** with a lantern on your boat. | **The coach** for your first five minutes. |
| ![The River Journal: what next, standing, Wren's letters and river finds](docs/media/0.2.0/journal.jpg) | ![The Gear tab at a camp](docs/media/0.2.0/gear.jpg) |
| **The journal:** what next, your rank, Wren's letters and river finds. | **Gear** at any camp: Patch Kit, Dry Bags, Long Paddle, Chart Case, Spray Deck. |
| ![In a rapid, with a river find and a new camp announced](docs/media/0.2.0/rapid-calls.jpg) | ![A phone held sideways, with the signals fanned out](docs/media/0.2.0/phone.jpg) |
| **In a rapid,** hitting the calls; finds and camps are announced as you pass. | **On a phone held sideways:** big stroke buttons and signals. |

**Then and now:**

| 0.1.0 | 0.2.0 |
|---|---|
| ![Whitewater in 0.1.0](docs/playtests/0.2.0/visuals/before/rapids.jpg) | ![Whitewater in 0.2.0](docs/media/rapids.png) |
| ![The raft in 0.1.0](docs/playtests/0.2.0/boats/before-raft-close.jpg) | ![The raft in 0.2.0](docs/playtests/0.2.0/boats/after-raft-close.jpg) |

More stills, before and after, are in each lane's notes under
[docs/playtests/0.2.0/](docs/playtests/0.2.0/).

## Play

- **Flat water:** paddle where you like. `W`/`↑`/`Space` forward, `S`/`↓`
  back, `A` `D` or `←` `→` to turn. On a phone, use the big buttons; a
  gamepad works too. New players get a coach for the first few minutes.
- **Rapids:** the guide calls *Forward, Back, Left, Right* on the beat. Hit
  each call as its marker reaches the gate. Clean strokes keep your line and
  fill the flow meter. Misses hit the rocks, and too many put you in the river.
- **Camps:** `E` steps you ashore and you can walk anywhere on land (`WASD`,
  `Shift` to run, or hold ▲ on a phone; drag to look). Walk to the fire to
  rest, the job board for deliveries, the boat rack to change boats and buy
  gear, the truck to shuttle to any camp you've found, and the dock to get
  back in the boat.
- **Goals:** the line under the place name says what to do next: your job,
  or the next of Wren's letters from Saltmouth Light. Earn ranks from your
  journal, find what the river hides, and help restore the light.
- **Multiplayer:** everyone on the river is in the same world. You see other
  paddlers live, can start group races at a course's start buoy (`R`), and race
  the best ghosts on each course's online board.
- `M` map, `J` journal, `Tab` who's on the river, `1` `2` `3` wave, flare,
  bell, `C` free camera, `H` the controls.

## Run it locally

The game is static files plus a prebuilt engine (`web/engine/`), so any static
server works. The bundled server also hosts multiplayer
(the live game uses the relay at `forward-two-api.play.danielstephenson.dev`):

```sh
node server/main.js --static web --port 8790   # Node 22, no npm install
```

Then open <http://localhost:8790>. Useful URL options: `?world=small` (a
lighter world for phones), `?seed=N`, `?hour=6.5`, `?new=1`, `?skip=1`, `?server=<url>` (a different relay) or `?server=off` (offline),
`?detail=0`-`2` (spray, foam, pixel ratio and, at 0, a thinner forest),
`?coach=0` or `?coach=1` (skip or replay the coach) and `?perf=1` (load and
frame timings).

The game picks the world and detail from the device (touch screen, memory,
cores, data saver) and remembers a device that was too slow, so its next
visit starts lighter; `?world=` overrides that. Saves are checked when they
load, backed up once a session (`f2.save.v1.bak`), and a damaged save is
restored from the backup and kept aside (`f2.save.v1.corrupt`), never deleted.
"Start over" keeps the old save in `f2.save.v1.prev`, and a save from a newer
version of the game is never overwritten.

`tools/readme-shots.cjs` regenerates the stills above from a running server.

## How it's built

- **Engine:** [Strata](https://github.com/Preponderous-Software/strata) 0.10.0
  through its web kit. `engine/bridge.cpp` is a small host that draws whatever
  the page hands it: terrain, meshes, textures and per-frame rows.
  `tools/build-engine.sh` rebuilds `web/engine/` (emsdk 6.0.11).
- **Game:** plain ES modules under `web/src/`, with no build step. World
  generation (`world/`) and simulation (`sim/`) never touch the DOM, so the
  tests run them directly.
- **Multiplayer:** `server/` is a dependency-free Node service. It runs live
  rooms (other boats, emotes, group race starts) and stores ghosts and boards.
  With no server, the game keeps ghosts and times on the device.

The design is in [docs/rfc/0001-forward-two.md](docs/rfc/0001-forward-two.md).

```sh
npm test    # node --test
```

## License

MIT; see [LICENSE](LICENSE). Strata's web-kit scripts in `web/engine/` are MIT
(Strata). The guide's voice is generated with Kokoro-82M (Apache-2.0); see
`web/audio/guide/LICENSE.md`.
