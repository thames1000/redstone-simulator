// blocks.js — shared constants, directions, and block-type metadata.

// Six cardinal directions as name -> unit vector.
export const DIRS = {
  east:  { x:  1, y:  0, z:  0 },
  west:  { x: -1, y:  0, z:  0 },
  up:    { x:  0, y:  1, z:  0 },
  down:  { x:  0, y: -1, z:  0 },
  south: { x:  0, y:  0, z:  1 },
  north: { x:  0, y:  0, z: -1 },
};

export const DIR_NAMES = Object.keys(DIRS);

export const OPPOSITE = {
  east: 'west', west: 'east',
  up: 'down', down: 'up',
  south: 'north', north: 'south',
};

export const HORIZONTAL = ['east', 'south', 'west', 'north']; // clockwise
export const VERTICAL = ['up', 'down'];

// The two horizontal directions perpendicular to a given horizontal dir.
export function sidesOf(dir) {
  if (dir === 'east' || dir === 'west') return ['north', 'south'];
  return ['east', 'west'];
}

// ---- coordinate key helpers --------------------------------------------
export function keyOf(x, y, z) { return `${x},${y},${z}`; }
export function parseKey(k) { const [x, y, z] = k.split(',').map(Number); return { x, y, z }; }
export function addDir(k, dir) {
  const { x, y, z } = parseKey(k);
  const d = DIRS[dir];
  return keyOf(x + d.x, y + d.y, z + d.z);
}

// ---- block-type metadata -----------------------------------------------
// category is used to build the palette. `rotatable` says which dir-set the
// component can face. `directional` marks components with a working facing.
export const BLOCK_TYPES = {
  stone: {
    label: 'Block', category: 'build', color: 0x8a8a8a,
    solid: true, conductive: true, movable: true,
    desc: 'Solid opaque block. Conducts redstone power.',
  },
  glass: {
    label: 'Glass', category: 'build', color: 0x9fd8e6,
    solid: true, conductive: false, transparent: true, movable: true,
    desc: 'Solid but does NOT conduct power. Good for insulating wires.',
  },
  slime: {
    label: 'Slime Block', category: 'build', color: 0x7bd45a,
    solid: true, conductive: false, transparent: true, movable: true, sticky: true,
    desc: 'Sticks to adjacent blocks — a piston moves the whole clump together.',
  },
  dust: {
    label: 'Redstone Dust', category: 'wire', color: 0xd40000,
    solid: false, conductive: false, needsSupport: true, poppable: true,
    desc: 'Carries a signal 0-15, dropping 1 per block travelled.',
  },
  torch: {
    label: 'Redstone Torch', category: 'power', color: 0xff5522,
    solid: false, directional: true, rotatable: 'all', mount: true, poppable: true,
    desc: 'Inverter. ON unless the block it is mounted on is powered.',
  },
  redstone_block: {
    label: 'Redstone Block', category: 'power', color: 0xaa0d0d,
    solid: true, conductive: false, movable: true,
    desc: 'Constant power source (15) to adjacent dust and components.',
  },
  lever: {
    label: 'Lever', category: 'power', color: 0x9a7b4f,
    solid: false, directional: true, rotatable: 'all', mount: true, toggle: true, poppable: true,
    desc: 'Toggle input. Click in Interact mode to switch on/off.',
  },
  button: {
    label: 'Button', category: 'power', color: 0x7a5f3a,
    solid: false, directional: true, rotatable: 'all', mount: true, momentary: true, poppable: true,
    desc: 'Momentary input. Emits a short pulse when pressed.',
  },
  repeater: {
    label: 'Repeater', category: 'logic', color: 0xb9b0a8,
    solid: false, directional: true, rotatable: 'horizontal', slab: true, poppable: true,
    desc: 'Restores signal to 15, one-way, adjustable 1-4 tick delay. Can be locked from the side.',
  },
  comparator: {
    label: 'Comparator', category: 'logic', color: 0xcfc6bd,
    solid: false, directional: true, rotatable: 'horizontal', slab: true, poppable: true,
    desc: 'Compare / subtract modes. Reads rear input, or the fill of the block behind (crops).',
  },
  observer: {
    label: 'Observer', category: 'logic', color: 0x5a5a5a,
    solid: true, conductive: false, directional: true, rotatable: 'all', movable: true,
    desc: 'Emits a short pulse from its back when the block it faces changes.',
  },
  piston: {
    label: 'Piston', category: 'mech', color: 0x9a8a6a,
    solid: true, conductive: false, directional: true, rotatable: 'all',
    desc: 'Pushes up to 12 blocks when powered. Retracts (leaving them) when off.',
  },
  sticky_piston: {
    label: 'Sticky Piston', category: 'mech', color: 0x7a9a5a,
    solid: true, conductive: false, directional: true, rotatable: 'all', sticky: true,
    desc: 'Like a piston, but pulls the front block back when it retracts.',
  },
  piston_head: { // internal — spawned when a piston extends
    label: 'Piston Head', color: 0xb7a985, solid: true, conductive: false, internal: true,
    desc: 'The extended arm of a piston.',
  },
  dispenser: {
    label: 'Dispenser', category: 'mech', color: 0x707070,
    solid: true, conductive: true, directional: true, rotatable: 'all',
    desc: 'On a rising power edge, acts on the block in front. Click it in Interact mode to swap its loaded item: BONE MEAL (grow/plant a crop) or SHEARS (harvest a ripe crop and replant it).',
  },
  crop: {
    label: 'Wheat Crop', category: 'mech', color: 0x8fae4a, poppable: true,
    desc: 'Grows over time (stages 0-7). A comparator behind it reads its growth.',
  },
  lamp: {
    label: 'Redstone Lamp', category: 'output', color: 0x5b4a2a,
    solid: true, conductive: true, movable: true,
    desc: 'Output. Lights up while powered.',
  },
};

export const PALETTE_ORDER = [
  'stone', 'glass', 'slime',
  'dust',
  'torch', 'redstone_block', 'lever', 'button',
  'repeater', 'comparator', 'observer',
  'piston', 'sticky_piston', 'dispenser', 'crop',
  'lamp',
];

export function makeBlock(type) {
  const meta = BLOCK_TYPES[type];
  const b = { type, dir: 'up' };
  if (type === 'repeater') { b.dir = 'north'; b.delay = 1; }
  if (type === 'comparator') { b.dir = 'north'; b.mode = 'compare'; }
  if (type === 'observer') b.dir = 'north';
  if (type === 'piston' || type === 'sticky_piston') { b.dir = 'east'; b.extended = false; }
  if (type === 'dispenser') { b.dir = 'east'; b._wasPowered = false; b.loaded = 'bonemeal'; }
  if (type === 'crop') { b.dir = 'up'; b.age = 0; b._growth = 0; }
  if (meta.toggle) b.on = false;
  return b;
}

export function isMovable(type) { return !!BLOCK_TYPES[type]?.movable; }
export function isPoppable(type) { return !!BLOCK_TYPES[type]?.poppable; }
