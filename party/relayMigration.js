// BENTONVILLE ROYALE — relay host migration decisions (pure; party/server.js Main calls these,
// tests/relay-migration.test.mjs covers them).
//
// Only rooms a Box Fights lobby registered (internal POST {t:'lobby'} from party/lobbyRoom.js)
// migrate. Every other room (battle royale, friend lobbies) keeps the old rule: host gone ->
// {t:'bye'} and everyone is closed.
//
// The successor is named ONLY by the lobby server (internal POST {t:'promote', token}); a guest
// can never promote itself. The token is the party token that guest connected to the relay with.

export const HOST_GRACE_MS = 10000;

export function cleanRelayToken(t) {
  return String(t || '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40);
}

/** Relay slot of the connected guest with this token, or -1. guests: Map<slot, {token}>. */
function slotOf(guests, token) {
  if (!token) return -1;
  for (const [slot, g] of guests) if (g && g.token === token) return slot;
  return -1;
}

/** The host's socket closed. */
export function hostClosedDecision({ lobbyManaged, pendingToken, guests }) {
  if (!lobbyManaged || !guests.size) return { action: 'bye' };
  const slot = slotOf(guests, pendingToken);
  return slot >= 0 ? { action: 'promote', slot } : { action: 'wait' };
}

/** The lobby server named a successor. waiting = host gone, inside the grace window. */
export function promoteDecision({ hostConnected, waiting, token, guests }) {
  if (!token) return { action: 'ignore' };
  if (hostConnected) return { action: 'pending' }; // applied when the host's socket closes
  if (!waiting) return { action: 'ignore' };
  const slot = slotOf(guests, token);
  return slot >= 0 ? { action: 'promote', slot } : { action: 'pending' };
}

/** The guests left after `slot` became the host, for the new host's join table. */
export function rosterAfterPromotion(guests, slot) {
  const out = [];
  for (const [id, g] of guests) if (id !== slot) out.push({ id, name: g.name, token: g.token });
  return out;
}
