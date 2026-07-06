import { RedstoneEngine } from '../src/engine.js';

function run(name, fn) {
  try { fn(); console.log('✓', name); }
  catch (e) { console.log('✗', name, '\n   ', e.message); process.exitCode = 1; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`); }

// 1. Lever -> dust line -> lamp
run('lever powers dust line and lights lamp', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'stone');
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up';
  e.place('1,0,0', 'stone'); e.place('2,0,0', 'stone'); e.place('3,0,0', 'stone');
  e.place('1,1,0', 'dust'); e.place('2,1,0', 'dust'); e.place('3,1,0', 'dust');
  const lamp = e.place('4,1,0', 'lamp');
  lever.on = false;
  for (let i = 0; i < 5; i++) e.tick();
  eq(e.get('4,1,0')._lit, false, 'lamp off when lever off');
  lever.on = true;
  for (let i = 0; i < 5; i++) e.tick();
  eq(e.get('1,1,0')._dust, 15, 'dust nearest lever = 15');
  eq(e.get('3,1,0')._dust, 13, 'dust drops 1 per block');
  eq(e.get('4,1,0')._lit, true, 'lamp on when lever on');
});

// 2. Dust attenuation to zero over distance
run('dust decays to 0 after 15 blocks', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'stone'); e.place('0,1,0', 'redstone_block'); // source at dust level
  for (let x = 1; x <= 17; x++) { e.place(`${x},0,0`, 'stone'); e.place(`${x},1,0`, 'dust'); }
  for (let i = 0; i < 3; i++) e.tick();
  eq(e.get('1,1,0')._dust, 15, 'adjacent to power block = 15');
  eq(e.get('16,1,0')._dust, 0, 'signal gone at 16 blocks');
});

// 3. Redstone torch inverts its mount block's power
run('torch is off when its mount block is powered', () => {
  const e = new RedstoneEngine();
  const block = e.place('0,0,0', 'stone');
  const torch = e.place('1,0,0', 'torch'); torch.dir = 'east'; // mounted on 0,0,0
  const lamp = e.place('1,1,0', 'lamp'); // torch powers block above
  // no power to block -> torch ON -> lamp lit
  for (let i = 0; i < 4; i++) e.tick();
  eq(e.get('1,0,0').torchOn, true, 'torch on with unpowered mount');
  // power the mount with a redstone block neighbour
  e.place('0,1,0', 'redstone_block');
  for (let i = 0; i < 4; i++) e.tick();
  eq(e.get('1,0,0').torchOn, false, 'torch off when mount powered');
});

// 4. Torch clock oscillates (torch feeding a dust that powers its own mount)
run('torch NOT clock: stable inverter with lever', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'stone');
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = true;
  const torch = e.place('1,0,0', 'torch'); torch.dir = 'east';
  // lever powers block 0,0,0? lever mounts on 0,0,0 -> strong. torch mount 0,0,0 powered -> off
  for (let i = 0; i < 5; i++) e.tick();
  eq(e.get('1,0,0').torchOn, false, 'NOT gate: input high -> output low');
  lever.on = false;
  for (let i = 0; i < 5; i++) e.tick();
  eq(e.get('1,0,0').torchOn, true, 'NOT gate: input low -> output high');
});

// 5. Repeater passes signal one way with delay, restores to 15
run('repeater restores signal and is one-directional', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'stone'); e.place('0,1,0', 'redstone_block');
  e.place('1,0,0', 'stone'); e.place('1,1,0', 'dust');
  const rep = e.place('2,1,0', 'repeater'); rep.dir = 'east'; rep.delay = 1;
  e.place('3,0,0', 'stone'); e.place('3,1,0', 'dust'); e.place('4,0,0', 'stone'); e.place('4,1,0', 'dust');
  for (let i = 0; i < 6; i++) e.tick();
  eq(e.get('3,1,0')._dust, 15, 'repeater output restored to 15');
});

// 6. Repeater blocks reverse signal
run('repeater blocks signal from its output side', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'stone'); e.place('0,1,0', 'redstone_block'); // power on the OUTPUT side
  e.place('1,0,0', 'stone'); e.place('1,1,0', 'dust');
  const rep = e.place('2,1,0', 'repeater'); rep.dir = 'west'; // output points west (toward power), input east
  e.place('3,0,0', 'stone'); e.place('3,1,0', 'dust');
  for (let i = 0; i < 6; i++) e.tick();
  eq(e.get('3,1,0')._dust, 0, 'no signal leaks backward through repeater');
});

// 7. Comparator subtract mode
run('comparator subtract mode outputs rear - side', () => {
  const e = new RedstoneEngine();
  // rear input strength via dust from a block, side input weaker
  e.place('0,0,0', 'redstone_block');           // rear source (15 into dust)
  e.place('1,0,0', 'stone'); e.place('1,1,0', 'dust'); // rear dust = 15
  const comp = e.place('2,1,0', 'comparator'); comp.dir = 'east'; comp.mode = 'subtract';
  // side input: a dust fed to strength ~13 on the north side
  e.place('2,0,1', 'stone'); e.place('2,1,1', 'dust');
  e.place('1,1,1', 'dust'); // extends toward redstone block chain -> gets 14/13
  e.place('3,0,0', 'stone'); e.place('3,1,0', 'dust'); // output dust
  for (let i = 0; i < 8; i++) e.tick();
  const out = e.get('3,1,0')._dust;
  if (out < 0 || out > 3) throw new Error('subtract output out of expected small range, got ' + out);
});

// 8. Observer pulses when watched block changes
run('observer emits a pulse when its target changes', () => {
  const e = new RedstoneEngine();
  const obs = e.place('1,0,0', 'observer'); obs.dir = 'west'; // watches 0,0,0
  e.place('2,0,0', 'stone'); e.place('2,1,0', 'lamp'); // back output side is east (2,0,0)
  for (let i = 0; i < 3; i++) e.tick(); // settle, obsPrev set
  eq(e.get('1,0,0').obsPulse, 0, 'no pulse without change');
  e.place('0,0,0', 'redstone_block'); // change the watched cell
  e.tick();
  const pulsed = e.get('1,0,0').obsPulse > 0;
  eq(pulsed, true, 'observer pulses on change');
});

// 9. A repeater does not leak power sideways to a neighbouring repeater.
// Three repeaters in a row facing north; only the middle one is fed from its
// rear. The input dust sits beside the outer repeaters' (empty) rear cells,
// and must NOT switch them on.
run('repeater does not power a repeater beside it', () => {
  const e = new RedstoneEngine();
  for (const x of [-1, 0, 1]) { e.place(`${x},0,0`, 'stone'); e.place(`${x},0,1`, 'stone'); }
  e.place('0,0,2', 'stone');
  e.place('-1,1,0', 'repeater').dir = 'north';
  e.place('0,1,0', 'repeater').dir = 'north';
  e.place('1,1,0', 'repeater').dir = 'north';
  e.place('0,1,1', 'dust');                       // feeds only the middle rear
  const lever = e.place('0,1,2', 'lever'); lever.dir = 'up'; lever.on = true;
  for (let i = 0; i < 12; i++) e.tick();
  eq(e.get('0,1,0').repOn, true, 'fed middle repeater is on');
  eq(e.get('-1,1,0').repOn, false, 'left repeater stays off');
  eq(e.get('1,1,0').repOn, false, 'right repeater stays off');
});

// 10. Comparator subtract mode outputs the exact rear-minus-side difference.
run('comparator subtract yields the exact difference', () => {
  const e = new RedstoneEngine();
  for (let x = -3; x <= 1; x++) e.place(`${x},0,0`, 'stone');
  for (let z = 0; z <= 9; z++) e.place(`0,0,${z}`, 'stone');
  const c = e.place('0,1,0', 'comparator'); c.dir = 'east'; c.mode = 'subtract';
  e.place('1,1,0', 'dust');                                  // output/front
  e.place('-1,1,0', 'dust'); e.place('-2,1,0', 'redstone_block'); // rear = 15
  for (let z = 1; z <= 8; z++) e.place(`0,1,${z}`, 'dust');
  e.place('0,1,9', 'redstone_block');                        // side wire: (0,1,1) = 8
  for (let i = 0; i < 15; i++) e.tick();
  eq(e.get('-1,1,0')._dust, 15, 'rear dust is 15');
  eq(e.get('0,1,1')._dust, 8, 'side dust is 8');
  eq(e.get('0,1,0').compOut, 7, 'subtract 15 - 8 = 7 (exact, not off-by-one)');
});

// 11. A wall-mounted redstone torch inverts the block it is attached to.
run('wall torch inverts its mount block', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'stone');
  e.place('1,0,0', 'torch').dir = 'east';                    // torch on the block's east face
  const lever = e.place('0,1,0', 'lever'); lever.dir = 'up'; lever.on = false;
  for (let i = 0; i < 5; i++) e.tick();
  eq(e.get('1,0,0').torchOn, true, 'torch on when mount unpowered');
  lever.on = true;
  for (let i = 0; i < 5; i++) e.tick();
  eq(e.get('1,0,0').torchOn, false, 'torch off when mount block is powered');
});

// 12. A wall-mounted lever strongly powers the block it is attached to.
run('wall lever strongly powers its mount block', () => {
  const e = new RedstoneEngine();
  e.place('0,0,0', 'stone');                               // mount block
  const lev = e.place('1,0,0', 'lever'); lev.dir = 'east'; lev.on = false; // on east face
  e.place('0,1,0', 'dust');                                // dust on top of the mount block
  for (let i = 0; i < 5; i++) e.tick();
  eq(e.get('0,1,0')._dust, 0, 'dust off when lever off');
  lev.on = true;
  for (let i = 0; i < 5; i++) e.tick();
  eq(e.get('0,1,0')._dust, 15, 'strong power reseeds dust on the mount block');
});

console.log('\nDone.');
