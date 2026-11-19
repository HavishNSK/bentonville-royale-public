// BENTONVILLE ROYALE — pure team-packing helpers for the matchmaker.
// No imports: party/matchmaker.js pulls in `partyserver` (cloudflare:workers),
// so anything node tests need lives here.

/** parties: [{partyId, fill, members:[{token, leader}]}] in queue order -> {teams, hostToken} */
export function packTeams(parties, size) {
  const teams = [];
  for (const p of parties) {
    if (!p.fill) teams.push({ tokens: p.members.map((m) => m.token), allowBots: false });
  }
  const fillers = parties.filter((p) => p.fill).sort((a, b) => b.members.length - a.members.length);
  for (const p of fillers) {
    const n = p.members.length;
    let team = teams.find((t) => t.allowBots && t.tokens.length + n <= size);
    if (!team) {
      team = { tokens: [], allowBots: true };
      teams.push(team);
    }
    team.tokens.push(...p.members.map((m) => m.token));
  }
  let host = null;
  for (const p of parties) if (!host || p.members.length > host.members.length) host = p;
  const leader = host ? host.members.find((m) => m.leader) || host.members[0] : null;
  return { teams, hostToken: leader ? leader.token : null };
}

/**
 * Box Fights: two teams of capacity `size`. tickets are in queue order (oldest first),
 * each {partyId, ticketId, fill, at, members:[{token, leader}]}.
 * Returns {match, nextAt}; match = {teams:[{tickets, tokens, allowBots}x2], hostToken, used}
 * or null. nextAt is the ms timestamp the next check could form a match (null if none).
 */
export function packBoxFight(tickets, size, now, { windowMs = 10000, soloWaitMs = 30000 } = {}) {
  const bins = [0, 1].map(() => ({ tickets: [], tokens: [], sealed: false }));
  for (const t of Array.isArray(tickets) ? tickets : []) {
    const n = t.members.length;
    if (n < 1 || n > size) continue;
    const bin = t.fill === false
      ? bins.find((b) => !b.tickets.length)
      : bins.find((b) => !b.sealed && b.tokens.length + n <= size);
    if (!bin) continue;
    bin.tickets.push(t);
    bin.tokens.push(...t.members.map((m) => m.token));
    if (t.fill === false) bin.sealed = true;
  }
  const used = bins.flatMap((b) => b.tickets);
  if (!used.length) return { match: null, nextAt: null };

  const done = (b) => b.sealed || b.tokens.length >= size;
  let due;
  if (bins.every(done)) due = now;
  else {
    const oldest = Math.min(...used.map((t) => t.at));
    due = oldest + (bins.every((b) => b.tickets.length) ? windowMs : soloWaitMs);
  }
  if (now < due) return { match: null, nextAt: due };

  let host = null;
  for (const t of used) if (!host || t.members.length > host.members.length) host = t;
  const leader = host.members.find((m) => m.leader) || host.members[0];
  return {
    match: {
      teams: bins.map((b) => ({ tickets: b.tickets.map((t) => t.ticketId), tokens: b.tokens, allowBots: !b.sealed })),
      hostToken: leader.token,
      used: used.map((t) => t.ticketId),
    },
    nextAt: due,
  };
}
