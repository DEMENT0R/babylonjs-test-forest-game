// Нора и вещи во дворе из примитивов Babylon — как декор у каменного круга.
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

  /** Холм норы под большим деревом: вход дырой под корнями. */
  shell(): Built {
    const s = this.scene;
    const { root, meshes, add } = this.start('den-shell');
    const mound = add(MeshBuilder.CreateSphere('den-mound', { diameter: MOUND.r * 2, segments: 20, slice: 0.5 }, s), [0.36, 0.52, 0.3], MOUND.x, 0, MOUND.z);
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
    }
    return { ...b, tick };
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
