// BENTONVILLE ROYALE — persisted player settings (incl. key bindings).

export const SETTINGS_KEY = 'bentonville-royale.settings.v1';

/**
 * Every remappable gameplay action. `def` is a KeyboardEvent.code, or
 * 'Mouse0' (left) / 'Mouse1' (middle) / 'Mouse2' (right) for mouse buttons.
 * Escape (pause) and the mouse wheel (cycle slots) are fixed.
 */
export const ACTIONS = Object.freeze([
  { id: 'moveForward', label: 'Move forward', group: 'Movement', def: 'KeyW' },
  { id: 'moveBack', label: 'Move back', group: 'Movement', def: 'KeyS' },
  { id: 'moveLeft', label: 'Move left', group: 'Movement', def: 'KeyA' },
  { id: 'moveRight', label: 'Move right', group: 'Movement', def: 'KeyD' },
  { id: 'jump', label: 'Jump / deploy glider', group: 'Movement', def: 'Space' },
  { id: 'sprint', label: 'Sprint', group: 'Movement', def: 'ShiftLeft' },
  { id: 'crouch', label: 'Crouch', group: 'Movement', def: 'ControlLeft' },
  { id: 'crouchAlt', label: 'Crouch (alternate)', group: 'Movement', def: 'KeyZ' },
  { id: 'fire', label: 'Fire / swing / place', group: 'Combat', def: 'Mouse0' },
  { id: 'aim', label: 'Aim down sights', group: 'Combat', def: 'Mouse2' },
  { id: 'reload', label: 'Reload', group: 'Combat', def: 'KeyR' },
  { id: 'interact', label: 'Interact / loot', group: 'Combat', def: 'KeyE' },
  { id: 'carry', label: 'Carry / drop knocked teammate', group: 'Combat', def: 'KeyH' },
  { id: 'ping', label: 'Ping / mark a spot for your team', group: 'Combat', def: 'Mouse1' },
  { id: 'inventory', label: 'Inventory', group: 'Inventory', def: 'Tab' },
  { id: 'pickaxe', label: 'Pickaxe', group: 'Inventory', def: 'KeyF' },
  { id: 'slot1', label: 'Slot 1', group: 'Inventory', def: 'Digit1' },
  { id: 'slot2', label: 'Slot 2', group: 'Inventory', def: 'Digit2' },
  { id: 'slot3', label: 'Slot 3', group: 'Inventory', def: 'Digit3' },
  { id: 'slot4', label: 'Slot 4', group: 'Inventory', def: 'Digit4' },
  { id: 'slot5', label: 'Slot 5', group: 'Inventory', def: 'Digit5' },
  { id: 'buildWall', label: 'Build wall', group: 'Building', def: 'KeyQ' },
  { id: 'buildFloor', label: 'Build floor', group: 'Building', def: 'KeyC' },
  { id: 'buildRamp', label: 'Build ramp', group: 'Building', def: 'KeyV' },
  { id: 'buildCone', label: 'Build cone', group: 'Building', def: 'KeyX' },
  { id: 'cycleMaterial', label: 'Switch material', group: 'Building', def: 'KeyG' },
  { id: 'edit', label: 'Edit piece', group: 'Building', def: 'KeyT' },
  { id: 'map', label: 'Full map', group: 'Other', def: 'KeyM' },
  { id: 'emote', label: 'Emote', group: 'Other', def: 'KeyB' },
]);

export const DEFAULT_BINDINGS = Object.freeze(Object.fromEntries(ACTIONS.map((a) => [a.id, a.def])));

/** Codes that can never be bound (reserved by the browser / pause). */
export const RESERVED_CODES = Object.freeze(['Escape', 'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12']);

export const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1, // 0.2 .. 3
  adsSensitivity: 0.6, // multiplier on sensitivity while aiming, 0.1 .. 2
  fov: 68, // vertical degrees, 55 .. 100 (CAMERA.fov default)
  quality: 'medium', // 'low' | 'medium' | 'high'
  volume: 0.7, // master, 0 .. 1
  sfxVolume: 1, // 0 .. 1
  musicVolume: 0.6, // 0 .. 1
  uiVolume: 1, // 0 .. 1
  invertY: false,
  showFps: false,
  autoPickupAmmo: true,
  editOnRelease: false, // releasing the mouse after selecting edit tiles confirms the edit
  editWheelReset: false, // the mouse wheel resets the piece being edited
  difficulty: 'normal', // 'easy' | 'normal' | 'hard'
  performanceMode: false, // Chromebook / weak laptop: half-res, no post, short draw distances
  googleTiles: false, // optional Google Photorealistic 3D Tiles view (needs VITE_GOOGLE_MAPS_API_KEY)
  bindings: DEFAULT_BINDINGS,
});

export const QUALITY_OPTIONS = ['low', 'medium', 'high'];
export const DIFFICULTY_OPTIONS = ['easy', 'normal', 'hard'];

const num = (v, lo, hi, fallback) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

const CODE_RE = /^(Mouse[0-4]|[A-Za-z][A-Za-z0-9]{0,24})$/;

/** Clean bindings map: every action present, unknown actions dropped, bad codes -> default. */
export function sanitizeBindings(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const a of ACTIONS) {
    const c = b[a.id];
    out[a.id] = typeof c === 'string' && CODE_RE.test(c) && !RESERVED_CODES.includes(c) ? c : a.def;
  }
  return out;
}

/** Returns a clean settings object no matter what was passed in. */
export function sanitizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    sensitivity: num(s.sensitivity, 0.2, 3, d.sensitivity),
    adsSensitivity: num(s.adsSensitivity, 0.1, 2, d.adsSensitivity),
    fov: num(s.fov, 55, 100, d.fov),
    quality: QUALITY_OPTIONS.includes(s.quality) ? s.quality : d.quality,
    volume: num(s.volume, 0, 1, d.volume),
    sfxVolume: num(s.sfxVolume, 0, 1, d.sfxVolume),
    musicVolume: num(s.musicVolume, 0, 1, d.musicVolume),
    uiVolume: num(s.uiVolume, 0, 1, d.uiVolume),
    invertY: bool(s.invertY, d.invertY),
    showFps: bool(s.showFps, d.showFps),
    autoPickupAmmo: bool(s.autoPickupAmmo, d.autoPickupAmmo),
    editOnRelease: bool(s.editOnRelease, d.editOnRelease),
    editWheelReset: bool(s.editWheelReset, d.editWheelReset),
    difficulty: DIFFICULTY_OPTIONS.includes(s.difficulty) ? s.difficulty : d.difficulty,
    performanceMode: bool(s.performanceMode, d.performanceMode),
    // Performance mode forces Google tiles off (too heavy for Chromebooks).
    googleTiles: s.performanceMode === true ? false : s.googleTiles === true,
    bindings: sanitizeBindings(s.bindings),
  };
}

/** QUALITY key actually used for rendering (performance mode overrides the quality picker). */
export function graphicsQuality(settings) {
  if (settings && settings.performanceMode) return 'performance';
  return settings && QUALITY_OPTIONS.includes(settings.quality) ? settings.quality : 'medium';
}

/** Human label for a binding code: 'KeyW' -> 'W', 'Mouse0' -> 'LMB', 'ShiftLeft' -> 'L-SHIFT'. */
export function keyLabel(code) {
  if (!code) return '—';
  const fixed = {
    Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'MB4', Mouse4: 'MB5',
    Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT', AltRight: 'R-ALT', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', CapsLock: 'CAPS',
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'ENTER', Backspace: 'BKSP', Tab: 'TAB',
  };
  if (fixed[code]) return fixed[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6).toUpperCase();
  return code.toUpperCase();
}

/**
 * Rebinds `action` to `code`. If another action already uses `code`, the two swap
 * keys. Returns { bindings, swapped } where swapped is the other action id or null.
 */
export function rebind(bindings, action, code) {
  const b = sanitizeBindings(bindings);
  let swapped = null;
  for (const id in b) {
    if (id !== action && b[id] === code) {
      b[id] = b[action];
      swapped = id;
    }
  }
  b[action] = code;
  return { bindings: b, swapped };
}

export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch (err) {
    /* private mode / blocked storage / bad JSON: fall through to defaults */
  }
  return sanitizeSettings(null);
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(settings)));
    return true;
  } catch (err) {
    return false;
  }
}
