// Редкие события уровня — одноразовые «вот это да», не чаще раза в полтора десятка уровней.
// Радуга над поляной: постоишь под ней — ветер в спину. Звездопад ночью: постоишь под ним —
// редкий кристалл. Белка утащила кристалл и убегает: догонишь (рывок помогает) — отдаст.

import {
  Color3,
  Color4,
  MeshBuilder,
  ParticleSystem,
  StandardMaterial,
  TransformNode,
  Vector3,
  type DynamicTexture,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import { dotTexture } from '../particles';
import type { BiomeId } from './biomes';
import type { Clearing, LevelLayout } from './generator';

export type EventKind = 'rainbow' | 'starfall' | 'squirrel';

/** Что событие дало герою. */
export type EventReward = 'wind' | 'rare';

/** Доля уровней кампании с событием (с третьего, не в Лесе дня). */
export const EVENT_CHANCE = 0.06;

/** Какое событие подходит биому: радуга — днём там, где бывает дождь, звездопад — только ночью. */
export function eventFor(biome: BiomeId, roll: number): EventKind {
  if (biome === 'night') return roll < 0.6 ? 'starfall' : 'squirrel';
  if (biome === 'meadow' || biome === 'autumn' || biome === 'lakes') return roll < 0.5 ? 'rainbow' : 'squirrel';
  return 'squirrel';
}

/** Что сказать в начале уровня. */
export const EVENT_INTRO: Record<EventKind, string> = {
  rainbow: 'Над лесом радуга — найди поляну под ней',
  starfall: 'Звездопад! Встань под ним',
  squirrel: 'Белка утащила кристалл — догони её!',
};

/** Сколько стоять под радугой или звездопадом, с. */
const STAND_TIME = 2;
/** Белка: с какого расстояния пугается, как быстро бежит, с какого расстояния поймана. */
const SQUIRREL_SCARE = 11;
const SQUIRREL_RUN = 9.5;
const SQUIRREL_CATCH = 1.3;

/** Мир для белки: высота земли, вода и препятствия. */
export interface EventGround {
  heightAt(x: number, z: number): number;
  waterDepth(x: number, z: number): number;
}

export class LevelEvent {
  private readonly root: TransformNode;
  private readonly meshes: Mesh[] = [];
  private readonly mats: StandardMaterial[] = [];
  private readonly tex: DynamicTexture;
  private ps: ParticleSystem | null = null;
  /** Поляна под радугой или звездопадом. */
  private readonly place: Clearing;
  private stood = 0;
  private done = false;
  private t = 0;
  /** Белка: где она и куда бежит. */
  private readonly pos = new Vector3();
  private heading = 0;

  constructor(
    private readonly scene: Scene,
    readonly kind: EventKind,
    private readonly layout: LevelLayout,
    private readonly ground: EventGround,
  ) {
    this.root = new TransformNode(`event-${kind}`, scene);
    this.tex = dotTexture(scene);
    // Дальняя от старта боковая поляна — чтобы было куда идти
    const side = layout.clearings.slice(1);
    const far = (c: Clearing) => Math.hypot(c.x - layout.spawn.x, c.z - layout.spawn.z);
    this.place = side.sort((a, b) => far(b) - far(a))[0] ?? layout.clearings[0];
    if (kind === 'rainbow') this.buildRainbow();
    else if (kind === 'starfall') this.buildStarfall();
    else this.buildSquirrel();
  }

  private mat(color: Color3, alpha = 1): StandardMaterial {
    const m = new StandardMaterial('event', this.scene);
    m.diffuseColor = color;
    m.emissiveColor = color;
    m.disableLighting = true;
    m.alpha = alpha;
    this.mats.push(m);
    return m;
  }

  /** Шесть цветных дуг над поляной, концами в землю. */
  private buildRainbow(): void {
    const { x, z } = this.place;
    const y = this.ground.heightAt(x, z);
    const colors = [
      [1, 0.25, 0.25], [1, 0.6, 0.2], [1, 0.95, 0.3], [0.35, 0.9, 0.4], [0.3, 0.6, 1], [0.6, 0.35, 0.95],
    ] as const;
    // Дуга стоит поперёк взгляда от старта, чтобы её было видно целиком: локальная X — поперёк
    const yaw = Math.atan2(x - this.layout.spawn.x, z - this.layout.spawn.z);
    colors.forEach((c, i) => {
      const r = 30 - i * 0.9;
      const path: Vector3[] = [];
      for (let k = 0; k <= 32; k++) {
        const a = (Math.PI * k) / 32;
        path.push(new Vector3(Math.cos(a) * r, y - 2 + Math.sin(a) * r * 0.45, 0));
      }
      const m = MeshBuilder.CreateTube('rainbow', { path, radius: 0.45, tessellation: 6 }, this.scene);
      m.material = this.mat(new Color3(c[0], c[1], c[2]), 0.42);
      m.parent = this.root;
      m.isPickable = false;
      // Радугу видно сквозь туман — она дальше, чем лес
      m.applyFog = false;
      this.meshes.push(m);
    });
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
  }

  /** Падающие звёзды над поляной: вытянутые искры сыплются наискось с неба. */
  private buildStarfall(): void {
    const { x, z } = this.place;
    const ps = (this.ps = new ParticleSystem('starfall', 120, this.scene));
    ps.particleTexture = this.tex;
    ps.emitter = new Vector3(x, this.ground.heightAt(x, z) + 34, z);
    ps.minEmitBox = new Vector3(-14, 0, -14);
    ps.maxEmitBox = new Vector3(14, 6, 14);
    ps.direction1 = new Vector3(0.5, -1, 0.2);
    ps.direction2 = new Vector3(0.8, -1, 0.4);
    ps.minEmitPower = 14;
    ps.maxEmitPower = 22;
    ps.minLifeTime = 1;
    ps.maxLifeTime = 1.8;
    ps.minSize = 0.3;
    ps.maxSize = 0.6;
    ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.color1 = new Color4(0.9, 0.95, 1, 1);
    ps.color2 = new Color4(1, 0.9, 0.6, 1);
    ps.colorDead = new Color4(0.8, 0.85, 1, 0);
    ps.emitRate = 14;
    ps.start();
  }

  /** Белка из примитивов с кристаллом в лапах: тело, голова, уши и пышный хвост. */
  private buildSquirrel(): void {
    const s = this.scene;
    const fur = this.mat(new Color3(0.72, 0.36, 0.14));
    fur.disableLighting = false;
    fur.emissiveColor = new Color3(0.12, 0.05, 0.02);
    const add = (m: Mesh, mat: StandardMaterial, x: number, y: number, z: number) => {
      m.material = mat;
      m.parent = this.root;
      m.position.set(x, y, z);
      m.isPickable = false;
      this.meshes.push(m);
      return m;
    };
    add(MeshBuilder.CreateSphere('sq-body', { diameter: 0.38, segments: 8 }, s), fur, 0, 0.24, 0).scaling.set(0.8, 0.9, 1.15);
    add(MeshBuilder.CreateSphere('sq-head', { diameter: 0.24, segments: 8 }, s), fur, 0, 0.44, 0.17);
    for (const side of [-1, 1]) add(MeshBuilder.CreateCylinder('sq-ear', { diameterTop: 0, diameterBottom: 0.07, height: 0.1, tessellation: 5 }, s), fur, side * 0.06, 0.58, 0.15);
    const tail = add(MeshBuilder.CreateSphere('sq-tail', { diameter: 0.34, segments: 8 }, s), fur, 0, 0.45, -0.26);
    tail.scaling.set(0.7, 1.5, 0.7);
    tail.rotation.x = -0.4;
    const gem = add(MeshBuilder.CreatePolyhedron('sq-gem', { type: 1, size: 0.1 }, s), this.mat(new Color3(1, 0.84, 0.42)), 0, 0.36, 0.32);
    gem.scaling.y = 1.6;
    // Искры над кристаллом — белку видно в траве издалека
    const ps = (this.ps = new ParticleSystem('squirrel-gem', 40, s));
    ps.particleTexture = this.tex;
    ps.emitter = gem;
    ps.createSphereEmitter(0.3, 0);
    ps.minEmitPower = 0.1;
    ps.maxEmitPower = 0.3;
    ps.gravity = new Vector3(0, 0.6, 0);
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.1;
    ps.minSize = 0.15;
    ps.maxSize = 0.28;
    ps.color1 = new Color4(1, 0.86, 0.45, 1);
    ps.color2 = new Color4(1, 0.95, 0.7, 1);
    ps.colorDead = new Color4(1, 0.8, 0.3, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 16;
    ps.start();
    const { x, z } = this.place;
    this.pos.set(x, this.ground.heightAt(x, z), z);
    this.heading = Math.random() * Math.PI * 2;
  }

  /** Событие ещё ждёт героя. */
  get active(): boolean {
    return !this.done;
  }

  /** Каждый кадр; feet — где стоит герой. Возвращает награду, когда событие состоялось. */
  update(dt: number, feet: Vector3): EventReward | null {
    this.t += dt;
    if (this.done) return null;
    if (this.kind === 'squirrel') return this.runSquirrel(dt, feet);
    const inside = Math.hypot(feet.x - this.place.x, feet.z - this.place.z) < Math.max(6, this.place.r);
    this.stood = inside ? this.stood + dt : 0;
    if (this.stood < STAND_TIME) return null;
    this.finish();
    return this.kind === 'rainbow' ? 'wind' : 'rare';
  }

  /** Белка убегает от героя, огибая деревья и воду; рядом с ней — поймана. */
  private runSquirrel(dt: number, feet: Vector3): EventReward | null {
    const p = this.pos;
    const dx = p.x - feet.x, dz = p.z - feet.z;
    const d = Math.hypot(dx, dz);
    if (d < SQUIRREL_CATCH) {
      this.finish();
      return 'rare';
    }
    const scared = d < SQUIRREL_SCARE;
    // Испугавшись — прочь от героя, петляя; иначе бродит потихоньку
    const want = scared ? Math.atan2(dx, dz) + Math.sin(this.t * 2.3) * 0.6 : this.heading + Math.sin(this.t * 0.7) * 0.02;
    this.heading += Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading)) * Math.min(1, dt * 6);
    const speed = scared ? SQUIRREL_RUN : 1.2;
    let nx = p.x + Math.sin(this.heading) * speed * dt;
    let nz = p.z + Math.cos(this.heading) * speed * dt;
    const lim = this.layout.half - 3;
    // У края и у воды — разворот
    if (Math.abs(nx) > lim || Math.abs(nz) > lim || this.ground.waterDepth(nx, nz) > 0.15) {
      this.heading += Math.PI * (0.5 + Math.random() * 0.5);
      nx = p.x;
      nz = p.z;
    }
    // Стволы и камни выталкивают — белка скользит вдоль
    for (const o of this.layout.obstacles) {
      const ox = nx - o.x, oz = nz - o.z, od = Math.hypot(ox, oz), min = o.r + 0.3;
      if (od < min && od > 1e-4) {
        nx = o.x + (ox / od) * min;
        nz = o.z + (oz / od) * min;
      }
    }
    p.set(nx, this.ground.heightAt(nx, nz), nz);
    this.root.position.set(p.x, p.y + (scared ? Math.abs(Math.sin(this.t * 14)) * 0.15 : 0), p.z);
    this.root.rotation.y = this.heading;
    return null;
  }

  /** Событие состоялось: радуга и звездопад медленно гаснут, белка исчезает. */
  private finish(): void {
    this.done = true;
    if (this.ps) this.ps.emitRate = 0;
    if (this.kind === 'squirrel') this.root.setEnabled(false);
  }

  /** Радуга гаснет после того, как под ней постояли. */
  fade(dt: number): void {
    if (!this.done || this.kind !== 'rainbow') return;
    for (const m of this.mats) m.alpha = Math.max(0, m.alpha - dt * 0.08);
  }

  dispose(): void {
    this.ps?.dispose(false);
    for (const m of this.meshes) m.dispose();
    for (const m of this.mats) m.dispose();
    this.root.dispose();
    this.tex.dispose();
  }
}
