// scene.js — Three.js rendering of the voxel world.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DIRS, BLOCK_TYPES, parseKey, OPPOSITE } from './blocks.js';

const CELL = 1;

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.meshes = new Map();      // key -> THREE.Group
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b2330);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
    this.camera.position.set(10, 12, 16);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(4, 1, 4);

    // lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(8, 20, 6);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0x88aaff, 0.35);
    dir2.position.set(-8, 6, -10);
    this.scene.add(dir2);

    // ground grid + invisible placement plane
    this.grid = new THREE.GridHelper(64, 64, 0x39506b, 0x2a3b52);
    this.grid.position.set(0, 0, 0);
    this.scene.add(this.grid);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 64),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(0, 0, 0);
    this.scene.add(this.ground);

    // hover highlight
    this.highlight = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 1.02, 1.02),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 })
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.raycaster = new THREE.Raycaster();
    this._onResize();
    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- picking ---------------------------------------------------------
  // Returns { key, place } where `key` is the hit cell and `place` is the
  // empty neighbour cell the face points to (for placement). Ground hits
  // return the cell resting on the grid.
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    const targets = [];
    for (const g of this.meshes.values()) targets.push(g);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length) {
      const hitObj = hits[0].object;
      let obj = hitObj;
      while (obj && !obj.userData.cell) obj = obj.parent;
      if (obj) {
        const key = obj.userData.cell;
        const n = hits[0].face.normal.clone().transformDirection(hitObj.matrixWorld);
        const { x, y, z } = parseKey(key);
        const place = `${x + Math.round(n.x)},${y + Math.round(n.y)},${z + Math.round(n.z)}`;
        return { key, place, normal: n };
      }
    }

    const gh = this.raycaster.intersectObject(this.ground);
    if (gh.length) {
      const p = gh[0].point;
      const x = Math.floor(p.x), z = Math.floor(p.z);
      const key = `${x},0,${z}`;
      return { key, place: key, normal: new THREE.Vector3(0, 1, 0), ground: true };
    }
    return null;
  }

  setHighlight(key) {
    if (!key) { this.highlight.visible = false; return; }
    const { x, y, z } = parseKey(key);
    this.highlight.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.highlight.visible = true;
  }

  // ---- mesh construction ----------------------------------------------
  syncBlock(key, block) {
    this.removeBlock(key);
    const g = buildMesh(block);
    const { x, y, z } = parseKey(key);
    g.position.set(x + 0.5, y + 0.5, z + 0.5);
    g.userData.cell = key;
    this.scene.add(g);
    this.meshes.set(key, g);
  }

  removeBlock(key) {
    const g = this.meshes.get(key);
    if (!g) return;
    this.scene.remove(g);
    g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.meshes.delete(key);
  }

  rebuildAll(engine) {
    for (const key of [...this.meshes.keys()]) this.removeBlock(key);
    for (const [key, b] of engine.world) this.syncBlock(key, b);
  }

  // Update materials that change with simulation state (no geometry rebuild).
  updateDynamic(engine) {
    for (const [key, g] of this.meshes) {
      const b = engine.world.get(key);
      if (!b) continue;
      const d = g.userData.dyn;
      if (!d) continue;
      if (b.type === 'dust') {
        const t = (b._dust || 0) / 15;
        const c = new THREE.Color().setRGB(0.15 + 0.85 * t, 0.02 * t, 0.02 * t);
        d.mat.color.copy(c);
        d.mat.emissive.copy(c).multiplyScalar(0.6 * t);
      } else if (b.type === 'lamp') {
        if (b._lit) { d.mat.color.setHex(0xfff2b0); d.mat.emissive.setHex(0xffcf55); }
        else { d.mat.color.setHex(0x5b4a2a); d.mat.emissive.setHex(0x000000); }
      } else if (b.type === 'torch') {
        const on = b.torchOn;
        d.mat.emissive.setHex(on ? 0xff3300 : 0x000000);
        d.mat.color.setHex(on ? 0xff5522 : 0x551a0a);
      } else if (b.type === 'repeater') {
        d.front.emissive.setHex(b.repOn ? 0xff2200 : 0x330000);
        d.front.color.setHex(b.repOn ? 0xff4422 : 0x552222);
        if (d.lock) d.lock.visible = !!b.locked;
      } else if (b.type === 'comparator') {
        const on = b.compOut > 0;
        d.front.emissive.setHex(on ? 0xff2200 : 0x220000);
        if (d.modeMat) {
          const sub = b.mode === 'subtract';
          d.modeMat.emissive.setHex(sub ? 0xff2200 : 0x220000);
          d.modeMat.color.setHex(sub ? 0xff4422 : 0x441111);
        }
      } else if (b.type === 'observer') {
        d.back.emissive.setHex(b.obsPulse > 0 ? 0xff2200 : 0x000000);
        d.back.color.setHex(b.obsPulse > 0 ? 0xff4422 : 0x333333);
      } else if (b.type === 'crop' && d.crop) {
        applyCropVisual(d, b.age || 0);
      }
    }
  }

  // Rebuild meshes for cells the engine moved/spawned/destroyed this tick.
  applyDirty(engine) {
    for (const key of engine.consumeDirty()) {
      const b = engine.world.get(key);
      if (b) this.syncBlock(key, b);
      else this.removeBlock(key);
    }
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// ---- geometry factory --------------------------------------------------
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.75, metalness: 0.05, ...opts,
  });
}

function facingQuat(dir) {
  // rotation so that +Z maps to `dir`
  const v = DIRS[dir];
  const from = new THREE.Vector3(0, 0, 1);
  const to = new THREE.Vector3(v.x, v.y, v.z);
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}

function addArrow(group, dir, color = 0x222222) {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 8), mat(color));
  const v = DIRS[dir];
  cone.position.set(v.x * 0.35, v.y * 0.35 + 0.12, v.z * 0.35);
  cone.quaternion.copy(facingQuat(dir)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  group.add(cone);
}

function buildMesh(block) {
  const g = new THREE.Group();
  g.userData.dyn = {};
  const meta = BLOCK_TYPES[block.type];

  switch (block.type) {
    case 'stone':
    case 'redstone_block': {
      const m = mat(meta.color);
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
      break;
    }
    case 'glass': {
      const m = mat(meta.color, { transparent: true, opacity: 0.35 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
      break;
    }
    case 'lamp': {
      const m = mat(meta.color, { emissive: 0x000000 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
      g.userData.dyn.mat = m;
      break;
    }
    case 'dust': {
      const m = mat(0x3a0000, { emissive: 0x000000, roughness: 1 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.92), m);
      plate.position.y = -0.47;
      g.add(plate);
      g.userData.dyn.mat = m;
      break;
    }
    case 'torch': {
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), mat(0x6b4a2a));
      stick.position.y = -0.2;
      g.add(stick);
      const headMat = mat(0xff5522, { emissive: 0xff3300 });
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), headMat);
      head.position.y = 0.18;
      g.add(head);
      g.userData.dyn.mat = headMat;
      break;
    }
    case 'lever': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.5), mat(0x777777));
      base.position.y = -0.42;
      g.add(base);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), mat(0xbb9966));
      handle.position.y = -0.15;
      handle.rotation.x = block.on ? 0.5 : -0.5;
      g.add(handle);
      break;
    }
    case 'button': {
      const btn = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), mat(0x8a6a44));
      btn.position.y = -0.42;
      g.add(btn);
      break;
    }
    case 'repeater': {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.16, 0.98), mat(0xb9b0a8));
      slab.position.y = -0.42;
      g.add(slab);
      // input + output indicator torches along the facing axis
      const v = DIRS[block.dir];
      const backMat = mat(0xff4422, { emissive: 0x330000 });
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.12), backMat);
      back.position.set(-v.x * 0.35, -0.28, -v.z * 0.35);
      g.add(back);
      const frontMat = mat(0x552222, { emissive: 0x330000 });
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.12), frontMat);
      // delay: move the movable torch away from output based on delay
      const off = 0.05 + 0.08 * ((block.delay || 1) - 1);
      front.position.set(v.x * off, -0.28, v.z * off);
      g.add(front);
      // lock bar (visible when locked)
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.12), mat(0xddddaa));
      lock.position.set(0, -0.3, 0);
      lock.visible = false;
      g.add(lock);
      addArrow(g, block.dir, 0x333333);
      g.userData.dyn.front = frontMat;
      g.userData.dyn.lock = lock;
      break;
    }
    case 'comparator': {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.16, 0.98), mat(0xcfc6bd));
      slab.position.y = -0.42;
      g.add(slab);
      const v = DIRS[block.dir];
      const frontMat = mat(0x772222, { emissive: 0x220000 });
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.12), frontMat);
      front.position.set(v.x * 0.35, -0.28, v.z * 0.35);
      g.add(front);
      // mode torch at back (lit = subtract)
      const modeMat = mat(0x441111, { emissive: 0x220000 });
      const modeT = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.12), modeMat);
      modeT.position.set(-v.x * 0.35, -0.26, -v.z * 0.35);
      g.add(modeT);
      addArrow(g, block.dir, 0x333333);
      g.userData.dyn.front = frontMat;
      g.userData.dyn.modeMat = modeMat;
      break;
    }
    case 'observer': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat(0x5a5a5a));
      g.add(body);
      // face marker (the side it watches)
      const fv = DIRS[block.dir];
      const faceMat = mat(0x2a2a2a);
      const face = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.05), faceMat);
      face.position.set(fv.x * 0.51, fv.y * 0.51, fv.z * 0.51);
      face.quaternion.copy(facingQuat(block.dir));
      g.add(face);
      // back output marker
      const bv = DIRS[OPPOSITE[block.dir]];
      const backMat = mat(0x333333, { emissive: 0x000000 });
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.05), backMat);
      back.position.set(bv.x * 0.51, bv.y * 0.51, bv.z * 0.51);
      back.quaternion.copy(facingQuat(OPPOSITE[block.dir]));
      g.add(back);
      g.userData.dyn.back = backMat;
      break;
    }
    case 'slime': {
      const m = mat(0x7bd45a, { transparent: true, opacity: 0.55, emissive: 0x1c3a10 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.98), m));
      break;
    }
    case 'piston':
    case 'sticky_piston': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat(0x8a7550));
      g.add(body);
      // the pushing face plate on the facing side
      const v = DIRS[block.dir];
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 0.18),
        mat(block.type === 'sticky_piston' ? 0x7bd45a : 0xc9b587)
      );
      plate.position.set(v.x * 0.42, v.y * 0.42, v.z * 0.42);
      plate.quaternion.copy(facingQuat(block.dir));
      g.add(plate);
      break;
    }
    case 'piston_head': {
      const v = DIRS[block.dir];
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.22), mat(0xc9b587));
      plate.position.set(v.x * 0.4, v.y * 0.4, v.z * 0.4);
      plate.quaternion.copy(facingQuat(block.dir));
      g.add(plate);
      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.8), mat(0x9a8a6a));
      rod.position.set(-v.x * 0.2, -v.y * 0.2, -v.z * 0.2);
      rod.quaternion.copy(facingQuat(block.dir));
      g.add(rod);
      break;
    }
    case 'dispenser': {
      const shears = block.loaded === 'shears';
      // a shears dispenser (harvester) reads as steel-blue, bone meal as green
      const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        mat(shears ? 0x63707a : 0x6f6f6f));
      g.add(body);
      const v = DIRS[block.dir];
      const axisFix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 16),
        mat(shears ? 0x9fd0dd : 0x1a1a1a, { emissive: shears ? 0x14343d : 0x000000 }));
      hole.position.set(v.x * 0.5, v.y * 0.5, v.z * 0.5);
      hole.quaternion.copy(facingQuat(block.dir)).multiply(axisFix);
      g.add(hole);
      if (shears) {
        // little "X" of shear blades over the muzzle to signal harvester mode
        for (const ang of [Math.PI / 4, -Math.PI / 4]) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.05), mat(0xdfe8ec));
          blade.position.set(v.x * 0.55, v.y * 0.55, v.z * 0.55);
          blade.quaternion.copy(facingQuat(block.dir))
            .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang));
          g.add(blade);
        }
      }
      break;
    }
    case 'crop': {
      const soil = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.12, 0.98), mat(0x5a3d24));
      soil.position.y = -0.44;
      g.add(soil);
      const bladeMat = mat(0x8fae4a, { emissive: 0x000000 });
      const blades = new THREE.Group();
      for (const [ox, oz] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28], [0, 0]]) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.06), bladeMat);
        blade.position.set(ox, 0, oz);
        blades.add(blade);
      }
      g.add(blades);
      g.userData.dyn = { crop: blades, cropMat: bladeMat };
      applyCropVisual(g.userData.dyn, block.age || 0);
      break;
    }
    default: {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat(0xff00ff)));
    }
  }
  return g;
}

// Scale/tint a crop's blades to reflect its growth stage (0-7).
function applyCropVisual(dyn, age) {
  const t = age / 7;
  const h = 0.25 + 0.7 * t;          // blade height
  dyn.crop.scale.y = h;
  dyn.crop.position.y = -0.5 + h / 2;
  dyn.cropMat.color.setRGB(0.45 + 0.35 * t, 0.55 + 0.2 * t, 0.15 + 0.1 * (1 - t));
  if (age >= 7) dyn.cropMat.color.setHex(0xe3c74a); // golden when ripe
}
export { applyCropVisual };
