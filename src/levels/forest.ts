// Лес уровня: стволы и кроны через thin instances (два вызова отрисовки на весь лес).
// Деревья качаются на ветру и вздрагивают, когда в них врезается или рядом приземляется
// герой, — всё смещение считается в вершинном шейдере, на CPU только затухание тряски.
// Тряхнутое дерево роняет листья, снег или светлячков — смотря какой биом.

import {
  Color3,
  Color4,
  MaterialPluginBase,
  Matrix,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  ShaderLanguage,
  StandardMaterial,
  Vector3,
  type DynamicTexture,
  type Material,
  type MaterialDefines,
  type Mesh,
  type Scene,
  type UniformBuffer,
} from '@babylonjs/core';
import { dotTexture } from '../particles';
import { addShadowCaster, settings, type LightingContext } from '../settings';
import { clamp } from '../utils';
import { wind, WIND_DIR } from '../wind';
import type { LevelLayout } from './generator';

/** Частота тряски, рад/с (~2 Гц — как у настоящего деревца). */
const SHAKE_FREQ = 13;
/** За сколько секунд тряска затухает в e раз. */
const SHAKE_DECAY = 0.45;
/** Наибольший размах верхушки при тряске, м. */
const SHAKE_MAX = 0.35;

// ---------- Плагин материала: ветер и тряска ----------

// treeShake (на экземпляр): x — высота земли у дерева, y — высота дерева,
// z — направление толчка (угол в XZ), w — текущий размах тряски.
const SWAY_GLSL = /* glsl */ `
#ifdef TREESWAY
{
  // Доля высоты дерева: у земли неподвижно, верхушка гнётся сильнее всего
  float th = max(treeShake.y, 0.1);
  float tk = clamp((worldPos.y - treeShake.x) / th, 0.0, 1.3);
  tk *= tk;
  vec2 tp = finalWorld[3].xz;
  vec2 tdir = treeWind.xy;
  float ts = treeWind.z;
  float tt = treeWind.w;
  // Порыв бежит по лесу волной, каждое дерево ещё и раскачивается в своей фазе
  float twave = sin(dot(tp, tdir) * 0.12 - tt * 1.1) * 0.5 + 0.5;
  float tsway = sin(tt * 1.6 + tp.x * 0.9 + tp.y * 1.3);
  vec2 toff = tdir * (ts * (0.3 + 0.7 * twave) * 0.28 + tsway * (0.03 + 0.07 * ts));
  toff += vec2(-tdir.y, tdir.x) * sin(tt * 1.25 + tp.y * 0.7) * 0.05 * ts;
  toff *= th / 5.5;
  // Тряска: затухающие колебания вдоль толчка, размах задаёт CPU
  toff += vec2(cos(treeShake.z), sin(treeShake.z)) * sin(tt * ${SHAKE_FREQ.toFixed(1)}) * treeShake.w;
  worldPos.xz += toff * tk;
}
#endif
`;

class TreeSwayPlugin extends MaterialPluginBase {
  readonly wind = new Float32Array([WIND_DIR.x, WIND_DIR.z, 0, 0]);

  constructor(material: Material) {
    super(material, 'TreeSway', 200, { TREESWAY: false }, true, true);
  }

  override getClassName(): string {
    return 'TreeSwayPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['TREESWAY'] = true;
  }

  override getAttributes(attributes: string[]): void {
    attributes.push('treeShake');
  }

  override getUniforms() {
    return {
      ubo: [{ name: 'treeWind', size: 4, type: 'vec4' }],
      vertex: `#ifdef TREESWAY
        uniform vec4 treeWind;
      #endif`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const w = this.wind;
    ubo.updateFloat4('treeWind', w[0], w[1], w[2], w[3]);
  }

  override getCustomCode(shaderType: string) {
    return shaderType === 'vertex'
      ? {
          CUSTOM_VERTEX_DEFINITIONS: `#ifdef TREESWAY
            attribute vec4 treeShake;
          #endif`,
          CUSTOM_VERTEX_UPDATE_WORLDPOS: SWAY_GLSL,
        }
      : null;
  }
}

// ---------- Что сыплется с дерева ----------

type Fall = 'leaves' | 'snow' | 'fireflies';

/** Очередь стряхиваний: частицы рождаются в кроне того дерева, которое тряхнули. */
interface Burst { x: number; y: number; z: number; r: number; h: number; /** Сколько частиц ещё родить. */ left: number }

function createFall(scene: Scene, texture: DynamicTexture, kind: Fall, leaves: readonly Color3[], queue: Burst[]): ParticleSystem {
  const ps = new ParticleSystem(`tree-${kind}`, kind === 'fireflies' ? 120 : 400, scene);
  ps.particleTexture = texture;
  ps.emitter = Vector3.Zero();
  ps.emitRate = 0;
  ps.manualEmitCount = 0;
  ps.startPositionFunction = (_m, pos) => {
    while (queue.length > 0 && queue[0].left <= 0) queue.shift();
    const b = queue[0];
    if (!b) return pos.set(0, -100, 0);
    b.left--;
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * b.r;
    pos.set(b.x + Math.cos(a) * d, b.y + Math.random() * b.h, b.z + Math.sin(a) * d);
  };
  const c = (k: Color3, a: number) => new Color4(k.r, k.g, k.b, a);
  switch (kind) {
    case 'leaves': {
      // Листья кружат и медленно опускаются
      ps.direction1 = new Vector3(-0.6, -0.2, -0.6);
      ps.direction2 = new Vector3(0.6, 0.3, 0.6);
      ps.minEmitPower = 0.3;
      ps.maxEmitPower = 0.9;
      ps.gravity = new Vector3(0, -1.1, 0);
      ps.minLifeTime = 2;
      ps.maxLifeTime = 3.5;
      ps.minSize = 0.09;
      ps.maxSize = 0.16;
      ps.minAngularSpeed = -4;
      ps.maxAngularSpeed = 4;
      const a = leaves[0], b = leaves[leaves.length - 1];
      ps.color1 = c(a, 1);
      ps.color2 = c(b, 1);
      ps.colorDead = c(a, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      break;
    }
    case 'snow':
      // Снег ссыпается с лап комками — падает быстрее листьев
      ps.direction1 = new Vector3(-0.3, -0.5, -0.3);
      ps.direction2 = new Vector3(0.3, 0, 0.3);
      ps.minEmitPower = 0.2;
      ps.maxEmitPower = 0.6;
      ps.gravity = new Vector3(0, -4, 0);
      ps.minLifeTime = 1.2;
      ps.maxLifeTime = 2;
      ps.minSize = 0.1;
      ps.maxSize = 0.28;
      ps.color1 = new Color4(1, 1, 1, 0.95);
      ps.color2 = new Color4(0.9, 0.94, 1, 0.85);
      ps.colorDead = new Color4(0.9, 0.94, 1, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      break;
    case 'fireflies':
      // Вспугнутые светлячки разлетаются из кроны
      ps.direction1 = new Vector3(-1, -0.4, -1);
      ps.direction2 = new Vector3(1, 0.8, 1);
      ps.minEmitPower = 0.6;
      ps.maxEmitPower = 1.4;
      ps.gravity = new Vector3(0, 0, 0);
      ps.minLifeTime = 2;
      ps.maxLifeTime = 4;
      ps.minSize = 0.07;
      ps.maxSize = 0.13;
      ps.color1 = new Color4(0.85, 1, 0.45, 1);
      ps.color2 = new Color4(1, 0.9, 0.4, 1);
      ps.colorDead = new Color4(0, 0, 0, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      break;
  }
  ps.start();
  return ps;
}

// ---------- Лес ----------

/** Что нужно лесу от раскладки: деревья, биом и рельеф (уровень или поляна экрана выбора). */
export type ForestLayout = Pick<LevelLayout, 'trees' | 'biome' | 'terrain'>;

/** Тряхнутое дерево — для звука и прочих откликов. */
/** Тряхнутое дерево: где оно, насколько сильно и его номер в layout.trees. */
export interface TreeHit { x: number; z: number; strength: number; tree: number }

export class Forest {
  private readonly meshes: Mesh[] = [];
  private readonly materials: StandardMaterial[] = [];
  private readonly plugins: TreeSwayPlugin[] = [];
  /** Буферы treeShake стволов и крон и их меши. */
  private readonly shakeBufs: { mesh: Mesh; buf: Float32Array; per: number }[] = [];
  /** Текущий размах тряски каждого дерева. */
  private readonly amp: Float32Array;
  private readonly radius: Float32Array;
  private readonly crownY: Float32Array;
  private readonly crownR: Float32Array;
  private readonly crownH: Float32Array;
  private readonly fallKind: Fall;
  private fall: ParticleSystem | null = null;
  private texture: DynamicTexture | null = null;
  private readonly bursts: Burst[] = [];
  private shaking = 0;
  /** Деревья, которых герой касается сейчас: тряска — только в момент удара, не пока он трётся о ствол. */
  private contact = new Set<number>();
  private contactNext = new Set<number>();

  constructor(private readonly scene: Scene, private readonly lighting: LightingContext, private readonly layout: ForestLayout) {
    const { trees, biome } = layout;
    const n = trees.length;
    this.amp = new Float32Array(n);
    this.radius = new Float32Array(n);
    this.crownY = new Float32Array(n);
    this.crownR = new Float32Array(n);
    this.crownH = new Float32Array(n);
    this.fallKind = biome.frost ? 'snow' : biome.particles === 'fireflies' ? 'fireflies' : 'leaves';
    this.build();
  }

  private build(): void {
    const { trees, biome, terrain } = this.layout;
    const scene = this.scene;
    const pine = biome.trees.kind === 'pine';
    const m = new Matrix();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    const put = (buf: Float32Array, i: number, sx: number, sy: number, sz: number, yaw: number, x: number, y: number, z: number) => {
      s.set(sx, sy, sz);
      Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, q);
      p.set(x, y, z);
      Matrix.ComposeToRef(s, q, p, m);
      m.copyToArray(buf, i * 16);
    };

    const n = trees.length;
    const crownsPerTree = pine ? 3 : 2;
    const trunks = new Float32Array(n * 16);
    const crowns = new Float32Array(n * crownsPerTree * 16);
    const crownColors = new Float32Array(n * crownsPerTree * 4);
    const trunkShake = new Float32Array(n * 4);
    const crownShake = new Float32Array(n * crownsPerTree * 4);
    trees.forEach((t, i) => {
      // Ствол чуть утоплен в землю — на склоне не видно зазора под ним
      const g = terrain.heightAt(t.x, t.z) - 0.25;
      const h = (pine ? 5.4 : 5.6) * t.s;
      if (pine) {
        put(trunks, i, t.s, t.s, t.s, t.yaw, t.x, g + t.s, t.z);
        for (let k = 0; k < 3; k++) {
          const d = (3 - k * 0.7) * t.s;
          put(crowns, i * 3 + k, d, t.s, d, t.yaw + k * 1.3, t.x, g + (2 + k * 1.1) * t.s, t.z);
        }
        this.crownY[i] = g + 1.4 * t.s;
        this.crownR[i] = 1.3 * t.s;
        this.crownH[i] = 3.5 * t.s;
      } else {
        // Берёза: тонкий высокий ствол и две круглые кроны
        put(trunks, i, 0.6 * t.s, 1.7 * t.s, 0.6 * t.s, t.yaw, t.x, g + 1.7 * t.s, t.z);
        put(crowns, i * 2, 1.5 * t.s, 1.3 * t.s, 1.5 * t.s, t.yaw, t.x, g + 3.9 * t.s, t.z);
        const ox = Math.cos(t.yaw) * 0.6 * t.s, oz = Math.sin(t.yaw) * 0.6 * t.s;
        put(crowns, i * 2 + 1, 1.1 * t.s, 1 * t.s, 1.1 * t.s, t.yaw + 1, t.x + ox, g + 5 * t.s, t.z + oz);
        this.crownY[i] = g + 2.8 * t.s;
        this.crownR[i] = 1.4 * t.s;
        this.crownH[i] = 2.8 * t.s;
      }
      this.radius[i] = (pine ? 0.45 : 0.35) * t.s;
      const c = biome.trees.leaves[t.tint % biome.trees.leaves.length];
      trunkShake.set([g, h, 0, 0], i * 4);
      for (let k = 0; k < crownsPerTree; k++) {
        const v = 0.92 + ((i * 7 + k * 13) % 10) / 60;
        crownColors.set([c.r * v, c.g * v, c.b * v, 1], (i * crownsPerTree + k) * 4);
        crownShake.set([g, h, 0, 0], (i * crownsPerTree + k) * 4);
      }
    });

    const trunk = MeshBuilder.CreateCylinder('trunks', { height: 2, diameterTop: 0.3, diameterBottom: 0.5, tessellation: 6 }, scene);
    this.instanced(trunk, this.mat('trunk', biome.trees.trunk), trunks, trunkShake, 1);
    const crown = pine
      ? MeshBuilder.CreateCylinder('crowns', { height: 1.8, diameterTop: 0, diameterBottom: 1, tessellation: 7 }, scene)
      : MeshBuilder.CreateIcoSphere('crowns', { radius: 1, subdivisions: 1, flat: true }, scene);
    this.instanced(crown, this.mat('leaves', new Color3(1, 1, 1)), crowns, crownShake, crownsPerTree, crownColors);
  }

  private mat(name: string, color: Color3): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(0, 0, 0);
    this.plugins.push(new TreeSwayPlugin(m));
    this.materials.push(m);
    return m;
  }

  private instanced(base: Mesh, material: Material, matrices: Float32Array, shake: Float32Array, per: number, colors?: Float32Array): void {
    base.material = material;
    base.isPickable = false;
    base.receiveShadows = true;
    base.thinInstanceSetBuffer('matrix', matrices, 16, true);
    if (colors) base.thinInstanceSetBuffer('color', colors, 4, true);
    base.thinInstanceSetBuffer('treeShake', shake, 4, false);
    base.thinInstanceRefreshBoundingInfo(false);
    // Качание выносит верхушки за статичную рамку — расширяем её, чтобы деревья не пропадали у края кадра
    const bi = base.getBoundingInfo();
    bi.reConstruct(bi.minimum.subtract(new Vector3(1, 0, 1)), bi.maximum.add(new Vector3(1, 0, 1)));
    addShadowCaster(this.lighting, base);
    this.meshes.push(base);
    this.shakeBufs.push({ mesh: base, buf: shake, per });
  }

  /** Толкнуть дерево i: размах растёт до strength (0…1), направление — куда толкнули. */
  private shake(i: number, strength: number, dirX: number, dirZ: number): boolean {
    const a = strength * SHAKE_MAX;
    // Дерево, которое ещё не успокоилось, повторно не вздрагивает — нет дребезга при трении о ствол
    if (this.amp[i] > a * 0.5) return false;
    this.amp[i] = a;
    const angle = Math.atan2(dirZ, dirX);
    for (const { buf, per } of this.shakeBufs) for (let k = 0; k < per; k++) buf[(i * per + k) * 4 + 2] = angle;
    this.dropFrom(i, strength);
    return true;
  }

  private dropFrom(i: number, strength: number): void {
    if (!settings.particles) return;
    if (!this.fall) {
      this.texture ??= dotTexture(this.scene);
      this.fall = createFall(this.scene, this.texture, this.fallKind, this.layout.biome.trees.leaves, this.bursts);
    }
    const t = this.layout.trees[i];
    const count = Math.round(this.fallKind === 'fireflies' ? 4 + strength * 8 : 8 + strength * 26);
    this.bursts.push({ x: t.x, y: this.crownY[i], z: t.z, r: this.crownR[i], h: this.crownH[i], left: count });
    this.fall.manualEmitCount = Math.max(this.fall.manualEmitCount, 0) + count;
  }

  /**
   * Герой врезался в ствол на бегу или приземлился рядом — деревья вздрагивают.
   * @param vx, vz горизонтальная скорость героя, м/с
   * @param landing скорость падения при приземлении в этом кадре (0 — не приземлялся)
   * @returns тряхнутые деревья
   */
  touch(at: Vector3, heroRadius: number, vx: number, vz: number, landing: number): TreeHit[] {
    const hits: TreeHit[] = [];
    const trees = this.layout.trees;
    const landR = 2.5;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const dx = t.x - at.x, dz = t.z - at.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 9) continue;
      const d = Math.sqrt(d2);
      let strength = 0, nx = dx, nz = dz;
      // Касание ствола: сила по скорости навстречу дереву
      if (d < this.radius[i] + heroRadius + 0.12 && d > 1e-3) {
        this.contactNext.add(i);
        const toward = (vx * dx + vz * dz) / d;
        if (toward > 1.2 && !this.contact.has(i)) strength = clamp(toward / 7, 0.25, 1);
        // Ствол выталкивает героя по касательной — толчок туда, куда он бежал
        nx = vx;
        nz = vz;
      }
      // Приземление: сотрясение земли, к дальним деревьям слабее
      if (landing > 4 && d < landR) {
        const s = clamp((landing - 4) / 8, 0.15, 0.8) * (1 - d / landR) ** 0.5;
        if (s > strength) {
          strength = s;
          nx = dx;
          nz = dz;
        }
      }
      if (strength > 0 && (nx !== 0 || nz !== 0) && this.shake(i, strength, nx, nz)) hits.push({ x: t.x, z: t.z, strength, tree: i });
    }
    [this.contact, this.contactNext] = [this.contactNext, this.contact];
    this.contactNext.clear();
    return hits;
  }

  /** Ветер в шейдер и затухание тряски. */
  update(dt: number): void {
    const windOn = settings.grassWind;
    const t = (performance.now() / 1000) % 1000;
    for (const p of this.plugins) {
      p.wind[2] = windOn ? wind.strength : 0;
      p.wind[3] = t;
    }
    // Буфер тряски перезаливаем, только пока какое-нибудь дерево колеблется
    let active = 0;
    const k = Math.exp(-dt / SHAKE_DECAY);
    for (let i = 0; i < this.amp.length; i++) {
      if (this.amp[i] === 0) continue;
      this.amp[i] = this.amp[i] < 0.004 ? 0 : this.amp[i] * k;
      for (const { buf, per } of this.shakeBufs) for (let j = 0; j < per; j++) buf[(i * per + j) * 4 + 3] = this.amp[i];
      active++;
    }
    if (active > 0 || this.shaking > 0) for (const { mesh } of this.shakeBufs) mesh.thinInstanceBufferUpdated('treeShake');
    this.shaking = active;
    if (this.fall && this.fallKind !== 'fireflies') {
      const drift = wind.strength * (this.fallKind === 'leaves' ? 0.8 : 0.3);
      this.fall.gravity.x = WIND_DIR.x * drift;
      this.fall.gravity.z = WIND_DIR.z * drift;
    }
  }

  dispose(): void {
    this.fall?.dispose();
    this.texture?.dispose();
    for (const m of this.meshes) m.dispose();
    for (const m of this.materials) m.dispose();
  }
}
