# Multiplayer (host-authoritative, PartyKit WebSocket relay)

Status: WORKING LOCALLY (host + guest verified end to end in headless Chromium). Not deployed.

## Why the transport changed
PeerJS/WebRTC depended on the free public broker (0.peerjs.com) and on NAT
traversal with no TURN server, so friends often could not connect. All traffic
now goes over one WebSocket per player to a tiny PartyKit relay. The host's
browser still runs the whole simulation; the relay does no game logic.

## Pieces
- `party/server.js` + `partykit.json`: one PartyKit room per 4-letter code.
  First `role=host` connection owns the room (a second host gets `taken`, the
  client retries a new code). Guests get slot ids 1..MAX_HUMANS-1 (MAX_HUMANS
  imported from `src/net/protocol.js`). Rejects: `notFound` (no host),
  `version` (PROTO_VERSION differs from host's), `started`, `full`. Guest
  frames go to the host prefixed with the slot id; host frames are addressed to
  one slot or broadcast. Binary frames keep a 1-byte routing prefix. Host gets
  `join`/`leave` notices; guests get `{t:'bye'}` when the host disconnects.
- `src/net/Net.js`: same exported API as before (hostRoom/joinRoom, HostRoom,
  ClientConn, MSG), plain browser WebSocket (no partysocket; auto-reconnect would
  break slot identity). Setting `room.started = true` (HostSession does) tells the
  relay to refuse new joins. Huge JSON is chunked at 256 KB in the existing `_c` format.
  Relay address: `?party=host:port` > `VITE_PARTYKIT_HOST` > `localhost:1999`;
  `ws://` for localhost/LAN addresses, `wss://` otherwise.
- `src/main.js`: onHost/onJoin/onLobbyStart/onLobbyFill/onLobbyLeave wired;
  map preloads in the background while in a lobby; `?room=CODE` prefills the join
  code; host-left shows a title notice. Net modules are dynamic imports (solo
  play fetches none of them — verified).
- HostSession/ClientSession: unchanged.

## Verified (local `npx partykit dev` + vite)
- Node script against the real relay: host/join, lobby roster, JSON both ways,
  binary both ways, 700 KB chunked message, start, reject started/notFound/
  version/full (15 guests + host, 16th refused), slot reuse after leave, guest
  leave notice, host leave -> guest onClose "Host left the match.", second host -> taken.
- Headless Chromium (two contexts): host lobby -> guest joins via `?room=` link
  -> both rosters show both -> host starts -> client in match (role client, id 1),
  ~18 snapshots/s, 0 lost, client walked 21.7 m and the host saw the same 21.7 m;
  host closing -> client back on title with "Host left the match."
- Solo PLAY still starts (99 bots, no /net/ modules fetched). `npm run build` passes.

## Not tested
- Real internet play through a deployed PartyKit project (needs the user's login).
- More than one human guest in a full browser match; long matches; mobile.
- Everything rides one reliable ordered socket: on lossy links snapshots can
  queue behind each other (TCP head-of-line) instead of being dropped.

## Deploy
1. `npx partykit login`
2. `npm run party:deploy` -> prints `bentonville-royale.<user>.partykit.dev`
3. Build the site with `VITE_PARTYKIT_HOST=bentonville-royale.<user>.partykit.dev`
   (e.g. a Vercel env var, or `.env.production`), then redeploy the site.
   Without it a production build points at `localhost:1999`.
   Quick test without rebuilding: open the site with `?party=bentonville-royale.<user>.partykit.dev`.
