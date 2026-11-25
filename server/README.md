# Forward Two server

The multiplayer service for Forward Two: live WebSocket rooms, group races, and
the ghost and board API. It uses only the Node 22 standard library. The
WebSocket code (RFC 6455) is in `ws.js`.

```
node server/main.js [--port 8790] [--host 0.0.0.0] [--data ./data] [--static web]
npm run serve        # the game and the service on :8790
```

`--static <dir>` also serves the game's files, so one process can run the whole
game locally. Environment fallbacks: `PORT`, `HOST`, `F2_DATA`, `F2_STATIC`.
Behind a reverse proxy, set `F2_TRUST_PROXY=1` so the per-address limits (ghost
posts, live connections) use the last address in `X-Forwarded-For`; without it
every player shares the proxy's address.

The game finds the service from `<meta name="f2-server" content="...">` in
`web/index.html`, or from `?server=` in the page URL. Either can be a ws(s) URL
(`wss://host/ws`) or an http(s) base (`https://host`), and the client works
out the other. With neither, the game runs offline. Ghosts and boards are then
kept in localStorage.

## Files

| File | Role |
| --- | --- |
| `main.js` | CLI entry point and signal handling |
| `app.js` | HTTP: `/healthz`, `/api/*`, static files, WebSocket upgrade, heartbeat |
| `ws.js` | WebSocket handshake, frame parser and writer, ping/pong, close |
| `rooms.js` | `Hub`: rooms, relay, emotes, group races, clock sync, rate limits |
| `ghosts.js` | `GhostStore`: top 20 per course, atomic JSON files |
| `validate.js` | name, colour, state, course and room checks |
| `../web/src/net/ghost.js` | the ghost codec, shared with the browser |

## HTTP

| Request | Answer |
| --- | --- |
| `GET /healthz` | `200 {ok, rooms, players}` |
| `POST /api/ghosts/<course>` | body `{name, ms, ghost}`. `201 {ok, rank, board}` when ranked, `200 {ok, rank:null}` when not. `400` for a bad course or time, `413` when too large, `422` for an implausible ghost, `429` above 12 posts a minute per IP |
| `GET /api/ghosts/<course>?n=5` | `{course, ghosts:[{rank, name, ms, at, ghost}]}`, top N (1 to 20) |
| `GET /api/board/<course>` | `{course, board:[{rank, name, ms, at}]}`, top 20 without ghost bodies |

Course ids match `[a-z0-9-]{1,40}`. Every `/api` answer allows any origin (CORS).

A ghost is ranked only if:

- it decodes and is at most 64 KB;
- its times increase, with no gap over 2 s;
- every step stays under 16 m/s;
- it stays inside the world (0 to 3100 m);
- its duration matches `ms` within 1 s.

Each name keeps only its best run. Data is stored in
`<data>/ghosts/<course>.json`. A board file that can't be read is renamed to
`<course>.json.corrupt-<time>` and kept, never overwritten. Each write goes to a temp file and is then renamed
into place, and writes for one course run one at a time.

## Live protocol

Connect to `ws(s)://host/ws?seed=<seed>&room=<room>`. Every message is a JSON
text frame `{t: <type>, ...}`. Binary frames close the connection with 1003,
unmasked frames with 1002, and frames over 64 KB with 1009. A room is
`{seed, room}`. The default room is `river`, and a room holds at most 32 players.

Client to server:

| `t` | Fields | Notes |
| --- | --- | --- |
| `hello` | `name, colour [r,g,b] 0..1 or "#rrggbb", boat, seed?, room?` | Must come first. Sending it again updates the profile. Names are printable ASCII, 1 to 16 characters after trimming, otherwise `Paddler`. |
| `state` | `x, z, y, h, vx, vz, boat, swim` | About 10 Hz. x and z must be 0 to 3100, speed under 30 m/s, and every number finite. Invalid states are dropped. |
| `emote` | `kind`: `wave` \| `flare` \| `bell` | At most one a second. There is no free text. |
| `race-ready` | `course` | Opens or joins the course's lobby. Only the world's real courses are accepted. |
| `race-finish` | `course, ms` | Only racers can send it. `ms` cannot exceed the server's elapsed time plus 2 s. |
| `time` | `c` (client ms) | The server answers `{t:"time", c, s}`. |

Server to client:

| `t` | Fields |
| --- | --- |
| `welcome` | `id, seed, room, name, now, players:[{id,name,colour,boat,state}], races:[{course,at,ready}]` |
| `join` / `leave` | `{id,name,colour,boat}` / `{id}` |
| `states` | `at` (server ms), `list:[{id,x,z,y,h,vx,vz,boat,swim}]`, batched every 100 ms, changed boats only |
| `emote` | `id, kind` |
| `race-lobby` | `course, at` (start, server ms), `ready:[ids], now`. The lobby lasts 10 s from the first ready. |
| `race-start` | `course, at, racers:[ids]` |
| `race-results` | `course, final, results:[{id,name,ms,place}]`. Sent after each finish, and with `final` once every racer has finished or after 30 minutes. |
| `race-busy` | `course, at` when a race is already running there, or `at: 0` when the room already has 16 open lobbies and races |
| `time` | `c, s` |
| `error` | `code` (`full`: the room has 32 players; `busy`: the relay has 500 rooms), `msg` |

Abuse handling:

- At most 2000 live connections in all and 8 per client address; beyond
  that the upgrade is answered `503` with `Retry-After: 30`.
- A connection that hasn't sent `hello` within 10 s is closed with 1008.
- At most 500 rooms; a `hello` that would open another gets `error` `busy`
  and is closed with 1013.
- Each connection has a token bucket of 20 messages a second with a burst of 40.
- A dropped or invalid message counts as a strike. After 60 strikes the
  connection is closed with 1008. A message that makes the relay throw counts
  as a strike; it never takes the relay down.
- Quiet connections are pinged after 20 s and dropped after 45 s.

## Docker

```
docker build -f server/Dockerfile -t forward-two-server .
docker run -p 8790:8790 -v f2data:/data forward-two-server
```

Build from the repository root, because the image includes the shared codec
from `web/`. The image runs as the `node` user, stores data in `/data`, and
checks itself on `/healthz`.

## Tests

`node --test tests/*.test.js`. `tests/server.test.js` starts a real server on an
ephemeral port and drives it with raw WebSocket clients and with the game's own
`Net` client. `tests/net.test.js` covers the codec, the validation and `Others`.
