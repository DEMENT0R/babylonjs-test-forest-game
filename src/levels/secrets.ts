// Тайники уровня: мерцающее дерево роняет находку, если его тряхнуть (врезаться с разбега
// или приземлиться рядом); тайник под камнем поблёскивает только вблизи и раскрывается,
// когда герой подходит вплотную. Где они — решает генератор, здесь — искры и находка.

import { Color3, Color4, MeshBuilder, ParticleSystem, StandardMaterial, Vector3, type DynamicTexture, type Mesh, type Scene } from '@babylonjs/core';
import { dotTexture } from '../particles';
import type { LevelLayout, SecretSpot } from './generator';

/** Ближе этого тайник под камнем начинает поблёскивать, м. */
const STONE_SEEN = 6;
/** Подошёл на столько — тайник под камнем раскрыт, м. */
const STONE_OPEN = 1.6;
/** Блеск тайника под камнем — над землёй, м. */
const STONE_Y = 0.35;

const GOLD = new Color3(1, 0.84, 0.42);

interface Live {
  spot: SecretSpot;
  /** Откуда вылетает находка: середина кроны или блеск у камня. */
  at: Vector3;
  found: boolean;
  glint: ParticleSystem;
  /** Огонёк у камня; у дерева — только искры. */
  mesh?: Mesh;
}

export class LevelSecrets {
  private readonly live: Live[] = [];
  private readonly mat: StandardMaterial;
  /** Одна текстура искр на все тайники. */
  private readonly tex: DynamicTexture;
  private t = 0;

  constructor(scene: Scene, layout: LevelLayout) {
    this.tex = dotTexture(scene);
    this.mat = new StandardMaterial('secret', scene);
    this.mat.diffuseColor = GOLD;
    this.mat.emissiveColor = GOLD.scale(0.8);
    this.mat.disableLighting = true;
    const pine = layout.biome.trees.kind === 'pine';
    for (const spot of layout.secrets) {
      if (spot.kind === 'tree') {
        const s = layout.trees[spot.tree].s;
        // Середина кроны: у ели — три яруса от 2 до 4,2 высоты, у берёзы крона выше
        const at = new Vector3(spot.x, spot.y + (pine ? 3.1 : 4.3) * s, spot.z);
        this.live.push({ spot, at, found: false, glint: this.glint(scene, at, 1.5 * s, 26) });
      } else {
        const at = new Vector3(spot.x, spot.y + STONE_Y, spot.z);
        const mesh = MeshBuilder.CreatePolyhedron('secret-stone', { type: 1, size: 0.11 }, scene);
        mesh.position.copyFrom(at);
        mesh.material = this.mat;
        mesh.isPickable = false;
        mesh.setEnabled(false);
        const glint = this.glint(scene, at, 0.35, 0);
        this.live.push({ spot, at, found: false, glint, mesh });
      }
    }
  }

  /**
   * Золотые искры на поверхности сферы — снаружи кроны, чтобы их не закрывала листва.
   * Это подсказка, а не украшение, поэтому видна и с выключенными частицами в настройках.
   */
  private glint(scene: Scene, at: Vector3, radius: number, rate: number): ParticleSystem {
    const ps = new ParticleSystem('secret-glint', 80, scene);
    ps.particleTexture = this.tex;
    ps.emitter = at;
    ps.createSphereEmitter(radius, 0);
    ps.minEmitPower = 0.05;
    ps.maxEmitPower = 0.2;
    ps.gravity = new Vector3(0, -0.4, 0);
    ps.minLifeTime = 0.9;
    ps.maxLifeTime = 1.6;
    ps.minSize = 0.22;
    ps.maxSize = 0.4;
    ps.color1 = new Color4(1, 0.86, 0.45, 1);
    ps.color2 = new Color4(1, 0.95, 0.7, 1);
    ps.colorDead = new Color4(1, 0.8, 0.3, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = rate;
    ps.start();
    return ps;
  }

  get total(): number {
    return this.live.length;
  }

  get found(): number {
    return this.live.filter((l) => l.found).length;
  }

  private open(l: Live): Vector3 {
    l.found = true;
    l.glint.emitRate = 0;
    l.mesh?.setEnabled(false);
    return l.at;
  }

  /** Тряхнули дерево tree: если в нём тайник — он раскрыт, возвращает, откуда падает находка. */
  shake(tree: number): Vector3 | null {
    const l = this.live.find((s) => !s.found && s.spot.kind === 'tree' && s.spot.tree === tree);
    return l ? this.open(l) : null;
  }

  /** Герой подошёл к тайнику под камнем: раскрыт — возвращает, откуда выскакивает находка. */
  reach(at: Vector3): Vector3 | null {
    const l = this.live.find((s) => !s.found && s.spot.kind === 'stone' && Math.hypot(s.at.x - at.x, s.at.z - at.z) < STONE_OPEN);
    return l ? this.open(l) : null;
  }

  /** Есть ли ненайденное мерцающее дерево ближе r — для подсказки новичку. */
  treeNear(at: Vector3, r: number): boolean {
    return this.live.some((s) => !s.found && s.spot.kind === 'tree' && Math.hypot(s.at.x - at.x, s.at.z - at.z) < r);
  }

  /** Тайник под камнем разгорается, когда герой подходит, и гаснет, когда уходит. */
  update(dt: number, at: Vector3): void {
    this.t += dt;
    for (const l of this.live) {
      if (l.found || !l.mesh) continue;
      const d = Math.hypot(l.at.x - at.x, l.at.z - at.z);
      const k = Math.max(0, 1 - d / STONE_SEEN);
      l.mesh.setEnabled(k > 0);
      l.glint.emitRate = k > 0 ? 6 + 18 * k : 0;
      if (k <= 0) continue;
      l.mesh.visibility = Math.min(1, k * 2);
      l.mesh.rotation.y += dt * 2;
      l.mesh.scaling.setAll(1 + 0.25 * Math.sin(this.t * 5));
    }
  }

  dispose(): void {
    for (const l of this.live) {
      l.glint.dispose(false);
      l.mesh?.dispose();
    }
    this.mat.dispose();
    this.tex.dispose();
  }
}
