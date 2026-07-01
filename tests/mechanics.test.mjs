import { RedstoneEngine } from '../src/engine.js';

function run(name, fn) {
  try { fn(); console.log('✓', name); }
  catch (e) { console.log('✗', name, '\n   ', e.message); process.exitCode = 1; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// 1. A powered piston extends and pushes a block one cell forward.
run('piston pushes a block and places its head', () => {
  const e = new RedstoneEngine();
  const piston = e.place('0,0,0', 'piston'); piston.dir = 'east';
  e.place('1,0,0', 'stone');            // block to push
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = true; // powers piston
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('0,0,0').extended, true, 'piston extended');
  eq(e.get('1,0,0').type, 'piston_head', 'head occupies the front cell');
  eq(e.get('2,0,0')?.type, 'stone', 'pushed block moved forward');
});

// 2. Unpowering a regular piston retracts the head but leaves the block.
run('regular piston retracts and drops the block', () => {
  const e = new RedstoneEngine();
  const piston = e.place('0,0,0', 'piston'); piston.dir = 'east';
  e.place('1,0,0', 'stone');
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = true;
  for (let i = 0; i < 3; i++) e.tick();
  lever.on = false;
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('0,0,0').extended, false, 'piston retracted');
  eq(e.has('1,0,0'), false, 'head removed');
  eq(e.get('2,0,0')?.type, 'stone', 'block stays where it was pushed');
});

// 3. A sticky piston pulls the block back when it retracts.
run('sticky piston pulls the block back', () => {
  const e = new RedstoneEngine();
  const piston = e.place('0,0,0', 'sticky_piston'); piston.dir = 'east';
  e.place('1,0,0', 'stone');
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = true;
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('2,0,0')?.type, 'stone', 'pushed out');
  lever.on = false;
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('1,0,0')?.type, 'stone', 'pulled back to the head cell');
  eq(e.has('2,0,0'), false, 'no longer out front');
});

// 4. Slime block drags an attached neighbour along.
run('slime block moves an attached block with it', () => {
  const e = new RedstoneEngine();
  const piston = e.place('0,0,0', 'piston'); piston.dir = 'east';
  e.place('1,0,0', 'slime');
  e.place('1,0,1', 'stone'); // stuck to the side of the slime (perpendicular to push)
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = true;
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('2,0,0')?.type, 'slime', 'slime pushed');
  eq(e.get('2,0,1')?.type, 'stone', 'side block dragged by the slime');
});

// 5. Piston refuses to push more than 12 blocks.
run('piston will not push a 13-block line', () => {
  const e = new RedstoneEngine();
  const piston = e.place('0,0,0', 'piston'); piston.dir = 'east';
  for (let x = 1; x <= 13; x++) e.place(`${x},0,0`, 'stone');
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = true;
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('0,0,0').extended, false, 'push blocked -> stays retracted');
  eq(e.get('1,0,0')?.type, 'stone', 'nothing moved');
});

// 6. Crops grow over time and a comparator reads their stage.
run('crop grows and comparator behind it reads growth', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'stone');
  const crop = e.place('0,1,0', 'crop'); crop.age = 0;
  // comparator behind the crop reading east: facing west so its back is east (the crop)
  const comp = e.place('1,1,0', 'comparator'); comp.dir = 'east'; comp.mode = 'compare';
  e.place('2,0,0', 'stone'); e.place('2,1,0', 'dust');
  crop.age = 7; // fully grown
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('2,1,0')._dust, 15, 'full crop -> comparator outputs 15');
  crop.age = 0;
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('2,1,0')._dust, 0, 'empty crop -> 0');
});

// 7. Dispenser bone-meals the crop in front on a rising power edge.
run('dispenser bone-meals the crop in front', () => {
  const e = new RedstoneEngine();
  const disp = e.place('0,0,0', 'dispenser'); disp.dir = 'east';
  const crop = e.place('1,0,0', 'crop'); crop.age = 0;
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = false;
  for (let i = 0; i < 2; i++) e.tick();
  eq(e.get('1,0,0').age, 0, 'no growth without a pulse');
  lever.on = true; // rising edge
  e.tick();
  if (e.get('1,0,0').age <= 0) throw new Error('crop should have grown from bone meal');
  const after = e.get('1,0,0').age;
  e.tick(); // still on, no new rising edge
  eq(e.get('1,0,0').age, after, 'only fires on the rising edge, not while held');
});

// 8. Dispenser plants a crop on soil when it fires into empty air.
run('dispenser plants seeds on soil', () => {
  const e = new RedstoneEngine();
  const disp = e.place('0,1,0', 'dispenser'); disp.dir = 'east';
  e.place('1,0,0', 'stone'); // soil below the target cell (1,1,0)
  const lever = e.place('0,2,0', 'lever'); lever.dir = 'up'; lever.on = true;
  e.tick();
  eq(e.get('1,1,0')?.type, 'crop', 'a crop was planted on the soil');
});

// 9. A shears dispenser (harvester) cuts a ripe crop and replants it.
run('shears dispenser harvests a ripe crop and replants it', () => {
  const e = new RedstoneEngine();
  const disp = e.place('0,0,0', 'dispenser'); disp.dir = 'east'; disp.loaded = 'shears';
  const crop = e.place('1,0,0', 'crop'); crop.age = 7; // fully grown
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = false;
  e.tick();
  lever.on = true; e.tick(); // rising edge
  eq(e.get('1,0,0')?.type, 'crop', 'the crop stays (replanted, not removed)');
  eq(e.get('1,0,0').age, 0, 'ripe crop harvested back to stage 0');
});

// 10. A shears dispenser ignores an unripe crop.
run('shears dispenser leaves an unripe crop alone', () => {
  const e = new RedstoneEngine();
  const disp = e.place('0,0,0', 'dispenser'); disp.dir = 'east'; disp.loaded = 'shears';
  const crop = e.place('1,0,0', 'crop'); crop.age = 3;
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = true;
  e.tick(); e.tick();
  eq(e.get('1,0,0').age, 3, 'unripe crop untouched by shears');
});

// 11. Full observer-driven harvest loop: crop ripens -> observer pulse ->
//     shears dispenser -> crop resets to 0.
run('observer-driven harvester resets a ripened crop', () => {
  const e = new RedstoneEngine();
  const rows = [
    ['0,0,0', 'stone'], ['0,1,0', 'crop'],
    ['0,1,-1', 'observer', 'south'],
    ['0,0,-2', 'stone'], ['0,1,-2', 'dust'],
    ['1,0,-2', 'stone'], ['1,1,-2', 'dust'],
    ['1,0,-1', 'stone'], ['1,1,-1', 'dust'],
    ['1,1,0', 'dispenser', 'west'],
  ];
  for (const [k, t, d] of rows) { const b = e.place(k, t); if (d) b.dir = d; }
  e.get('1,1,0').loaded = 'shears';
  e.get('0,1,0').age = 6;
  for (let i = 0; i < 3; i++) e.tick(); // settle observer baseline
  e.get('0,1,0').age = 7;               // becomes ripe (as growth would do)
  let harvested = false;
  for (let i = 0; i < 6; i++) { e.tick(); if (e.get('0,1,0').age === 0) harvested = true; }
  eq(harvested, true, 'observer pulse fired the shears dispenser and reset the crop');
});

console.log('\nDone.');
