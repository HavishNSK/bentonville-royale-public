// BENTONVILLE ROYALE — UI icon set.
// Every icon is hand-drawn inline SVG (no image files, no third-party art).
// Square icons use a 48x48 viewBox, weapon silhouettes a 96x48 viewBox.

import { catfishSvg } from './catfishIcon.js';

const INK = '#0a0a14';
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

/** Draws `shapes` once as a fat dark outline and once as a flat fill, so the
 *  parts read as a single outlined silhouette. `details` go on top. */
function sil(shapes, fill, details = '', w = 6) {
  return (
    `<g fill="${INK}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round">${shapes}</g>` +
    `<g fill="${fill}">${shapes}</g>${details}`
  );
}

const GUN = '#e9edfa';
const GUN_DARK = '#4a4573';
const WOOD = '#c98a45';
const GOLD = '#ffc21f';

const SQUARE = {
  // ---- map markers -----------------------------------------------------
  catfish: catfishSvg(), // Catfish Ken's reboot van

  // ---- materials -------------------------------------------------------
  wood:
    `<path d="M12 14h24v20H12a6 10 0 0 1 0-20z" fill="#b5722f" ${S}/>` +
    `<ellipse cx="36" cy="24" rx="6.5" ry="10" fill="#f3cf8e" ${S}/>` +
    `<ellipse cx="36" cy="24" rx="2.4" ry="4.4" fill="none" stroke="#b5722f" stroke-width="2"/>` +
    `<path d="M13 20h9M17 28h10" fill="none" stroke="#7a4517" stroke-width="2.5" stroke-linecap="round"/>`,
  brick:
    `<rect x="5" y="11" width="38" height="26" rx="3" fill="#e5553a" ${S}/>` +
    `<path d="M5 24h38M24 11v13M14 24v13M34 24v13" fill="none" stroke="${INK}" stroke-width="2.5"/>` +
    `<path d="M9 15.5h10M28 15.5h10" fill="none" stroke="#ff9a7d" stroke-width="2.5" stroke-linecap="round"/>`,
  metal:
    `<polygon points="5,36 43,36 38,22 10,22" fill="#8f9db8" ${S}/>` +
    `<polygon points="10,22 38,22 34,13 14,13" fill="#dbe4f3" ${S}/>` +
    `<path d="M18 17.5h9" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` +
    `<path d="M12 31h7" fill="none" stroke="#c5cfe2" stroke-width="2.5" stroke-linecap="round"/>`,

  // ---- vitals / combat ---------------------------------------------------
  bullets: [11, 24, 37]
    .map(
      (cx) =>
        `<path d="M${cx - 4.5} 22C${cx - 4.5} 14 ${cx - 2} 8 ${cx} 6C${cx + 2} 8 ${cx + 4.5} 14 ${cx + 4.5} 22Z" fill="#e8743b" ${S}/>` +
        `<rect x="${cx - 4.5}" y="22" width="9" height="16" fill="${GOLD}" ${S}/>` +
        `<rect x="${cx - 5.5}" y="38" width="11" height="4" rx="1" fill="#f09a00" ${S}/>`
    )
    .join(''),
  shield:
    `<path d="M24 4L41 10.500V23C41 33.500 33.500 40.500 24 45C14.500 40.500 7 33.500 7 23V10.500Z" fill="#2f9bff" ${S}/>` +
    `<path d="M24 9.200V39.800C17 36 12 30.500 12 23V13.800Z" fill="#8fd4ff"/>`,
  heart:
    `<path d="M24 43C10 33 4.500 25 4.500 16.500C4.500 10 9.500 5.500 15 5.500C19 5.500 22 7.500 24 11.500C26 7.500 29 5.500 33 5.500C38.500 5.500 43.500 10 43.500 16.500C43.500 25 38 33 24 43Z" fill="#ff4f6d" ${S}/>` +
    `<path d="M24 15v14M17 22h14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`,
  pickaxe:
    `<path d="M9 43L32 16" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>` +
    `<path d="M9 43L32 16" fill="none" stroke="${WOOD}" stroke-width="4.5" stroke-linecap="round"/>` +
    `<path d="M17 4Q40 5 46 29Q31 18 17 4Z" fill="#d5deee" ${S}/>` +
    `<path d="M25 8.500Q36 11 41 20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  skull:
    `<path d="M24 4.500C13 4.500 6.500 12 6.500 21C6.500 27 9.500 30.500 13 32.500V38C13 40.500 14.500 42 17 42H31C33.500 42 35 40.500 35 38V32.500C38.500 30.500 41.500 27 41.500 21C41.500 12 35 4.500 24 4.500Z" fill="#fff" ${S}/>` +
    `<circle cx="17" cy="22" r="4.800" fill="${INK}"/><circle cx="31" cy="22" r="4.800" fill="${INK}"/>` +
    `<path d="M24 27.500l-2.600 4.200h5.200z" fill="${INK}"/>` +
    `<path d="M19.500 36.500V42M24 36.500V42M28.500 36.500V42" fill="none" stroke="${INK}" stroke-width="2.500" stroke-linecap="round"/>`,
  people:
    `<circle cx="34" cy="16" r="6" fill="#bcd2ff" ${S}/>` +
    `<path d="M24 41C24 32 28 27 34 27C40 27 45 32 45 41Z" fill="#bcd2ff" ${S}/>` +
    `<circle cx="17" cy="14.500" r="7.500" fill="#fff" ${S}/>` +
    `<path d="M3.500 42C3.500 32 9 26.500 17 26.500C25 26.500 30.500 32 30.500 42Z" fill="#fff" ${S}/>`,
  storm:
    `<path d="M13 30C7 30 3.500 26 3.500 21.500C3.500 17 7 13.500 11.500 13.500C12.500 8.500 17.500 4.500 24 4.500C30.500 4.500 35.500 8.500 36.500 13.500C41 13.500 44.500 17 44.500 21.500C44.500 26 41 30 35 30Z" fill="#c9a8ff" ${S}/>` +
    `<path d="M27 24L18 36H24L21 45.500L33 32H26.500L30 24Z" fill="${GOLD}" ${S}/>`,

  // ---- build pieces ------------------------------------------------------
  wall:
    `<rect x="7" y="7" width="34" height="34" rx="3" fill="#7fc4ff" ${S}/>` +
    `<path d="M7 18.500h34M7 29.500h34" fill="none" stroke="${INK}" stroke-width="2.500"/>` +
    `<path d="M12 12.500h8" fill="none" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/>`,
  floor:
    `<path d="M4 25v6l20 10 20-10v-6z" fill="#3f86e0" ${S}/>` +
    `<polygon points="24,13 44,25 24,37 4,25" fill="#7fc4ff" ${S}/>` +
    `<path d="M14 19l20 12M34 19L14 31" fill="none" stroke="${INK}" stroke-width="2" opacity=".55"/>`,
  ramp:
    `<polygon points="5,41 43,41 43,9" fill="#7fc4ff" ${S}/>` +
    `<path d="M17.500 41V30.500M30 41V20" fill="none" stroke="${INK}" stroke-width="2.500"/>`,
  cone:
    `<polygon points="24,5 45,41 3,41" fill="#7fc4ff" ${S}/>` +
    `<polygon points="24,5 45,41 30,41" fill="#3f86e0" ${S}/>`,

  // ---- consumables -------------------------------------------------------
  potion:
    `<path d="M19 9v8.500C12.500 19.500 8 25 8 31C8 39 15 45 24 45C33 45 40 39 40 31C40 25 35.500 19.500 29 17.500V9Z" fill="#e6f6ff" ${S}/>` +
    `<path d="M10.800 29C13 26.500 17 27 20 29C24 31.500 29 31.500 37.200 28C39 36 32 42.200 24 42.200C16 42.200 9.500 36.500 10.800 29Z" fill="#2f9bff"/>` +
    `<circle cx="19" cy="35.500" r="2" fill="#bfe6ff"/><circle cx="27" cy="37" r="1.400" fill="#bfe6ff"/>` +
    `<rect x="16" y="3" width="16" height="7" rx="2.500" fill="${WOOD}" ${S}/>`,
  medkit:
    `<path d="M17 14V10C17 7.500 18.500 6 21 6H27C29.500 6 31 7.500 31 10V14" fill="none" ${S}/>` +
    `<rect x="4.500" y="13" width="39" height="29" rx="6" fill="#fff" ${S}/>` +
    `<path d="M24 19.500v16M16 27.500h16" fill="none" stroke="#ff4f6d" stroke-width="6.500" stroke-linecap="round"/>`,
  grenade:
    `<path d="M30 8.500L41 16.500" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M30 8.500L41 16.500" fill="none" stroke="#c5cfe2" stroke-width="3.500" stroke-linecap="round"/>` +
    `<circle cx="13" cy="9" r="4.500" fill="none" stroke="${INK}" stroke-width="6"/>` +
    `<circle cx="13" cy="9" r="4.500" fill="none" stroke="${GOLD}" stroke-width="2.500"/>` +
    `<rect x="17" y="5" width="14" height="9" rx="2.500" fill="#8f9db8" ${S}/>` +
    `<ellipse cx="24" cy="29" rx="14.500" ry="16" fill="#5d8a45" ${S}/>` +
    `<path d="M10 26h28M11.500 34h25M19 14.500v29M29 14.500v29" fill="none" stroke="${INK}" stroke-width="2" opacity=".45"/>` +
    `<path d="M15 21.500q2.500-4 6-5" fill="none" stroke="#b9e08f" stroke-width="2.500" stroke-linecap="round"/>`,
  smoke:
    `<ellipse cx="16" cy="12" rx="7" ry="5.5" fill="#e8edf2" ${S}/>` +
    `<ellipse cx="28" cy="9" rx="9" ry="6.5" fill="#f4f6f8" ${S}/>` +
    `<ellipse cx="37" cy="14" rx="6" ry="4.5" fill="#d5dde6" ${S}/>` +
    `<rect x="18" y="18" width="12" height="7" rx="2" fill="#9aa6b4" ${S}/>` +
    `<ellipse cx="24" cy="34" rx="11" ry="12" fill="#c5ccd4" ${S}/>` +
    `<path d="M16 31h16" fill="none" stroke="${INK}" stroke-width="2" opacity=".4"/>` +
    `<path d="M20 22q-6-6-2-12" fill="none" stroke="#c5ccd4" stroke-width="2.5" stroke-linecap="round"/>`,

  // ---- menu / misc -------------------------------------------------------
  play: `<path d="M14 7.500L41 24L14 40.500Z" fill="#fff" ${S}/>`,
  keys:
    `<rect x="3.500" y="11" width="41" height="27" rx="6" fill="#fff" ${S}/>` +
    `<path d="M11 19h3M19 19h3M27 19h3M35 19h2M11 25h3M19 25h3M27 25h3M35 25h2M15 31.500h18" fill="none" stroke="${INK}" stroke-width="3.200" stroke-linecap="round"/>`,
  gear: sil(
    [0, 45, 90, 135]
      .map((a) => `<rect x="19.500" y="4" width="9" height="40" rx="2.500" transform="rotate(${a} 24 24)"/>`)
      .join('') + `<circle cx="24" cy="24" r="14"/>`,
    '#fff',
    `<circle cx="24" cy="24" r="5.500" fill="${INK}"/>`,
    6
  ),
  fullscreen:
    `<path d="M7 18V7h11M30 7h11v11M41 30v11H30M18 41H7V30" fill="none" stroke="${INK}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="M7 18V7h11M30 7h11v11M41 30v11H30M18 41H7V30" fill="none" stroke="#fff" stroke-width="4.500" stroke-linejoin="round" stroke-linecap="round"/>`,
  star: `<polygon points="24,4 29.300,17.200 43.500,18.200 32.600,27.400 36,41.200 24,33.700 12,41.200 15.400,27.400 4.500,18.200 18.700,17.200" fill="${GOLD}" ${S}/>`,
  back:
    `<path d="M28 8L11 24L28 40" fill="none" stroke="${INK}" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="M28 8L11 24L28 40" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`,
  close:
    `<path d="M11 11L37 37M37 11L11 37" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>` +
    `<path d="M11 11L37 37M37 11L11 37" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`,
  clock:
    `<circle cx="24" cy="25" r="18" fill="#fff" ${S}/>` +
    `<path d="M24 14v11.500l7.500 5" fill="none" stroke="${INK}" stroke-width="3.500" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M18 3.500h12" fill="none" ${S}/>`,
  target:
    `<circle cx="24" cy="24" r="19" fill="#fff" ${S}/>` +
    `<circle cx="24" cy="24" r="12" fill="#ff4f6d" ${S}/>` +
    `<circle cx="24" cy="24" r="4.500" fill="#fff" ${S}/>`,
  crown:
    `<path d="M7 38L4 13L15.500 23L24 7L32.500 23L44 13L41 38Z" fill="${GOLD}" ${S}/>` +
    `<path d="M11 32.500h26" fill="none" stroke="#f09a00" stroke-width="3" stroke-linecap="round"/>`,
  home:
    `<path d="M5 23L24 6L43 23V40C43 41.500 42 42.500 40.500 42.500H7.500C6 42.500 5 41.500 5 40Z" fill="#fff" ${S}/>` +
    `<rect x="19" y="27" width="10" height="15.500" fill="#2f9bff" ${S}/>`,
  replay:
    `<path d="M38.500 24A14.500 14.500 0 1 1 33 12.700" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>` +
    `<path d="M38.500 24A14.500 14.500 0 1 1 33 12.700" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M29 4.500L40 12L30 19.500Z" fill="#fff" ${S}/>`,
  pin:
    `<path d="M24 45C14 33 8.500 26 8.500 18.500C8.500 10 15.500 4 24 4C32.500 4 39.500 10 39.500 18.500C39.500 26 34 33 24 45Z" fill="#ff5d4a" ${S}/>` +
    `<circle cx="24" cy="18.500" r="6" fill="#fff" ${S}/>`,
  map:
    `<path d="M4.500 11L17 6L31 11L43.500 6V37L31 42L17 37L4.500 42Z" fill="#fff" ${S}/>` +
    `<path d="M17 6V37M31 11V42" fill="none" stroke="${INK}" stroke-width="2.500"/>` +
    `<circle cx="24" cy="22" r="4" fill="#ff4f6d" ${S}/>`,
  pencil:
    `<path d="M8 10h22v28H12c-2.2 0-4-1.8-4-4V10z" fill="#fff6dc" ${S}/>` +
    `<path d="M14 18h10M14 24h12M14 30h8" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M26 40L42 16l5 5L31 45h-5z" fill="${GOLD}" ${S}/>` +
    `<path d="M42 16l4-4 5 5-4 4z" fill="#ff8aa0" ${S}/>` +
    `<path d="M26 40l-2 6 6-2" fill="#c98a45" ${S}/>`,
};

// ---- weapon silhouettes (96x48, facing right) ------------------------------
const WIDE = {
  rifle: sil(
    `<rect x="60" y="17" width="31" height="4.500" rx="1"/>` +
      `<rect x="84" y="11" width="3.500" height="8"/>` +
      `<rect x="45" y="13.500" width="23" height="10" rx="2"/>` +
      `<rect x="25" y="13" width="25" height="11.500" rx="2"/>` +
      `<rect x="30" y="8" width="13" height="6" rx="1.500"/>` +
      `<polygon points="27,14 6,15.500 4,32 12,32 16,24 27,24"/>` +
      `<polygon points="38,24 48,24 47,40 38,38.500"/>` +
      `<polygon points="27,24 34.500,24 32,37 24.500,36"/>`,
    GUN,
    `<rect x="45" y="13.500" width="23" height="10" rx="2" fill="${GUN_DARK}"/>` +
      `<polygon points="27,14 6,15.500 4,32 12,32 16,24 27,24" fill="${GUN_DARK}"/>` +
      `<polygon points="38,24 48,24 47,40 38,38.500" fill="${GOLD}"/>` +
      `<polygon points="27,24 34.500,24 32,37 24.500,36" fill="${GUN_DARK}"/>` +
      `<path d="M49 16.500h4M56 16.500h4M49 20.500h4M56 20.500h4" stroke="${GUN}" stroke-width="1.500" fill="none"/>`
  ),
  shotgun: sil(
    `<rect x="30" y="14" width="61" height="5.500" rx="2"/>` +
      `<rect x="40" y="20.500" width="43" height="4.500" rx="2"/>` +
      `<rect x="52" y="18.500" width="20" height="9" rx="3"/>` +
      `<rect x="24" y="13.500" width="21" height="12" rx="2"/>` +
      `<polygon points="27,14.500 6,20 4,35 11.500,36 17,28 28,25.500"/>` +
      `<polygon points="27,25 34,25 30,34.500 23,33.500"/>`,
    GUN,
    `<rect x="52" y="18.500" width="20" height="9" rx="3" fill="${WOOD}"/>` +
      `<path d="M57 20.500v5M62 20.500v5M67 20.500v5" stroke="#8a5622" stroke-width="1.500" fill="none"/>` +
      `<polygon points="27,14.500 6,20 4,35 11.500,36 17,28 28,25.500" fill="${WOOD}"/>` +
      `<polygon points="27,25 34,25 30,34.500 23,33.500" fill="${GUN_DARK}"/>`
  ),
  smg: sil(
    `<rect x="22" y="14" width="42" height="12.500" rx="3"/>` +
      `<rect x="62" y="17.500" width="16" height="5.500" rx="1"/>` +
      `<rect x="72" y="15" width="16" height="10.500" rx="3"/>` +
      `<rect x="31" y="9.500" width="20" height="5" rx="1.500"/>` +
      `<polygon points="44,26 53.500,26 52.500,45 43,45"/>` +
      `<polygon points="27,26 35,26 32.500,38.500 24.500,37.500"/>` +
      `<path d="M23 15H7V32h5V20h11Z"/>`,
    GUN,
    `<rect x="72" y="15" width="16" height="10.500" rx="3" fill="${GUN_DARK}"/>` +
      `<polygon points="44,26 53.500,26 52.500,45 43,45" fill="${GOLD}"/>` +
      `<polygon points="27,26 35,26 32.500,38.500 24.500,37.500" fill="${GUN_DARK}"/>` +
      `<path d="M23 15H7V32h5V20h11Z" fill="${GUN_DARK}"/>` +
      `<path d="M40 18.500h14" stroke="${GUN_DARK}" stroke-width="2.500" stroke-linecap="round" fill="none"/>`
  ),
  rocket_launcher: sil(
    `<rect x="18" y="14" width="56" height="12" rx="3"/>` +
      `<polygon points="18,12 6,9 6,31 18,28"/>` +
      `<polygon points="74,13 84,13 94,20 84,27 74,27"/>` +
      `<polygon points="40,26 48,26 46.500,39 38.500,39"/>` +
      `<rect x="52" y="6" width="12" height="8" rx="2"/>`,
    '#6f8f55',
    `<polygon points="74,13 84,13 94,20 84,27 74,27" fill="#ff5a4d"/>` +
      `<polygon points="18,12 6,9 6,31 18,28" fill="${GUN_DARK}"/>` +
      `<polygon points="40,26 48,26 46.500,39 38.500,39" fill="${GUN_DARK}"/>` +
      `<rect x="52" y="6" width="12" height="8" rx="2" fill="${GUN_DARK}"/>` +
      `<rect x="30" y="14" width="5" height="12" fill="${GOLD}"/><rect x="60" y="14" width="5" height="12" fill="${GOLD}"/>`
  ),
  sniper: sil(
    `<rect x="48" y="19.500" width="42" height="4" rx="1"/>` +
      `<rect x="85" y="17.500" width="8" height="8" rx="1.500"/>` +
      `<rect x="22" y="17.500" width="31" height="9.500" rx="2"/>` +
      `<polygon points="25,18.500 4,19.500 3,34 10.500,34 15.500,28 26,27"/>` +
      `<rect x="27" y="6" width="30" height="8" rx="4"/>` +
      `<rect x="32.500" y="12" width="4" height="7"/><rect x="47.500" y="12" width="4" height="7"/>` +
      `<polygon points="26,27 33,27 30.500,37.500 23.500,36.500"/>` +
      `<rect x="38" y="26" width="9" height="8" rx="1.500"/>` +
      `<polygon points="66,23 71,23 65,38 60.500,38"/>`,
    GUN,
    `<polygon points="25,18.500 4,19.500 3,34 10.500,34 15.500,28 26,27" fill="${WOOD}"/>` +
      `<rect x="27" y="6" width="30" height="8" rx="4" fill="${GUN_DARK}"/>` +
      `<circle cx="53" cy="10" r="2" fill="#6fd0ff"/>` +
      `<polygon points="26,27 33,27 30.500,37.500 23.500,36.500" fill="${GUN_DARK}"/>` +
      `<rect x="38" y="26" width="9" height="8" rx="1.500" fill="${GOLD}"/>` +
      `<polygon points="66,23 71,23 65,38 60.500,38" fill="${GUN_DARK}"/>`
  ),
  pistol: sil(
    `<rect x="24" y="9" width="50" height="12.500" rx="2.500"/>` +
      `<rect x="27" y="5.500" width="5" height="5"/><rect x="67" y="5.500" width="4" height="5"/>` +
      `<rect x="30" y="20" width="32" height="6" rx="1.500"/>` +
      `<polygon points="29,21 45,21 41.500,44 26,42"/>` +
      `<path d="M45 25.500h13c0 7-4 10-9.500 10H45Z"/>`,
    GUN,
    `<polygon points="29,21 45,21 41.500,44 26,42" fill="${GUN_DARK}"/>` +
      `<path d="M48.500 27.500h6c-.500 3-2.500 5-6 5Z" fill="${INK}"/>` +
      `<path d="M52 13h16" stroke="${GUN_DARK}" stroke-width="2.500" stroke-linecap="round" fill="none"/>` +
      `<path d="M31.500 28l9 1M30.500 33.500l9 1" stroke="${GUN}" stroke-width="1.500" stroke-linecap="round" fill="none" opacity=".7"/>`
  ),
  // ---- variants (share a world mesh with the base gun, distinct HUD art) ----
  burst_rifle: sil(
    `<rect x="62" y="17.500" width="29" height="4" rx="1"/>` +
      `<rect x="40" y="13" width="26" height="10.500" rx="2"/>` +
      `<rect x="16" y="13" width="28" height="13" rx="3"/>` +
      `<rect x="20" y="6.500" width="34" height="5" rx="2"/>` +
      `<rect x="24" y="10" width="4" height="4"/><rect x="47" y="10" width="4" height="4"/>` +
      `<polygon points="17,14 5,16 4,31 11,31 14,26 17,26"/>` +
      `<polygon points="24,26 33,26 32,41 23,40"/>` +
      `<polygon points="46,23.500 55,23.500 51,35 43,34"/>`,
    GUN,
    `<rect x="16" y="13" width="28" height="13" rx="3" fill="${GUN_DARK}"/>` +
      `<polygon points="24,26 33,26 32,41 23,40" fill="${GOLD}"/>` +
      `<polygon points="46,23.500 55,23.500 51,35 43,34" fill="${GUN_DARK}"/>` +
      `<circle cx="52" cy="18" r="1.800" fill="#ff7a45"/><circle cx="57" cy="18" r="1.800" fill="#ff7a45"/><circle cx="62" cy="18" r="1.800" fill="#ff7a45"/>`
  ),
  tac_shotgun: sil(
    `<rect x="34" y="14" width="52" height="6" rx="2"/>` +
      `<rect x="44" y="20.500" width="34" height="5" rx="2"/>` +
      `<rect x="20" y="13" width="28" height="13" rx="2"/>` +
      `<rect x="26" y="9" width="14" height="5" rx="1.500"/>` +
      `<polygon points="21,15 6,17 5,30 11,30 14,25 21,25"/>` +
      `<polygon points="26,26 34,26 31,39 23,38"/>` +
      `<rect x="38" y="25" width="8" height="12" rx="1.500"/>`,
    GUN,
    `<rect x="44" y="20.500" width="34" height="5" rx="2" fill="${GUN_DARK}"/>` +
      `<polygon points="21,15 6,17 5,30 11,30 14,25 21,25" fill="${GUN_DARK}"/>` +
      `<polygon points="26,26 34,26 31,39 23,38" fill="${GUN_DARK}"/>` +
      `<rect x="38" y="25" width="8" height="12" rx="1.500" fill="#ff5d4a"/>` +
      `<path d="M52 17h22" stroke="${GUN_DARK}" stroke-width="1.500" fill="none"/>`
  ),
  heavy_shotgun: sil(
    `<rect x="28" y="12.500" width="62" height="8.500" rx="3"/>` +
      `<rect x="84" y="10.500" width="8" height="12.500" rx="2"/>` +
      `<rect x="44" y="21" width="30" height="8" rx="3"/>` +
      `<rect x="20" y="12" width="26" height="14" rx="2"/>` +
      `<polygon points="22,13.500 5,18 4,34 11.500,35 16,27 23,26"/>` +
      `<polygon points="26,26 34,26 30,36 22,35"/>`,
    GUN,
    `<rect x="44" y="21" width="30" height="8" rx="3" fill="${GUN_DARK}"/>` +
      `<path d="M50 23v4M56 23v4M62 23v4M68 23v4" stroke="${GUN}" stroke-width="1.500" fill="none"/>` +
      `<polygon points="22,13.500 5,18 4,34 11.500,35 16,27 23,26" fill="${GUN_DARK}"/>` +
      `<polygon points="26,26 34,26 30,36 22,35" fill="${GOLD}"/>` +
      `<rect x="84" y="10.500" width="8" height="12.500" rx="2" fill="${GUN_DARK}"/>`
  ),
  suppressed_smg: sil(
    `<rect x="18" y="14" width="36" height="12.500" rx="3"/>` +
      `<rect x="52" y="14.500" width="40" height="10" rx="5"/>` +
      `<rect x="25" y="9.500" width="18" height="5" rx="1.500"/>` +
      `<polygon points="36,26 45,26 44,44 35,44"/>` +
      `<polygon points="21,26 29,26 26.500,38.500 18.500,37.500"/>` +
      `<path d="M19 15H5V31h5V20h9Z"/>`,
    GUN,
    `<rect x="52" y="14.500" width="40" height="10" rx="5" fill="${GUN_DARK}"/>` +
      `<path d="M60 16.500v6M68 16.500v6M76 16.500v6M84 16.500v6" stroke="${INK}" stroke-width="1.500" fill="none" opacity=".6"/>` +
      `<polygon points="36,26 45,26 44,44 35,44" fill="${GUN_DARK}"/>` +
      `<polygon points="21,26 29,26 26.500,38.500 18.500,37.500" fill="${GUN_DARK}"/>` +
      `<path d="M19 15H5V31h5V20h9Z" fill="${GUN_DARK}"/>`
  ),
  hunting_rifle: sil(
    `<rect x="46" y="18" width="46" height="4" rx="1"/>` +
      `<rect x="22" y="16" width="30" height="9" rx="2"/>` +
      `<polygon points="24,17 4,19.500 3,33 10,33 15,26 26,25"/>` +
      `<polygon points="40,25 78,22 78,26 42,28"/>` +
      `<rect x="30" y="11" width="10" height="5" rx="1"/>` +
      `<polygon points="26,25 33,25 30.500,35.500 23.500,34.500"/>` +
      `<rect x="88" y="14.500" width="3" height="4"/>`,
    GUN,
    `<polygon points="24,17 4,19.500 3,33 10,33 15,26 26,25" fill="${WOOD}"/>` +
      `<polygon points="40,25 78,22 78,26 42,28" fill="${WOOD}"/>` +
      `<polygon points="26,25 33,25 30.500,35.500 23.500,34.500" fill="${WOOD}"/>` +
      `<rect x="30" y="11" width="10" height="5" rx="1" fill="${GOLD}"/>`
  ),
};

/**
 * @param {string} name icon id (see SQUARE / WIDE above)
 * @param {string} [cls] extra class names
 * @returns {string} inline SVG markup ('' if the icon is unknown)
 */
export function icon(name, cls = '') {
  const wide = WIDE[name];
  const body = wide || SQUARE[name];
  if (!body) return '';
  const box = wide ? '0 0 96 48' : '0 0 48 48';
  return `<svg class="br-ico${wide ? ' br-ico-wide' : ''} br-ico-${name}${cls ? ' ' + cls : ''}" viewBox="${box}" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function hasIcon(name) {
  return !!(SQUARE[name] || WIDE[name]);
}

export const ICON_NAMES = [...Object.keys(SQUARE), ...Object.keys(WIDE)];
