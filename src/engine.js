// engine.js — the redstone simulation.
//
// This is an *approximate* model of Minecraft redstone (good enough for the
// common builds: wires, torch logic, repeaters, comparators, observers,
// clocks, lamps) but it is not bit-for-bit accurate. Notable simplifications:
//   * dust connects to the 4 horizontal + 8 diagonal-vertical neighbours;
//   * "strong vs weak" power is collapsed to a single conduction rule;
//   * torches/repeaters/comparators/observers carry tick delays, dust is instant.

import {
  DIRS, DIR_NAMES, OPPOSITE, HORIZONTAL, sidesOf,
  keyOf, parseKey, addDir, BLOCK_TYPES, makeBlock, isMovable, isPoppable,
} from './blocks.js?v=6';

const HORIZ_AND_DOWN = ['east', 'west', 'south', 'north', 'down'];
const MAX_PUSH = 12;        // a piston moves at most this many blocks

// Components a dust wire visually connects to (and thus can power) horizontally.
// Repeaters/comparators are axis-sensitive and handled separately.
const DUST_LINK = new Set([
  'dust', 'redstone_block', 'torch', 'lever', 'button',
  'lamp', 'dispenser', 'observer', 'piston', 'sticky_piston',
]);
const CROP_MAX = 7;         // fully grown wheat stage
const CROP_INTERVAL = 24;   // ticks between natural growth attempts

export class RedstoneEngine {
  constructor() {
    this.world = new Map(); // key -> block object
    this.tickCount = 0;
    this._dirty = new Set(); // cells whose block identity changed during ticks
  }

  // Cells the renderer must rebuild (moved/spawned/destroyed blocks). Clears it.
  consumeDirty() { const d = this._dirty; this._dirty = new Set(); return d; }
  _markDirty(key) { this._dirty.add(key); }

  // ---- world editing ---------------------------------------------------
  get(key) { return this.world.get(key); }
  has(key) { return this.world.has(key); }

  set(key, block) {
    this.world.set(key, block);
    this._initRuntime(key, block);
    return block;
  }

  place(key, type) {
    const b = makeBlock(type);
    return this.set(key, b);
  }

  remove(key) { this.world.delete(key); }

  clear() { this.world.clear(); this.tickCount = 0; }

  _initRuntime(key, b) {
    const meta = BLOCK_TYPES[b.type];
    b._dust = 0;
    b._lit = false;
    if (b.type === 'torch') b.torchOn = true;
    if (b.type === 'repeater') { b.repOn = false; b.repBuf = new Array(b.delay || 1).fill(false); b.locked = false; }
    if (b.type === 'comparator') { b.compOut = 0; b.compBuf = [0]; }
    if (b.type === 'observer') { b.obsPulse = 0; b.obsPrev = null; }
    if (b.type === 'piston' || b.type === 'sticky_piston') { if (b.extended === undefined) b.extended = false; }
    if (b.type === 'dispenser') { if (b._wasPowered === undefined) b._wasPowered = false; if (b.loaded === undefined) b.loaded = 'bonemeal'; }
    if (b.type === 'crop') { if (b.age === undefined) b.age = 0; b._growth = b._growth || 0; }
    if (meta.momentary) b._ticks = 0;
  }

  setRepeaterDelay(key, delay) {
    const b = this.world.get(key);
    if (!b || b.type !== 'repeater') return;
    b.delay = Math.max(1, Math.min(4, delay));
    b.repBuf = new Array(b.delay).fill(b.repOn);
  }

  // ---- helpers ---------------------------------------------------------
  _isSolidConductive(key) {
    const b = this.world.get(key);
    return !!(b && BLOCK_TYPES[b.type].solid && BLOCK_TYPES[b.type].conductive);
  }
  _isSolid(key) {
    const b = this.world.get(key);
    return !!(b && BLOCK_TYPES[b.type].solid);
  }

  // ---- one simulation tick --------------------------------------------
  tick() {
    this.tickCount++;
    const field = this._computeField();

    // 1. Decrement momentary inputs.
    for (const b of this.world.values()) {
      if (b._ticks > 0) b._ticks--;
    }

    // 2. Compute next states of delayed components from the current field.
    const nextTorch = new Map();
    const nextRep = new Map();
    const nextComp = new Map();
    const nextObs = new Map();

    for (const [key, b] of this.world) {
      switch (b.type) {
        case 'torch': {
          const mount = addDir(key, OPPOSITE[b.dir]);
          nextTorch.set(key, !this._isPowered(mount, field));
          break;
        }
        case 'repeater': {
          const back = addDir(key, OPPOSITE[b.dir]);
          const input = this._isPowered(back, field);
          // Locked if a repeater/comparator on either side faces into us and is on.
          let locked = false;
          for (const sd of sidesOf(b.dir)) {
            const sb = this.world.get(addDir(key, sd));
            if (!sb) continue;
            const facesIn = sb.dir === OPPOSITE[sd];
            const on = (sb.type === 'repeater' && sb.repOn) ||
                       (sb.type === 'comparator' && sb.compOut > 0);
            if (facesIn && on) locked = true;
          }
          nextRep.set(key, { input, locked });
          break;
        }
        case 'comparator': {
          const back = addDir(key, OPPOSITE[b.dir]);
          const rear = Math.max(this._signalLevel(back, key, field), this._measure(back));
          let side = 0;
          for (const sd of sidesOf(b.dir)) {
            side = Math.max(side, this._signalLevel(addDir(key, sd), key, field));
          }
          let out;
          if (b.mode === 'subtract') out = Math.max(0, rear - side);
          else out = rear >= side ? rear : 0; // compare
          nextComp.set(key, out);
          break;
        }
        case 'observer': {
          const front = addDir(key, b.dir);
          const sig = this._signature(front, field);
          const changed = b.obsPrev !== null && sig !== b.obsPrev;
          nextObs.set(key, { sig, changed });
          break;
        }
      }
    }

    // 3. Apply next states.
    for (const [key, on] of nextTorch) this.world.get(key).torchOn = on;

    for (const [key, { input, locked }] of nextRep) {
      const b = this.world.get(key);
      b.locked = locked;
      if (!locked) {
        b.repBuf.push(input);
        b.repOn = b.repBuf.shift();
      }
    }

    for (const [key, out] of nextComp) {
      const b = this.world.get(key);
      b.compBuf.push(out);
      b.compOut = b.compBuf.shift();
    }

    for (const [key, { sig, changed }] of nextObs) {
      const b = this.world.get(key);
      if (changed) b.obsPulse = 2;
      else if (b.obsPulse > 0) b.obsPulse--;
      b.obsPrev = sig;
    }

    // 3b. Mechanical blocks act on the field: pistons move blocks, dispensers
    //     fire on rising edges, crops grow. Snapshot the piston/dispenser set
    //     first because pistons mutate the world as they run.
    const pistons = [];
    const dispensers = [];
    const crops = [];
    for (const [key, b] of this.world) {
      if (b.type === 'piston' || b.type === 'sticky_piston') pistons.push(key);
      else if (b.type === 'dispenser') dispensers.push(key);
      else if (b.type === 'crop') crops.push(key);
    }
    for (const key of pistons) {
      const b = this.world.get(key);
      if (!b) continue;
      const powered = this._isPowered(key, field);
      if (powered && !b.extended) this._extendPiston(key, b);
      else if (!powered && b.extended) this._retractPiston(key, b);
    }
    for (const key of dispensers) {
      const b = this.world.get(key);
      if (!b) continue;
      const powered = this._isPowered(key, field);
      if (powered && !b._wasPowered) this._fireDispenser(key, b);
      b._wasPowered = powered;
    }
    for (const key of crops) {
      const b = this.world.get(key);
      if (!b || b.age >= CROP_MAX) continue;
      b._growth++;
      if (b._growth >= CROP_INTERVAL && Math.random() < 0.5) { b.age++; b._growth = 0; }
    }

    // 4. Record dust levels + lamp lit for rendering.
    for (const [key, b] of this.world) {
      if (b.type === 'dust') b._dust = field.dust.get(key) || 0;
      if (b.type === 'lamp') b._lit = this._isPowered(key, field);
    }
  }

  // Compute the instantaneous power field from the *current* component states.
  _computeField() {
    const strong = new Map();   // solid cell -> strong power level (any solid block)
    const seed = new Map();     // dust cell -> initial level from direct sources
    const addStrong = (k, lvl) => { if (this._isSolid(k)) strong.set(k, Math.max(strong.get(k) || 0, lvl)); };
    const addSeed = (k, lvl) => { if (this.world.get(k)?.type === 'dust') seed.set(k, Math.max(seed.get(k) || 0, lvl)); };

    for (const [key, b] of this.world) {
      switch (b.type) {
        case 'redstone_block':
          for (const d of DIR_NAMES) addSeed(addDir(key, d), 15);
          break;
        case 'lever':
          if (b.on) this._emitSource(key, b, 15, addStrong, addSeed);
          break;
        case 'button':
          if (b._ticks > 0) this._emitSource(key, b, 15, addStrong, addSeed);
          break;
        case 'torch':
          if (b.torchOn) {
            addStrong(addDir(key, 'up'), 15);
            const mount = addDir(key, OPPOSITE[b.dir]);
            for (const d of DIR_NAMES) {
              const n = addDir(key, d);
              if (n !== mount) addSeed(n, 15);
            }
          }
          break;
        case 'repeater':
          if (b.repOn) {
            const front = addDir(key, b.dir);
            if (this.world.get(front)?.type === 'dust') addSeed(front, 15);
            else addStrong(front, 15);
          }
          break;
        case 'comparator':
          if (b.compOut > 0) {
            const front = addDir(key, b.dir);
            if (this.world.get(front)?.type === 'dust') addSeed(front, b.compOut);
            else addStrong(front, b.compOut);
          }
          break;
        case 'observer':
          if (b.obsPulse > 0) {
            const back = addDir(key, OPPOSITE[b.dir]);
            if (this.world.get(back)?.type === 'dust') addSeed(back, 15);
            else addStrong(back, 15);
          }
          break;
      }
    }

    // Strongly-powered *conductive* solid blocks push their level into dust.
    for (const [cell, lvl] of strong) {
      if (!this._isSolidConductive(cell)) continue;
      for (const d of DIR_NAMES) addSeed(addDir(cell, d), lvl);
    }

    // Propagate dust with bucketed max-relaxation (Dijkstra on a 0-15 lattice).
    const dust = new Map();
    const buckets = Array.from({ length: 16 }, () => []);
    for (const [cell, lvl] of seed) {
      if (lvl > (dust.get(cell) || 0)) { dust.set(cell, lvl); buckets[lvl].push(cell); }
    }
    for (let L = 15; L >= 1; L--) {
      for (const cell of buckets[L]) {
        if (dust.get(cell) !== L) continue;
        for (const n of this._dustNeighbors(cell)) {
          if (this.world.get(n)?.type !== 'dust') continue;
          if (L - 1 > (dust.get(n) || 0)) { dust.set(n, L - 1); buckets[L - 1].push(n); }
        }
      }
    }

    // Weak power: dust weakly powers the block beneath it + horizontal neighbours.
    const weak = new Map();
    for (const [cell, lvl] of dust) {
      for (const d of HORIZ_AND_DOWN) {
        const n = addDir(cell, d);
        if (this._isSolidConductive(n)) weak.set(n, Math.max(weak.get(n) || 0, lvl));
      }
    }

    return { strong, weak, dust };
  }

  _emitSource(key, b, level, addStrong, addSeed) {
    const mount = addDir(key, OPPOSITE[b.dir]);
    addStrong(mount, level);
    for (const d of DIR_NAMES) {
      const n = addDir(key, d);
      if (n !== mount) addSeed(n, level);
    }
  }

  // Total power a cell "sees": its own conduction (a solid block powered by a
  // lever/torch/repeater or dust on it) plus anything emitted by a neighbour.
  _levelInto(cell, field) {
    return Math.max(
      field.strong.get(cell) || 0,
      field.weak.get(cell) || 0,
      this._powerInto(cell, field),
    );
  }
  _isPowered(cell, field) { return this._levelInto(cell, field) > 0; }

  // The redstone signal the block at `cell` presents to a comparator/repeater
  // sitting at `toward`. This reads the actual level AT the cell (dust level,
  // source output, or a component's directed output) instead of the power
  // flowing into it — so a comparator subtracts exact strengths, not the value
  // one block upstream.
  _signalLevel(cell, toward, field) {
    const b = this.world.get(cell);
    if (!b) return 0;
    switch (b.type) {
      case 'dust': return field.dust.get(cell) || 0;
      case 'redstone_block': return 15;
      case 'torch': return b.torchOn ? 15 : 0;
      case 'lever': return b.on ? 15 : 0;
      case 'button': return b._ticks > 0 ? 15 : 0;
      case 'repeater': return (b.repOn && addDir(cell, b.dir) === toward) ? 15 : 0;
      case 'comparator': return (b.compOut > 0 && addDir(cell, b.dir) === toward) ? b.compOut : 0;
      default: // solid block: its strong/weak powered level
        return Math.max(field.strong.get(cell) || 0, field.weak.get(cell) || 0);
    }
  }

  // The power delivered into `cell` from its 6 neighbours, given the field.
  _powerInto(cell, field) {
    let best = 0;
    for (const d of DIR_NAMES) {
      const n = addDir(cell, d);
      const nb = this.world.get(n);
      if (!nb) continue;
      switch (nb.type) {
        case 'dust':
          // Dust powers the cell directly beneath it (dust is at d==='up'),
          // and cells it points at horizontally — but never sideways into a
          // component it isn't wired to, nor the cell above it (d==='down').
          if (d === 'up') best = Math.max(best, field.dust.get(n) || 0);
          else if (d !== 'down' && this._dustConnectsToward(n, OPPOSITE[d])) {
            best = Math.max(best, field.dust.get(n) || 0);
          }
          break;
        case 'redstone_block':
          best = 15; break;
        case 'stone': case 'glass': case 'lamp': case 'dispenser': {
          if (BLOCK_TYPES[nb.type].conductive) {
            best = Math.max(best, field.strong.get(n) || 0, field.weak.get(n) || 0);
          }
          break;
        }
        case 'torch':
          if (nb.torchOn && cell !== addDir(n, OPPOSITE[nb.dir])) best = 15;
          break;
        case 'lever':
          if (nb.on && cell !== addDir(n, OPPOSITE[nb.dir])) best = 15;
          break;
        case 'button':
          if (nb._ticks > 0 && cell !== addDir(n, OPPOSITE[nb.dir])) best = 15;
          break;
        case 'repeater':
          if (nb.repOn && addDir(n, nb.dir) === cell) best = 15;
          break;
        case 'comparator':
          if (nb.compOut > 0 && addDir(n, nb.dir) === cell) best = Math.max(best, nb.compOut);
          break;
        case 'observer':
          if (nb.obsPulse > 0 && addDir(n, OPPOSITE[nb.dir]) === cell) best = 15;
          break;
      }
      if (best === 15) break;
    }
    return best;
  }

  // Does the dust at `cell` connect (point) toward its neighbour in `dir`?
  // Dust only delivers power in directions it actually wires up — matching the
  // rendered wire — so it can't leak sideways into a component it isn't feeding.
  _dustConnectsToward(cell, dir) {
    const nb = addDir(cell, dir);
    const b = this.world.get(nb);
    if (b) {
      if (DUST_LINK.has(b.type)) return true;
      if (b.type === 'repeater' || b.type === 'comparator') {
        return b.dir === dir || OPPOSITE[b.dir] === dir;
      }
    }
    // climb: dust sitting on top of the neighbouring block
    if (this.world.get(addDir(nb, 'up'))?.type === 'dust') return true;
    // step down: neighbour cell is open and dust runs one level below
    const nbSolid = b && BLOCK_TYPES[b.type]?.solid;
    if (!nbSolid && this.world.get(addDir(nb, 'down'))?.type === 'dust') return true;
    return false;
  }

  // Dust connectivity: 4 horizontal + climbing up/down over adjacent columns.
  _dustNeighbors(cell) {
    const { x, y, z } = parseKey(cell);
    const out = [];
    const hor = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of hor) {
      out.push(keyOf(x + dx, y, z + dz));       // same level
      out.push(keyOf(x + dx, y + 1, z + dz));   // climb up
      out.push(keyOf(x + dx, y - 1, z + dz));   // step down
    }
    return out;
  }

  // A signature of a cell's observable state, for observer change-detection.
  _signature(cell, field) {
    const b = this.world.get(cell);
    if (!b) return 'air';
    let s = b.type + ':' + (b.dir || '');
    if (b.type === 'dust') s += ':' + (field.dust.get(cell) || 0);
    if (b.type === 'lamp') s += ':' + (this._powerInto(cell, field) > 0);
    if (b.type === 'lever') s += ':' + b.on;
    if (b.type === 'torch') s += ':' + b.torchOn;
    if (b.type === 'repeater') s += ':' + b.repOn;
    if (b.type === 'comparator') s += ':' + b.compOut;
    if (b.type === 'crop') s += ':' + b.age;
    if (b.type === 'piston' || b.type === 'sticky_piston') s += ':' + b.extended;
    return s;
  }

  // ---- comparator measurement -----------------------------------------
  // The "fill level" a comparator reads from the block directly behind it.
  _measure(cell) {
    const b = this.world.get(cell);
    if (b && b.type === 'crop') return Math.floor(b.age * 15 / CROP_MAX);
    return 0;
  }

  // ---- piston movement -------------------------------------------------
  _proj(key, D) {
    const { x, y, z } = parseKey(key);
    return x * DIRS[D].x + y * DIRS[D].y + z * DIRS[D].z;
  }

  _extendPiston(key, b) {
    const D = b.dir;
    const F = addDir(key, D);
    const push = this._gatherPush(F, D);
    if (!push) return; // blocked or too many blocks -> stays retracted

    for (const c of push.pop) { this.world.delete(c); this._markDirty(c); }

    // Move front-most first so we never overwrite a not-yet-moved block.
    const moves = push.move.slice().sort((a, c) => this._proj(c, D) - this._proj(a, D));
    for (const c of moves) {
      const blk = this.world.get(c);
      this.world.delete(c);
      const nc = addDir(c, D);
      this.world.set(nc, blk);
      this._markDirty(c); this._markDirty(nc);
    }

    const head = makeBlock('piston_head');
    head.dir = D; head.base = key;
    this.world.set(F, head); this._markDirty(F);
    b.extended = true;
  }

  _retractPiston(key, b) {
    const D = b.dir;
    const F = addDir(key, D);
    const head = this.world.get(F);
    if (head && head.type === 'piston_head') { this.world.delete(F); this._markDirty(F); }
    b.extended = false;
    if (b.type !== 'sticky_piston') return;

    const pullFrom = addDir(F, D); // block just beyond where the head was
    const pb = this.world.get(pullFrom);
    if (!pb || !isMovable(pb.type)) return;
    const group = this._gatherPull(pullFrom, D);
    if (!group) return;

    // Move nearest-to-piston first (its destination, F, is already vacated).
    const moves = group.slice().sort((a, c) => this._proj(a, D) - this._proj(c, D));
    for (const c of moves) {
      const blk = this.world.get(c);
      this.world.delete(c);
      const nc = addDir(c, OPPOSITE[D]);
      this.world.set(nc, blk);
      this._markDirty(c); this._markDirty(nc);
    }
  }

  // Blocks a piston would push at F along D. Forward neighbours are required
  // (an immovable one aborts the push); slime neighbours adhere optionally.
  _gatherPush(F, D) {
    const move = [], moveSet = new Set(), pop = [], popSet = new Set();
    const required = [F];
    const optional = [];
    const consider = (c, isRequired) => {
      if (moveSet.has(c)) return true;
      const bc = this.world.get(c);
      if (!bc) return true; // air
      if (isPoppable(bc.type)) { if (!popSet.has(c)) { popSet.add(c); pop.push(c); } return true; }
      if (!isMovable(bc.type)) return !isRequired; // required immovable -> fail
      moveSet.add(c); move.push(c);
      if (move.length > MAX_PUSH) return false;
      required.push(addDir(c, D));
      if (bc.type === 'slime') for (const d of DIR_NAMES) optional.push(addDir(c, d));
      return true;
    };
    while (required.length || optional.length) {
      const req = required.length > 0;
      const c = req ? required.pop() : optional.pop();
      if (!consider(c, req)) return null;
    }
    return { move, pop };
  }

  // The slime-connected clump anchored at `start`, if every block can slide
  // one step toward the piston (destination air or also in the clump).
  _gatherPull(start, D) {
    const move = [], set = new Set(), stack = [start];
    while (stack.length) {
      const c = stack.pop();
      if (set.has(c)) continue;
      const bc = this.world.get(c);
      if (!bc || !isMovable(bc.type)) continue;
      set.add(c); move.push(c);
      if (move.length > MAX_PUSH) return null;
      if (bc.type === 'slime') for (const d of DIR_NAMES) stack.push(addDir(c, d));
    }
    for (const c of move) {
      const dest = addDir(c, OPPOSITE[D]);
      if (set.has(dest)) continue;
      if (this.world.has(dest)) return null; // destination blocked
    }
    return move;
  }

  // ---- dispenser -------------------------------------------------------
  _fireDispenser(key, b) {
    const F = addDir(key, b.dir);
    const front = this.world.get(F);

    if (b.loaded === 'shears') {
      // Harvester: shears only cut a fully-grown crop, leaving the plant in
      // place reset to stage 0 (i.e. harvested and replanted in one action).
      if (front && front.type === 'crop' && front.age >= CROP_MAX) {
        front.age = 0;
        front._growth = 0;
      }
      return;
    }

    // Bone meal (default): grow the crop in front, or plant one on soil.
    if (front && front.type === 'crop') {
      front.age = Math.min(CROP_MAX, front.age + 1 + Math.floor(Math.random() * 3));
      return;
    }
    if (!front) {
      const below = this.world.get(addDir(F, 'down'));
      if (below && BLOCK_TYPES[below.type].solid) {
        this.world.set(F, makeBlock('crop'));
        this._markDirty(F);
      }
    }
  }

  // Serialisation (for save/load).
  toJSON() {
    const blocks = [];
    for (const [key, b] of this.world) {
      if (b.type === 'piston_head') continue; // recreated when the piston re-extends
      const e = { key, type: b.type };
      if (b.dir) e.dir = b.dir;
      if (b.delay) e.delay = b.delay;
      if (b.mode) e.mode = b.mode;
      if (b.on) e.on = b.on;
      if (b.age) e.age = b.age;
      if (b.loaded && b.loaded !== 'bonemeal') e.loaded = b.loaded;
      blocks.push(e);
    }
    return { blocks };
  }

  fromJSON(data) {
    this.clear();
    for (const e of data.blocks || []) {
      if (e.type === 'piston_head') continue;
      const b = makeBlock(e.type);
      if (e.dir) b.dir = e.dir;
      if (e.delay) b.delay = e.delay;
      if (e.mode) b.mode = e.mode;
      if (e.on) b.on = e.on;
      if (e.age) b.age = e.age;
      if (e.loaded) b.loaded = e.loaded;
      this.set(e.key, b);
    }
  }
}
