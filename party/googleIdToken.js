// Verify Google Identity Services ID tokens (JWT) with Google's JWKS.
// Called by: party/accounts.js googleLogin op. No other verifier exists in-repo.
// Reads: idToken JWT + GOOGLE_CLIENT_ID (aud). Writes: none (pure verify).
// User verbatim: "we need google auth so people can sign in with gogle"

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

let cached = { keys: null, exp: 0 };

function b64urlToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJsonPart(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function loadJwks() {
  const now = Date.now();
  if (cached.keys && cached.exp > now) return cached.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks');
  const body = await res.json();
  if (!body || !Array.isArray(body.keys)) throw new Error('jwks');
  const cc = res.headers.get('cache-control') || '';
  const m = /max-age=(\d+)/i.exec(cc);
  const ttlMs = Math.max(60, Math.min(3600, m ? Number(m[1]) : 300)) * 1000;
  cached = { keys: body.keys, exp: now + ttlMs };
  return body.keys;
}

/**
 * @param {string} idToken
 * @param {string} clientId OAuth Web client ID (aud)
 * @returns {Promise<{sub:string, email?:string, email_verified?:boolean, name?:string, given_name?:string}>}
 */
export async function verifyGoogleIdToken(idToken, clientId) {
  if (typeof idToken !== 'string' || idToken.length < 40 || idToken.length > 4096) {
    throw new Error('bad-token');
  }
  if (typeof clientId !== 'string' || !clientId) throw new Error('no-client');

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('bad-token');

  let header;
  let payload;
  try {
    header = decodeJsonPart(parts[0]);
    payload = decodeJsonPart(parts[1]);
  } catch {
    throw new Error('bad-token');
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('bad-alg');

  // Verify signature before trusting claims (limits junk-token JWKS/CPU work after kid lookup).
  const keys = await loadJwks();
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) throw new Error('no-key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToBytes(parts[2]);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  if (!ok) throw new Error('bad-sig');

  if (!ISSUERS.has(payload.iss)) throw new Error('bad-iss');
  const aud = payload.aud;
  const audOk = aud === clientId || (Array.isArray(aud) && aud.length === 1 && aud[0] === clientId);
  if (!audOk) throw new Error('bad-aud');
  if (payload.azp != null && payload.azp !== clientId) throw new Error('bad-azp');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) throw new Error('expired');
  if (typeof payload.iat === 'number' && payload.iat * 1000 > Date.now() + 60_000) throw new Error('bad-iat');
  if (typeof payload.iat === 'number' && Date.now() - payload.iat * 1000 > 3600_000) throw new Error('stale');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw new Error('bad-sub');

  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    email_verified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    given_name: typeof payload.given_name === 'string' ? payload.given_name : undefined,
  };
}
