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

// A piston is not powered through its front (extension) face.
run('piston ignores power on its front face', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'sticky_piston').dir = 'east';   // front = (1,0,0)
  e.place('1,0,0', 'redstone_block');               // block on the sticky face
  for (let i = 0; i < 4; i++) e.tick();
  eq(e.get('0,0,0').extended, false, 'front redstone block must not power it');
  // but the back face does
  const e2 = new RedstoneEngine();
  e2.place('0,0,0', 'sticky_piston').dir = 'east';
  e2.place('-1,0,0', 'redstone_block');             // back face
  for (let i = 0; i < 4; i++) e2.tick();
  eq(e2.get('0,0,0').extended, true, 'back redstone block powers it');
});

// A single-tick pulse makes a sticky piston DROP the block; a longer pulse
// pulls it back (the block-transport / drop-off trick).
run('sticky piston drops the block on a 1-tick pulse', () => {
  function pulse(ticks) {
    const e = new RedstoneEngine();
    e.place('0,0,0', 'sticky_piston').dir = 'east';
    e.place('1,0,0', 'stone');                       // block to move
    const lev = e.place('0,0,-1', 'lever'); lev.dir = 'north'; // side power
    lev.on = true;  for (let i = 0; i < ticks; i++) e.tick();
    lev.on = false; for (let i = 0; i < 4; i++) e.tick();
    return { at1: e.get('1,0,0')?.type || 'air', at2: e.get('2,0,0')?.type || 'air' };
  }
  const short = pulse(1);
  eq(short.at2, 'stone', '1-tick pulse leaves the block dropped one space out');
  eq(short.at1, 'air', '...and does not pull it back');
  const long = pulse(3);
  eq(long.at1, 'stone', 'a longer pulse pulls the block back');
});

// An observer's single (1-tick) pulse drives the sticky-piston block drop.
run('observer pulse drives the sticky-piston block drop', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'sticky_piston').dir = 'east';   // front = (1,0,0)
  e.place('1,0,0', 'stone');                         // block to transport
  e.place('0,0,-1', 'observer').dir = 'north';       // back=(0,0,0)=piston; watches (0,0,-2)
  for (let i = 0; i < 4; i++) e.tick();              // settle
  e.place('0,0,-2', 'redstone_block');               // a change the observer sees
  for (let i = 0; i < 6; i++) e.tick();
  eq(e.get('2,0,0')?.type, 'stone', 'observer pulse dropped the block one space out');
  eq(e.get('1,0,0')?.type || 'air', 'air', '...and did not pull it back');
});

// A 1-tick pulse TOGGLES a block in/out — the T flip flop core. Push+drop when a
// block is in front; pull-in when the space ahead is empty (so it doesn't just
// drop every time).
run('1-tick pulse toggles a block in and out', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'sticky_piston').dir = 'east';   // front F = (1,0,0)
  e.place('1,0,0', 'redstone_block');               // starts IN at F
  const lev = e.place('0,0,-1', 'lever'); lev.dir = 'north'; // side power
  const pulse = () => { lev.on = true; e.tick(); lev.on = false; for (let i = 0; i < 3; i++) e.tick(); };
  const at = () => e.get('1,0,0')?.type === 'redstone_block' ? 'in'
                 : e.get('2,0,0')?.type === 'redstone_block' ? 'out' : '?';
  e.tick(); e.tick();
  eq(at(), 'in', 'starts in');
  pulse(); eq(at(), 'out', 'first pulse pushes it out and drops it');
  pulse(); eq(at(), 'in', 'second pulse pulls it back in');
  pulse(); eq(at(), 'out', 'third pulse pushes it out again');
});

// An observer fires ONE pulse for a momentary on->off change, not two on
// back-to-back ticks (which would drive a sticky piston with a 2-tick pulse and
// pull the block back instead of dropping it).
run('observer fires once on a momentary change (cooldown)', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'sticky_piston').dir = 'east';
  e.place('1,0,0', 'stone');
  e.place('0,0,-1', 'observer').dir = 'north';   // back=(0,0,0)=piston; watches (0,0,-2)
  for (let i = 0; i < 4; i++) e.tick();
  e.place('0,0,-2', 'redstone_block');            // rise
  e.tick();
  e.remove('0,0,-2');                             // fall one tick later
  for (let i = 0; i < 6; i++) e.tick();
  eq(e.get('2,0,0')?.type, 'stone', 'block dropped one out (single pulse)');
  eq(e.get('1,0,0')?.type || 'air', 'air', '...not pulled back onto the piston');
});

console.log('\nDone.');
