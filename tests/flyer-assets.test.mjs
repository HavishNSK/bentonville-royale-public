// The update flyer's data, images and shot list (tools/flyer/): every image it shows is shipped,
// described, within budget, and reproducible from tools/flyer/shots/<version>.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { FLYER } from '../src/data/updateFlyer.js';
import { PATCH_NOTES, LATEST_VERSION } from '../src/data/patchNotes.js';
import { validateShotList, loadShotList, coverage, flyerImages, BUDGET, RARITIES } from '../tools/flyer/shots.mjs';

const pub = (src) => new URL('../public' + src, import.meta.url);
const cmp = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

test('the flyer is for a released version, never newer than the newest patch notes', () => {
  // A flyer shows once per FLYER.version; a later patch without a flyer of its own keeps showing
  // the last one, so FLYER.version is the newest version that HAS a flyer, not always PATCH_NOTES[0].
  assert.ok(PATCH_NOTES.some((n) => n.version === FLYER.version), `${FLYER.version} has a PATCH_NOTES entry`);
  assert.equal(PATCH_NOTES[0].version, LATEST_VERSION);
  assert.ok(cmp(FLYER.version, LATEST_VERSION) <= 0, `flyer ${FLYER.version} is not ahead of ${LATEST_VERSION}`);
});

test('the flyer copy has its parts', () => {
  assert.ok(FLYER.kicker && FLYER.tagline, 'kicker and tagline');
  assert.equal(FLYER.title.length, 2, 'title: [big, small]');
  assert.ok(FLYER.title[0].length <= 14, 'the big title word fits the hero');
  assert.ok(FLYER.sections.length >= 1 && FLYER.sections.length <= 5, '1..5 sections');
  const ids = new Set();
  for (const s of FLYER.sections) {
    assert.match(s.id, /^[a-z0-9-]+$/, 'section id is a css-safe slug');
    assert.ok(!ids.has(s.id), 'unique section ids');
    ids.add(s.id);
    assert.ok(s.tag && s.tag.length <= 12, `${s.id}: short tag`);
    assert.ok(s.title, `${s.id}: title`);
    assert.ok(s.items || s.images || s.bullets, `${s.id}: has content`);
    for (const it of s.items || []) {
      assert.ok(RARITIES.includes(it.rarity), `${it.name}: rarity "${it.rarity}" is one of ${RARITIES.join(', ')}`);
      assert.ok(it.name && it.text, 'item card has a name and text');
    }
  }
});

test('every flyer image is shipped, described and within budget', () => {
  const imgs = flyerImages(FLYER);
  assert.ok(imgs.length >= 1);
  for (const im of imgs) {
    assert.match(im.src, /^\/ui\/news\/[a-z0-9-]+\.(png|jpg)$/, `${im.where}: path`);
    assert.ok(im.alt && im.alt.trim().length >= 3, `${im.where}: alt text / name`);
    const url = pub(im.src);
    assert.ok(existsSync(url), `${im.src} missing from public/`);
    const buf = readFileSync(url);
    const size = statSync(url).size;
    if (im.src.endsWith('.jpg')) {
      assert.ok(buf[0] === 0xff && buf[1] === 0xd8, `${im.src} is a JPEG`);
      assert.ok(size <= BUDGET.jpg, `${im.src}: ${size} B over the ${BUDGET.jpg} B JPEG budget`);
    } else {
      assert.equal(buf.toString('latin1', 1, 4), 'PNG', `${im.src} is a PNG`);
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      assert.equal(w, h, `${im.src}: item renders are square`);
      assert.ok(w <= 1024, `${im.src}: at most 1024 px`);
      // transparent background: RGBA, or (capture's fallback for big glows) a palette with tRNS
      assert.ok(buf[25] === 6 || (buf[25] === 3 && buf.includes(Buffer.from('tRNS'))), `${im.src}: has transparency`);
      assert.ok(size <= BUDGET.png, `${im.src}: ${size} B over the ${BUDGET.png} B PNG budget`);
    }
  }
  // scene images (not item renders) need a real description
  for (const im of imgs.filter((i) => i.src.endsWith('.jpg'))) assert.ok(im.alt.length > 10, `${im.src}: alt text describes the scene`);
});

test('the shot list for this flyer is valid and covers every image', async () => {
  const list = await loadShotList(FLYER.version);
  assert.ok(list, `tools/flyer/shots/${FLYER.version}.mjs exists`);
  assert.equal(list.version, FLYER.version);
  assert.deepEqual(validateShotList(list), []);
  const cov = coverage(FLYER, list);
  assert.deepEqual(cov.missing, [], 'every flyer image has a shot or is listed in reuse');
  assert.deepEqual(cov.orphans, [], 'no shot writes an image the flyer does not show');
  for (const f of list.reuse || []) assert.ok(existsSync(pub('/ui/news/' + f)), `reused ${f} is shipped`);
});

test('the shot-list validator rejects what capture cannot do', () => {
  const base = { version: '1.2.3', shots: [] };
  const errs = (shot) => validateShotList({ ...base, shots: [shot] });
  assert.deepEqual(errs({ kind: 'item', file: 'bb-item-x.png', item: 'grenade' }), []);
  assert.deepEqual(errs({ kind: 'scene', file: 'bb-x.jpg', camera: { target: 'van:square', heading: 0, pitch: 0, distance: 8 } }), []);
  assert.ok(errs({ kind: 'scene', file: 'bb-x.jpg', camera: { pos: { x: 0, z: 0 }, lookAt: { x: 1, z: 0 } }, setup: [{ do: 'rm -rf' }] }).some((e) => /unknown action/.test(e)));
  assert.ok(errs({ kind: 'scene', file: 'bb-x.jpg', camera: { pos: { x: 0, z: 0 }, lookAt: { x: 1, z: 0 }, timeOfDay: 'dusk' } }).some((e) => /not supported/.test(e)));
  assert.ok(errs({ kind: 'scene', file: '../evil.jpg', player: { x: 0, z: 0 } }).some((e) => /file/.test(e)));
  assert.ok(errs({ kind: 'scene', file: 'bb-x.png', player: { x: 0, z: 0 } }).some((e) => /\.jpg/.test(e)));
  assert.ok(errs({ kind: 'item', file: 'bb-x.png', item: 'grenade', glow: 'mythic' }).some((e) => /glow/.test(e)));
  assert.ok(errs({ kind: 'scene', file: 'bb-x.jpg', camera: { target: 'nowhere:1', heading: 0, pitch: 0, distance: 8 } }).some((e) => /unknown ref/.test(e)));
  assert.ok(validateShotList({ ...base, shots: [{ kind: 'item', file: 'a.png', item: 'smg' }, { kind: 'item', file: 'a.png', item: 'smg' }] }).some((e) => /duplicate/.test(e)));
});
