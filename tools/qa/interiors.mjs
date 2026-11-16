// Strict interior gameplay checks using the development-only Game inspection API.
// node tools/qa/smoke.mjs --url http://127.0.0.1:5173 --script tools/qa/interiors.mjs
export default async function (page, h) {
  await page.locator('[data-act="freebuild"]').click();
  await page.waitForFunction(() => window.__game?.raw?.player && window.__game.state === 'play', null, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const g = window.__game.raw, p = g.player, w = g.world;
    g.paused = true;
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const input = { dx: 0, dy: 0, wheel: 0, buttons: [], clicked: [], down: () => false, hit: () => false,
      action: name => name === 'moveForward', actionHit: () => false, label: () => '' };
    const place = (x, y, z) => {
      p.pos.set(x, y, z); p.vel.set(0, 0, 0); p.mode = 'ground'; p.grounded = true;
      p.airborneDrop = false; p.alive = true; p.inBus = false; p.mantle = null;
    };
    const walk = (x, z, max = 1500) => {
      for (let i = 0; i < max; i++) {
        const d = Math.hypot(x - p.pos.x, z - p.pos.z);
        if (d < 0.12) { p.vel.set(0, 0, 0); return; }
        p.heading = Math.atan2(x - p.pos.x, -(z - p.pos.z));
        p.update(Math.min(1 / 60, d / 8), input, g);
      }
      throw new Error(`player movement blocked: ${p.pos.x},${p.pos.y},${p.pos.z} -> ${x},${z}`);
    };
    const buildings = w.buildingInteriors().map(b => b.collider);
    const c = buildings.find(c => c.shell.plan.stairs.length && c.shell.plan.levels.length >= 2);
    check(c, 'no building with upper floors');
    const s = c.shell, plan = s.plan, door = s.doors.find(d => d.main) || s.doors[0];
    place(door.x + door.nx * 3, s.floor, door.z + door.nz * 3);
    walk(door.x - door.nx * 2, door.z - door.nz * 2);
    check(w.interiorAt(p.pos.x, p.pos.z) === c, 'player did not enter doorway');
    walk(door.x + door.nx * 3, door.z + door.nz * 3);
    const stairResults = [];
    for (const st of plan.stairs) {
      const len = Math.hypot(st.x1 - st.x0, st.z1 - st.z0);
      const ux = (st.x1 - st.x0) / len, uz = (st.z1 - st.z0) / len;
      place(st.x0 - ux, st.y0, st.z0 - uz);
      walk(st.x0, st.z0); walk(st.x1, st.z1); walk(st.x1 + ux, st.z1 + uz);
      check(Math.abs(p.pos.y - st.y1) < 0.15, 'player did not climb to upper floor');
      walk(st.x1, st.z1); walk(st.x0, st.z0); walk(st.x0 - ux, st.z0 - uz);
      check(Math.abs(p.pos.y - st.y0) < 0.15, 'player did not descend stairs');
      stairResults.push({ level: st.level, rise: st.y1 - st.y0 });
    }
    let broken = null;
    for (const building of buildings) {
      const L = building.shell.plan.levels[0];
      for (let k = 0; k < L.wallMeta.length && !broken; k++) {
        const m = L.wallMeta[k], pn = building.shell.plan.panels[m.panel];
        if (!pn || Math.hypot(pn.bx - pn.ax, pn.bz - pn.az) < 2) continue;
        const x = (pn.ax + pn.bx) / 2, z = (pn.az + pn.bz) / 2, y = L.y;
        const hit = w.raycast(x - m.nx, y + 1, z - m.nz, m.nx, 0, m.nz, 2);
        if (!hit || w.panelHit(hit) !== pn) continue;
        place(x - m.nx, y, z - m.nz);
        const origin = p.pos.clone(); origin.y += 1;
        const dir = origin.clone().set(m.nx, 0, m.nz);
        for (let i = 0; i < 20 && pn.alive; i++) g.combat.swingPickaxe(p, origin, dir);
        check(!pn.alive, 'pickaxe did not break selected wall');
        walk(x + m.nx, z + m.nz);
        check((p.pos.x - x) * m.nx + (p.pos.z - z) * m.nz > 0.6, 'player did not pass broken wall');
        broken = { building: building.ref.id, panel: pn.id };
      }
      if (broken) break;
    }
    check(broken, 'no breakable partition tested');
    const upstairsLoot = g.loot.records.filter(r => {
      const b = w.interiorAt(r.x, r.z, r.y);
      return b && b.shell.plan.levels.some(L => L.i > 0 && Math.abs(L.y - r.y) < 0.6);
    });
    check(upstairsLoot.length > 0, 'no upper-floor loot spawned');
    const chest = upstairsLoot.find(r => r.kind === 'chest' || r.kind === 'ammoBox');
    check(chest, 'no upper-floor container');
    place(chest.x, chest.y, chest.z);
    const near = g.loot.nearest(p.pos, 2.4);
    check(near, 'upper-floor loot not interactable');
    g.loot.open(chest.id);
    check(chest.opened, 'upper-floor container did not open');
    const { Bots } = await import('/src/game/Bots.js');
    const bots = new Bots({ world: w, kits: [] });
    const st = plan.stairs[0], len = Math.hypot(st.x1 - st.x0, st.z1 - st.z0);
    const ux = (st.x1 - st.x0) / len, uz = (st.z1 - st.z0) / len;
    bots.spawn(1, () => 0.5, { dropPoints: [{ x: st.x0 - ux, z: st.z0 - uz }] });
    const brain = bots.brains[0], actor = brain.actor;
    actor.pos.set(st.x0 - ux, st.y0, st.z0 - uz); actor.gliding = false; actor.grounded = true;
    brain.state = 'wander'; brain.inB = c;
    brain.pathN = bots._roomRoute(c, actor.pos.x, actor.pos.z, actor.pos.y, st.x1 + ux, st.z1 + uz, st.y1, brain.path, brain.pathK, 0);
    brain.pathI = 0;
    for (let i = 0; i < 2400 && brain.pathI < brain.pathN; i++) {
      const x = brain.path[brain.pathI * 2], z = brain.path[brain.pathI * 2 + 1];
      if (Math.hypot(actor.pos.x - x, actor.pos.z - z) < 0.16) { brain.pathI++; continue; }
      bots.time += 0.025; bots._steer(brain, x, z, 3, 0); bots._move(brain, 0.025);
    }
    check(brain.pathI === brain.pathN && Math.abs(actor.pos.y - st.y1) < 0.2, 'browser bot did not climb stairs');
    bots.clear();
    // Leave the rendered view in an actual furnished landmark room for visual inspection.
    const furnished = buildings.find(b => b.shell.plan.recipe === 'landmark' && b.shell.plan.furniture.length);
    const prop = furnished.shell.plan.furniture[0], F = furnished.shell.plan.frame;
    const x = F.ox + F.ux * ((prop.a0 + prop.a1) / 2) + F.vx * ((prop.b0 + prop.b1) / 2);
    const z = F.oz + F.uz * ((prop.a0 + prop.a1) / 2) + F.vz * ((prop.b0 + prop.b1) / 2);
    place(x + F.vx * 3, prop.y, z + F.vz * 3);
    window.__game.debug.aimAt(x, prop.y + 0.6, z);
    g.view.update(g.camera.position, g.settings.quality);
    g.loot.update(0, g.camera.position);
    return { building: c.ref.id, doorway: true, stairs: stairResults, broken, upperLoot: upstairsLoot.length,
      opened: chest.id, botClimbed: true, furniture: buildings.reduce((n,b) => n + b.shell.plan.furniture.length,0),
      signs: buildings.reduce((n,b) => n + b.shell.plan.signs.length,0), errors: window.__game.errors };
  });
  console.log('[interiors]', JSON.stringify(result));
  if (result.errors.length) throw new Error('game reported runtime errors');
  await h.sleep(500);
  await h.shot('furnished-landmark');
  await page.evaluate(() => {
    const g = window.__game.raw;
    const c = g.world.buildingInteriors().map(b => b.collider).find(c => c.shell.plan.stairs.length);
    const s = c.shell.plan.stairs[0];
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    g.player.pos.set(s.x0 - (s.x1 - s.x0) / len * 0.7, s.y0, s.z0 - (s.z1 - s.z0) / len * 0.7);
    window.__game.debug.aimAt(s.x1, s.y1 + 0.2, s.z1);
  });
  await h.sleep(500);
  await h.shot('stairs');
}

