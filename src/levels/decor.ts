// Поляна у каменного круга обрастает: за каждый день, когда игрок прошёл уровень,
// на центральной поляне появляется ещё одна деталь — цветы, грибы, камешки, светлячки.
// Места и порядок одни и те же на любом уровне: это «своя» поляна игрока.

import { Color3, Mesh, MeshBuilder, StandardMaterial, type Scene } from '@babylonjs/core';
import type { LevelLayout } from './generator';

type Kind = 'flowers' | 'mushroom' | 'pebbles' | 'firefly' | 'stump' | 'berries';

export interface DecorItem { kind: Kind; name: string; color: readonly [r: number, g: number, b: number] }

const WHITE: DecorItem['color'] = [0.95, 0.95, 0.9];
const RED: DecorItem['color'] = [0.85, 0.15, 0.12];
const BLUE: DecorItem['color'] = [0.35, 0.45, 0.95];
const YELLOW: DecorItem['color'] = [1, 0.82, 0.2];
const PINK: DecorItem['color'] = [0.95, 0.5, 0.7];
const BROWN: DecorItem['color'] = [0.55, 0.35, 0.2];
const GLOW: DecorItem['color'] = [1, 0.9, 0.45];

/** Порядок появления: первая деталь — за первый день, вторая — за второй и так далее. */
export const DECOR: readonly DecorItem[] = [
  { kind: 'flowers', name: 'ромашки', color: WHITE },
  { kind: 'mushroom', name: 'мухомор', color: RED },
  { kind: 'pebbles', name: 'горка камешков', color: [0.62, 0.6, 0.56] },
  { kind: 'flowers', name: 'колокольчики', color: BLUE },
  { kind: 'firefly', name: 'светлячок', color: GLOW },
  { kind: 'stump', name: 'пенёк', color: BROWN },
  { kind: 'flowers', name: 'лютики', color: YELLOW },
  { kind: 'berries', name: 'кустик черники', color: [0.2, 0.25, 0.6] },
  { kind: 'mushroom', name: 'боровик', color: BROWN },
  { kind: 'flowers', name: 'клевер', color: PINK },
  { kind: 'firefly', name: 'ещё светлячок', color: GLOW },
  { kind: 'pebbles', name: 'речные камешки', color: [0.5, 0.55, 0.6] },
  { kind: 'flowers', name: 'маки', color: RED },
  { kind: 'berries', name: 'кустик брусники', color: RED },
  { kind: 'mushroom', name: 'лисички', color: [0.95, 0.65, 0.15] },
  { kind: 'stump', name: 'старый пень', color: [0.42, 0.3, 0.2] },
  { kind: 'flowers', name: 'незабудки', color: [0.5, 0.7, 1] },
  { kind: 'firefly', name: 'пара светлячков', color: GLOW },
  { kind: 'flowers', name: 'васильки', color: [0.3, 0.4, 1] },
  { kind: 'mushroom', name: 'сыроежка', color: PINK },
  { kind: 'pebbles', name: 'белые камешки', color: [0.88, 0.86, 0.82] },
  { kind: 'berries', name: 'кустик земляники', color: [0.95, 0.2, 0.25] },
  { kind: 'flowers', name: 'фиалки', color: [0.6, 0.35, 0.9] },
  { kind: 'mushroom', name: 'подберёзовик', color: [0.5, 0.38, 0.28] },
  { kind: 'firefly', name: 'светлячок у пенька', color: GLOW },
  { kind: 'flowers', name: 'одуванчики', color: YELLOW },
  { kind: 'stump', name: 'пенёк с мхом', color: [0.35, 0.45, 0.25] },
  { kind: 'flowers', name: 'розовые гвоздики', color: PINK },
  { kind: 'mushroom', name: 'белый гриб', color: [0.45, 0.3, 0.18] },
  { kind: 'firefly', name: 'хоровод светлячков', color: GLOW },
];

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

interface Firefly { mesh: Mesh; baseY: number; phase: number }

export class ClearingDecor {
  private readonly meshes: Mesh[] = [];
  private readonly materials = new Map<string, StandardMaterial>();
  private readonly flies: Firefly[] = [];
  private t = 0;

  /** count — сколько деталей уже заработано (дней с пройденным уровнем). */
  constructor(private readonly scene: Scene, private readonly layout: LevelLayout, count: number) {
    const n = Math.min(count, DECOR.length);
    for (let i = 0; i < n; i++) {
      const spot = this.spot(i);
      if (spot) this.build(DECOR[i], spot.x, spot.z, i);
    }
  }

  /**
   * Место детали i: по «подсолнуху» на утоптанной тропе между каменным кругом и травой. Если там
   * дерево, камень или вода — сдвигается дальше по радиусу, а не пропадает.
   */
  private spot(i: number): { x: number; z: number } | null {
    const a = i * GOLDEN;
    const { obstacles, platforms, crystals, waterLevel, terrain } = this.layout;
    for (let k = 0; k < 4; k++) {
      const r = 6 + ((i * 0.37) % 0.8) + k * 0.35;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const free =
        obstacles.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + 0.4) &&
        platforms.every((p) => Math.abs(p.x - x) > p.w / 2 + 0.4 || Math.abs(p.z - z) > p.d / 2 + 0.4) &&
        crystals.every((c) => Math.hypot(c.x - x, c.z - z) > 1.2) &&
        (waterLevel === null || terrain.heightAt(x, z) > waterLevel + 0.1);
      if (free) return { x, z };
    }
    return null;
  }

  private mat(color: readonly number[], emissive = false): StandardMaterial {
    const key = `${color.join()}|${emissive}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new StandardMaterial(`decor-${key}`, this.scene);
      m.diffuseColor = new Color3(color[0], color[1], color[2]);
      m.specularColor = new Color3(0, 0, 0);
      if (emissive) m.emissiveColor = m.diffuseColor.clone();
      this.materials.set(key, m);
    }
    return m;
  }

  private build(item: DecorItem, x: number, z: number, i: number): void {
    const y = this.layout.terrain.heightAt(x, z);
    const parts: Mesh[] = [];
    const add = (m: Mesh, color: readonly number[], px: number, py: number, pz: number) => {
      m.position.set(x + px, y + py, z + pz);
      m.material = this.mat(color);
      parts.push(m);
      return m;
    };
    const s = this.scene;
    const stem = [0.3, 0.6, 0.25];
    switch (item.kind) {
      case 'flowers':
        for (let k = 0; k < 4; k++) {
          const a = k * 1.9 + i, d = 0.12 + (k % 2) * 0.1, h = 0.32 + (k % 3) * 0.07;
          const ox = Math.cos(a) * d, oz = Math.sin(a) * d;
          add(MeshBuilder.CreateCylinder('decor', { height: h, diameter: 0.025, tessellation: 4 }, s), stem, ox, h / 2, oz);
          add(MeshBuilder.CreateSphere('decor', { diameter: 0.13, segments: 4 }, s), item.color, ox, h, oz).scaling.y = 0.45;
        }
        break;
      case 'mushroom':
        add(MeshBuilder.CreateCylinder('decor', { height: 0.2, diameterTop: 0.06, diameterBottom: 0.09, tessellation: 8 }, s), WHITE, 0, 0.1, 0);
        add(MeshBuilder.CreateSphere('decor', { diameter: 0.28, segments: 6, slice: 0.5 }, s), item.color, 0, 0.17, 0).scaling.y = 0.7;
        add(MeshBuilder.CreateCylinder('decor', { height: 0.12, diameter: 0.05, tessellation: 6 }, s), WHITE, 0.16, 0.06, 0.08);
        add(MeshBuilder.CreateSphere('decor', { diameter: 0.15, segments: 5, slice: 0.5 }, s), item.color, 0.16, 0.1, 0.08).scaling.y = 0.7;
        break;
      case 'pebbles':
        for (let k = 0; k < 4; k++) {
          const size = 0.07 + (k % 3) * 0.025;
          const m = add(MeshBuilder.CreatePolyhedron('decor', { type: 2, size }, s), item.color, Math.cos(k * 2.2) * 0.15, size * 0.5, Math.sin(k * 2.2) * 0.15);
          m.scaling.y = 0.6;
          m.rotation.y = k;
        }
        break;
      case 'stump':
        add(MeshBuilder.CreateCylinder('decor', { height: 0.35, diameterTop: 0.42, diameterBottom: 0.52, tessellation: 9 }, s), item.color, 0, 0.17, 0);
        add(MeshBuilder.CreateCylinder('decor', { height: 0.02, diameter: 0.4, tessellation: 9 }, s), [0.78, 0.62, 0.42], 0, 0.355, 0);
        break;
      case 'berries':
        add(MeshBuilder.CreateIcoSphere('decor', { radius: 0.22, subdivisions: 1, flat: true }, s), [0.22, 0.45, 0.2], 0, 0.16, 0).scaling.y = 0.75;
        for (let k = 0; k < 5; k++) {
          const a = k * 1.3;
          add(MeshBuilder.CreateSphere('decor', { diameter: 0.06, segments: 3 }, s), item.color, Math.cos(a) * 0.2, 0.12 + (k % 2) * 0.1, Math.sin(a) * 0.2);
        }
        break;
      case 'firefly': {
        // Светлячки летают, поэтому каждый — отдельный меш
        const count = item.name.startsWith('пара') ? 2 : item.name.startsWith('хоровод') ? 5 : 1;
        for (let k = 0; k < count; k++) {
          const m = MeshBuilder.CreateSphere('decor-fly', { diameter: 0.07, segments: 4 }, s);
          const a = k * 1.26;
          m.position.set(x + Math.cos(a) * 0.4 * Math.min(1, k), y + 0.7, z + Math.sin(a) * 0.4 * Math.min(1, k));
          m.material = this.mat(item.color, true);
          m.isPickable = false;
          this.meshes.push(m);
          this.flies.push({ mesh: m, baseY: y + 0.7 + (k % 3) * 0.15, phase: i + k * 1.7 });
        }
        return;
      }
    }
    // Детали одной находки сливаются в один меш — меньше вызовов отрисовки
    const merged = parts.length > 1 ? Mesh.MergeMeshes(parts, true, true, undefined, false, true) : parts[0];
    if (!merged) return;
    merged.isPickable = false;
    merged.receiveShadows = true;
    this.meshes.push(merged);
  }

  /** Светлячки плавно кружат и покачиваются. */
  update(dt: number): void {
    this.t += dt;
    for (const f of this.flies) {
      const p = f.phase + this.t;
      f.mesh.position.y = f.baseY + Math.sin(p * 1.3) * 0.18;
      f.mesh.position.x += Math.cos(p * 0.7) * dt * 0.15;
      f.mesh.position.z += Math.sin(p * 0.9) * dt * 0.15;
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const m of this.materials.values()) m.dispose();
  }
}
