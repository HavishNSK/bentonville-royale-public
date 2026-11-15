# Multiplayer (peer-to-peer, host-authoritative)

Status: IN PROGRESS. This file is updated as the work goes.

- Replacing the quick "friend multiplayer" from commit 603076f (Room.js/Match.js/NetInput.js/Puppet.js: 8-player cap, raw key sampling that drops key presses between 50 ms packets, JSON snapshots, full world resend every 0.4 s, peerjs imported statically in solo mode) with the architecture in the brief.
- Done so far: `src/net/protocol.js` (binary snapshot/state codecs, JSON chunking), Combat.js multiplayer hooks (non-authoritative client mode, explicit pellet dirs, claimed hits, onFire/onColliderDestroyed), shotgun pump + impact surface sounds.
- Public PeerJS broker (0.peerjs.com) is unreachable from this sandbox (curl returns 000); tests will use a local `peer` server behind `?peer=host:port`.
