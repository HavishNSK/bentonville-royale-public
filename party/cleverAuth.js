// Clever Instant Login (OAuth authorization-code) for Bentonville Royale.
// Called by: party/server.js fetch (/auth/clever, /auth/clever/callback).
// No other Clever handler exists. Reads CLEVER_CLIENT_ID + CLEVER_CLIENT_SECRET (Worker).
// User: "so google auth doesnt work can we do clever auth"

const CLEVER_AUTHORIZE = 'https://clever.com/oauth/authorize';
const CLEVER_TOKENS = 'https://clever.com/oauth/tokens';
const CLEVER_ME = 'https://api.clever.com/v3.0/me';
const TICKET_TTL_MS = 60_000;

const DEFAULT_RETURNS = [
  'https://bentonvilleroyale.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function b64basic(id, secret) {
  return btoa(`${id}:${secret}`);
}

function allowedReturns(env) {
  const extra = String(env.CLEVER_RETURN_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return new Set([...DEFAULT_RETURNS, ...extra]);
}

function safeReturn(raw, env) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const origin = u.origin;
    if (!allowedReturns(env).has(origin)) return null;
    // Stay on the site root (no open redirect into arbitrary paths with junk query).
    return origin + '/';
  } catch {
    return null;
  }
}

function redirectUriFor(request) {
  const u = new URL(request.url);
  return `${u.origin}/auth/clever/callback`;
}

async function accountsOp(env, body) {
  const id = env.Accounts.idFromName('global');
  const stub = env.Accounts.get(id);
  const res = await stub.fetch(
    new Request('https://accounts/global', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { res, data };
}

function htmlError(text, status = 400) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Sign-in</title><p>${text}</p><p><a href="https://bentonvilleroyale.vercel.app/">Back to Bentonville Royale</a></p>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

/** GET /auth/clever?return=<origin>  → Clever authorize */
export async function cleverStart(request, env) {
  const clientId = env.CLEVER_CLIENT_ID;
  if (!clientId || !env.CLEVER_CLIENT_SECRET) {
    return htmlError('Clever sign-in is not configured on the server.', 503);
  }
  const url = new URL(request.url);
  const ret = safeReturn(url.searchParams.get('return') || url.searchParams.get('return_to'), env) || 'https://bentonvilleroyale.vercel.app/';
  const state = btoa(JSON.stringify({ r: ret, n: crypto.getRandomValues(new Uint8Array(8)) }));
  const redirectUri = redirectUriFor(request);
  const dest = new URL(CLEVER_AUTHORIZE);
  dest.searchParams.set('response_type', 'code');
  dest.searchParams.set('client_id', clientId);
  dest.searchParams.set('redirect_uri', redirectUri);
  dest.searchParams.set('state', state);
  return Response.redirect(dest.toString(), 302);
}

/** GET /auth/clever/callback?code=&state= → exchange, mint ticket, bounce to game */
export async function cleverCallback(request, env) {
  const clientId = env.CLEVER_CLIENT_ID;
  const secret = env.CLEVER_CLIENT_SECRET;
  if (!clientId || !secret) return htmlError('Clever sign-in is not configured on the server.', 503);

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (err) return htmlError('Clever sign-in was cancelled.', 400);
  if (!code) return htmlError('Missing Clever authorization code.', 400);

  let returnTo = 'https://bentonvilleroyale.vercel.app/';
  try {
    const state = JSON.parse(atob(url.searchParams.get('state') || ''));
    const safe = safeReturn(state && state.r, env);
    if (safe) returnTo = safe;
  } catch {
    /* keep default */
  }

  const redirectUri = redirectUriFor(request);
  const tokenRes = await fetch(CLEVER_TOKENS, {
    method: 'POST',
    headers: {
      authorization: `Basic ${b64basic(clientId, secret)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
  });
  if (!tokenRes.ok) return htmlError('Could not finish Clever sign-in (token exchange).', 401);
  const tokens = await tokenRes.json();
  const access = tokens && tokens.access_token;
  if (!access) return htmlError('Clever did not return an access token.', 401);

  const meRes = await fetch(CLEVER_ME, {
    headers: { authorization: `Bearer ${access}`, accept: 'application/json' },
  });
  if (!meRes.ok) return htmlError('Could not read your Clever profile.', 401);
  const me = await meRes.json();
  // Clever v3 /me: { data: { id, type, district } }
  const data = me && me.data;
  const sub = String((data && data.id) || '').trim();
  if (!sub || sub.length > 64) return htmlError('Clever profile was missing a user id.', 401);

  const internal = secret;
  const { res, data: acc } = await accountsOp(env, {
    op: 'cleverLogin',
    cleverId: sub,
    nameHint: '',
    type: data && data.type,
    internal,
  });
  if (!res.ok || !acc || !acc.token) {
    return htmlError((acc && acc.error) || 'Account server rejected Clever sign-in.', res.status || 500);
  }

  const ticket = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await accountsOp(env, { op: 'putAuthTicket', ticket, token: acc.token, exp: Date.now() + TICKET_TTL_MS, internal });

  const bounce = new URL(returnTo);
  bounce.searchParams.set('br_auth', ticket);
  return Response.redirect(bounce.toString(), 302);
}

export async function handleCleverAuth(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (path === '/auth/clever') return cleverStart(request, env);
  if (path === '/auth/clever/callback') return cleverCallback(request, env);
  return null;
}
