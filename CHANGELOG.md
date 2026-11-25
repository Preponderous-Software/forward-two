# Changelog

## Unreleased

## 0.2.1 (2026-11-24)

### Feel
- Whitewater runs faster: class II water is about 45% quicker, class III 60%,
  class IV 45% and class V 30%, so a named rapid goes by at a run, not a drift. Gorge
  Gate (class III, 320 m) takes about 1:25 instead of 2:07 with every call
  hit. Flat water and Mirror Lake are unchanged.
- Race medal times are rescaled to match, so a medal is as hard to earn as
  before. Board times set in 0.2.0 on courses with rapids were run on slower
  water, so they are easier to beat.
- The relay accepts ghosts up to 16 m/s (was 12), since a kayak at full stroke
  down the fastest water now passes 12.

## 0.2.0 (2026-11-24)

A polish release: the boat steers the right way, the river looks like a river,
the crew are people, and there is more to do between rapids. 0.1.0 saves load
and catch up on what you had already earned.

### Feel and controls
- Fixed mirrored steering: left strokes (A, ←, ◀) now turn the boat left, and
  D walks right on foot. Panning the camera follows your finger.
- Rapids keep the beat: between features the guide calls drive strokes
  (Forward!) on the tempo. A dropped one costs flow, not the boat.
- A clean stroke on a rock call takes a visible line round the rock, and a
  missed rock costs you once, not twice.
- Rapids are called every time you run them, not only the first time. Early
  and late strokes are labelled separately.
- A coach for the first five minutes: stroke, steer, ride to the Sunken
  Bridge, run your first rapid (with a forgiving window), go ashore.
  Afterwards, a nudge toward the next place downstream when the river goes
  quiet (`?coach=0` turns it off).
- Camera: a smooth follow; in rapids it frames the water downstream with the
  boat mid-screen. Ashore it no longer ends up inside trees or the truck.
- Phones: a signals button (wave, flare, bell), hold ▲ to run on foot,
  haptics on the beat, and a layout for phones held sideways. Gamepad: D-pad,
  a stick deadzone, and the right stick looks around. H shows the controls.
- Gorge Lookout sits on the flat water above Gorge Gate, as its card says.

### Looks
- Rivers that look like rivers: depth colour toward the banks, flow lines and
  sun glints, foam-streaked whitewater on class III and up, a foam line along
  the banks, and water tinted by the hour (golden at dusk, moonlit at night).
- Smooth river banks: a foam line and wet margin along every bank replace the
  old saw-toothed water edge, and the water texture no longer smears near the
  camera.
- The sea has shallows and surf; drifting clouds; stars after dark.
- Varied ground (dry patches, gravel bars, banded cliffs), grass, wild
  flowers and reeds by the water, and trees of many shapes and tints.
- Camps read as places: a landing arch in the camp's colours, lanterns and
  festoon lights, boats on the bank, a cabin, smoke by day; fishing boats at
  Saltmouth. A lantern on your boat at night.
- The River Journal as illustrated badges (details on tap), a boat rack with
  pictures and stat pips, and a softer, clearer map.

### Boats and people
- New hulls for every boat: a tube raft with kicked-up ends, grab line and
  thwarts; a decked kayak with spray deck and bungees; a wooden-gunwaled canoe
  with seats and cargo; a high-sheer dory with hatches, oarlocks and two
  passengers.
- Paddlers are people (helmet, PFD, arms, legs) in five looks, and they paddle
  with your strokes: a raft turns with one side forward and one back, kayak
  strokes alternate, the dory pivots on its oars.
- Boats heave and pitch with the water (more in rapids), the crew leans into
  turns, and the bow throws spray and a wake. A swim is a swimmer, feet
  downstream, beside a raft floating bottom up.
- Other paddlers and ghosts use the same boats; ghosts are pale and
  translucent.

### Reasons to keep paddling
- Ranks, from Greenhorn to River Master, earned from your journal: places,
  feats, deliveries, medals and finds. Each opens new work and gear.
- Gear from the Gear tab at any camp: Patch Kit, Dry Bags, Long Paddle, Chart Case,
  Spray Deck.
- Wren's letters: eleven goals round the valley from the keeper of Saltmouth
  Light, with an errand for her on every job board.
- Restore Saltmouth Light in four stages, each one visible at the light: the
  Keeper's Dock, Signal Flags, the Keeper's Cottage and a New Lens.
- Twelve river finds glinting in calm water, among them Abel's letters in
  bottles.
- New jobs: rush deliveries, passengers who love a clean line and hate a swim,
  and landmark surveys. Fifteen new feats.
- A "what next" line under the place name that takes turns between your job
  and Wren's letter, and journal sections for What next, Standing, Letters and
  Finds.

### Robustness and performance
- Saves are checked when they load and repaired field by field. The save from
  the start of each session is backed up, a damaged save is restored from that
  backup, and unreadable saves are kept aside rather than deleted. "Start
  over" keeps the old save. The game saves when the page is hidden, and other
  seeds get their own slot. A save from a newer version of the game is never
  overwritten: the game plays from the backup, if there is one, and saves
  nothing that session.
- Friendly error screens with Try again for download, engine, WebAssembly and
  world failures, instead of a blank page.
- The relay drops connections that never say hello, caps connections per
  address, rooms and open races, and survives malformed messages. The client
  reconnects with backoff and retries when the page or network comes back.
- Runs finished offline are kept and sent to the online board when the relay
  is back. A group start the relay can't deliver falls back to a solo start.
- The world and detail are picked from the device, and a device that was too
  slow starts lighter next time (`?detail=0-2`, `?perf=1`).
- The forest is built in the world worker while the engine downloads, and the
  engine no longer keeps a second copy of it (about half the memory).

### Fixes
- Group race times no longer include the relay delay read as seconds.
- Job boards no longer send you upstream to camps you haven't found, hand out
  each job once a day, and the shuttle takes half the pay of a job it hauls.
- The in-game day is saved, so deadlines survive a reload.
- Cards queue instead of stacking.

## 0.1.0 (2026-11-22)

The first release of Forward Two, the open-world sequel to
[Forward One](https://github.com/McElyea/forward-one).

### The world
- The Long Water: a seeded 3 km valley with three rivers (the Long Water,
  the Brightwater and the Coldwater), Mirror Lake, a delta and the sea,
  drawn by Strata 0.10.0's web kit. A lighter world on phones (`?world=small`).
- Named rapids from class II to V (the Throat, Ferry Rapids and more), and
  the sixteen-metre High Falls.
- Eight camps and ten landmarks, with campfires, lanterns, fireflies and a
  turning lighthouse at night; a full day lasts 24 minutes.

### Paddling
- Raft, kayak, canoe and dory, each with its own speed, turning, steadiness
  and cargo space.
- In rapids the guide calls Forward, Back, Left and Right on the beat, voiced
  with Kokoro. Hit the call at the gate to keep the line and fill the flow
  meter; miss and the river hits back. A flip means a swim and two strokes to
  climb back in.
- Keyboard, touch and gamepad controls.

### Things to do
- Go ashore at any camp and walk anywhere on land: rest by the fire, take jobs
  from the board, change boats at the rack, ride the shuttle truck.
- Deliveries between camps (upstream and fragile loads pay more).
- Six race courses with medals, ghosts of your best runs and online boards.
- The River Journal (places and feats as illustrated badges) and a map with
  fog that lifts where you have paddled. Saves on the device.

### Together
- Live multiplayer through the relay at forward-two-api.play.danielstephenson.dev:
  other paddlers' boats (or paddlers on foot), waves, flares and bells, group
  race starts, and a list of who is on the river.
- Ghost boards check that a run passed every gate of its course in order.
- Offline, ghosts and times stay on the device (`?server=off`).
