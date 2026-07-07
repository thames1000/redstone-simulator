import { RedstoneEngine } from '../src/engine.js';
import { makeBlock } from '../src/blocks.js';

function run(name, fn) {
  try { fn(); console.log('✓', name); }
  catch (e) { console.log('✗', name, '\n   ', e.message); process.exitCode = 1; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// helper: place a minecart sitting on a rail (the cart carries that rail)
function cartOn(e, cell, cartType, railType, dir) {
  const rail = makeBlock(railType);
  const cart = makeBlock(cartType); cart.dir = dir; cart.rail = rail;
  e.set(cell, cart);
  return cart;
}
function floor(e, from, to) { for (let x = from; x <= to; x++) e.place(`${x},0,0`, 'stone'); }

// 1. A powered rail activates from redstone and spreads up to 8 rails, not 9.
run('powered rail activates and propagates up to 8 rails', () => {
  const e = new RedstoneEngine();
  for (let x = 0; x <= 11; x++) { e.place(`${x},0,0`, 'stone'); e.place(`${x},1,0`, 'powered_rail'); }
  e.place('0,1,-1', 'redstone_block');   // powers the rail at x=0
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('0,1,0').active, true, 'source rail active');
  eq(e.get('8,1,0').active, true, 'rail 8 away is active');
  eq(e.get('9,1,0').active, false, 'rail 9 away is NOT active');
});

// 2. A minecart rides an active powered rail and coasts along plain rails.
run('active powered rail drives a minecart along the track', () => {
  const e = new RedstoneEngine();
  floor(e, 0, 5);
  for (let x = 1; x <= 5; x++) e.place(`${x},1,0`, 'rail');   // plain track ahead
  const cart = cartOn(e, '0,1,0', 'minecart', 'powered_rail', 'east');
  e.place('0,1,-1', 'redstone_block');   // activates the cart's powered rail
  for (let i = 0; i < 6; i++) e.tick();
  // cart should have moved east and stopped at the last rail (x=5)
  eq(e.get('5,1,0')?.type, 'minecart', 'cart reached the end of the track');
  eq(e.get('0,1,0')?.type, 'powered_rail', 'the starting rail is restored');
});

// 3. An inactive powered rail brakes the cart (it does not move).
run('inactive powered rail keeps the cart stopped', () => {
  const e = new RedstoneEngine();
  floor(e, 0, 3);
  for (let x = 1; x <= 3; x++) e.place(`${x},1,0`, 'rail');
  cartOn(e, '0,1,0', 'minecart', 'powered_rail', 'east');   // no redstone -> inactive
  for (let i = 0; i < 5; i++) e.tick();
  eq(e.get('0,1,0')?.type, 'minecart', 'cart stayed put on the unpowered rail');
});

// 4. An active activator rail ejects a plain minecart.
run('active activator rail ejects a minecart', () => {
  const e = new RedstoneEngine();
  floor(e, 0, 4);
  e.place('1,1,0', 'rail');
  e.place('2,1,0', 'activator_rail'); e.place('2,1,-1', 'redstone_block'); // active
  for (let x = 3; x <= 4; x++) e.place(`${x},1,0`, 'rail');
  const cart = cartOn(e, '0,1,0', 'minecart', 'powered_rail', 'east');
  e.place('0,1,-1', 'redstone_block');   // drive the cart east
  for (let i = 0; i < 8; i++) e.tick();
  eq(e.get('2,1,0')?.type, 'activator_rail', 'the activator rail is restored');
  const cartCells = [...e.world.values()].filter(b => b.type === 'minecart').length;
  eq(cartCells, 0, 'the minecart was ejected (removed)');
});

// 5. A TNT minecart is primed by an active activator rail and explodes.
run('active activator rail primes and detonates a TNT minecart', () => {
  const e = new RedstoneEngine();
  floor(e, 0, 2);
  e.place('1,1,0', 'stone');            // a block the blast should clear
  const cart = cartOn(e, '0,1,0', 'tnt_minecart', 'activator_rail', 'east');
  e.place('0,1,-1', 'redstone_block');  // active activator rail under the cart
  for (let i = 0; i < 20; i++) e.tick();
  const carts = [...e.world.values()].filter(b => b.type === 'tnt_minecart').length;
  eq(carts, 0, 'the TNT minecart exploded (gone)');
  eq(e.get('1,1,0'), undefined, 'the blast cleared a nearby block');
});

console.log('\nDone.');
