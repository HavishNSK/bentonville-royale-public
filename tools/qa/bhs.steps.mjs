// Run with the dev server and tools/qa/smoke.mjs. Uses only the generated game scene.
export default async function (page, h) {
  await page.evaluate(() => {
    document.querySelector('[data-ref="name"]').value = 'Visitor';
    document.querySelector('[data-act="freebuild"]').click();
  });
  await page.waitForFunction(() => window.__game?.state === 'play', null, { timeout: 120000 });
  await page.evaluate(() => {
    const { raw, debug } = window.__game;
    raw.applySettings({ ...raw.settings, quality: 'low', performanceMode: false });
    const building = raw.world.buildingById(952075843);
    const door = building.shell.doors.find(d => d.main);
    debug.teleport(door.x + door.nx * 13 + door.nz * 5, door.z + door.nz * 13 - door.nx * 5);
    debug.aimAt(door.x, building.y0 + 2.5, door.z);
    if (!raw.scene.getObjectByName('bhs-ext-lettering')) throw new Error('Missing school lettering');
  });
  await page.waitForFunction(() => document.querySelector('[data-ref="loc"]')?.textContent === 'BENTONVILLE HIGH SCHOOL');
  await h.shot('school-entrance');
  await page.evaluate(() => {
    const { raw, debug } = window.__game;
    const floor = raw.world.buildingById(952075843).shell.plan.levels[0];
    const room = floor.rooms.find(r => r.label === 'Commons');
    debug.teleport(room.cx, room.cz, floor.y);
    debug.look(0.7, 0.08);
  });
  await h.sleep(1200);
  await h.shot('north-commons');
  await page.evaluate(() => {
    const { raw, debug } = window.__game;
    const plan = raw.world.buildingById(952075843).shell.plan;
    const floor = plan.levels[0];
    const room = floor.rooms.find(r => r.label === 'Media Center');
    const shelf = plan.furniture.find(p => p.level === 0 && p.room === room.id && p.kind === 'bookcase');
    const a = (shelf.a0 + shelf.a1) / 2, b = (shelf.b0 + shelf.b1) / 2;
    const f = plan.frame;
    debug.teleport(room.cx, room.cz, floor.y);
    debug.aimAt(f.ox + a * f.ux + b * f.vx, floor.y + 1.3, f.oz + a * f.uz + b * f.vz);
  });
  await h.sleep(1200);
  await h.shot('media-center');
  await page.evaluate(() => {
    const { raw, debug } = window.__game;
    const museum = raw.world.landmarks.crystal_bridges;
    debug.teleport(museum.x, museum.z);
  });
  await page.waitForFunction(() => document.querySelector('[data-ref="loc"]')?.textContent.includes('CRYSTAL BRIDGES'));
  await page.evaluate(() => {
    const { raw, debug } = window.__game;
    const school = raw.world.landmarks.bentonville_high;
    debug.teleport(school.x, school.z);
  });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.br-toast')).some(
    el => !el.dataset.leaving && el.textContent === 'Bentonville High School'
  ));
}
