# RFC 0001: Forward Two, an open-world river game on Strata

- Status: Accepted (2026-11-22)
- Authors: drafted by Claude on behalf of Daniel Stephenson
- Sequel to: [Forward One](https://github.com/McElyea/forward-one) by Jon McElyea, who okayed the sequel

## Summary

Forward One is a whitewater survival racer: a guide calls *Forward!* or
*Back!*, the player strokes on the beat, and the river decides how long they
last. Forward Two keeps the river and the guide and opens the map. The player
gets a boat at the headwaters of a watershed, the Long Water, and can go anywhere
the water goes. That includes three rivers that join, a gorge, a lake, a delta and the sea. Travel is
the game. Rhythm is how you get through the hard water. Other paddlers share the
river, live or as ghosts.

The game is 3D, runs in the browser on [Strata](https://github.com/Preponderous-Software/strata)'s
web kit, plays on desktop and phone, and is MIT licensed.

## Motivation

- Forward One proves that the guide-call rhythm loop is fun, but every run is
  the same corridor. Players asked "what's downstream?". Forward Two answers that.
- Strata now has what an open world needs: 1025² terrain tiles, translucent
  and textured meshes, mesh transforms, a real sun, point lights and fog, and
  WebGL 2 with a loading shell and adaptive quality.
- Multiplayer in Forward One is a room of racers on one run. In an open world
  it can be more: you meet people on the river.

## Design pillars

1. **The river is the road.** Every place is reached by water, and current is
   the world's main force. Downstream is easy and fast. Upstream is work, done
   in eddies and on lakes. Portages and the shuttle truck are the only ways back up.
2. **Rhythm is how you get through hard water.** On flat water you steer
   freely. In a rapid the guide takes over the tempo. Calls (*Forward, Back,
   Left, Right, Hold*) come on a beat tied to the rocks and waves ahead, and
   hitting them keeps the line. The rhythm is one tool among several, not the whole game.
3. **Always something on the horizon.** A camp's smoke, a waterfall's mist, a
   race buoy, another paddler's lantern. The world tells you where to go next without
   a quest log.
4. **Other people make the river alive.** You see live players in real time. When
   nobody is online, ghosts of earlier runs race you. Nothing needs an account.
5. **Phone-first controls, 3D by default.** Touch has its own designed path
   (paddle buttons and a drag to steer) with the same features as the keyboard.

## The world: the Long Water

The world is generated from a seed, so the same seed always makes the same world.
Multiplayer depends on that: everyone in a room shares one seed, and the server never
sends terrain.

- **Terrain:** a 1025 × 1025 heightfield at 3 m spacing, about 3 km square.
  Mountains rise to the north and west, the land falls away to the south-east,
  and the sea fills the south-east corner. The heights are layered noise plus
  ridges, with valleys carved by the rivers.
- **Rivers:** sources sit high on the ridges. Each river traces downhill, the
  rivers join where they meet, and the flow gathered from upstream sets each
  stretch's width and depth. Each river is a polyline with a water level, a
  width, a speed and a *class* (I–V) at every node. The class comes from the
  slope and from where the river narrows. Steep drops become **waterfalls**, which you can
  run if you're bold or portage if you're sensible.
- **Regions:** the Headwaters (alpine, cold, narrow), the Gorge (class IV–V,
  cliffs), the Meadows (braided, gentle), the Lake (open water, wind), and the
  Delta and the Sea (reeds, the town).
- **Places:** about eight **camps** (rest, save, change boat, take jobs, see the
  shuttle), **landmarks** to discover (the Stone Arch, Old Mill, Hot Spring,
  Heron Rookery, the Sunken Bridge, the Falls, a lighthouse…), **race
  courses** (buoyed gates over a stretch), and **eddy pools** with collectibles.

## The boat and the water

- Boat physics is 2D on the water surface, with the height read from the river or lake level.
  The forces are the current (along the river's tangent, fastest mid-channel and
  slowing toward the banks), the paddle strokes (forward, back, and left or right
  sweeps), drag, and the bank (sliding along it, with damage at speed). The model
  is plain JavaScript (`web/src/sim/`) that never touches the DOM, so node tests run it directly.
- **Boats:** a raft (stable, forgiving), a kayak (fast, turns sharply, tippy), a
  canoe (carries cargo) and a dory (unlocked; heavy, fast in big water).
  Each has its own speed, turning, stability and cargo capacity.
- **Swimming:** too many hits or missed calls in a rapid flip the boat. The
  player then swims to the boat (the recovery calls from Forward One) or
  washes into the next eddy.

## Rhythm in rapids

When the boat enters a stretch rated class II or higher, the guide starts calling.
Calls are generated from the river ahead: a rock on the left gets *Right!*, a hole
gets *Forward!* (punch it), and a pour-over gets *Back!*. The beat speeds up with the
class. Each call shows as a marker sliding into a timing gate, as in Forward One.

- *Perfect* and *good* strokes give speed and stability. A miss means a hit and lost
  stability. Lose all of it and you swim.
- The strokes are real paddle strokes, so the boat moves on each beat. A well-run
  rapid is visibly the clean line.
- A **flow** meter builds over a clean streak. Full flow gives a burst of speed and
  a "line" bonus.
- On flat water the same keys paddle freely, with no timing.

## Things to do

- **Explore:** discovering a landmark adds an illustrated card to the
  **River Journal**. The map's fog clears as you travel.
- **Deliveries:** camps post jobs, such as carrying cargo to another camp before
  dusk. The pay buys boats and gear. Fragile cargo cares about hits.
- **Races:** buoyed courses with medal times. Each course keeps your best run as a
  ghost and races you against the top ghosts on the server.
- **The Descent:** the signature run, from the highest source to the sea in one
  go, with a split per region. It is the open world's "run" and the closest
  thing to Forward One.
- **Day and night:** a full day takes about 24 minutes. At night camps light
  lanterns, fireflies come out over the meadows, and the river is harder to read.
- **Shuttle:** from any discovered camp, the truck takes you back to any other
  discovered camp.

## Multiplayer

Forward Two runs two kinds of multiplayer at once. Neither needs an account.

### Live (shared river)

- A small Node service (`server/`) runs WebSocket rooms. A room is
  `{seed, name}`. A browser joins the default room unless it is told
  otherwise (`?room=`).
- Each client sends its boat state about 10 times a second (position, heading,
  speed, boat type, colour, name and emote). The server checks rates and value
  ranges and relays the states. Clients interpolate the other boats about 150 ms
  behind real time.
- **Group races:** paddlers at a course's start buoy can start a shared
  countdown. The server holds the start time and the finishing order.
- **Pings and emotes:** a paddle wave, a "follow me" flare, and a bell.
  There is no free-text chat, which removes the moderation surface.
- Names are chosen locally. The server limits their length and character set and keeps them to
  printable ASCII.

### Asynchronous (ghosts and boards)

- Every finished race and Descent produces a compact **ghost**: one sample
  every 100 ms, quantised and delta-encoded (about 2–6 KB). The client POSTs
  it to the server, which checks it (plausible speeds, the course's gates in
  order, a duration that matches the timestamps) before it ranks.
- Clients fetch the top N ghosts for a course and race them. Ghosts show as
  translucent boats with their name labels.
- **Offline first:** with no server, the game works the same with local ghosts
  and a local board (localStorage). The online parts appear when the
  server answers.

### Hosting

The static game ships to the arcade like every other Strata game. The multiplayer
service is a separate container (stdlib Node plus one small WebSocket
implementation), deployed behind Traefik. The game finds it from a
`<meta name="f2-server">` tag, or `?server=`. With neither, it runs offline.

## Architecture

```
engine/bridge.cpp      Strata web-kit host: terrain, meshes, textures, per-frame rows
web/src/world/         seeded world generation (noise, terrain, rivers, places)
web/src/sim/           boat physics, current field, rapids and the rhythm caller
web/src/game/          the game: state, jobs, races, journal, saves, day cycle
web/src/render/        mesh builders and the bridge client (JS → wasm heap)
web/src/net/           live client, ghost codec, board client
web/src/ui/            HUD, map, journal, menus, touch controls
server/                multiplayer service (rooms, ghosts, boards)
tests/                 node --test unit tests + Playwright play-throughs
```

The page owns the game. The C++ bridge only draws. This follows the web kit's
model, keeps the game testable without a GPU, and means gameplay changes never
need a wasm rebuild.

## Milestones

- **M0:** this RFC, the bridge, world generation, a boat on a river in 3D.
- **M1:** the current field, boat physics, the chase camera, touch controls, the day cycle.
- **M2:** rapids and the rhythm caller, the guide's voice, swimming.
- **M3:** camps, landmarks, the journal, the map, saves, the shuttle, jobs.
- **M4:** live multiplayer (rooms and presence), group races.
- **M5:** ghosts and boards, the Descent.
- **M6:** audio, art passes, performance, playtests, release 0.1.0 to the arcade.

## Alternatives considered

- **Phaser and a fake 3D look, extending Forward One.** Rejected: the owner
  asked for 3D on Strata, and an open world needs a real camera.
- **Game logic in C++ inside the wasm.** It would be faster per frame, but every
  gameplay change would need emsdk, and node tests could not run the
  simulation. The bridge-plus-JS split keeps the hot loops small, because the
  terrain and meshes upload once.
- **Supabase for multiplayer (as in Forward One).** It works for lobbies, but
  20 Hz positions through Postgres realtime cost too much and arrive too late.
  A small relay we host is simpler and free.
- **Authoritative server physics.** Not needed: the game is cooperative and
  competes only on ghosts and races, so the server checks ghosts instead of
  simulating them.

## Drawbacks, risks and open questions

- **Performance on phones:** a 1025² terrain tile plus water and vegetation
  meshes may be heavy on low-end GPUs. The quality tiers and a 513² fallback
  tile (`?world=small`) are the mitigation. Not yet measured on a real phone.
- **Cheating in boards:** validation catches impossible ghosts but not a
  careful forgery. The boards are for fun, with no prizes.
- **Moderation:** names are the only text. There is no chat.
- **The relay's uptime:** if it is down, the game falls back to offline mode.
- **Open question:** whether a later Forward One update should link to Forward
  Two (Jon's call).
