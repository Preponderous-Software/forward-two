# Visuals pass: notes (0.2.0)

Lane: visuals, 0.2.0 polish pass.

AI playtest of how Forward Two looks, with before/after stills of the same
viewpoints. Stills are headless (SwiftShader, `?world=small&server=off`,
quality 2) from a copy of `tools/readme-shots.cjs` with extra viewpoints, so
colours are close to a real GPU but shadows and fog are a little softer.

- `before/`: the 0.1.0 code (HEAD 3cbb443).
- `after/`: this pass (round 7, the final code).
- `compare.jpg`: before (left) and after (right) for each viewpoint.

Before stills drove 24 frames per shot, after stills 12 (the box was
loaded); the time of day and camera are the same.

Viewpoints: `day-river` (11:30, the Meadows), `evening-river` (18:12, same
spot), `rapids` (the Throat), `camp-day` and `night-camp` (Meadow Fork at
15:00 and 22:18), `saltmouth` (18:36), `sea-day` (the delta at noon),
`falls`, `map` (the map canvas) and the page panels `journal`, `camp-panel`,
`map-panel`, `title`, `hud`.

## Round 1: what looked wrong

1. **Water was one flat teal.** No depth, no shoreline, and rapids were only
   a lighter teal: nothing said "whitewater".
2. **The sea was a single quad** of navy: no surf, no shallows.
3. **Meadows were one saturated green**; banks were the same mud everywhere.
4. **Broadleaf trees were dark umbrellas**, all the same.
5. **Camps did not read as places** from the water: a few dark tents and a
   flag. At night, only the fire.
6. **Evening light was not warm**; nights had no stars and the raft vanished.
7. **The journal was a wall of text**: every camp had the same tent icon and
   every tile printed its blurb.
8. **The map** had a hard grid in the fog and white streak artefacts from the
   hill shading.

## Fixes

- Water colour from depth (shallow, lighter and greener; deep channel
  blue-green), a wet shoreline, and whitewater broken into streaks with foam
  lines along the banks of fast water (`render/meshes.js` `waterMesh`).
- The sea is now a depth-coloured grid with a surf band and turquoise
  shallows, fading to deep blue offshore (`seaMesh`).
- Ground: dry sunny patches, darker forest floor under the woods, gravel bars
  along fast water, banded cliffs (`world/terrain.js` `paintGround`).
- Trees: rounded broadleaf crowns lit lighter on top, birches, a few copper
  trees, firs of two or three tiers, per-tree size and hue, a second lobe on
  big old trees; grey outcrops on steep ground (see round 5 for the vertex
  budget).
- Camps: a landing arch in the camp's colour, lanterns on the dock and path,
  bunting, a woodpile, a canoe on the bank, a smoke plume by day; Saltmouth
  gets moored fishing boats (`game/places.js`).
- Light: a wider, warmer golden hour; cooler night ambient; stars after dusk;
  a lantern on your boat at night (`game/game.js`, `render/effects.js`).
- Rapids: foam flecks stream down the rapid you are in; every boat flies a whip flag in its colour.
- UI: medallion badges (camps ringed in their flag colour, each with its own
  art; feats with ribbons; locked feats as faint silhouettes), progress chips
  instead of the summary sentence, details on tap/focus; boat rack with boat
  art and stat pips; icons on the camp tabs; badges on the "found" and "feat"
  cards; a painted valley on the title card; the map gets soft fog, gentler
  shading, depth-tinted water and a compass rose.

## Rounds 2 to 5 (after owner feedback: "visuals still need work")

The owner asked for big, visible changes in water, land and trees, and light
and sky. Each round re-shot every viewpoint; what each round fixed:

- **Round 2.** Water was still a flat sheet, since vertex colours are only
  every 3 to 6 m. Moved the look into textures: a calm-water texture with
  flow lines and glints, and a separate whitewater texture (long foam
  streaks) on class III+ water, scrolling twice as fast. Added ground cover
  (grass tufts, wild flowers, reeds, pebbles) within 75 m of the water,
  varied tree shapes and tints, drifting clouds, sun glitter on the water, a
  foam line along the banks, a brighter moonlit night.
- **Round 3.** Grass tufts read as black spikes (their back faces were in
  shadow): blades now take an up-facing normal and are lit like the ground.
  Clouds looked like grey rocks: they are now unlit and tinted for the hour
  through a tiny texture (white by day, peach at dusk, slate at night).
  Night foam points glowed like lamps: they dim after dark.
- **Round 4.** Evening and night water went nearly black because the low sun
  barely lights a flat surface. Rivers are now unlit and tinted for the hour
  like the sky they reflect: warm at golden hour, moonlit blue at night.
  Whitewater had gone dark teal: rapids get a near-white base.
- **Round 5.** Per-tree vertex counts brought back under 0.1.0's (80.9 per
  tree vs 83.4 on the small world; trunks lose their hidden caps, crowns use
  one lathed shape), grass blades share their vertices, surf softened, a
  warmer golden hour.

- **Rounds 6 and 7.** The landing arch and bunting sat in the walker's
  chase camera ashore: the arch is now 5 m tall and the bunting runs along
  the bank above head height. A stepped water shelf on the banks of steep
  rapids (coarse worlds): bank-edge vertices took the highest neighbouring
  level; they now follow their own level and tuck under the bank, taking the
  wet ground's colour so the sheet fades into it. Whitewater streaks were
  too stretched near the camera: two scales, less stretch. My boat wake was
  dropped (boats belong to the boats and people lane).

Still open:
- On the small world (6 m cells) the edge where water meets a steep bank is
  still visibly saw-toothed; the full world's 3 m grid halves it. A proper
  fix would be a shoreline strip mesh.
- The engine's distance fog and sky gradient are fixed in the
Strata kit (no host knob without rebuilding the wasm), so haze is unchanged.

## Wave 3: the shoreline (`wave3/`)

The merged build's rapids still showed a saw-toothed water edge where the
whitewater meets the bank, and a band of stretched texture near the camera.

- **Shoreline strip** (`shoreMesh` in `render/meshes.js`): a narrow strip
  along both banks of every river, built per river sample (every 3 m)
  instead of on the 3 to 6 m terrain grid. Its inner edge lies on the water
  as a lacy foam line (white on fast water, wet-sand on calm), the middle
  rides just above the ground (on the higher of the two possible triangle
  splits, with the ground's own slope and colour, darkened as wet), and the
  outer edge dips under the terrain. The grid's jagged edge is hidden
  behind a smooth curve. It is skipped where the bank is more water
  (confluences, the lake, the delta). About 22 k vertices on either world.
- **Stretched band**: water vertices took v from their nearest river
  sample's distance only, so several vertices sharing a sample got the same
  v and the texture smeared along the flow. v is now the sample's distance
  plus the vertex's own offset along the tangent (still growing downstream).

`wave3/*-before.jpg` are from the end of round 7, `*-after.jpg` from this
wave; `wave3/compare.jpg` puts them side by side (The Throat, a calm bend,
Meadow Fork).

## Screenshots

| | Before (0.1.0) | After (visuals lane) |
|---|---|---|
| **Title card** | ![Title card before](before/title.jpg) | ![Title card after](after/title.jpg) |
| **The river by day** | ![The river by day before](before/day-river.jpg) | ![The river by day after](after/day-river.jpg) |
| **The river at dusk** | ![The river at dusk before](before/evening-river.jpg) | ![The river at dusk after](after/evening-river.jpg) |
| **Whitewater** | ![Whitewater before](before/rapids.jpg) | ![Whitewater after](after/rapids.jpg) |
| **The High Falls** | ![The High Falls before](before/falls.jpg) | ![The High Falls after](after/falls.jpg) |
| **The sea** | ![The sea before](before/sea-day.jpg) | ![The sea after](after/sea-day.jpg) |
| **A camp by day** | ![A camp by day before](before/camp-day.jpg) | ![A camp by day after](after/camp-day.jpg) |
| **A camp at night** | ![A camp at night before](before/night-camp.jpg) | ![A camp at night after](after/night-camp.jpg) |
| **Saltmouth** | ![Saltmouth before](before/saltmouth.jpg) | ![Saltmouth after](after/saltmouth.jpg) |
| **The HUD** | ![The HUD before](before/hud.jpg) | ![The HUD after](after/hud.jpg) |
| **The River Journal** | ![The River Journal before](before/journal.jpg) | ![The River Journal after](after/journal.jpg) |
| **The camp panel** | ![The camp panel before](before/camp-panel.jpg) | ![The camp panel after](after/camp-panel.jpg) |
| **The map panel** | ![The map panel before](before/map-panel.jpg) | ![The map panel after](after/map-panel.jpg) |
| **The map** | ![The map before](before/map.jpg) | ![The map after](after/map.jpg) |

Wave 3 (smooth banks, water uv, ground cover):

| | Before | After |
|---|---|---|
| **River by day** | ![River by day before](wave3/day-river-before.jpg) | ![River by day after](wave3/day-river-after.jpg) |
| **Whitewater** | ![Whitewater before](wave3/rapids-before.jpg) | ![Whitewater after](wave3/rapids-after.jpg) |
| **Camp by day** | ![Camp by day before](wave3/camp-day-before.jpg) | ![Camp by day after](wave3/camp-day-after.jpg) |

All at once: ![Before and after contact sheet](compare.jpg)

These stills come from the visuals lane's build. The boats in them are still the 0.1.0 boats; the new boats came from the boats and people lane (see `../boats/`).
