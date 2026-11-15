// BENTONVILLE ROYALE — optional "Real-world 3D view": Google Photorealistic 3D Tiles
// streamed around Bentonville and aligned to the game's world frame.
//
// Visual only. The procedural world meshes (ground, roads, buildings, trees, props)
// are hidden from the camera while the view is active; collision, bots, loot, builds,
// characters, effects and the HUD keep working exactly as before because they never
// depend on those meshes (World.js owns all collision).
//
// Off by default. It needs VITE_GOOGLE_MAPS_API_KEY (put it in .env.local, see
// .env.example). Without a key nothing Google-related is imported or requested:
// the 3d-tiles-renderer library is loaded with a dynamic import() only when the
// view is switched on.
//
//   import { createGoogleTilesController, hasGoogleTilesKey } from './render/GoogleTiles.js';
//   const gt = createGoogleTilesController({ getGame: () => game, onFail: (msg) => ... });
//   gt.setEnabled(true | false);   // waits for game.loaded, then streams tiles
//   gt.status                      // 'off' | 'waiting' | 'loading' | 'on' | 'failed' | 'unavailable'
//
// Coordinates. The game uses metres with x = east, y = up, z = SOUTH around the map
// origin (scripts/fetch-map-data.mjs). Tiles arrive in ECEF (Earth-centred, Z = polar
// axis, which is how 3d-tiles-renderer leaves them). We build the local East-North-Up
// frame at the origin and map  game.x = E, game.y = U - groundHeight, game.z = -N.
//
// Ground height. The ENU frame is placed `ellipsoidHeight` metres above the WGS84
// ellipsoid at the origin. Default = 390 m terrain elevation (orthometric) + -28 m geoid
// undulation in NW Arkansas = 362 m, so the real ground lands near y = 0. After tiles
// stream in, the view auto-calibrates by ray casting a few points around the camera and
// matching them to World's ground (terrainHeight when present, else y = 0). Override:
//   URL  ?gtilesHeight=362        fixed ellipsoid height, disables auto-calibration
//   URL  ?gtilesOffset=-4         extra vertical shift in metres (after calibration)
//   JS   window.__brGoogleTiles.setHeightOffset(m) / .calibrate()
//
// Composed map. public/data/bentonville-osm.json is a compact designed layout (see
// scripts/compose-map.mjs): only the downtown core (meta.composition.core.rect) is at its
// real position; the school islands are moved cut-outs, so real-world tiles would show the
// wrong place there. When the map has a composition, the tiles are clipped to the core
// rectangle and the procedural world stays visible outside it (ground and road layers are
// clipped to the outside of the core instead of being hidden). See coreRect().
//
// Google Maps Platform terms: the attribution overlay (Google + the data providers of
// every visible tile) is always on screen while tiles render; tiles are only held in
// 3d-tiles-renderer's in-memory LRU cache (plus the browser's normal HTTP cache) and are
// never persisted, exported or pre-fetched outside the camera's view.

import * as THREE from 'three';

export const GOOGLE_TILES_ORIGIN = Object.freeze({ lat: 36.3729, lon: -94.2088 });
export const GOOGLE_TILES_TERRAIN_ELEVATION = 390; // m above mean sea level near the square
export const GOOGLE_TILES_GEOID_UNDULATION = -28; // m, EGM96 geoid vs WGS84 ellipsoid here
export const GOOGLE_TILES_DEFAULT_HEIGHT = GOOGLE_TILES_TERRAIN_ELEVATION + GOOGLE_TILES_GEOID_UNDULATION;

const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const CALIBRATION_LIMIT = 80; // m: never move the tiles further than this automatically
const HIDDEN_LAYER = 31;
const _chunkBox = new THREE.Box3();

/** [minX, minZ, maxX, maxZ] of the part of the map that is at its real position, or null (all of it). */
export function coreRect(world) {
  const c = world && world.data && world.data.meta && world.data.meta.composition;
  const r = c && c.core && c.core.rect;
  return Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) ? r : null;
}

/** Clip planes keeping the inside of rect r (world space, y up). */
function rectPlanes(r) {
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -r[0]),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), r[2]),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -r[1]),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), r[3]),
  ];
}

// ---------------------------------------------------------------- key

/** The API key from Vite's env (VITE_GOOGLE_MAPS_API_KEY), or '' when not configured. */
export function googleTilesKey() {
  let env = null;
  try {
    env = import.meta.env;
  } catch (err) {
    env = null;
  }
  const k = env && env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof k === 'string' ? k.trim() : '';
}

export function hasGoogleTilesKey() {
  return googleTilesKey().length > 0;
}

// ---------------------------------------------------------------- math (pure, Node-testable)

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const DEG = Math.PI / 180;

/** Geodetic (degrees, metres above the ellipsoid) -> ECEF metres (Z = polar axis). */
export function geodeticToEcef(latDeg, lonDeg, h = 0, target = new THREE.Vector3()) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sl * sl);
  return target.set((n + h) * cl * Math.cos(lon), (n + h) * cl * Math.sin(lon), (n * (1 - WGS84_E2) + h) * sl);
}

/**
 * Matrix taking ECEF coordinates into game coordinates (x = east, y = up, z = south),
 * with the origin at (lat, lon, height above ellipsoid). `projectionMatch` (default on)
 * matches the map's equirectangular metres instead of true local metres.
 */
export function ecefToGameMatrix(
  { lat = GOOGLE_TILES_ORIGIN.lat, lon = GOOGLE_TILES_ORIGIN.lon, height = GOOGLE_TILES_DEFAULT_HEIGHT, projectionMatch = true } = {},
  target = new THREE.Matrix4()
) {
  const la = lat * DEG;
  const lo = lon * DEG;
  const east = new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0);
  const north = new THREE.Vector3(-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la));
  const up = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
  const o = geodeticToEcef(lat, lon, height);
  // The map pipeline projects with fixed metres-per-degree (MX, MZ in fetch-map-data.mjs);
  // squash the true ENU metres by the same ratio so OSM features line up across the map
  // (~0.12 % in x, ~0.35 % in z: up to ~10 m at the map edge otherwise).
  let sx = 1;
  let sz = 1;
  if (projectionMatch) {
    const sl = Math.sin(la);
    const w = Math.sqrt(1 - WGS84_E2 * sl * sl);
    const trueMX = ((WGS84_A / w) * Math.cos(la) * Math.PI) / 180;
    const trueMZ = ((WGS84_A * (1 - WGS84_E2)) / (w * w * w)) * DEG;
    sx = (111320 * Math.cos(la)) / trueMX;
    sz = 110574 / trueMZ;
  }
  // rows: game.x = sx·E·(p-o), game.y = U·(p-o), game.z = -sz·N·(p-o)
  target.set(
    sx * east.x, sx * east.y, sx * east.z, -sx * east.dot(o),
    up.x, up.y, up.z, -up.dot(o),
    -sz * north.x, -sz * north.y, -sz * north.z, sz * north.dot(o),
    0, 0, 0, 1
  );
  return target;
}

// ---------------------------------------------------------------- DOM bits

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
.br-gattr{position:fixed;left:8px;bottom:6px;z-index:40;max-width:min(70vw,640px);display:none;align-items:center;gap:8px;
  padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font:11px/1.3 Roboto,Arial,sans-serif;pointer-events:none}
.br-gattr.is-on{display:flex}
.br-gattr b{font:500 14px/1 Roboto,Arial,sans-serif;letter-spacing:-.2px}
.br-gattr span{opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.br-gnote{position:fixed;left:50%;top:14px;z-index:60;transform:translateX(-50%);max-width:min(90vw,560px);padding:8px 14px;
  border-radius:10px;background:rgba(20,16,48,.92);color:#fff6dc;font:13px/1.35 system-ui,sans-serif;box-shadow:0 4px 0 #120d33;
  pointer-events:none;opacity:0;transition:opacity .25s}
.br-gnote.is-on{opacity:1}`;
  document.head.appendChild(s);
}

let noteEl = null;
let noteTimer = 0;
/** Small self-contained toast (the HUD may not exist yet when the toggle is used from the title screen). */
export function showGoogleTilesNotice(text, ms = 5000) {
  if (typeof document === 'undefined') return;
  injectCss();
  if (!noteEl) {
    noteEl = document.createElement('div');
    noteEl.className = 'br-gnote';
    noteEl.setAttribute('role', 'status');
    document.body.appendChild(noteEl);
  }
  noteEl.textContent = text;
  noteEl.classList.add('is-on');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => noteEl && noteEl.classList.remove('is-on'), ms);
}

function urlNumber(name) {
  try {
    const v = new URLSearchParams(window.location.search).get(name);
    if (v == null || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------- the view

/**
 * Owns one TilesRenderer. Create with `await GoogleTilesView.create(...)`.
 * Throws when the library cannot be loaded; reports later failures via `onError`.
 */
export class GoogleTilesView {
  static async create(opts) {
    const [core, corePlugins, threePlugins, { DRACOLoader }] = await Promise.all([
      import('3d-tiles-renderer'),
      import('3d-tiles-renderer/core/plugins'),
      import('3d-tiles-renderer/three/plugins'),
      import('three/examples/jsm/loaders/DRACOLoader.js'),
    ]);
    return new GoogleTilesView(opts, { core, corePlugins, threePlugins, DRACOLoader });
  }

  constructor({ apiKey, scene, camera, renderer, world, onError }, lib) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.world = world || null;
    this.onError = onError || (() => {});
    this.disposed = false;
    this.modelsLoaded = 0;
    this.tileErrors = 0;

    const fixedHeight = urlNumber('gtilesHeight');
    this.baseHeight = fixedHeight != null ? fixedHeight : GOOGLE_TILES_DEFAULT_HEIGHT;
    this.autoCalibrate = fixedHeight == null;
    this.calibration = 0; // metres added to y by auto-calibration
    this.userOffset = urlNumber('gtilesOffset') || 0;
    this.calibrations = 0;
    // composed map: show real-world tiles only over the downtown core
    const core = coreRect(this.world);
    this.clipPlanes = core ? rectPlanes(core) : null;
    this._prevLocalClipping = renderer.localClippingEnabled;
    if (this.clipPlanes) renderer.localClippingEnabled = true;

    const tiles = new lib.core.TilesRenderer();
    this.tiles = tiles;
    tiles.registerPlugin(new lib.corePlugins.GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    this.dracoLoader = new lib.DRACOLoader().setDecoderPath(DRACO_DECODER_PATH);
    tiles.registerPlugin(new lib.threePlugins.GLTFExtensionsPlugin({ dracoLoader: this.dracoLoader }));
    if (lib.threePlugins.TileCompressionPlugin) tiles.registerPlugin(new lib.threePlugins.TileCompressionPlugin());
    if (lib.threePlugins.UnloadTilesPlugin) tiles.registerPlugin(new lib.threePlugins.UnloadTilesPlugin());
    tiles.errorTarget = 20;

    tiles.group.name = 'google-3d-tiles';
    this._applyTransform();
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);

    this._onLoadError = (e) => {
      if (this.disposed) return;
      if (!e.tile) {
        const msg = e.error && e.error.message ? e.error.message : String(e.error || 'network error');
        this.onError(new Error(/40[13]/.test(msg) ? 'Google rejected the API key (check Map Tiles API, billing and key restrictions).' : 'Could not reach Google 3D Tiles: ' + msg));
        return;
      }
      this.tileErrors++;
      if (this.tileErrors >= 25 && this.modelsLoaded === 0) this.onError(new Error('Google 3D Tiles keep failing to load.'));
    };
    this._onLoadModel = ({ scene: model }) => {
      this.modelsLoaded++;
      // tiles are self-lit photos: no shadows, keep fog so they melt into the horizon
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
          if (this.clipPlanes) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) m.clippingPlanes = this.clipPlanes;
        }
      });
    };
    this._onLoadEnd = () => {
      if (this.autoCalibrate && this.calibrations < 6) this.calibrate();
    };
    tiles.addEventListener('load-error', this._onLoadError);
    tiles.addEventListener('load-model', this._onLoadModel);
    tiles.addEventListener('tiles-load-end', this._onLoadEnd);

    scene.add(tiles.group);
  }

  _applyTransform() {
    // not a pure TRS (tiny non-uniform map scale), so drive the matrix directly
    const g = this.tiles.group;
    g.matrixAutoUpdate = false;
    ecefToGameMatrix({ height: this.baseHeight }, g.matrix);
    g.matrix.elements[13] += this.calibration + this.userOffset;
    g.matrixWorldNeedsUpdate = true;
    g.updateMatrixWorld(true);
  }

  setHeightOffset(m) {
    this.userOffset = Number(m) || 0;
    this._applyTransform();
  }

  /**
   * Matches the tiles' ground to World's ground near the camera: ray cast a 3x3 grid,
   * take the second-lowest difference (roofs and trees only push hits upward).
   */
  calibrate() {
    if (this.disposed) return null;
    const cx = this.camera.position.x;
    const cz = this.camera.position.z;
    const w = this.world;
    const ground = (x, z) => (w && typeof w.terrainHeight === 'function' ? w.terrainHeight(x, z) || 0 : 0);
    const ray = new THREE.Raycaster();
    ray.firstHitOnly = true;
    const diffs = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const x = cx + i * 25;
        const z = cz + j * 25;
        ray.set(new THREE.Vector3(x, 1500, z), new THREE.Vector3(0, -1, 0));
        ray.far = 3000;
        let hits = [];
        try {
          hits = ray.intersectObject(this.tiles.group, true);
        } catch (err) {
          hits = [];
        }
        if (hits.length) diffs.push(hits[0].point.y - ground(x, z));
      }
    }
    if (diffs.length < 5) return null;
    diffs.sort((a, b) => a - b);
    const d = diffs[1]; // current error relative to the game's ground
    const next = THREE.MathUtils.clamp(this.calibration - d, -CALIBRATION_LIMIT, CALIBRATION_LIMIT);
    this.calibrations++;
    if (Math.abs(next - this.calibration) > 0.05) {
      this.calibration = next;
      this._applyTransform();
    }
    return this.calibration;
  }

  update() {
    if (this.disposed) return;
    this.camera.updateMatrixWorld();
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.update();
  }

  /** Attribution strings: always non-empty once anything is visible. */
  getAttributionText() {
    const out = [];
    try {
      this.tiles.getAttributions(out);
    } catch (err) {
      /* ignore */
    }
    return out
      .filter((a) => a && a.type === 'string' && a.value)
      .map((a) => a.value)
      .join('; ');
  }

  get visibleCount() {
    return this.tiles.visibleTiles ? this.tiles.visibleTiles.size : 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.clipPlanes) this.renderer.localClippingEnabled = this._prevLocalClipping;
    const t = this.tiles;
    t.removeEventListener('load-error', this._onLoadError);
    t.removeEventListener('load-model', this._onLoadModel);
    t.removeEventListener('tiles-load-end', this._onLoadEnd);
    if (t.group.parent) t.group.parent.remove(t.group);
    try {
      t.dispose();
    } catch (err) {
      /* ignore */
    }
    try {
      this.dracoLoader.dispose();
    } catch (err) {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- world hiding

/**
 * Hides the procedural world from cameras (and shadow cameras) by moving every world
 * mesh to an unused layer. Layers, not `.visible`, because WorldMeshes' distance culling
 * rewrites `.visible` every frame. Restores the exact previous masks.
 */
class WorldHider {
  constructor() {
    this.saved = new Map();
    this.clipped = new Map(); // material -> [clippingPlanes, clipIntersection, clipShadows]
    this.core = null;
    this.outside = null; // planes whose intersection clips the INSIDE of the core
  }

  _hide(o) {
    if (this.saved.has(o)) return;
    const c = this.core;
    if (c && o.isMesh) {
      const cx = o.userData.cx;
      const cz = o.userData.cz;
      let clip = true;
      if (typeof cx === 'number' && typeof cz === 'number') {
        // chunked meshes (buildings, trees, props): judge by the chunk's world AABB, not its
        // centre. Fully outside the core: keep. Fully inside: hide (below). Straddling the
        // edge: cut the core out like the map-wide meshes. Chunk materials are only shared
        // with other world chunks, and everything inside the core is replaced by the tiles,
        // so clipping a shared material is harmless.
        const b = _chunkBox.makeEmpty().expandByObject(o);
        if (b.isEmpty() || b.max.x < c[0] || b.min.x > c[2] || b.max.z < c[1] || b.min.z > c[3]) return;
        clip = !(b.min.x >= c[0] && b.max.x <= c[2] && b.min.z >= c[1] && b.max.z <= c[3]);
      }
      if (clip) {
        // map-wide meshes (ground, roads/land cover) and straddling chunks: cut the core
        // out, keep the islands (and the shadows of what is kept)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || this.clipped.has(m)) continue;
          this.clipped.set(m, [m.clippingPlanes, m.clipIntersection, m.clipShadows]);
          m.clippingPlanes = this.outside;
          m.clipIntersection = true;
          m.clipShadows = true;
          m.needsUpdate = true;
        }
        return;
      }
    }
    this.saved.set(o, o.layers.mask);
    o.layers.set(HIDDEN_LAYER);
  }

  apply(game) {
    const core = coreRect(game.world);
    if (core && !this.core) {
      this.core = core;
      this.outside = rectPlanes(core).map((p) => p.clone().negate());
    }
    const view = game.view;
    if (view && view.root) view.root.traverse((o) => this._hide(o));
    // tree / prop instancers live directly on the scene; WorldMeshes tags their chunk centre
    for (const o of game.scene.children) {
      if (o.isInstancedMesh && typeof o.userData.cx === 'number' && typeof o.userData.cz === 'number') o.traverse((c) => this._hide(c));
      if (o.name === 'world' && o !== (view && view.root)) o.traverse((c) => this._hide(c));
    }
  }

  restore() {
    for (const [o, mask] of this.saved) o.layers.mask = mask;
    this.saved.clear();
    for (const [m, [planes, inter, shadows]] of this.clipped) {
      m.clippingPlanes = planes;
      m.clipIntersection = inter;
      m.clipShadows = shadows;
      m.needsUpdate = true;
    }
    this.clipped.clear();
    this.core = this.outside = null;
  }
}

// ---------------------------------------------------------------- controller

/**
 * Glue between settings and the game. Never throws; any failure reverts to the normal
 * world, shows a notice and calls `onFail(message)` (main.js turns the setting off).
 */
export function createGoogleTilesController({ getGame, onFail } = {}) {
  const key = googleTilesKey();
  const hider = new WorldHider();
  let wanted = false;
  let view = null;
  let starting = false;
  let raf = 0;
  let attrEl = null;
  let attrT = 0;
  let rehideT = 0;
  let status = key ? 'off' : 'unavailable';
  let generation = 0;

  function attribution(text) {
    if (typeof document === 'undefined') return;
    injectCss();
    if (!attrEl) {
      attrEl = document.createElement('div');
      attrEl.className = 'br-gattr';
      attrEl.setAttribute('aria-label', 'Map data attribution');
      attrEl.innerHTML = '<b>Google</b><span></span>';
      document.body.appendChild(attrEl);
    }
    if (text == null) {
      attrEl.classList.remove('is-on');
      return;
    }
    attrEl.querySelector('span').textContent = text;
    attrEl.classList.add('is-on');
  }

  function teardown() {
    if (view) view.dispose();
    view = null;
    hider.restore();
    attribution(null);
  }

  function fail(err) {
    const msg = (err && err.message) || String(err);
    console.warn('[GoogleTiles] disabled:', msg);
    generation++;
    wanted = false;
    starting = false;
    teardown();
    status = 'failed';
    showGoogleTilesNotice('Real-world 3D view turned off: ' + msg, 7000);
    if (onFail) {
      try {
        onFail(msg);
      } catch (e) {
        /* ignore */
      }
    }
  }

  async function start(game) {
    starting = true;
    status = 'loading';
    const gen = ++generation;
    try {
      const v = await GoogleTilesView.create({
        apiKey: key,
        scene: game.scene,
        camera: game.camera,
        renderer: game.renderer,
        world: game.world,
        onError: (e) => fail(e),
      });
      if (gen !== generation || !wanted) {
        v.dispose();
        return;
      }
      view = v;
      hider.apply(game);
      status = 'on';
      if (typeof window !== 'undefined') window.__brGoogleTiles = v;
      showGoogleTilesNotice('Streaming Google Photorealistic 3D Tiles. Collision still uses the game map.', 4000);
    } catch (err) {
      if (gen === generation) fail(err);
    } finally {
      if (gen === generation) starting = false;
    }
  }

  function tick(now) {
    raf = 0;
    if (!wanted) return;
    raf = requestAnimationFrame(tick);
    const game = getGame && getGame();
    if (!game) return;
    if (!view) {
      if (!starting && game.loaded && game.view && game.scene && game.camera && game.renderer) start(game);
      else if (!starting) status = 'waiting';
      return;
    }
    try {
      view.update();
      if (now - rehideT > 2000) {
        rehideT = now;
        hider.apply(game); // catches meshes added after enabling
      }
      if (now - attrT > 400) {
        attrT = now;
        // Required by Google: show the attribution whenever tiles are visible.
        const txt = view.getAttributionText();
        attribution(view.visibleCount > 0 || txt ? txt || 'Map data ©Google' : 'Loading 3D Tiles…');
      }
    } catch (err) {
      fail(err);
    }
  }

  return {
    get available() {
      return !!key;
    },
    get status() {
      return status;
    },
    get view() {
      return view;
    },
    setEnabled(on) {
      on = !!on && !!key;
      if (on === wanted) return;
      wanted = on;
      if (on) {
        status = 'waiting';
        if (!raf) raf = requestAnimationFrame(tick);
      } else {
        generation++;
        starting = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        teardown();
        status = key ? 'off' : 'unavailable';
      }
    },
    dispose() {
      this.setEnabled(false);
    },
  };
}
