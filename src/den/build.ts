// Нора и вещи во дворе из примитивов Babylon — как детали поляны в decor.ts.
// Вещь строится вокруг своего начала координат; DenScreen ставит её в слот и поворачивает.

import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import type { ItemId } from './catalog';

type Rgb = readonly [r: number, g: number, b: number];

/** Построенная вещь: корень для расстановки и, если она живая, анимация. */
export interface Built {
  root: TransformNode;
  meshes: Mesh[];
  tick?: (t: number) => void;
}

const BARK: Rgb = [0.4, 0.28, 0.18];
const WOOD: Rgb = [0.72, 0.55, 0.36];
const CUT: Rgb = [0.8, 0.65, 0.44];
const SOIL: Rgb = [0.3, 0.21, 0.14];
const MOSS: Rgb = [0.3, 0.5, 0.22];
const LEAF: Rgb = [0.26, 0.5, 0.22];
const GLOW: Rgb = [1, 0.85, 0.4];
const DARK: Rgb = [0.06, 0.045, 0.035];
const ROOT: Rgb = [0.36, 0.25, 0.16];

/** Холм норы: центр, радиус у земли и высота. */
export const MOUND = { x: 0, z: 5.6, r: 2.7, h: 1.5 };
/** Вторая комната большой норы — холмик поменьше справа. */
export const ANNEX = { x: 3, z: 6.4, r: 1.6, h: 1 };
const STONE: Rgb = [0.62, 0.6, 0.56];
const BRASS: Rgb = [0.85, 0.68, 0.3];
const FLOWERS: readonly Rgb[] = [[0.95, 0.5, 0.7], [1, 0.82, 0.2], [0.5, 0.6, 1], [0.95, 0.95, 0.9]];
/** Середина входа над землёй и наклон двери по склону холма. */
const ENTRANCE_Y = 0.4;
const ENTRANCE_TILT = 0.47;

/**
 * Точка на склоне холма на высоте y: az — угол от направления на камеру (0 — прямо к ней),
 * k — во сколько раз отступить от поверхности наружу.
 */
export function moundPoint(az: number, y: number, k = 1): Vector3 {
  const flat = MOUND.r * Math.sqrt(Math.max(0, 1 - (y / MOUND.h) ** 2)) * k;
  return new Vector3(MOUND.x + Math.sin(az) * flat, y * k, MOUND.z - Math.cos(az) * flat);
}

/** Материалы по цвету и строитель мешей одной сцены. */
export class DenKit {
  private readonly materials = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene) {}

  mat(c: Rgb, emissive = 0, alpha = 1): StandardMaterial {
    const key = `${c.join()}|${emissive}|${alpha}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new StandardMaterial(`den-${key}`, this.scene);
      m.diffuseColor = new Color3(c[0], c[1], c[2]);
      m.specularColor = new Color3(0, 0, 0);
      if (emissive) m.emissiveColor = m.diffuseColor.scale(emissive);
      if (alpha < 1) m.alpha = alpha;
      this.materials.set(key, m);
    }
    return m;
  }

  /** Сборщик одной вещи: части цепляются к общему корню. */
  private start(name: string): { root: TransformNode; meshes: Mesh[]; add: (m: Mesh, c: Rgb, x: number, y: number, z: number, emissive?: number) => Mesh } {
    const root = new TransformNode(name, this.scene);
    const meshes: Mesh[] = [];
    const add = (m: Mesh, c: Rgb, x: number, y: number, z: number, emissive = 0) => {
      m.parent = root;
      m.position.set(x, y, z);
      m.material = this.mat(c, emissive);
      m.receiveShadows = true;
      meshes.push(m);
      return m;
    };
    return { root, meshes, add };
  }

  // ---------- Нора ----------

  /**
   * Холм норы под большим деревом: вход под корнями. С уровнем нора растёт:
   * 1 — круглая дверца, 2 — окошко с ящиком цветов, 3 — вторая комната и труба с дымком.
   * Дёрн на холмах — в цвет земли биома.
   */
  shell(tier: number, ground: Rgb = [0.42, 0.6, 0.36]): Built {
    const turf = (k: number): Rgb => [ground[0] * k, ground[1] * k, ground[2] * k];
    const s = this.scene;
    const { root, meshes, add } = this.start('den-shell');
    const ticks: ((t: number) => void)[] = [];
    /** Группа деталей, обращённая лицом наружу от холма в точке p (нормаль — n). */
    const face = (p: Vector3, n: Vector3) => {
      const g = new TransformNode('den-face', s);
      g.parent = root;
      g.position.copyFrom(p);
      g.lookAt(p.subtract(n));
      return g;
    };
    const into = (g: TransformNode, m: Mesh, c: Rgb, x: number, y: number, z: number, emissive = 0) => {
      add(m, c, 0, 0, 0, emissive);
      m.parent = g;
      m.position.set(x, y, z);
      return m;
    };
    const mound = add(MeshBuilder.CreateSphere('den-mound', { diameter: MOUND.r * 2, segments: 20, slice: 0.5 }, s), turf(0.86), MOUND.x, 0, MOUND.z);
    mound.scaling.y = MOUND.h / MOUND.r;
    // Вход: тёмный круг, наполовину ушедший в землю и наклонённый по склону холма
    const door = moundPoint(0, ENTRANCE_Y);
    const hole = add(MeshBuilder.CreateDisc('den-hole', { radius: 0.72, tessellation: 28 }, s), DARK, door.x, ENTRANCE_Y, door.z - 0.02);
    hole.rotation.x = ENTRANCE_TILT;
    add(MeshBuilder.CreateDisc('den-sill', { radius: 0.9, tessellation: 20 }, s), SOIL, 0, 0.025, door.z - 0.45).rotation.x = Math.PI / 2;
    // Корень аркой над входом
    const arch: Vector3[] = [];
    for (let k = 0; k <= 14; k++) {
      const a = -0.25 + ((Math.PI + 0.5) * k) / 14;
      const up = Math.sin(a) * 0.86;
      arch.push(new Vector3(Math.cos(a) * 0.86, ENTRANCE_Y + up * Math.cos(ENTRANCE_TILT), door.z + up * Math.sin(ENTRANCE_TILT) - 0.06));
    }
    add(MeshBuilder.CreateTube('den-root', { path: arch, radius: 0.1, tessellation: 6, cap: Mesh.CAP_ALL }, s), ROOT, 0, 0, 0);
    // Корни сосны сбегают с макушки холма по бокам
    for (const az of [-1.25, 1.2, 2.3, -2.4]) {
      const path: Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const el = 1.25 - (1.25 * k) / 10;
        const p = moundPoint(az, Math.sin(el) * MOUND.h, 1.03);
        path.push(p);
      }
      add(MeshBuilder.CreateTube('den-root', { path, radius: 0.08 + Math.abs(az) * 0.01, tessellation: 6, cap: Mesh.CAP_ALL }, s), ROOT, 0, 0, 0);
    }

    if (tier >= 1) {
      // Круглая дверца с ручкой, по наклону входа
      const g = new TransformNode('den-door', s);
      g.parent = root;
      g.position.set(door.x, ENTRANCE_Y, door.z - 0.05);
      g.rotation.x = ENTRANCE_TILT;
      into(g, MeshBuilder.CreateDisc('door', { radius: 0.66, tessellation: 28 }, s), WOOD, 0, 0, 0);
      for (const x of [-0.3, 0, 0.3]) into(g, MeshBuilder.CreateBox('door-plank', { width: 0.025, height: 1.1, depth: 0.02 }, s), BARK, x, 0, -0.01).scaling.y = x ? 0.85 : 1;
      into(g, MeshBuilder.CreateSphere('door-knob', { diameter: 0.1, segments: 6 }, s), BRASS, 0.42, 0.02, -0.05);
    }
    if (tier >= 2) {
      // Окошко слева от двери: тёплый свет, рама крестом и ящик с цветами
      const p = moundPoint(-0.85, 0.72, 1);
      const n = new Vector3((p.x - MOUND.x) / MOUND.r ** 2, p.y / MOUND.h ** 2, (p.z - MOUND.z) / MOUND.r ** 2).normalize();
      const g = face(p.add(n.scale(0.02)), n);
      const glass = into(g, MeshBuilder.CreateDisc('window', { radius: 0.34, tessellation: 20 }, s), GLOW, 0, 0, 0, 0.8);
      into(g, MeshBuilder.CreateTorus('window-frame', { diameter: 0.72, thickness: 0.07, tessellation: 24 }, s), WOOD, 0, 0, 0).rotation.x = Math.PI / 2;
      into(g, MeshBuilder.CreateBox('window-bar', { width: 0.68, height: 0.04, depth: 0.04 }, s), WOOD, 0, 0, -0.02);
      into(g, MeshBuilder.CreateBox('window-bar', { width: 0.04, height: 0.68, depth: 0.04 }, s), WOOD, 0, 0, -0.02);
      into(g, MeshBuilder.CreateBox('flower-box', { width: 0.8, height: 0.16, depth: 0.22 }, s), BARK, 0, -0.48, -0.12);
      for (let k = 0; k < 6; k++) {
        into(g, MeshBuilder.CreateSphere('box-flower', { diameter: 0.11, segments: 4 }, s), FLOWERS[k % FLOWERS.length], -0.3 + k * 0.12, -0.36 + (k % 2) * 0.04, -0.14);
      }
      const warm = glass.material as StandardMaterial;
      ticks.push((t) => warm.emissiveColor.set(0.8 + Math.sin(t * 3.1) * 0.05 + Math.sin(t * 7.3) * 0.03, 0.68, 0.32));
    }
    if (tier >= 3) {
      // Вторая комната — холмик справа со своим окошком
      const annex = add(MeshBuilder.CreateSphere('den-annex', { diameter: ANNEX.r * 2, segments: 16, slice: 0.5 }, s), turf(0.9), ANNEX.x, 0, ANNEX.z);
      annex.scaling.y = ANNEX.h / ANNEX.r;
      const g = new TransformNode('den-annex-window', s);
      g.parent = root;
      g.position.set(ANNEX.x - 0.55, 0.55, ANNEX.z - 1.3);
      g.lookAt(new Vector3(ANNEX.x - 0.55 + 0.45, 0.55 + 0.5, ANNEX.z - 1.3 + 1));
      into(g, MeshBuilder.CreateDisc('annex-window', { radius: 0.22, tessellation: 16 }, s), GLOW, 0, 0, 0, 0.8);
      into(g, MeshBuilder.CreateTorus('annex-frame', { diameter: 0.48, thickness: 0.06, tessellation: 20 }, s), WOOD, 0, 0, 0).rotation.x = Math.PI / 2;
      // Труба на макушке и дымок колечками
      const top = moundPoint(0.75, 1.2);
      add(MeshBuilder.CreateCylinder('chimney', { diameter: 0.42, height: 1, tessellation: 10 }, s), STONE, top.x, 1.65, top.z);
      add(MeshBuilder.CreateCylinder('chimney-cap', { diameter: 0.52, height: 0.1, tessellation: 10 }, s), [0.5, 0.48, 0.45], top.x, 2.18, top.z);
      const smoke = this.mat([0.85, 0.85, 0.85], 0.3, 0.45);
      const puffs = [0, 1, 2, 3, 4].map((k) => {
        const m = MeshBuilder.CreateSphere('smoke', { diameter: 0.3, segments: 6 }, s);
        m.parent = root;
        m.material = smoke;
        m.isPickable = false;
        meshes.push(m);
        return { m, k };
      });
      ticks.push((t) => {
        for (const { m, k } of puffs) {
          const u = (t * 0.25 + k / puffs.length) % 1;
          m.position.set(top.x + Math.sin(u * 4 + k) * 0.15 + u * 0.4, 2.3 + u * 2.2, top.z + u * 0.3);
          m.scaling.setAll(0.6 + u * 1.6);
          m.visibility = 1 - u;
        }
      });
    }
    return { root, meshes, tick: ticks.length ? (t) => ticks.forEach((f) => f(t)) : undefined };
  }

  /** Сад кристаллов: кольцо камешков и мох. */
  gardenBed(x: number, z: number): Built {
    const s = this.scene;
    const { root, meshes, add } = this.start('den-garden-bed');
    root.position.set(x, 0, z);
    add(MeshBuilder.CreateDisc('bed-moss', { radius: 0.75, tessellation: 20 }, s), MOSS, 0, 0.03, 0).rotation.x = Math.PI / 2;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2, size = 0.13 + (k % 3) * 0.03;
      const m = add(MeshBuilder.CreatePolyhedron('bed-stone', { type: 2, size }, s), [0.62, 0.6, 0.56], Math.cos(a) * 0.85, size * 0.4, Math.sin(a) * 0.85);
      m.scaling.y = 0.6;
      m.rotation.y = k;
    }
    for (const m of meshes) m.isPickable = false;
    return { root, meshes };
  }

  // ---------- Вещи ----------

  item(id: ItemId): Built {
    const s = this.scene;
    const b = this.start(`den-${id}`);
    const { add } = b;
    let tick: Built['tick'];
    switch (id) {
      case 'mat': {
        const m = add(MeshBuilder.CreateCylinder('mat', { diameter: 1.3, height: 0.04, tessellation: 20 }, s), MOSS, 0, 0.02, 0);
        m.scaling.z = 0.65;
        for (let k = 0; k < 5; k++) {
          add(MeshBuilder.CreateSphere('moss', { diameter: 0.16, segments: 4 }, s), [0.36, 0.58, 0.26], Math.cos(k * 1.3) * 0.45, 0.04, Math.sin(k * 1.3) * 0.25).scaling.y = 0.4;
        }
        break;
      }
      case 'lantern': {
        add(MeshBuilder.CreateCylinder('post', { diameter: 0.08, height: 1.1, tessellation: 6 }, s), BARK, 0, 0.55, 0);
        add(MeshBuilder.CreateBox('arm', { width: 0.4, height: 0.05, depth: 0.05 }, s), BARK, 0.18, 1.08, 0);
        const jar = add(MeshBuilder.CreateCylinder('jar', { diameter: 0.24, height: 0.3, tessellation: 12 }, s), [0.8, 0.9, 0.85], 0.34, 0.86, 0);
        jar.material = this.mat([0.8, 0.9, 0.85], 0, 0.3);
        add(MeshBuilder.CreateCylinder('lid', { diameter: 0.26, height: 0.05, tessellation: 12 }, s), WOOD, 0.34, 1.03, 0);
        const fly = add(MeshBuilder.CreateSphere('fly', { diameter: 0.1, segments: 6 }, s), GLOW, 0.34, 0.86, 0, 1);
        tick = (t) => {
          fly.position.y = 0.86 + Math.sin(t * 2.3) * 0.05;
          fly.position.x = 0.34 + Math.cos(t * 1.7) * 0.04;
        };
        break;
      }
      case 'basket': {
        add(MeshBuilder.CreateCylinder('basket', { diameterTop: 0.6, diameterBottom: 0.45, height: 0.28, tessellation: 14 }, s), [0.68, 0.5, 0.28], 0, 0.14, 0);
        const path: Vector3[] = [];
        for (let k = 0; k <= 10; k++) path.push(new Vector3(Math.cos((Math.PI * k) / 10) * 0.27, 0.28 + Math.sin((Math.PI * k) / 10) * 0.3, 0));
        add(MeshBuilder.CreateTube('handle', { path, radius: 0.02, tessellation: 5 }, s), [0.6, 0.44, 0.24], 0, 0, 0);
        for (let k = 0; k < 9; k++) {
          const a = k * 2.4, r = 0.08 + (k % 3) * 0.06;
          add(MeshBuilder.CreateSphere('berry', { diameter: 0.09, segments: 4 }, s), k % 3 ? [0.85, 0.15, 0.2] : [0.25, 0.3, 0.7], Math.cos(a) * r, 0.3, Math.sin(a) * r);
        }
        break;
      }
      case 'stumpTable':
      case 'teaTable': {
        add(MeshBuilder.CreateCylinder('stump', { diameterTop: 0.95, diameterBottom: 1.15, height: 0.6, tessellation: 12 }, s), BARK, 0, 0.3, 0);
        add(MeshBuilder.CreateCylinder('top', { diameter: 0.92, height: 0.03, tessellation: 12 }, s), CUT, 0, 0.6, 0);
        for (const side of [-1, 1]) {
          add(MeshBuilder.CreateCylinder('seat', { diameterTop: 0.42, diameterBottom: 0.5, height: 0.32, tessellation: 9 }, s), BARK, side * 0.95, 0.16, 0.15);
          add(MeshBuilder.CreateCylinder('seat-top', { diameter: 0.4, height: 0.02, tessellation: 9 }, s), CUT, side * 0.95, 0.32, 0.15);
        }
        if (id === 'teaTable') {
          const pot = add(MeshBuilder.CreateSphere('pot', { diameter: 0.3, segments: 10 }, s), [0.9, 0.88, 0.82], 0, 0.74, 0);
          pot.scaling.y = 0.8;
          add(MeshBuilder.CreateSphere('pot-lid', { diameter: 0.1, segments: 6 }, s), [0.85, 0.3, 0.25], 0, 0.88, 0);
          const spout = add(MeshBuilder.CreateCylinder('spout', { diameterTop: 0.03, diameterBottom: 0.06, height: 0.18, tessellation: 6 }, s), [0.9, 0.88, 0.82], 0.17, 0.8, 0);
          spout.rotation.z = -0.9;
          for (const side of [-1, 1]) {
            add(MeshBuilder.CreateCylinder('cup', { diameterTop: 0.1, diameterBottom: 0.08, height: 0.09, tessellation: 8 }, s), [0.85, 0.3, 0.25], side * 0.28, 0.66, 0.12);
          }
        }
        break;
      }
      case 'mushrooms':
      case 'pumpkins': {
        add(MeshBuilder.CreateBox('bed', { width: 1.5, height: 0.14, depth: 0.85 }, s), SOIL, 0, 0.07, 0);
        for (const side of [-1, 1]) {
          const log = add(MeshBuilder.CreateCylinder('edge', { diameter: 0.14, height: 1.6, tessellation: 7 }, s), BARK, 0, 0.08, side * 0.47);
          log.rotation.z = Math.PI / 2;
        }
        if (id === 'mushrooms') {
          for (let k = 0; k < 6; k++) {
            const x = -0.55 + k * 0.22, z = (k % 2 ? 0.14 : -0.14);
            const h = 0.12 + (k % 3) * 0.04;
            add(MeshBuilder.CreateCylinder('m-stem', { diameter: 0.05, height: h, tessellation: 6 }, s), [0.95, 0.9, 0.8], x, 0.14 + h / 2, z);
            add(MeshBuilder.CreateSphere('m-cap', { diameter: 0.16, segments: 6, slice: 0.5 }, s), [0.95, 0.62, 0.15], x, 0.14 + h, z).scaling.y = 0.6;
          }
        } else {
          for (let k = 0; k < 3; k++) {
            const x = -0.45 + k * 0.45, d = 0.32 + (k % 2) * 0.08;
            add(MeshBuilder.CreateSphere('pumpkin', { diameter: d, segments: 10 }, s), [0.95, 0.5, 0.12], x, 0.14 + d * 0.35, 0).scaling.y = 0.72;
            add(MeshBuilder.CreateCylinder('p-stem', { diameter: 0.04, height: 0.08, tessellation: 5 }, s), [0.35, 0.45, 0.2], x, 0.14 + d * 0.66, 0);
            const leaf = add(MeshBuilder.CreateDisc('p-leaf', { radius: 0.12, tessellation: 8 }, s), LEAF, x + 0.15, 0.16, 0.2);
            leaf.rotation.x = Math.PI / 2;
          }
        }
        break;
      }
      case 'log': {
        const log = add(MeshBuilder.CreateCylinder('log', { diameter: 0.42, height: 1.6, tessellation: 10 }, s), BARK, 0, 0.21, 0);
        log.rotation.z = Math.PI / 2;
        for (const side of [-1, 1]) {
          const cut = add(MeshBuilder.CreateDisc('log-cut', { radius: 0.2, tessellation: 10 }, s), CUT, side * 0.805, 0.21, 0);
          cut.rotation.y = (side * Math.PI) / 2;
        }
        add(MeshBuilder.CreateSphere('log-moss', { diameter: 0.3, segments: 5 }, s), MOSS, -0.3, 0.38, 0.05).scaling.y = 0.35;
        break;
      }
      case 'bench': {
        for (const side of [-1, 1]) add(MeshBuilder.CreateCylinder('bench-leg', { diameter: 0.22, height: 0.4, tessellation: 8 }, s), BARK, side * 0.55, 0.2, 0);
        add(MeshBuilder.CreateBox('bench-seat', { width: 1.5, height: 0.08, depth: 0.42 }, s), WOOD, 0, 0.44, 0);
        for (const side of [-1, 1]) add(MeshBuilder.CreateBox('bench-post', { width: 0.07, height: 0.55, depth: 0.07 }, s), WOOD, side * 0.6, 0.72, 0.18);
        add(MeshBuilder.CreateBox('bench-back', { width: 1.4, height: 0.2, depth: 0.05 }, s), WOOD, 0, 0.88, 0.2);
        break;
      }
      case 'signpost': {
        add(MeshBuilder.CreateCylinder('sign-post', { diameter: 0.1, height: 1.5, tessellation: 6 }, s), BARK, 0, 0.75, 0);
        const a = add(MeshBuilder.CreateBox('sign-a', { width: 0.75, height: 0.18, depth: 0.04 }, s), WOOD, 0.25, 1.25, 0);
        a.rotation.z = 0.08;
        const b2 = add(MeshBuilder.CreateBox('sign-b', { width: 0.7, height: 0.18, depth: 0.04 }, s), CUT, -0.22, 0.98, 0);
        b2.rotation.set(0, 0.5, -0.06);
        break;
      }
      case 'mailbox': {
        add(MeshBuilder.CreateCylinder('mail-post', { diameter: 0.1, height: 1, tessellation: 6 }, s), BARK, 0, 0.5, 0);
        add(MeshBuilder.CreateBox('mail-box', { width: 0.32, height: 0.24, depth: 0.5 }, s), [0.8, 0.25, 0.2], 0, 1.1, 0);
        const roof = add(MeshBuilder.CreateCylinder('mail-roof', { diameter: 0.32, height: 0.5, tessellation: 12, arc: 0.5 }, s), [0.8, 0.25, 0.2], 0, 1.22, 0);
        roof.rotation.set(Math.PI / 2, 0, Math.PI / 2);
        add(MeshBuilder.CreateBox('mail-flag', { width: 0.03, height: 0.22, depth: 0.08 }, s), BRASS, 0.18, 1.2, 0.12);
        break;
      }
      case 'pond': {
        const water = add(MeshBuilder.CreateDisc('pond', { radius: 0.95, tessellation: 28 }, s), [0.3, 0.55, 0.7], 0, 0.04, 0, 0.15);
        water.rotation.x = Math.PI / 2;
        water.scaling.y = 0.75;
        // Свой материал с бликом: только у пруда такой цвет и прозрачность
        const wm = this.mat([0.3, 0.55, 0.7], 0.15, 0.92);
        wm.specularColor.set(0.6, 0.6, 0.6);
        wm.specularPower = 48;
        water.material = wm;
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2, size = 0.12 + (k % 3) * 0.04;
          const m = add(MeshBuilder.CreatePolyhedron('pond-stone', { type: 2, size }, s), STONE, Math.cos(a) * 1.02, size * 0.35, Math.sin(a) * 0.78);
          m.scaling.y = 0.55;
        }
        for (let k = 0; k < 3; k++) {
          const a = 0.6 + k * 1.9;
          add(MeshBuilder.CreateSphere('pond-shell', { diameter: 0.14, segments: 6, slice: 0.5 }, s), [1, 0.78, 0.74], Math.cos(a) * 1.25, 0.02, Math.sin(a) * 0.95).scaling.y = 0.5;
        }
        const pad = add(MeshBuilder.CreateDisc('lily', { radius: 0.18, tessellation: 12, arc: 0.85 }, s), LEAF, 0.3, 0.05, 0.1);
        pad.rotation.x = Math.PI / 2;
        add(MeshBuilder.CreateSphere('lily-flower', { diameter: 0.1, segments: 5 }, s), [0.98, 0.85, 0.9], 0.32, 0.08, 0.12);
        tick = (t) => (pad.rotation.y = Math.sin(t * 0.4) * 0.3);
        break;
      }
      case 'snowman': {
        const SNOW: Rgb = [0.95, 0.97, 1];
        add(MeshBuilder.CreateSphere('snow-1', { diameter: 0.8, segments: 12 }, s), SNOW, 0, 0.36, 0);
        add(MeshBuilder.CreateSphere('snow-2', { diameter: 0.56, segments: 12 }, s), SNOW, 0, 0.9, 0);
        add(MeshBuilder.CreateSphere('snow-3', { diameter: 0.38, segments: 12 }, s), SNOW, 0, 1.3, 0);
        const nose = add(MeshBuilder.CreateCylinder('nose', { diameterTop: 0, diameterBottom: 0.07, height: 0.22, tessellation: 6 }, s), [0.95, 0.5, 0.12], 0, 1.3, -0.25);
        nose.rotation.x = -Math.PI / 2;
        for (const side of [-1, 1]) {
          add(MeshBuilder.CreateSphere('eye', { diameter: 0.05, segments: 4 }, s), DARK, side * 0.08, 1.38, -0.17);
          const arm = add(MeshBuilder.CreateCylinder('arm', { diameter: 0.03, height: 0.55, tessellation: 4 }, s), BARK, side * 0.45, 0.98, 0);
          arm.rotation.z = side * 1.1;
        }
        add(MeshBuilder.CreateCylinder('icicle-hat', { diameterTop: 0, diameterBottom: 0.3, height: 0.35, tessellation: 7 }, s), [0.7, 0.9, 1], 0, 1.62, 0, 0.3);
        break;
      }
      case 'posts': {
        const lights: Mesh[] = [];
        const ends = [-0.8, 0.8];
        for (const x of ends) add(MeshBuilder.CreateCylinder('post', { diameter: 0.09, height: 1.5, tessellation: 6 }, s), BARK, x, 0.75, 0);
        const path: Vector3[] = [];
        for (let k = 0; k <= 12; k++) {
          const u = k / 12;
          path.push(new Vector3(-0.8 + 1.6 * u, 1.45 - Math.sin(u * Math.PI) * 0.3, 0));
        }
        add(MeshBuilder.CreateTube('rope', { path, radius: 0.012, tessellation: 4 }, s), [0.3, 0.25, 0.2], 0, 0, 0);
        for (let k = 1; k < 12; k += 2) {
          const p = path[k];
          lights.push(add(MeshBuilder.CreateSphere('bulb', { diameter: 0.09, segments: 5 }, s), FLOWERS[(k >> 1) % FLOWERS.length], p.x, p.y - 0.06, 0, 1));
        }
        tick = (t) => lights.forEach((l, k) => (l.visibility = 0.75 + Math.sin(t * 2 + k * 1.3) * 0.25));
        break;
      }
      case 'chimes': {
        add(MeshBuilder.CreateCylinder('chime-post', { diameter: 0.09, height: 1.6, tessellation: 6 }, s), BARK, -0.35, 0.8, 0);
        const arm = add(MeshBuilder.CreateCylinder('chime-arm', { diameter: 0.06, height: 0.8, tessellation: 6 }, s), BARK, 0, 1.55, 0);
        arm.rotation.z = Math.PI / 2;
        const hangs: Mesh[] = [];
        for (let k = 0; k < 5; k++) {
          const x = -0.12 + k * 0.1;
          const h = add(MeshBuilder.CreateCylinder('chime', { diameter: 0.035, height: 0.3 + (k % 3) * 0.08, tessellation: 5 }, s), k % 2 ? [1, 0.78, 0.74] : [0.86, 0.84, 0.95], x, 1.3, 0);
          hangs.push(h);
        }
        tick = (t) => hangs.forEach((h, k) => (h.rotation.z = Math.sin(t * 1.7 + k) * 0.12));
        break;
      }
      case 'campfire': {
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          add(MeshBuilder.CreatePolyhedron('fire-stone', { type: 2, size: 0.14 }, s), STONE, Math.cos(a) * 0.5, 0.07, Math.sin(a) * 0.5).scaling.y = 0.6;
        }
        for (let k = 0; k < 3; k++) {
          const l = add(MeshBuilder.CreateCylinder('fire-log', { diameter: 0.1, height: 0.6, tessellation: 6 }, s), BARK, 0, 0.12, 0);
          l.rotation.set(Math.PI / 2 - 0.35, (k * Math.PI * 2) / 3, 0);
        }
        const flames = [0, 1, 2].map((k) =>
          add(MeshBuilder.CreateCylinder('flame', { diameterTop: 0, diameterBottom: 0.3 - k * 0.07, height: 0.6 - k * 0.12, tessellation: 7 }, s), k ? [1, 0.82, 0.3] : [1, 0.5, 0.15], 0, 0.35, 0, 1),
        );
        for (const m of flames) m.isPickable = false;
        for (const side of [-1, 1]) {
          const seat = add(MeshBuilder.CreateCylinder('fire-seat', { diameter: 0.34, height: 1.1, tessellation: 8 }, s), BARK, side * 1.05, 0.17, 0.25);
          seat.rotation.set(0, side * 0.4, Math.PI / 2);
        }
        tick = (t) =>
          flames.forEach((f, k) => {
            const flick = 1 + Math.sin(t * (9 + k * 3)) * 0.08 + Math.sin(t * 23 + k) * 0.05;
            f.scaling.set(1, flick, 1);
            f.position.y = 0.32 + (flick - 1) * 0.3;
          });
        break;
      }
      case 'crystalStone': {
        add(MeshBuilder.CreateCylinder('stone', { diameterTop: 0.4, diameterBottom: 0.7, height: 1.2, tessellation: 7 }, s), STONE, 0, 0.6, 0);
        const gem = add(MeshBuilder.CreatePolyhedron('gem', { type: 1, size: 0.22 }, s), [0.6, 0.9, 1], 0, 1.65, 0, 0.8);
        gem.scaling.y = 1.7;
        // Материал этого цвета есть только у камня — его можно перекрашивать
        const gm = gem.material as StandardMaterial;
        // Камень переливается оттенками всех шести лесов по очереди
        const hues: Rgb[] = [[0.3, 1, 0.45], [1, 0.25, 0.3], [0.7, 0.4, 1], [0.55, 0.9, 1], [0.92, 0.95, 1], [0.15, 0.95, 0.8]];
        tick = (t) => {
          gem.rotation.y = t * 0.8;
          gem.position.y = 1.65 + Math.sin(t * 1.5) * 0.06;
          const u = (t * 0.25) % hues.length, i = Math.floor(u), f = u - i;
          const a = hues[i], b = hues[(i + 1) % hues.length];
          gm.diffuseColor.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
          gm.emissiveColor.copyFrom(gm.diffuseColor.scale(0.8));
        };
        break;
      }
    }
    return { ...b, tick };
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
