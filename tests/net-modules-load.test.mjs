// Regression: the netcode modules load in Node (scripts/check-interiors.mjs phase 2E and tests
// import them). HostSession used to import heldSlot from Game.js, which pulls in the whole UI
// (its .css imports), so `npm run check:interiors` crashed after its building checks.
import test from 'node:test';
import assert from 'node:assert/strict';

test('HostSession and ClientSession import without the UI layer', async () => {
  const { HostSession } = await import('../src/net/HostSession.js');
  const { ClientSession } = await import('../src/net/ClientSession.js');
  assert.equal(typeof HostSession, 'function');
  assert.equal(typeof ClientSession, 'function');
});

test('heldSlot: the slot a remote actor is holding', async () => {
  const { heldSlot } = await import('../src/game/Inventory.js');
  const inv = { selected: 1, slots: [{ id: 'rifle' }, { id: 'smg' }, { type: 'consumable', id: 'medkit' }, null, null] };
  assert.equal(heldSlot({ equipId: null }, inv), 1);
  assert.equal(heldSlot({ equipId: null, buildPiece: 'wall' }, inv), -1);
  assert.equal(heldSlot({ equipId: 'pickaxe' }, inv), -1);
  assert.equal(heldSlot({ equipId: 'rifle' }, inv), 0);
  assert.equal(heldSlot({ equipId: 'none' }, inv), 2);
});
