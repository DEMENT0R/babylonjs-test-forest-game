// Стоянка путника на особом уровне региона: кострище с ещё тлеющими углями, свёрнутая
// подстилка, котомка и камень с запиской. Путник всегда на шаг впереди героя.

import { Color3, Color4, MeshBuilder, ParticleSystem, StandardMaterial, TransformNode, Vector3, type DynamicTexture, type Mesh, type Scene } from '@babylonjs/core';
import { dotTexture } from '../particles';
import { addShadowCaster, type LightingContext } from '../settings';

/** Подошёл на столько — записку можно читать, м. */
const READ_R = 2.2;

export class TravelerCamp {
  private readonly root: TransformNode;
  private readonly mats: StandardMaterial[] = [];
  private readonly tex: DynamicTexture;
  private readonly smoke: ParticleSystem;
  private readonly embers: StandardMaterial;
  /** Камень с запиской: светится, пока её не прочли. */
  private readonly stone: StandardMaterial;
  private t = 0;
  private visited = false;

  constructor(
    scene: Scene,
    lighting: LightingContext,
    readonly at: Vector3,
    /** Записка ещё не прочитана — камень светится. */
    unread: boolean,
  ) {
    this.root = new TransformNode('camp', scene);
    this.root.position.copyFrom(at);
    const mat = (c: [number, number, number], emissive = 0) => {
      const m = new StandardMaterial('camp', scene);
      m.diffuseColor = new Color3(...c);
      m.specularColor = new Color3(0.05, 0.05, 0.05);
      if (emissive) m.emissiveColor = new Color3(...c).scale(emissive);
      this.mats.push(m);
      return m;
    };
    const add = (m: Mesh, material: StandardMaterial, x: number, y: number, z: number) => {
      m.material = material;
      m.parent = this.root;
      m.position.set(x, y, z);
      m.isPickable = false;
      addShadowCaster(lighting, m);
      return m;
    };
    const stoneM = mat([0.5, 0.5, 0.52]);
    // Кольцо камней вокруг кострища и обгоревшие поленья крест-накрест
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      add(MeshBuilder.CreatePolyhedron('camp-stone', { type: 2, size: 0.13 + (k % 3) * 0.03 }, scene), stoneM, Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55).scaling.y = 0.6;
    }
    const charred = mat([0.18, 0.12, 0.08]);
    for (const yaw of [0.4, -0.5]) {
      add(MeshBuilder.CreateCylinder('camp-log', { diameter: 0.12, height: 0.8, tessellation: 7 }, scene), charred, 0, 0.08, 0).rotation.set(Math.PI / 2, yaw, 0);
    }
    this.embers = mat([1, 0.45, 0.12], 0.9);
    for (let k = 0; k < 5; k++) {
      add(MeshBuilder.CreateSphere('camp-ember', { diameter: 0.08, segments: 4 }, scene), this.embers, Math.cos(k * 1.7) * 0.15, 0.1, Math.sin(k * 1.7) * 0.15);
    }
    // Свёрнутая подстилка, котомка и посох
    add(MeshBuilder.CreateCylinder('camp-roll', { diameter: 0.32, height: 0.9, tessellation: 10 }, scene), mat([0.5, 0.36, 0.3]), 1.3, 0.16, 0.5).rotation.set(0, 0.6, Math.PI / 2);
    add(MeshBuilder.CreateBox('camp-bag', { width: 0.4, height: 0.45, depth: 0.28 }, scene), mat([0.42, 0.38, 0.22]), -1.1, 0.22, 0.7).rotation.y = -0.4;
    add(MeshBuilder.CreateCylinder('camp-staff', { diameter: 0.05, height: 1.5, tessellation: 6 }, scene), mat([0.4, 0.26, 0.15]), -1.35, 0.72, -0.3).rotation.z = 0.25;
    this.stone = mat([0.55, 0.62, 0.7]);
    if (unread) this.stone.emissiveColor = new Color3(0.15, 0.35, 0.6);
    add(MeshBuilder.CreateBox('camp-note', { width: 0.6, height: 0.75, depth: 0.15 }, scene), this.stone, 0.2, 0.35, -1.2).rotation.set(-0.2, 0.3, 0.06);
    // Дымок от углей — издалека видно, куда идти
    this.tex = dotTexture(scene);
    const ps = (this.smoke = new ParticleSystem('camp-smoke', 60, scene));
    ps.particleTexture = this.tex;
    ps.emitter = at.add(new Vector3(0, 0.2, 0));
    ps.minEmitBox = new Vector3(-0.1, 0, -0.1);
    ps.maxEmitBox = new Vector3(0.1, 0, 0.1);
    ps.direction1 = new Vector3(-0.15, 1, -0.1);
    ps.direction2 = new Vector3(0.2, 1, 0.15);
    ps.minEmitPower = 0.4;
    ps.maxEmitPower = 0.8;
    ps.minLifeTime = 3;
    ps.maxLifeTime = 5;
    ps.minSize = 0.4;
    ps.maxSize = 1;
    ps.color1 = new Color4(0.75, 0.75, 0.75, 0.35);
    ps.color2 = new Color4(0.6, 0.6, 0.62, 0.25);
    ps.colorDead = new Color4(0.6, 0.6, 0.6, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 5;
    ps.start();
  }

  /** Угли мерцают; true — герой только что подошёл к стоянке (один раз за уровень). */
  update(dt: number, feet: Vector3): boolean {
    this.t += dt;
    const k = 0.7 + 0.3 * Math.sin(this.t * 3.1) * Math.sin(this.t * 1.7);
    this.embers.emissiveColor.set(0.9 * k, 0.4 * k, 0.1 * k);
    if (this.visited || Math.hypot(feet.x - this.at.x, feet.z - this.at.z) > READ_R) return false;
    this.visited = true;
    this.stone.emissiveColor.set(0, 0, 0);
    return true;
  }

  dispose(): void {
    this.smoke.dispose(false);
    this.root.dispose(false, true);
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }
}

/** Огоньки тропы к стоянке: низкие столбики с тёплым светлячком наверху, мигают по очереди. */
export class TrailLanterns {
  private readonly root: TransformNode;
  private readonly glow: StandardMaterial;
  private readonly post: StandardMaterial;
  private readonly lights: Mesh[] = [];
  private t = 0;

  constructor(scene: Scene, points: readonly { x: number; z: number; y: number }[]) {
    this.root = new TransformNode('trail', scene);
    this.post = new StandardMaterial('trail-post', scene);
    this.post.diffuseColor = new Color3(0.4, 0.27, 0.16);
    this.glow = new StandardMaterial('trail-glow', scene);
    this.glow.diffuseColor = new Color3(1, 0.8, 0.4);
    this.glow.emissiveColor = new Color3(1, 0.75, 0.35);
    this.glow.disableLighting = true;
    for (const p of points) {
      const post = MeshBuilder.CreateCylinder('trail-post', { diameter: 0.07, height: 0.7, tessellation: 5 }, scene);
      post.material = this.post;
      post.position.set(p.x, p.y + 0.35, p.z);
      post.parent = this.root;
      post.isPickable = false;
      const light = MeshBuilder.CreateSphere('trail-light', { diameter: 0.2, segments: 6 }, scene);
      light.material = this.glow;
      light.position.set(p.x, p.y + 0.8, p.z);
      light.parent = this.root;
      light.isPickable = false;
      this.lights.push(light);
    }
  }

  /** Огоньки пульсируют волной от старта к стоянке — подсказка, куда идти. */
  update(dt: number): void {
    this.t += dt;
    this.lights.forEach((l, i) => l.scaling.setAll(0.8 + 0.4 * Math.max(0, Math.sin(this.t * 3 - i * 0.6))));
  }

  dispose(): void {
    this.root.dispose(false, true);
    this.glow.dispose();
    this.post.dispose();
  }
}
