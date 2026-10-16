// Игровой мир: поляна, деревья, камни, каменный круг, платформы-лестница и кристаллы.

import {
  Color3,
  Color4,
  DirectionalLight,
  GlowLayer,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  UniversalCamera,
  Vector3,
  type Engine,
  type Mesh,
} from '@babylonjs/core';
import { GrassField, MEADOW_GROUND, MEADOW_TIP } from './grass';
import { addShadowCaster, createLightingContext, type LightingContext } from './settings';
import { clamp } from './utils';

/** Половина стороны квадратного мира, м. */
export const WORLD_HALF = 60;

export interface Obstacle { x: number; z: number; r: number }
export interface Platform { x: number; z: number; w: number; d: number; h: number }
export type Surface = 'grass' | 'path' | 'stone';
export interface Crystal { mesh: Mesh; baseY: number; phase: number }

/** Меши с этим флагом перекрывают обзор — камера подъезжает к герою. */
export function isCameraBlocker(m: { metadata?: unknown }): boolean {
  return (m.metadata as { blocker?: boolean } | null)?.blocker === true;
}

/** Радиус утоптанной площадки в центре поляны. */
const PATH_RADIUS = 7;
const SKY = new Color3(0.55, 0.72, 0.78);

export class World {
  readonly scene: Scene;
  readonly sun: DirectionalLight;
  /** Нормализованное направление солнечного света. */
  readonly sunDir: Vector3;
  readonly camera: UniversalCamera;
  readonly lighting: LightingContext;
  readonly obstacles: Obstacle[] = [];
  readonly platforms: Platform[] = [];
  readonly crystals: Crystal[] = [];
  readonly grass: GrassField;
  collected = 0;

  private seed = 7;

  constructor(engine: Engine) {
    const scene = (this.scene = new Scene(engine));
    scene.clearColor = Color4.FromColor3(SKY, 1);
    scene.fogColor = SKY.clone();

    const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.25, 0.3, 0.25);
    this.sun = new DirectionalLight('s', new Vector3(-0.5, -1, -0.35), scene);
    this.sun.position = new Vector3(40, 60, 30);
    this.sun.intensity = 1.1;
    this.sun.diffuse = new Color3(1, 0.95, 0.85);
    this.sunDir = this.sun.direction.clone().normalize();

    this.camera = new UniversalCamera('cam', new Vector3(0, 3, -8), scene);
    this.camera.minZ = 0.1;
    this.camera.inputs.clear();

    this.lighting = createLightingContext({ scene, sun: this.sun, camera: this.camera, allowSsao: true });
    this.lighting.glow = new GlowLayer('glow', scene);
    this.lighting.glow.intensity = 0.6;

    this.buildGround();
    this.buildForest();
    const stone = this.mat('st', new Color3(0.62, 0.6, 0.56), 0.05);
    this.buildStoneCircle(stone);
    this.buildStairs(stone);
    this.buildCrystals();

    this.grass = new GrassField(scene, {
      area: {
        minX: -WORLD_HALF + 0.5,
        maxX: WORLD_HALF - 0.5,
        minZ: -WORLD_HALF + 0.5,
        maxZ: WORLD_HALF - 0.5,
        circles: this.obstacles,
        rects: this.platforms,
        // Утоптанная площадка в центре: травы нет, к краю она постепенно густеет
        coverage: (x, z) => clamp((Math.hypot(x, z) - (PATH_RADIUS - 0.6)) / 1.4, 0, 1),
      },
      baseColor: MEADOW_GROUND.scale(0.55),
      tipColor: MEADOW_TIP,
      glow: this.lighting.glow,
    });
  }

  /** Детерминированный ГПСЧ — у всех одинаковая поляна. */
  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private mat(name: string, color: Color3, spec = 0): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(spec, spec, spec);
    return m;
  }

  private solid(m: Mesh, blocker = true): void {
    m.receiveShadows = true;
    if (blocker) m.metadata = { blocker: true };
    addShadowCaster(this.lighting, m);
  }

  private isFree(x: number, z: number, margin: number): boolean {
    return Math.hypot(x, z) > 9 && this.obstacles.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + margin);
  }

  private randomPoint(edge: number): [number, number] {
    return [(this.rnd() * 2 - 1) * (WORLD_HALF - edge), (this.rnd() * 2 - 1) * (WORLD_HALF - edge)];
  }

  private buildGround(): void {
    const ground = MeshBuilder.CreateGround('g', { width: WORLD_HALF * 2, height: WORLD_HALF * 2, subdivisions: 2 }, this.scene);
    ground.material = this.mat('gm', MEADOW_GROUND);
    ground.receiveShadows = true;
    const path = MeshBuilder.CreateDisc('p', { radius: PATH_RADIUS, tessellation: 48 }, this.scene);
    path.rotation.x = Math.PI / 2;
    path.position.y = 0.02;
    path.material = this.mat('pm', new Color3(0.66, 0.58, 0.44));
    path.receiveShadows = true;
  }

  private buildForest(): void {
    const trunkM = this.mat('tr', new Color3(0.4, 0.28, 0.18));
    const leafM = [
      this.mat('l1', new Color3(0.2, 0.45, 0.25)),
      this.mat('l2', new Color3(0.28, 0.52, 0.22)),
      this.mat('l3', new Color3(0.16, 0.38, 0.3)),
    ];
    const rockM = this.mat('rk', new Color3(0.55, 0.55, 0.58), 0.1);

    const tree = (x: number, z: number) => {
      const s = 0.8 + this.rnd() * 0.7;
      const t = MeshBuilder.CreateCylinder('t', { height: 2 * s, diameterTop: 0.3 * s, diameterBottom: 0.5 * s, tessellation: 6 }, this.scene);
      t.position.set(x, s, z);
      t.material = trunkM;
      for (let i = 0; i < 3; i++) {
        const c = MeshBuilder.CreateCylinder('c', { height: 1.8 * s, diameterTop: 0, diameterBottom: (3 - i * 0.7) * s, tessellation: 7 }, this.scene);
        c.position.set(x, (2 + i * 1.1) * s, z);
        c.rotation.y = this.rnd() * 3;
        c.material = leafM[(this.rnd() * 3) | 0];
        this.solid(c);
      }
      this.solid(t);
      this.obstacles.push({ x, z, r: 0.45 * s });
    };

    const rock = (x: number, z: number) => {
      const s = 0.6 + this.rnd() * 1.4;
      const r = MeshBuilder.CreatePolyhedron('r', { type: 2, size: s * 0.7 }, this.scene);
      r.scaling.y = 0.6;
      r.position.set(x, s * 0.3, z);
      r.rotation.set(this.rnd() * 3, this.rnd() * 3, this.rnd() * 3);
      r.material = rockM;
      this.solid(r);
      this.obstacles.push({ x, z, r: s * 0.65 });
    };

    for (let i = 0; i < 90; i++) {
      const [x, z] = this.randomPoint(4);
      if (this.isFree(x, z, 2.5)) tree(x, z);
    }
    for (let i = 0; i < 35; i++) {
      const [x, z] = this.randomPoint(4);
      if (this.isFree(x, z, 1.5)) rock(x, z);
    }
  }

  private buildStoneCircle(stone: StandardMaterial): void {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = Math.cos(a) * 5.5;
      const z = Math.sin(a) * 5.5;
      const h = 2.4 + (i % 2) * 0.8;
      const p = MeshBuilder.CreateBox('pl', { width: 0.9, height: h, depth: 0.6 }, this.scene);
      p.position.set(x, h / 2, z);
      p.rotation.y = -a;
      p.material = stone;
      this.solid(p);
      this.obstacles.push({ x, z, r: 0.6 });
    }
  }

  private buildStairs(stone: StandardMaterial): void {
    const platform = (x: number, z: number, w: number, d: number, h: number) => {
      const b = MeshBuilder.CreateBox('pf', { width: w, height: h, depth: d }, this.scene);
      b.position.set(x, h / 2, z);
      b.material = stone;
      this.solid(b);
      this.platforms.push({ x, z, w, d, h });
    };
    platform(14, -4, 4, 4, 1);
    platform(18, -8, 3, 3, 2);
    platform(21, -13, 3, 3, 3.1);
  }

  private buildCrystals(): void {
    const crystM = this.mat('cr', new Color3(1, 0.8, 0.3));
    crystM.emissiveColor = new Color3(0.9, 0.6, 0.1);
    const crystal = (x: number, z: number, y = 0) => {
      const m = MeshBuilder.CreatePolyhedron('k', { type: 1, size: 0.35 }, this.scene);
      m.scaling.y = 1.6;
      m.position.set(x, y + 1, z);
      m.material = crystM;
      addShadowCaster(this.lighting, m);
      this.crystals.push({ mesh: m, baseY: y + 1, phase: this.rnd() * 6 });
    };
    for (let i = 0; i < 14; i++) {
      let x: number, z: number, n = 0;
      do {
        [x, z] = this.randomPoint(6);
        n++;
      } while (!this.isFree(x, z, 1.5) && n < 50);
      crystal(x, z);
    }
    crystal(21, -13, 3.1); // на вершине лестницы
    crystal(0, 0); // в центре круга
  }

  // ---------- Запросы для физики игрока ----------

  /** Высота опоры под точкой: земля или верх платформы, на которую можно встать с высоты y. */
  groundAt(x: number, z: number, y: number): number {
    let g = 0;
    for (const p of this.platforms) {
      if (Math.abs(x - p.x) < p.w / 2 + 0.25 && Math.abs(z - p.z) < p.d / 2 + 0.25 && y >= p.h - 0.35) g = Math.max(g, p.h);
    }
    return g;
  }

  /** Из чего поверхность под ногами — для звука шагов. */
  surfaceAt(x: number, z: number, groundY: number): Surface {
    if (groundY > 0) return 'stone';
    return Math.hypot(x, z) < PATH_RADIUS ? 'path' : 'grass';
  }

  /** Упирается ли игрок на высоте y в боковую стенку платформы. */
  blockedByPlatform(x: number, z: number, y: number): boolean {
    return this.platforms.some((p) => Math.abs(x - p.x) < p.w / 2 + 0.3 && Math.abs(z - p.z) < p.d / 2 + 0.3 && y < p.h - 0.35);
  }

  // ---------- Кристаллы ----------

  spinCrystals(dt: number): void {
    for (const k of this.crystals) {
      if (!k.mesh.isEnabled()) continue;
      k.phase += dt;
      k.mesh.rotation.y += dt * 1.5;
      k.mesh.position.y = k.baseY + Math.sin(k.phase * 2) * 0.15;
    }
  }

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

  resetCrystals(): void {
    for (const k of this.crystals) k.mesh.setEnabled(true);
    this.collected = 0;
  }

  /** Сдвигает солнце вслед за точкой — область теней остаётся возле камеры. */
  followSun(center: Vector3): void {
    this.sun.position.copyFrom(center.subtract(this.sunDir.scale(60)));
  }
}
