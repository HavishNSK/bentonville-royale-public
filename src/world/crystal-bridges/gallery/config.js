// BENTONVILLE ROYALE — Crystal Bridges gallery config: location + validation (pure, no DOM / three).
// The config is data (musewalk gallery.config.json shape): every field is type-checked, clamped
// and length-limited before use; colours must be #rrggbb; portal targets must be finite numbers.

export const DEFAULT_PALETTE = { accent: '#b7a98c', wall: '#2a211c', panel: '#39302a', floor: '#8b5a32', fog: '#c5d2c8', lightColor: '#ffe2b8', frameStyle: 'dark' };

/** 0 = outdoor town, 1 = full gallery mist. The ravine stays hazy even between pavilions. */
export function interiorBlend({ inside = false, glassy = false, inSite = false } = {}) {
  if (inside) return glassy ? 0.62 : 0.92;
  if (inSite) return 0.58;
  return 0;
}

/** ?cbConfig=/data/foo.json (same-origin JSON under /data/ only); else the default config. */
export function configUrl(search = typeof location !== 'undefined' ? location.search : '') {
  const q = new URLSearchParams(search).get('cbConfig');
  return q && /^\/data\/[a-z0-9._-]+\.json$/i.test(q) && !q.includes('..') ? q : '/data/crystal-bridges.config.json';
}

/** Validate the config shape; drops anything malformed (config is data, not code). */
export function sanitizeConfig(cfg) {
  const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  const str = (v, n = 400) => (typeof v === 'string' ? v.slice(0, n) : '');
  const wings = Array.isArray(cfg && cfg.wings) ? cfg.wings.slice(0, 32) : [];
  return {
    wings: wings
      .filter((w) => w && typeof w.id === 'string')
      .map((w) => ({
        id: str(w.id, 40), no: str(w.no, 8), name: str(w.name, 80), intro: str(w.intro),
        accent: hex(w.accent, DEFAULT_PALETTE.accent), wall: hex(w.wall, DEFAULT_PALETTE.wall), panel: hex(w.panel, DEFAULT_PALETTE.panel),
        floor: hex(w.floor, DEFAULT_PALETTE.floor), fog: hex(w.fog, DEFAULT_PALETTE.fog), lightColor: hex(w.lightColor, DEFAULT_PALETTE.lightColor),
        frameStyle: ['gold', 'dark', 'float'].includes(w.frameStyle) ? w.frameStyle : 'dark',
        works: (Array.isArray(w.works) ? w.works.slice(0, 64) : []).filter((x) => x && typeof x === 'object').map((x) => ({
          art: typeof x.art === 'string' ? x.art.slice(0, 80) : null,
          placeholder: !!x.placeholder, standIn: !!x.standIn, wide: !!x.wide,
          title: str(x.title, 120), artist: str(x.artist, 80), year: str(x.year, 30),
          desc: str(x.desc, 600), line: str(x.line, 120),
          aspect: Number.isFinite(x.aspect) && x.aspect > 0.2 && x.aspect < 5 ? x.aspect : null,
          verify: !!x.verify,
          portal: x.portal && Array.isArray(x.portal.to) && x.portal.to.length === 3 && x.portal.to.every(Number.isFinite)
            ? { to: x.portal.to.slice(0, 3), heading: Number.isFinite(x.portal.heading) ? x.portal.heading : 0, name: str(x.portal.name, 60) }
            : null,
        })),
        rooms: Array.isArray(w.rooms) ? w.rooms.slice(0, 8).map((r) => ({ room: str(r.room, 40), title: str(r.title, 120), artist: str(r.artist, 80), year: str(r.year, 30) })) : [],
        plinths: Array.isArray(w.plinths) ? w.plinths.slice(0, 8).map((r) => ({ title: str(r.title, 120), artist: str(r.artist, 80), year: str(r.year, 30) })) : [],
      })),
    outdoor: (Array.isArray(cfg && cfg.outdoor) ? cfg.outdoor.slice(0, 16) : [])
      .filter((o) => o && Array.isArray(o.at) && o.at.length === 3 && o.at.every(Number.isFinite))
      .map((o) => ({ title: str(o.title, 120), artist: str(o.artist, 80), year: str(o.year, 30), at: o.at.slice(0, 3) })),
  };
}

