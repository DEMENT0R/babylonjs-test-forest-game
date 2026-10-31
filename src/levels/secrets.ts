// Тайники уровня. Мерцающее дерево роняет находку, если его тряхнуть (врезаться с разбега
// или приземлиться рядом); тайник под камнем поблёскивает только вблизи и раскрывается,
// когда герой подходит вплотную; в грибном круге надо постоять; гнездо на уступе берётся
// высоким или двойным прыжком; жемчужина лежит на дне озера, и за ней надо зайти в воду.
// Где тайники — решает генератор, здесь — как они выглядят и когда раскрываются.

import { Color3, Color4, MeshBuilder, ParticleSystem, StandardMaterial, Vector3, type DynamicTexture, type Mesh, type Scene } from '@babylonjs/core';
import { dotTexture } from '../particles';
import type { LevelLayout, SecretSpot } from './generator';

/** Ближе этого тайник под камнем начинает поблёскивать, м. */
const STONE_SEEN = 6;
/** Подошёл на столько — тайник раскрыт (камень, гнездо, жемчужина), м. */
const OPEN_R = 1.6;
/** Блеск тайника под камнем — над землёй, м. */
const STONE_Y = 0.35;
/** Грибной круг: радиус, сколько грибов и сколько в нём стоять, с. */
const RING_R = 1.6;
const RING_CAPS = 9;
const RING_TIME = 3;

const GOLD = new Color3(1, 0.84, 0.42);

/** Раскрытый тайник и откуда вылетает находка. */
export interface Opened { spot: SecretSpot; at: Vector3 }

interface Live {
  spot: SecretSpot;
  /** Откуда вылетает находка: середина кроны, блеск у камня, середина круга, гнездо, жемчужина. */
  at: Vector3;
  found: boolean;
  glint: ParticleSystem;
  meshes: Mesh[];
  /** Грибной круг: сколько секунд в нём простояли и материал шляпок — они разгораются. */
  charge: number;
  caps?: StandardMaterial;
}

export class LevelSecrets {
  private readonly live: Live[] = [];
  private readonly mats: StandardMaterial[] = [];
  /** Одна текстура искр на все тайники. */
  private readonly tex: DynamicTexture;
  private readonly water: number | null;
  private t = 0;

  constructor(
    private readonly scene: Scene,
    layout: LevelLayout,
  ) {
    this.tex = dotTexture(scene);
    this.water = layout.waterLevel;
    const gold = this.mat('secret-gold', GOLD, GOLD.scale(0.8));
    const pine = layout.biome.trees.kind === 'pine';
    for (const spot of layout.secrets) {
      const l: Live = { spot, at: new Vector3(spot.x, spot.y, spot.z), found: false, glint: null!, meshes: [], charge: 0 };
      switch (spot.kind) {
        case 'tree': {
          const s = layout.trees[spot.tree].s;
          // Середина кроны: у ели — три яруса от 2 до 4,2 высоты, у берёзы крона выше
          l.at.y += (pine ? 3.1 : 4.3) * s;
          l.glint = this.glint(l.at, 1.5 * s, 26);
          break;
        }
        case 'stone': {
          l.at.y += STONE_Y;
          const m = this.mesh(MeshBuilder.CreatePolyhedron('secret-stone', { type: 1, size: 0.11 }, scene), l, gold);
          m.position.copyFrom(l.at);
          m.setEnabled(false);
          l.glint = this.glint(l.at, 0.35, 0);
          break;
        }
        case 'ring': {
          l.at.y += 0.3;
          this.buildRing(l);
          l.glint = this.glint(l.at, RING_R, 0);
          break;
        }
        case 'ledge': {
          l.at.y = spot.top + 0.15;
          const nest = this.mesh(MeshBuilder.CreateTorus('secret-nest', { diameter: 0.7, thickness: 0.2, tessellation: 14 }, scene), l, this.mat('secret-nest', new Color3(0.45, 0.32, 0.18)));
          nest.position.set(spot.x, spot.top + 0.1, spot.z);
          const egg = this.mesh(MeshBuilder.CreateSphere('secret-egg', { diameter: 0.24, segments: 8 }, scene), l, gold);
          egg.scaling.y = 1.3;
          egg.position.set(spot.x, spot.top + 0.2, spot.z);
          l.glint = this.glint(new Vector3(spot.x, spot.top + 0.4, spot.z), 0.6, 14);
          break;
        }
        case 'pearl': {
          l.at.y += 0.12;
          const pearl = this.mesh(MeshBuilder.CreateSphere('secret-pearl', { diameter: 0.24, segments: 10 }, scene), l, this.mat('secret-pearl', new Color3(1, 0.97, 0.92), new Color3(0.5, 0.48, 0.45)));
          pearl.position.copyFrom(l.at);
          // Искры над водой, чтобы место было видно с берега
          l.glint = this.glint(new Vector3(spot.x, (this.water ?? spot.y) + 0.15, spot.z), 0.4, 10);
          break;
        }
      }
      this.live.push(l);
    }
  }

  private mat(name: string, color: Color3, emissive?: Color3): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color;
    m.specularColor = new Color3(0.1, 0.1, 0.1);
    if (emissive) m.emissiveColor = emissive;
    this.mats.push(m);
    return m;
  }

  private mesh(m: Mesh, l: Live, mat: StandardMaterial): Mesh {
    m.material = mat;
    m.isPickable = false;
    l.meshes.push(m);
    return m;
  }

  /** Кольцо грибов: ножки и шляпки; шляпки разгораются, пока герой стоит в круге. */
  private buildRing(l: Live): void {
    const stem = this.mat('secret-stem', new Color3(0.92, 0.88, 0.78));
    l.caps = this.mat('secret-caps', new Color3(0.85, 0.3, 0.22), new Color3(0, 0, 0));
    for (let i = 0; i < RING_CAPS; i++) {
      const a = (i / RING_CAPS) * Math.PI * 2;
      const x = l.spot.x + Math.cos(a) * RING_R, z = l.spot.z + Math.sin(a) * RING_R;
      const s = 0.8 + 0.4 * ((i * 7) % 5) / 5;
      const y = l.spot.y;
      const st = this.mesh(MeshBuilder.CreateCylinder('secret-stem', { height: 0.22 * s, diameter: 0.07 * s, tessellation: 6 }, this.scene), l, stem);
      st.position.set(x, y + 0.11 * s, z);
      const cap = this.mesh(MeshBuilder.CreateSphere('secret-cap', { diameter: 0.26 * s, segments: 6, slice: 0.5 }, this.scene), l, l.caps);
      cap.position.set(x, y + 0.2 * s, z);
    }
  }

  /**
   * Золотые искры на поверхности сферы — снаружи кроны, чтобы их не закрывала листва.
   * Это подсказка, а не украшение, поэтому видна и с выключенными частицами в настройках.
   */
  private glint(at: Vector3, radius: number, rate: number): ParticleSystem {
    const ps = new ParticleSystem('secret-glint', 80, this.scene);
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

  /** Ненайденные тайники — для подсказок на экране итога. */
  get left(): SecretSpot[] {
    return this.live.filter((l) => !l.found).map((l) => l.spot);
  }

  private open(l: Live): Opened {
    l.found = true;
    l.glint.emitRate = 0;
    // Грибы остаются — гаснут; камень, гнездо и жемчужина исчезают вместе с находкой
    if (l.spot.kind === 'ring') l.caps!.emissiveColor.set(0.15, 0.1, 0.05);
    else for (const m of l.meshes) m.setEnabled(false);
    return { spot: l.spot, at: l.at };
  }

  /** Тряхнули дерево tree: если в нём тайник — он раскрыт. */
  shake(tree: number): Opened | null {
    const l = this.live.find((s) => !s.found && s.spot.kind === 'tree' && s.spot.tree === tree);
    return l ? this.open(l) : null;
  }

  /** Ближайший ненайденный тайник ближе r — для подсказок; дерево считается по стволу. */
  near(at: Vector3, r: number): SecretSpot | null {
    let best: SecretSpot | null = null;
    let bestD = r;
    for (const l of this.live) {
      const d = Math.hypot(l.spot.x - at.x, l.spot.z - at.z);
      if (!l.found && d < bestD) {
        best = l.spot;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * Каждый кадр: тайник под камнем разгорается, когда герой рядом; грибной круг копит время;
   * камень, гнездо и жемчужина раскрываются, когда герой до них добрался. feet — где стоит герой.
   */
  update(dt: number, feet: Vector3): Opened[] {
    this.t += dt;
    const opened: Opened[] = [];
    for (const l of this.live) {
      if (l.found) continue;
      const d = Math.hypot(l.spot.x - feet.x, l.spot.z - feet.z);
      switch (l.spot.kind) {
        case 'stone': {
          const k = Math.max(0, 1 - d / STONE_SEEN);
          const m = l.meshes[0];
          m.setEnabled(k > 0);
          l.glint.emitRate = k > 0 ? 6 + 18 * k : 0;
          if (k > 0) {
            m.visibility = Math.min(1, k * 2);
            m.rotation.y += dt * 2;
            m.scaling.setAll(1 + 0.25 * Math.sin(this.t * 5));
          }
          if (d < OPEN_R) opened.push(this.open(l));
          break;
        }
        case 'ring': {
          // Вышел из круга — заряд медленно уходит, можно вернуться и достоять
          l.charge = d < RING_R - 0.1 ? l.charge + dt : Math.max(0, l.charge - dt * 0.5);
          const k = Math.min(1, l.charge / RING_TIME);
          l.caps!.emissiveColor.set(0.9 * k, 0.55 * k, 0.25 * k);
          l.glint.emitRate = k > 0 ? 8 + 30 * k : 0;
          if (k >= 1) opened.push(this.open(l));
          break;
        }
        case 'ledge':
          // Гнездо — только для того, кто стоит наверху
          if (d < OPEN_R && feet.y > l.spot.top - 0.3) opened.push(this.open(l));
          break;
        case 'pearl':
          l.meshes[0].rotation.y += dt;
          if (d < OPEN_R && this.water !== null && feet.y < this.water) opened.push(this.open(l));
          break;
      }
    }
    return opened;
  }

  dispose(): void {
    for (const l of this.live) {
      l.glint.dispose(false);
      for (const m of l.meshes) m.dispose();
    }
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }
}
