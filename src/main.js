// main.js — app entry: wires the engine, scene, palette UI, and input.

import { RedstoneEngine } from './engine.js?v=3';
import { SceneManager } from './scene.js?v=3';
import {
  BLOCK_TYPES, PALETTE_ORDER, DIR_NAMES, HORIZONTAL, OPPOSITE,
} from './blocks.js?v=3';

const engine = new RedstoneEngine();
const scene = new SceneManager(document.getElementById('view'));
scene.world = engine.world;   // let the renderer read neighbours (dust wiring)

let selected = 'dust';   // current palette selection
let tool = 'build';      // 'build' | 'interact'
let running = false;
let tps = 5;             // ticks per second
let hover = null;        // last pick result

// ---- palette -----------------------------------------------------------
const paletteEl = document.getElementById('palette');
function buildPalette() {
  const interact = mkTool('interact', '✋ Interact', 'Toggle levers, press buttons, edit components');
  paletteEl.appendChild(interact);
  for (const type of PALETTE_ORDER) {
    const meta = BLOCK_TYPES[type];
    const el = document.createElement('button');
    el.className = 'pal';
    el.dataset.type = type;
    el.title = meta.desc;
    el.innerHTML = `<span class="sw" style="background:#${meta.color.toString(16).padStart(6, '0')}"></span>${meta.label}`;
    el.onclick = () => selectType(type);
    paletteEl.appendChild(el);
  }
  selectType('dust');
}
function mkTool(name, label, title) {
  const el = document.createElement('button');
  el.className = 'pal tool';
  el.dataset.tool = name;
  el.title = title;
  el.textContent = label;
  el.onclick = () => { tool = name; selected = null; refreshPalette(); };
  return el;
}
function selectType(type) { selected = type; tool = 'build'; refreshPalette(); }
function refreshPalette() {
  for (const el of paletteEl.querySelectorAll('.pal')) {
    const active = (el.dataset.type && el.dataset.type === selected && tool === 'build') ||
                   (el.dataset.tool === tool && tool === 'interact');
    el.classList.toggle('active', active);
  }
  document.getElementById('mode-hint').textContent =
    tool === 'interact' ? 'Interact: click inputs/components' : `Build: place ${BLOCK_TYPES[selected].label}`;
}

// ---- placement facing --------------------------------------------------
// Choose a sensible default facing for a newly placed component: point it
// away from the surface it was placed against.
function defaultDir(pick) {
  const n = pick.normal;
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return n.y >= 0 ? 'up' : 'down';
  if (ax >= az) return n.x >= 0 ? 'east' : 'west';
  return n.z >= 0 ? 'south' : 'north';
}

// ---- pointer input -----------------------------------------------------
const canvas = document.getElementById('view');
let dragged = false;
canvas.addEventListener('pointerdown', () => { dragged = false; });
canvas.addEventListener('pointermove', e => {
  dragged = true;
  hover = scene.pick(e.clientX, e.clientY);
  scene.setHighlight(tool === 'build' ? hover?.place : hover?.key);
  refreshInspector();
});

canvas.addEventListener('click', e => {
  const pick = scene.pick(e.clientX, e.clientY);
  if (!pick) return;
  if (tool === 'interact') return interact(pick);
  // build: place at the empty neighbour cell
  const target = pick.place;
  if (engine.has(target) && !pick.ground) return;
  const b = engine.place(target, selected);
  if (BLOCK_TYPES[selected].directional) {
    let d = defaultDir(pick);
    if (BLOCK_TYPES[selected].rotatable === 'horizontal' && (d === 'up' || d === 'down')) d = facingFromCamera();
    b.dir = d;
  }
  scene.syncBlock(target, b);
  markDirty();
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const pick = scene.pick(e.clientX, e.clientY);
  if (pick && !pick.ground && engine.has(pick.key)) {
    engine.remove(pick.key);
    scene.removeBlock(pick.key);
    scene.refreshDustNeighbors(pick.key);
    markDirty();
  }
});

function interact(pick) {
  const b = engine.get(pick.key);
  if (!b) return;
  if (b.type === 'lever') { b.on = !b.on; scene.syncBlock(pick.key, b); markDirty(); }
  else if (b.type === 'button') { b._ticks = 8; markDirty(); }
  else if (b.type === 'repeater') { engine.setRepeaterDelay(pick.key, (b.delay % 4) + 1); scene.syncBlock(pick.key, b); }
  else if (b.type === 'comparator') { b.mode = b.mode === 'compare' ? 'subtract' : 'compare'; scene.syncBlock(pick.key, b); markDirty(); }
  else if (b.type === 'crop') { b.age = Math.min(7, b.age + 1); scene.updateDynamic(engine); } // manual bone meal
  else if (b.type === 'dispenser') { b.loaded = b.loaded === 'shears' ? 'bonemeal' : 'shears'; scene.syncBlock(pick.key, b); }
}

// ---- inspector panel ---------------------------------------------------
// Live, per-component state for the block currently under the cursor.
const inspectorEl = document.getElementById('inspector');

// Returns [label, value, kind?] rows describing a block's live state.
function componentState(b) {
  switch (b.type) {
    case 'dust': return [['Signal', `${b._dust || 0} / 15`, (b._dust || 0) > 0]];
    case 'lever': return [['State', b.on ? 'ON' : 'OFF', b.on]];
    case 'button': return [['State', b._ticks > 0 ? 'PRESSED' : 'idle', b._ticks > 0]];
    case 'torch': return [['Output', b.torchOn ? 'ON (15)' : 'OFF', b.torchOn]];
    case 'redstone_block': return [['Output', '15 (constant)', true]];
    case 'repeater': return [
      ['Delay', `${b.delay || 1} tick${(b.delay || 1) > 1 ? 's' : ''}`],
      ['Output', b.repOn ? 'ON (15)' : 'OFF', b.repOn],
      ['Locked', b.locked ? 'yes' : 'no', b.locked],
    ];
    case 'comparator': return [
      ['Mode', b.mode || 'compare'],
      ['Output', `${b.compOut || 0} / 15`, (b.compOut || 0) > 0],
    ];
    case 'observer': return [['Pulse', b.obsPulse > 0 ? 'firing' : 'idle', b.obsPulse > 0]];
    case 'lamp': return [['Lit', b._lit ? 'yes' : 'no', b._lit]];
    case 'piston': case 'sticky_piston': return [['Extended', b.extended ? 'yes' : 'no', b.extended]];
    case 'dispenser': return [['Loaded', b.loaded === 'shears' ? 'shears' : 'bone meal']];
    case 'crop': return [['Growth', `${b.age || 0} / 7`, (b.age || 0) >= 7]];
    default: return [];
  }
}

function inspectorRow(k, v, kind) {
  const cls = kind === true ? ' on' : kind === false ? ' off' : '';
  return `<div class="ins-row"><span class="k">${k}</span><span class="v${cls}">${v}</span></div>`;
}

function refreshInspector() {
  const key = hover?.key;
  const b = key && engine.get(key);
  if (!b) { inspectorEl.classList.add('hidden'); return; }
  const meta = BLOCK_TYPES[b.type];
  const sw = `#${meta.color.toString(16).padStart(6, '0')}`;
  let html = `<div class="ins-title"><span class="sw" style="background:${sw}"></span>${meta.label}</div>`;
  html += inspectorRow('Cell', key);
  if (meta.directional) html += inspectorRow('Facing', b.dir);
  for (const [k, v, kind] of componentState(b)) html += inspectorRow(k, v, kind);
  html += `<div class="ins-desc">${meta.desc}</div>`;
  inspectorEl.innerHTML = html;
  inspectorEl.classList.remove('hidden');
}

// Rotate the hovered directional block with R.
window.addEventListener('keydown', e => {
  if (e.key === 'r' || e.key === 'R') {
    if (!hover) return;
    const b = engine.get(hover.key);
    if (!b || !BLOCK_TYPES[b.type].directional) return;
    const set = BLOCK_TYPES[b.type].rotatable === 'horizontal' ? HORIZONTAL : DIR_NAMES;
    b.dir = set[(set.indexOf(b.dir) + 1) % set.length];
    scene.syncBlock(hover.key, b);
    markDirty();
  }
  if (e.key === 'Delete' || e.key === 'x' || e.key === 'X') {
    if (hover && engine.has(hover.key)) { engine.remove(hover.key); scene.removeBlock(hover.key); scene.refreshDustNeighbors(hover.key); markDirty(); }
  }
  if (e.key === ' ') { e.preventDefault(); toggleRun(); }
  if (e.key === '.') applyTick();
});

// Advance one tick and reflect all resulting changes (moved blocks + colours).
function applyTick() {
  engine.tick();
  scene.applyDirty(engine);
  scene.updateDynamic(engine);
  refreshInspector();
  document.getElementById('tickcount').textContent = engine.tickCount;
}

function facingFromCamera() {
  const d = scene.camera.getWorldDirection(new (scene.controls.target.constructor)());
  return Math.abs(d.x) > Math.abs(d.z) ? (d.x > 0 ? 'east' : 'west') : (d.z > 0 ? 'south' : 'north');
}

// When the world changes while paused, refresh the field once so preview is live.
function markDirty() {
  if (!running) applyTick();
}

// ---- simulation loop ---------------------------------------------------
let acc = 0, last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000; last = now;
  if (running) {
    acc += dt;
    const step = 1 / tps;
    let n = 0;
    while (acc >= step && n < 10) { engine.tick(); acc -= step; n++; }
    if (n > 0) {
      scene.applyDirty(engine);
      scene.updateDynamic(engine);
      refreshInspector();
      document.getElementById('tickcount').textContent = engine.tickCount;
    }
  }
  scene.render();
  requestAnimationFrame(frame);
}

function toggleRun() {
  running = !running;
  document.getElementById('btn-run').textContent = running ? '⏸ Pause' : '▶ Run';
  acc = 0; last = performance.now();
}

// ---- toolbar wiring ----------------------------------------------------
document.getElementById('btn-run').onclick = toggleRun;
document.getElementById('btn-step').onclick = applyTick;
document.getElementById('btn-signal').onclick = e => {
  const on = !scene.showSignal;
  scene.setSignalVisible(on);
  e.currentTarget.classList.toggle('active', on);
  scene.updateDynamic(engine);   // reflect immediately, even while paused
};
document.getElementById('btn-clear').onclick = () => { if (confirm('Clear the whole build?')) { engine.clear(); scene.rebuildAll(engine); } };
document.getElementById('speed').oninput = e => { tps = Number(e.target.value); document.getElementById('speed-val').textContent = tps; };
document.getElementById('btn-save').onclick = () => {
  const blob = new Blob([JSON.stringify(engine.toJSON())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'redstone-build.json'; a.click();
};
document.getElementById('file-load').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { engine.fromJSON(JSON.parse(r.result)); scene.rebuildAll(engine); markDirty(); } catch (err) { alert('Bad file: ' + err.message); } };
  r.readAsText(f);
};

// ---- example builds ----------------------------------------------------
const EXAMPLES = {
  basics: [
    // lever -> dust line -> lamp
    ['0,0,0', 'stone'], ['1,0,0', 'stone'], ['2,0,0', 'stone'], ['3,0,0', 'stone'], ['4,0,0', 'stone'],
    ['0,1,0', 'lever', 'up'],
    ['1,1,0', 'dust'], ['2,1,0', 'dust'], ['3,1,0', 'dust'], ['4,1,0', 'lamp'],
    // repeater extends the signal to a second lamp
    ['2,0,2', 'stone'], ['3,0,2', 'stone'], ['4,0,2', 'stone'], ['5,0,2', 'stone'],
    ['2,1,2', 'dust'], ['3,1,2', 'repeater', 'east'], ['4,1,2', 'dust'], ['5,1,2', 'lamp'],
    // torch on a block powering a lamp above
    ['0,0,4', 'stone'], ['0,1,4', 'torch', 'up'], ['0,2,4', 'lamp'],
  ],
  piston_door: [
    // lever pulses two sticky pistons that shove slime pillars aside
    ['0,0,0', 'stone'], ['0,0,1', 'stone'], ['0,0,2', 'stone'],
    ['0,1,0', 'sticky_piston', 'east'], ['0,3,0', 'sticky_piston', 'east'],
    ['1,1,0', 'slime'], ['1,2,0', 'slime'], ['1,3,0', 'slime'],
    ['0,2,0', 'stone'],
    ['0,1,2', 'lever', 'up'],
    ['0,1,1', 'dust'], ['0,2,1', 'dust'],
    ['1,1,2', 'dust'],
  ],
  auto_farm: [
    // a comparator reads the crop's growth; when ripe (15) the lamp lights.
    // press the button to bone-meal the crop from the dispenser.
    ['0,0,0', 'stone'],                 // soil
    ['0,1,0', 'crop'],                  // the crop (grows over time)
    ['1,0,0', 'stone'],
    ['1,1,0', 'comparator', 'east'],    // back faces the crop, output east
    ['2,0,0', 'stone'], ['2,1,0', 'dust'],
    ['3,0,0', 'stone'], ['3,1,0', 'lamp'],
    // dispenser aimed at the crop, fired by a button (bone meal)
    ['-1,1,0', 'dispenser', 'east'],
    ['-1,2,0', 'button', 'up'],
    // an observer watching the crop pulses a lamp on each growth stage
    ['0,1,-1', 'observer', 'south'],   // faces the crop at 0,1,0
    ['0,1,-2', 'stone'], ['0,2,-2', 'lamp'],
  ],
  auto_harvester: [
    // Self-running farm. An observer facing the crop pulses every time it grows
    // a stage; that pulse fires a SHEARS dispenser. Shears only cut a ripe crop,
    // so it harvests + replants (age -> 0) exactly when the wheat is full-grown.
    ['0,0,0', 'stone'], ['0,1,0', 'crop'],
    ['0,1,-1', 'observer', 'south'],           // watches the crop
    ['0,0,-2', 'stone'], ['0,1,-2', 'dust'],   // observer's back pulse ...
    ['1,0,-2', 'stone'], ['1,1,-2', 'dust'],   // ... routed around ...
    ['1,0,-1', 'stone'], ['1,1,-1', 'dust'],   // ... to the dispenser
    ['1,1,0', 'dispenser', 'west', { loaded: 'shears' }], // harvester aimed at crop
    // a comparator + lamp reads current growth (lamp brightens as it ripens)
    ['-1,0,0', 'stone'], ['-1,1,0', 'comparator', 'west'],
    ['-2,0,0', 'stone'], ['-2,1,0', 'dust'],
    ['-3,0,0', 'stone'], ['-3,1,0', 'lamp'],
  ],
};

function loadExample(name) {
  engine.clear();
  for (const [key, type, dir, extra] of EXAMPLES[name]) {
    const b = engine.place(key, type);
    if (dir) b.dir = dir;
    if (extra) Object.assign(b, extra); // e.g. { loaded: 'shears' } or { mode: 'subtract' }
  }
  scene.rebuildAll(engine);
  markDirty();
}
document.getElementById('examples').onchange = e => { if (e.target.value) { loadExample(e.target.value); e.target.selectedIndex = 0; } };

document.getElementById('help-close').onclick = () => {
  const h = document.getElementById('help');
  h.classList.toggle('hidden');
  document.getElementById('help-close').textContent = h.classList.contains('hidden') ? 'show' : 'hide';
};

// ---- go ----------------------------------------------------------------
buildPalette();
loadExample('basics');
requestAnimationFrame(frame);
