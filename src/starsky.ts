// Ночное небо уровня: фоновые звёзды и созвездия игрока на куполе вокруг камеры.
// Купол едет вместе с камерой (infiniteDistance) и держится чуть ближе дальней
// плоскости отсечения; туман его не касается, лес и рельеф закрывают низкие звёзды.

import { Constants, Effect, Material, Mesh, ShaderMaterial, VertexData, type Camera, type GlowLayer, type Scene } from '@babylonjs/core';
import { BACKGROUND, skyFor, type Dir } from './constellations';
import { now } from './utils';

Effect.ShadersStore.skyStarVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
attribute float twinkle;
uniform mat4 worldViewProjection;
uniform float time;
varying vec2 vUV;
varying vec4 vColor;
void main() {
  vUV = uv;
  float tw = twinkle > 0.0 ? 0.75 + 0.25 * sin(time * (0.8 + twinkle) + twinkle * 37.0) : 1.0;
  vColor = vec4(color.rgb, color.a * tw);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;
Effect.ShadersStore.skyStarFragmentShader = `
precision highp float;
varying vec2 vUV;
varying vec4 vColor;
void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float d = dot(p, p);
  float a = (exp(-d * 16.0) + 0.3 * exp(-d * 4.0)) * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;
Effect.ShadersStore.skyLineVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec4 color;
uniform mat4 worldViewProjection;
varying vec4 vColor;
void main() {
  vColor = color;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;
Effect.ShadersStore.skyLineFragmentShader = `
precision highp float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

type RGBA = readonly [number, number, number, number];

const EARNED: RGBA = [1, 0.9, 0.72, 1];
const FAINT: RGBA = [0.8, 0.86, 1, 1];
const GHOST: RGBA = [0.6, 0.7, 1, 0.22];
const LINE_DONE: RGBA = [0.7, 0.78, 1, 0.32];
const LINE_PART: RGBA = [0.7, 0.78, 1, 0.18];

/** Купол — на этой доле дальней плоскости камеры. */
const DOME = 0.85;

class StarBuffer {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];
  readonly twinkle: number[] = [];
  readonly indices: number[] = [];

  /** Квадрат с центром на направлении d, повёрнутый к центру купола; size — полуширина в радианах. */
  add(d: Dir, size: number, c: RGBA, alpha: number, tw: number): void {
    const [x, y, z] = d;
    // Касательные: e1 = d × вверх (или × ось X у зенита), e2 = d × e1
    let ex = -z, ez = x, ey = 0;
    if (Math.hypot(ex, ez) < 1e-3) [ex, ey, ez] = [0, z, -y];
    const l1 = Math.hypot(ex, ey, ez);
    ex /= l1; ey /= l1; ez /= l1;
    const fx = y * ez - z * ey, fy = z * ex - x * ez, fz = x * ey - y * ex;
    const base = this.positions.length / 3;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      this.positions.push(x + (ex * u + fx * v) * size, y + (ey * u + fy * v) * size, z + (ez * u + fz * v) * size);
      this.uvs.push((u + 1) / 2, (v + 1) / 2);
      this.colors.push(c[0], c[1], c[2], c[3] * alpha);
      this.twinkle.push(tw);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

export class StarSky {
  private stars: Mesh | null = null;
  private lines: Mesh | null = null;
  private readonly starMat: ShaderMaterial;
  private readonly lineMat: ShaderMaterial;
  /** Для какого числа звёзд построено небо; -1 — ещё не строилось. */
  private builtFor = -1;
  private visible = false;

  constructor(private readonly scene: Scene, private readonly camera: Camera, private readonly glow: GlowLayer | null) {
    this.starMat = new ShaderMaterial('sky-stars', scene, 'skyStar', {
      attributes: ['position', 'uv', 'color', 'twinkle'],
      uniforms: ['worldViewProjection', 'time'],
      needAlphaBlending: true,
    });
    this.lineMat = new ShaderMaterial('sky-lines', scene, 'skyLine', {
      attributes: ['position', 'color'],
      uniforms: ['worldViewProjection'],
      needAlphaBlending: true,
    });
    for (const m of [this.starMat, this.lineMat]) {
      m.alphaMode = Constants.ALPHA_ADD;
      m.disableDepthWrite = true;
      m.backFaceCulling = false;
    }
    this.lineMat.fillMode = Material.LineListDrawMode;
    scene.onBeforeRenderObservable.add(() => this.update());
  }

  /** Показать небо (ночной биом) или спрятать; total — сколько звёзд у игрока. */
  show(on: boolean, total: number): void {
    this.visible = on;
    if (on && total !== this.builtFor) this.build(total);
    this.stars?.setEnabled(on);
    this.lines?.setEnabled(on);
  }

  private build(total: number): void {
    this.stars?.dispose();
    this.lines?.dispose();
    this.builtFor = total;
    const sky = skyFor(total);
    const b = new StarBuffer();
    BACKGROUND.forEach((s, i) => b.add(s.dir, 0.0026 + s.mag * 0.0022, FAINT, 0.22 + s.mag * 0.55, i % 2 ? 0.3 + (i % 7) * 0.2 : 0));
    const lineP: number[] = [];
    const lineC: number[] = [];
    const line = (a: Dir, z: Dir, c: RGBA) => {
      lineP.push(...a, ...z);
      lineC.push(...c, ...c);
    };
    for (const { c, count, done } of sky.lit) {
      c.stars.forEach((s, i) => {
        if (i < count) b.add(s.dir, 0.008 + s.mag * 0.005, EARNED, 0.75 + s.mag * 0.25, 0.4 + i * 0.37);
        else b.add(s.dir, 0.0045, GHOST, 1, 0);
      });
      for (const [a, z] of c.edges) if (a < count && z < count) line(c.stars[a].dir, c.stars[z].dir, done ? LINE_DONE : LINE_PART);
    }
    // Следующее созвездие, где ещё не горит ни одной звезды, — едва заметные точки
    if (sky.next && !sky.lit.some((l) => l.c === sky.next!.c)) for (const s of sky.next.c.stars) b.add(s.dir, 0.0045, GHOST, 1, 0);
    for (const { star, index } of sky.dust) b.add(star.dir, 0.006 + star.mag * 0.003, EARNED, 0.8, 0.5 + (index % 5) * 0.3);

    this.stars = this.mesh('sky-stars', this.starMat, b.positions, b.indices, b.colors, (m) => {
      m.setVerticesData('uv', b.uvs, false, 2);
      m.setVerticesData('twinkle', b.twinkle, false, 1);
    });
    this.lines = lineP.length
      ? this.mesh('sky-lines', this.lineMat, lineP, Array.from({ length: lineP.length / 3 }, (_, i) => i), lineC)
      : null;
  }

  private mesh(name: string, mat: Material, positions: number[], indices: number[], colors: number[], extra?: (m: Mesh) => void): Mesh {
    const m = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = colors;
    vd.applyToMesh(m);
    extra?.(m);
    m.material = mat;
    m.infiniteDistance = true;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.applyFog = false;
    m.hasVertexAlpha = true;
    this.glow?.addExcludedMesh(m);
    m.setEnabled(this.visible);
    return m;
  }

  private update(): void {
    if (!this.visible) return;
    const r = this.camera.maxZ * DOME;
    this.stars?.scaling.setAll(r);
    this.lines?.scaling.setAll(r);
    this.starMat.setFloat('time', now());
  }
}
