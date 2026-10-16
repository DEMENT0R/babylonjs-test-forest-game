// Содержимое одного уровня в игровой сцене: земля, лес, камни, каменный круг,
// платформы, кристаллы, портал и трава. Строится по раскладке из генератора
// и целиком убирается при переходе на следующий уровень.

import {
  Color3,
  Matrix,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  Vector3,
  VertexData,
  type Material,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import { GrassField } from '../grass';
import { addShadowCaster, type LightingContext } from '../settings';
import { clamp } from '../utils';
import { PATH_R, type LevelLayout } from './generator';

export interface Crystal { mesh: Mesh; baseY: number; phase: number }

const PORTAL_Y = 1.6;

export class Level {
  readonly crystals: Crystal[] = [];
  readonly grass: GrassField;
  portalOpen = false;

  private readonly meshes: Mesh[] = [];
  private readonly materials: Material[] = [];
  private readonly portalRing: Mesh;
  private readonly portalCore: Mesh;
  private readonly ringIdle: StandardMaterial;
  private readonly ringLit: StandardMaterial;
  private portalT = 0;

  constructor(private readonly scene: Scene, private readonly lighting: LightingContext, readonly layout: LevelLayout) {
    const b = layout.biome;
    const stone = this.mat('stone', b.stone, 0.05);

    this.buildGround();
    this.buildTrees();
    this.buildRocks();

    const ground = (x: number, z: number) => layout.terrain.heightAt(x, z);
    // Опоры уходят в землю на SINK, чтобы на склоне не висеть в воздухе одним краем
    const SINK = 1;
    for (const p of layout.pillars) {
      const m = this.track(MeshBuilder.CreateBox('pillar', { width: 0.9, height: p.h + SINK, depth: 0.6 }, scene));
      m.position.set(p.x, ground(p.x, p.z) + (p.h - SINK) / 2, p.z);
      m.rotation.y = p.yaw;
      m.material = stone;
      this.solid(m);
    }
    for (const p of layout.platforms) {
      const m = this.track(
        p.round
          ? MeshBuilder.CreateCylinder('portal-base', { height: p.h + SINK, diameter: p.w * 1.2, tessellation: 24 }, scene)
          : MeshBuilder.CreateBox('platform', { width: p.w, height: p.h + SINK, depth: p.d }, scene),
      );
      m.position.set(p.x, p.y0 + (p.h - SINK) / 2, p.z);
      m.material = stone;
      this.solid(m);
    }

    // Кристаллы
    const crystM = this.mat('crystal', new Color3(1, 0.8, 0.3));
    crystM.emissiveColor = new Color3(0.9, 0.6, 0.1);
    layout.crystals.forEach((c, i) => {
      const m = this.track(MeshBuilder.CreatePolyhedron('crystal', { type: 1, size: 0.35 }, scene));
      m.scaling.y = 1.6;
      m.position.set(c.x, c.y + 1, c.z);
      m.material = crystM;
      addShadowCaster(lighting, m);
      this.crystals.push({ mesh: m, baseY: c.y + 1, phase: i * 1.7 });
    });

    // Портал в центре каменного круга (плита — среди платформ), сердцевина появляется при открытии
    this.ringIdle = this.mat('portal-idle', new Color3(0.45, 0.45, 0.5), 0.1);
    this.ringLit = this.mat('portal-lit', new Color3(0.7, 0.85, 1));
    this.ringLit.emissiveColor = new Color3(0.35, 0.6, 1);
    this.portalRing = this.track(MeshBuilder.CreateTorus('portal-ring', { diameter: 2.6, thickness: 0.2, tessellation: 40 }, scene));
    this.portalRing.rotation.x = Math.PI / 2;
    const portalY = ground(layout.portal.x, layout.portal.z) + PORTAL_Y;
    this.portalRing.position.set(layout.portal.x, portalY, layout.portal.z);
    this.portalRing.material = this.ringIdle;
    addShadowCaster(lighting, this.portalRing);
    const coreM = this.mat('portal-core', new Color3(0.6, 0.8, 1));
    coreM.emissiveColor = new Color3(0.25, 0.45, 0.85);
    coreM.alpha = 0.45;
    coreM.backFaceCulling = false;
    this.portalCore = this.track(MeshBuilder.CreateDisc('portal-core', { radius: 1.15, tessellation: 40 }, scene));
    this.portalCore.position.set(layout.portal.x, portalY, layout.portal.z);
    this.portalCore.material = coreM;
    this.portalCore.setEnabled(false);
    // Светится кольцо; полупрозрачная сердцевина в слое свечения превращалась в белое пятно
    lighting.glow?.addExcludedMesh(this.portalCore);

    // Трава — внутри границ, без утоптанной площадки в центре
    const half = layout.half;
    this.grass = new GrassField(scene, {
      area: {
        minX: -half + 0.5,
        maxX: half - 0.5,
        minZ: -half + 0.5,
        maxZ: half - 0.5,
        circles: layout.obstacles,
        rects: layout.platforms,
        coverage: (x, z) => clamp((Math.hypot(x, z) - (PATH_R - 0.6)) / 1.4, 0, 1),
      },
      heightAt: ground,
      baseColor: b.grass.root,
      tipColor: b.grass.tip,
      densityScale: b.grass.density,
      glow: lighting.glow,
      seed: layout.recipe.seed,
    });
  }

  // ---------- Построение ----------

  private track<T extends Mesh>(m: T): T {
    this.meshes.push(m);
    return m;
  }

  private mat(name: string, color: Color3, spec = 0): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(spec, spec, spec);
    this.materials.push(m);
    return m;
  }

  private solid(m: Mesh): void {
    m.receiveShadows = true;
    addShadowCaster(this.lighting, m);
  }

  private buildGround(): void {
    const { half, biome } = this.layout;
    // Земля шире уровня: за стеной леса не должно быть видно края мира
    const size = (half + 60) * 2;
    // Шаг сетки ~2.5 м — рельеф плавный, мелкие детали не нужны
    const subdivisions = Math.ceil(size / 2.5);
    const ground = this.track(MeshBuilder.CreateGround('ground', { width: size, height: size, subdivisions, updatable: true }, this.scene));
    const pos = ground.getVerticesData('position')!;
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = this.layout.terrain.heightAt(pos[i], pos[i + 2]);
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, ground.getIndices()!, normals);
    ground.updateVerticesData('position', pos);
    ground.updateVerticesData('normal', normals);
    ground.refreshBoundingInfo();
    ground.material = this.mat('ground', biome.ground);
    ground.receiveShadows = true;
    const path = this.track(MeshBuilder.CreateDisc('path', { radius: PATH_R, tessellation: 48 }, this.scene));
    path.rotation.x = Math.PI / 2;
    path.position.y = this.layout.terrain.heightAt(0, 0) + 0.02;
    path.material = this.mat('path', biome.path);
    path.receiveShadows = true;
  }

  /**
   * Меш, размноженный через thin instances. Собственная геометрия у каждого:
   * буфер цветов экземпляров Babylon хранит в геометрии.
   */
  private instanced(base: Mesh, material: Material, matrices: Float32Array, colors?: Float32Array): void {
    base.material = material;
    base.isPickable = false;
    base.receiveShadows = true;
    base.thinInstanceSetBuffer('matrix', matrices, 16, true);
    if (colors) base.thinInstanceSetBuffer('color', colors, 4, true);
    base.thinInstanceRefreshBoundingInfo(false);
    addShadowCaster(this.lighting, base);
    this.track(base);
  }

  private buildTrees(): void {
    const { trees, biome, terrain } = this.layout;
    const scene = this.scene;
    const pine = biome.trees.kind === 'pine';
    const trunkM = this.mat('trunk', biome.trees.trunk);
    const leafM = this.mat('leaves', new Color3(1, 1, 1));
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

    const trunks = new Float32Array(trees.length * 16);
    const crownsPerTree = pine ? 3 : 2;
    const crowns = new Float32Array(trees.length * crownsPerTree * 16);
    const crownColors = new Float32Array(trees.length * crownsPerTree * 4);
    trees.forEach((t, i) => {
      // Ствол чуть утоплен в землю — на склоне не видно зазора под ним
      const g = terrain.heightAt(t.x, t.z) - 0.25;
      if (pine) {
        put(trunks, i, t.s, t.s, t.s, t.yaw, t.x, g + t.s, t.z);
        for (let k = 0; k < 3; k++) {
          const d = (3 - k * 0.7) * t.s;
          put(crowns, i * 3 + k, d, t.s, d, t.yaw + k * 1.3, t.x, g + (2 + k * 1.1) * t.s, t.z);
        }
      } else {
        // Берёза: тонкий высокий ствол и две круглые кроны
        put(trunks, i, 0.6 * t.s, 1.7 * t.s, 0.6 * t.s, t.yaw, t.x, g + 1.7 * t.s, t.z);
        put(crowns, i * 2, 1.5 * t.s, 1.3 * t.s, 1.5 * t.s, t.yaw, t.x, g + 3.9 * t.s, t.z);
        const ox = Math.cos(t.yaw) * 0.6 * t.s, oz = Math.sin(t.yaw) * 0.6 * t.s;
        put(crowns, i * 2 + 1, 1.1 * t.s, 1 * t.s, 1.1 * t.s, t.yaw + 1, t.x + ox, g + 5 * t.s, t.z + oz);
      }
      const c = biome.trees.leaves[t.tint];
      for (let k = 0; k < crownsPerTree; k++) {
        const v = 0.92 + ((i * 7 + k * 13) % 10) / 60;
        crownColors.set([c.r * v, c.g * v, c.b * v, 1], (i * crownsPerTree + k) * 4);
      }
    });

    const trunk = MeshBuilder.CreateCylinder('trunks', { height: 2, diameterTop: 0.3, diameterBottom: 0.5, tessellation: 6 }, scene);
    this.instanced(trunk, trunkM, trunks);
    const crown = pine
      ? MeshBuilder.CreateCylinder('crowns', { height: 1.8, diameterTop: 0, diameterBottom: 1, tessellation: 7 }, scene)
      : MeshBuilder.CreateIcoSphere('crowns', { radius: 1, subdivisions: 1, flat: true }, scene);
    this.instanced(crown, leafM, crowns, crownColors);
  }

  private buildRocks(): void {
    const { rocks, biome, terrain } = this.layout;
    if (rocks.length === 0) return;
    const matrices = new Float32Array(rocks.length * 16);
    const colors = new Float32Array(rocks.length * 4);
    const m = new Matrix();
    const q = new Quaternion();
    rocks.forEach((r, i) => {
      Quaternion.RotationYawPitchRollToRef(r.ry, r.rx, r.rz, q);
      Matrix.ComposeToRef(new Vector3(r.s, r.s * 0.6, r.s), q, new Vector3(r.x, terrain.heightAt(r.x, r.z) + r.s * 0.2, r.z), m);
      m.copyToArray(matrices, i * 16);
      const v = 0.85 + (i % 7) / 25;
      colors.set([v, v, v, 1], i * 4);
    });
    const rock = MeshBuilder.CreatePolyhedron('rocks', { type: 2, size: 0.7 }, this.scene);
    const rockM = this.mat('rock', biome.rocks.color, 0.1);
    this.instanced(rock, rockM, matrices, colors);
  }

  // ---------- Каждый кадр ----------

  spinCrystals(dt: number): void {
    for (const k of this.crystals) {
      if (!k.mesh.isEnabled()) continue;
      k.phase += dt;
      k.mesh.rotation.y += dt * 1.5;
      k.mesh.position.y = k.baseY + Math.sin(k.phase * 2) * 0.15;
    }
  }

  openPortal(): void {
    if (this.portalOpen) return;
    this.portalOpen = true;
    this.portalRing.material = this.ringLit;
    this.portalCore.setEnabled(true);
    this.portalCore.scaling.setAll(0.01);
    this.portalT = 0;
  }

  /** Сердцевина портала раскрывается и мерцает. */
  animatePortal(dt: number): void {
    if (!this.portalOpen) return;
    this.portalT += dt;
    const grow = Math.min(1, this.portalT / 0.8);
    const pulse = 1 + Math.sin(this.portalT * 3) * 0.03;
    this.portalCore.scaling.setAll((1 - (1 - grow) ** 3) * pulse);
    this.portalCore.rotation.z += dt * 0.6;
  }

  dispose(): void {
    this.lighting.glow?.removeExcludedMesh(this.portalCore);
    this.grass.dispose();
    for (const m of this.meshes) m.dispose();
    for (const m of this.materials) m.dispose();
  }
}
