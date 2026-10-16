// Игровой мир: постоянная сцена со светом, камерой и пост-обработкой,
// внутри которой сменяются уровни. Здесь же — запросы для физики и камеры.

import {
  Color4,
  DirectionalLight,
  GlowLayer,
  HemisphericLight,
  Scene,
  UniversalCamera,
  Vector3,
  type Engine,
} from '@babylonjs/core';
import { generateLevel, PATH_R, type LevelLayout, type Obstacle, type Platform } from './levels/generator';
import { Level, type Crystal } from './levels/level';
import type { LevelRecipe } from './levels/recipes';
import { createLightingContext, refreshLighting, type LightingContext } from './settings';

export type { Obstacle, Platform };
export type Surface = 'grass' | 'path' | 'stone';

/** Сетка для быстрого поиска препятствий рядом с точкой. */
class ObstacleGrid {
  private static readonly CELL = 8;
  private readonly cells = new Map<number, Obstacle[]>();

  constructor(obstacles: readonly Obstacle[]) {
    const C = ObstacleGrid.CELL;
    for (const o of obstacles) {
      const R = Math.max(o.r, o.view);
      for (let i = Math.floor((o.x - R) / C); i <= Math.floor((o.x + R) / C); i++) {
        for (let j = Math.floor((o.z - R) / C); j <= Math.floor((o.z + R) / C); j++) {
          const k = ObstacleGrid.key(i, j);
          const list = this.cells.get(k);
          if (list) list.push(o);
          else this.cells.set(k, [o]);
        }
      }
    }
  }

  private static key(i: number, j: number): number {
    return (i + 1000) * 4096 + (j + 1000);
  }

  /** Препятствия в прямоугольнике (могут повторяться, если лежат на границе клеток). */
  query(x0: number, z0: number, x1: number, z1: number, out: Set<Obstacle>): Set<Obstacle> {
    out.clear();
    const C = ObstacleGrid.CELL;
    for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) {
      for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) {
        const list = this.cells.get(ObstacleGrid.key(i, j));
        if (list) for (const o of list) out.add(o);
      }
    }
    return out;
  }
}

export class World {
  readonly scene: Scene;
  readonly sun: DirectionalLight;
  readonly camera: UniversalCamera;
  readonly lighting: LightingContext;
  private readonly hemi: HemisphericLight;
  /** Нормализованное направление солнечного света. */
  private sunDir = new Vector3(0, -1, 0);
  private level: Level | null = null;
  private grid = new ObstacleGrid([]);
  private readonly near = new Set<Obstacle>();
  collected = 0;

  constructor(private readonly engine: Engine) {
    const scene = (this.scene = new Scene(engine));
    this.hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
    this.sun = new DirectionalLight('s', new Vector3(-0.5, -1, -0.35), scene);
    this.camera = new UniversalCamera('cam', new Vector3(0, 3, -8), scene);
    this.camera.minZ = 0.1;
    this.camera.inputs.clear();
    this.lighting = createLightingContext({ scene, sun: this.sun, camera: this.camera, allowSsao: true });
    this.lighting.glow = new GlowLayer('glow', scene);
    this.lighting.glow.intensity = 0.6;
  }

  // ---------- Уровни ----------

  get layout(): LevelLayout {
    if (!this.level) throw new Error('Уровень ещё не загружен');
    return this.level.layout;
  }

  get half(): number {
    return this.layout.half;
  }

  get crystals(): readonly Crystal[] {
    return this.level?.crystals ?? [];
  }

  get portalOpen(): boolean {
    return this.level?.portalOpen ?? false;
  }

  /** Генерирует и строит уровень по рецепту, убирая предыдущий. */
  loadLevel(recipe: LevelRecipe): LevelLayout {
    this.level?.dispose();
    const layout = generateLevel(recipe);
    this.applyBiome(layout);
    this.level = new Level(this.scene, this.lighting, layout);
    this.grid = new ObstacleGrid(layout.obstacles);
    this.collected = 0;
    refreshLighting(this.lighting, this.engine);
    return layout;
  }

  private applyBiome(layout: LevelLayout): void {
    const b = layout.biome;
    this.scene.clearColor = Color4.FromColor3(b.sky, 1);
    this.scene.fogColor = b.sky.clone();
    this.lighting.fogBase = b.fogBase;
    this.hemi.intensity = b.hemi.intensity;
    this.hemi.groundColor = b.hemi.ground.clone();
    this.sun.direction = new Vector3(...b.sun.dir);
    this.sun.diffuse = b.sun.color.clone();
    this.sun.intensity = b.sun.intensity;
    this.sunDir = this.sun.direction.normalizeToNew();
  }

  /** Начать текущий уровень заново: все кристаллы на месте, портал закрыт. */
  restartLevel(): void {
    const recipe = this.layout.recipe;
    this.loadLevel(recipe);
  }

  // ---------- Запросы для физики игрока ----------

  /** Препятствия вблизи точки (для столкновений). */
  obstaclesNear(x: number, z: number, r: number): Iterable<Obstacle> {
    return this.grid.query(x - r, z - r, x + r, z + r, this.near);
  }

  private get platforms(): readonly Platform[] {
    return this.level?.layout.platforms ?? [];
  }

  /** Высота опоры под точкой: земля или верх платформы, на которую можно встать с высоты y. */
  groundAt(x: number, z: number, y: number): number {
    let g = 0;
    for (const p of this.platforms) {
      if (Math.abs(x - p.x) < p.w / 2 + 0.25 && Math.abs(z - p.z) < p.d / 2 + 0.25 && y >= p.h - 0.35) g = Math.max(g, p.h);
    }
    return g;
  }

  /** Упирается ли игрок на высоте y в боковую стенку платформы. */
  blockedByPlatform(x: number, z: number, y: number): boolean {
    return this.platforms.some((p) => Math.abs(x - p.x) < p.w / 2 + 0.3 && Math.abs(z - p.z) < p.d / 2 + 0.3 && y < p.h - 0.35);
  }

  /** Из чего поверхность под ногами — для звука шагов. */
  surfaceAt(x: number, z: number, groundY: number): Surface {
    if (groundY > 0) return 'stone';
    return Math.hypot(x, z) < PATH_R ? 'path' : 'grass';
  }

  /**
   * Где луч от героя к камере упирается в препятствие (кроны и стволы — вертикальные
   * цилиндры, платформы — коробки). Возвращает расстояние или null.
   */
  cameraHit(o: Vector3, d: Vector3, len: number): number | null {
    let best = len;
    const ex = o.x + d.x * len, ez = o.z + d.z * len;
    this.grid.query(Math.min(o.x, ex) - 2, Math.min(o.z, ez) - 2, Math.max(o.x, ex) + 2, Math.max(o.z, ez) + 2, this.near);
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-6) {
      for (const ob of this.near) {
        const fx = o.x - ob.x, fz = o.z - ob.z;
        const c = fx * fx + fz * fz - ob.view * ob.view;
        if (c < 0) continue; // герой под кроной — эта крона обзор не закрывает
        const b = 2 * (fx * d.x + fz * d.z);
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t < 0 || t >= best) continue;
        const y = o.y + d.y * t;
        if (y >= 0 && y <= ob.top) best = t;
      }
    }
    for (const p of this.platforms) {
      const t = rayBox(o, d, p.x - p.w / 2, 0, p.z - p.d / 2, p.x + p.w / 2, p.h, p.z + p.d / 2);
      if (t !== null && t < best) best = t;
    }
    return best < len ? best : null;
  }

  // ---------- Кристаллы и портал ----------

  /** Собирает кристаллы в радиусе от точки; возвращает, сколько собрано за этот вызов. */
  collectNear(center: Vector3, radius = 1.2): number {
    let n = 0;
    for (const k of this.crystals) {
      if (k.mesh.isEnabled() && Vector3.Distance(k.mesh.position, center) < radius) {
        k.mesh.setEnabled(false);
        n++;
      }
    }
    this.collected += n;
    return n;
  }

  openPortal(): void {
    this.level?.openPortal();
  }

  /** Стоит ли герой в открытом портале. */
  inPortal(pos: Vector3): boolean {
    const p = this.layout.portal;
    return this.portalOpen && Math.hypot(pos.x - p.x, pos.z - p.z) < 0.9;
  }

  /** Анимации уровня и трава. */
  update(dt: number, bendAt: Vector3 | null, bendRadius: number): void {
    const lvl = this.level;
    if (!lvl) return;
    lvl.spinCrystals(dt);
    lvl.animatePortal(dt);
    lvl.grass.update(this.camera.position, bendAt, bendRadius);
  }

  /** Сдвигает солнце вслед за точкой — область теней остаётся возле камеры. */
  followSun(center: Vector3): void {
    this.sun.position.copyFrom(center.subtract(this.sunDir.scale(60)));
  }
}

/** Пересечение луча с прямоугольным параллелепипедом (метод плит). */
function rayBox(o: Vector3, d: Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = 0, tmax = Infinity;
  const axes: [number, number, number, number][] = [
    [o.x, d.x, x0, x1],
    [o.y, d.y, y0, y1],
    [o.z, d.z, z0, z1],
  ];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return null;
      continue;
    }
    let t0 = (lo - oo) / dd, t1 = (hi - oo) / dd;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return null;
  }
  return tmin > 0 ? tmin : null;
}
