// Crystal Bridges walkthrough (musewalk scripts/verify.mjs idea, ported to this game's QA harness).
//
//   npm run dev   (in another terminal)
//   node tools/qa/smoke.mjs --url http://localhost:5173 --script tools/qa/crystal-bridges.steps.mjs --out tools/qa/out/cb --timeout 240000
//
// Opens Museum Mode, then for every gallery wing: stands in front of its first work, checks a
// caption is offered, screenshots. Then checks focus mode (panel opens / closes with E) and that a
// painting portal (walk into Kindred Spirits, if its image is downloaded) lands at its paired spot.
// Any failed check throws, which the harness reports as scriptError (and a non-zero exit).

export default async function (page, h) {
  const fail = (msg) => {
    throw new Error('CB walkthrough: ' + msg);
  };
  await page.evaluate(() => document.querySelector('[data-act="museum"]').click());
  for (let i = 0; i < 160; i++) {
    if ((await h.evalJSON('window.__game && window.__game.state')) === 'play') break;
    await h.sleep(500);
  }
  if ((await h.evalJSON('window.__game.state')) !== 'play') fail('museum mode did not start');
  await h.sleep(2500);
  const start = await h.evalJSON('window.__game.player.position');
  if (Math.hypot(start.x - 26, start.z + 258) > 3 || Math.abs(start.y + 7) > 0.8) fail('did not start in the Garrison Lobby: ' + JSON.stringify(start));
  console.log('PASS start in lobby');
  await h.shot('lobby');

  const wings = await h.evalJSON(`(() => {
    const gal = window.__game.raw && window.__game.raw.cbGallery;
    if (!gal) return null;
    const by = {};
    for (const it of gal.items) if (!by[it.pl.wing]) by[it.pl.wing] = { wing: it.pl.wing, x: it.pl.x, y: it.pl.y, z: it.pl.z, nx: it.pl.nx, nz: it.pl.nz, floor: it.pl.floor, title: it.info.title, n: 0 };
    for (const it of gal.items) by[it.pl.wing].n++;
    return Object.values(by);
  })()`);
  if (!wings) fail('no gallery (window.__game.raw needs a dev build)');
  if (wings.length < 5) fail('only ' + wings.length + ' wings hung');
  for (const w of wings) {
    const px = w.x + w.nx * 2.6;
    const pz = w.z + w.nz * 2.6;
    const hd = Math.atan2(-w.nx, w.nz);
    await page.evaluate(([x, z, y, hd]) => {
      window.__game.debug.teleport(x, z, y);
      window.__game.debug.look(hd, 0);
    }, [px, pz, w.floor, hd]);
    await h.sleep(1600);
    const cap = await h.evalJSON('document.querySelector(".cbg .caption.show .cap-t")?.textContent || null');
    if (!cap) fail(`no caption in front of "${w.title}" (${w.wing})`);
    console.log(`PASS ${w.wing}: ${w.n} works, caption "${cap}"`);
    await h.shot('wing-' + w.wing);
  }

  // focus mode on the last wing's first work
  await h.key('KeyE', 120);
  await h.sleep(2600);
  if (!(await h.evalJSON('window.__game.raw.cbGallery.focused'))) fail('focus mode did not engage');
  if (!(await h.evalJSON('!!document.querySelector(".cbg .panel.show .p-title")'))) fail('info panel not shown');
  await h.shot('focus');
  await h.key('KeyE', 120);
  await h.sleep(900);
  if (await h.evalJSON('window.__game.raw.cbGallery.focused')) fail('focus mode did not release');
  console.log('PASS focus mode');

  // portal
  const pt = await h.evalJSON(`(() => { const p = window.__game.raw.cbGallery.portals[0]; return p ? { x: p.x, z: p.z, nx: p.nx, nz: p.nz, floor: p.floor, to: p.to, tex: !!p.item.texture, name: p.name } : null; })()`);
  if (!pt) {
    console.log('SKIP portal: no portal painting has its image downloaded');
    return;
  }
  for (let i = 0; i < 20 && !(await h.evalJSON('!!window.__game.raw.cbGallery.portals[0].item.texture')); i++) await h.sleep(500);
  const hd = Math.atan2(-pt.nx, pt.nz);
  await page.evaluate(([x, z, y, hd]) => {
    window.__game.debug.teleport(x, z, y);
    window.__game.debug.look(hd, 0);
  }, [pt.x + pt.nx * 2.4, pt.z + pt.nz * 2.4, pt.floor, hd]);
  await h.sleep(800);
  await page.keyboard.down('KeyW');
  await h.sleep(1300);
  await h.shot('portal-strokes');
  await page.keyboard.up('KeyW');
  await h.sleep(3200);
  const end = await h.evalJSON('window.__game.player.position');
  if (Math.hypot(end.x - pt.to[0], end.z - pt.to[2]) > 3) fail(`portal "${pt.name}" landed at ${JSON.stringify(end)}`);
  console.log(`PASS portal to ${pt.name}`);
  await h.shot('portal-arrived');
}
