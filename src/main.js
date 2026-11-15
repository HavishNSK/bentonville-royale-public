// BENTONVILLE ROYALE — entry point: boot into the title screen, wire menus to the game.

import { Game } from './game/Game.js';
import { createMenus } from './ui/menus.js';
import { loadSettings, saveSettings } from './ui/settings.js';
import { sfx } from './audio/Sfx.js';
import { createGoogleTilesController, hasGoogleTilesKey } from './render/GoogleTiles.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui-root');
const bootError = document.getElementById('boot-error');

function showError(msg) {
  bootError.textContent = msg;
  bootError.style.display = 'block';
}

let settings = loadSettings();
sfx.autoUnlock(window);
sfx.setVolume(settings.volume);

// Optional local menu music, served only by the local dev/preview server from
// local-music/menu.mp3 (git-ignored, never built or deployed). Falls back to
// the synthesized theme when absent.
fetch('/local-music/menu.mp3', { method: 'HEAD' })
  .then((r) => {
    const type = r.headers.get('content-type') || '';
    if (r.ok && type.startsWith('audio/')) sfx.setCustomMusic('menu', '/local-music/menu.mp3');
  })
  .catch(() => {});

let game = null;

// Optional Google Photorealistic 3D Tiles view (off by default; inert without a key).
// The library is only imported when the toggle is on and a key is configured.
const googleTiles = createGoogleTilesController({
  getGame: () => game,
  onFail: () => {
    settings = { ...settings, googleTiles: false };
    saveSettings(settings);
    menus.setSettings(settings);
  },
});

const menus = createMenus(uiRoot, {
  settings,
  onClick: () => sfx.play('ui_click'),
  onHover: () => sfx.play('ui_hover', { volume: 0.4 }),
  onPlay: () => play(),
  onPlayAgain: () => play(),
  onResume: () => game && game.pause(false),
  onLeave: () => {
    if (game) game.leave();
    sfx.playMusic('menu');
  },
  googleTilesAvailable: hasGoogleTilesKey(),
  onSettings: (s) => {
    settings = s;
    saveSettings(s);
    googleTiles.setEnabled(s.googleTiles);
    if (game) game.applySettings(s);
    else sfx.setVolume(s.volume);
  },
});

async function play() {
  try {
    if (!game.loaded) {
      menus.showLoading(0, 'Warming up');
      await game.load((p, label) => menus.setLoading(p, label));
    }
    game.startMatch();
  } catch (err) {
    console.error(err);
    showError('Could not start the match: ' + (err && err.message ? err.message : err));
    menus.showTitle();
  }
}

try {
  game = new Game({ canvas, uiRoot, menus, settings });
  menus.showTitle();
  sfx.playMusic('menu');
  googleTiles.setEnabled(settings.googleTiles);
} catch (err) {
  console.error(err);
  showError('Bentonville Royale needs WebGL: ' + (err && err.message ? err.message : err));
}
