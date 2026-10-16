// Трава: десятки тысяч травинок через thin instances, разбитые на куски по сетке.
// Дальние куски прореживаются и скрываются, ветер и примятие героем считаются
// в вершинном шейдере — через плагин к обычному StandardMaterial, поэтому туман,
// освещение и приём теней работают как у остальной сцены.

import {
  BoundingInfo,
  Color3,
  MaterialPluginBase,
  Matrix,
  Mesh,
  Quaternion,
  ShaderLanguage,
  StandardMaterial,
  Vector3,
  VertexData,
  type GlowLayer,
  type Material,
  type MaterialDefines,
  type Scene,
  type UniformBuffer,
} from '@babylonjs/core';
import { onSettingsApplied, settings, type GrassDensity } from './settings';
import { clamp } from './utils';
import { wind, WIND_DIR } from './wind';

/** Травинок на квадратный метр для каждой плотности. */
const BLADES_PER_M2: Record<Exclude<GrassDensity, 'off'>, number> = { sparse: 4, normal: 10, dense: 20 };
const CHUNK = 8;

export interface GrassArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Круглые препятствия, под которыми травы нет (стволы, камни, подиумы). */
  circles: readonly { x: number; z: number; r: number }[];
  /** Прямоугольники без травы (платформы). */
  rects?: readonly { x: number; z: number; w: number; d: number }[];
  /** Вероятность травы в точке 0…1 — например, проплешина на утоптанной площадке. */
  coverage?: (x: number, z: number) => number;
}

export interface GrassOptions {
  area: GrassArea;
  /** Цвет у корня (лучше совпадать с землёй) и на кончике. */
  baseColor: Color3;
  tipColor: Color3;
  /** Свечение сцены: траву из него исключаем, иначе она рисуется дважды. */
  glow?: GlowLayer | null;
  /** Фиксированная дальность травы (экран выбора); иначе — из настроек. */
  fixedDistance?: number;
  /** Высота земли; без неё трава растёт на нулевой высоте. */
  heightAt?: (x: number, z: number) => number;
  /** Множитель плотности (биом с редкой травой). */
  densityScale?: number;
  seed?: number;
}

/** Цвета луга: земля (она же цвет у корня травинок) и кончики травы. */
export const MEADOW_GROUND = new Color3(0.42, 0.6, 0.36);
export const MEADOW_TIP = new Color3(0.6, 0.8, 0.32);

// ---------- Плагин материала: ветер и примятие ----------

const SWAY_GLSL = /* glsl */ `
#ifdef GRASSWIND
{
  // Доля высоты травинки: корень неподвижен, кончик гнётся сильнее всего
  float gh = clamp(positionUpdated.y, 0.0, 1.0);
  float gk = gh * gh;
  vec2 gp = worldPos.xz;
  vec2 gdir = grassWind.xy;
  float gs = grassWind.z;
  float gt = grassWind.w;
  // Бегущие волны порывов и мелкая дрожь отдельных травинок
  float wave = sin(dot(gp, gdir) * 0.45 - gt * 1.8) * 0.5 + 0.5;
  float flutter = sin(gt * 5.3 + gp.x * 2.1 + gp.y * 1.7) * 0.6 + sin(gt * 3.1 + gp.y * 2.9) * 0.4;
  vec2 off = gdir * (gs * (0.15 + 0.85 * wave) * 0.32 + flutter * (0.02 + 0.05 * gs)) * gk;
  off += vec2(-gdir.y, gdir.x) * flutter * 0.03 * gs * gk;
  // Герой приминает траву вокруг себя (если стоит на земле, а не летит в прыжке):
  // grassBend.y — высота героя над землёй
  vec2 gd = gp - grassBend.xz;
  float gdist = length(gd);
  float press = (1.0 - smoothstep(grassBend.w * 0.3, grassBend.w, gdist))
              * step(0.001, grassBend.w)
              * (1.0 - smoothstep(0.2, 0.8, grassBend.y));
  off += gd / max(gdist, 0.001) * press * 0.42 * gh;
  worldPos.xz += off;
  // Наклонённая травинка становится ниже — длина примерно сохраняется
  worldPos.y -= length(off) * 0.55 * gh;
}
#endif
`;

class GrassWindPlugin extends MaterialPluginBase {
  wind = new Float32Array([WIND_DIR.x, WIND_DIR.z, 0, 0]);
  bend = new Float32Array([0, 0, 0, 0]);

  constructor(material: Material) {
    super(material, 'GrassWind', 200, { GRASSWIND: false }, true, true);
  }

  override getClassName(): string {
    return 'GrassWindPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['GRASSWIND'] = true;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'grassWind', size: 4, type: 'vec4' },
        { name: 'grassBend', size: 4, type: 'vec4' },
      ],
      vertex: `#ifdef GRASSWIND
        uniform vec4 grassWind;
        uniform vec4 grassBend;
      #endif`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    const w = this.wind, b = this.bend;
    ubo.updateFloat4('grassWind', w[0], w[1], w[2], w[3]);
    ubo.updateFloat4('grassBend', b[0], b[1], b[2], b[3]);
  }

  override getCustomCode(shaderType: string) {
    return shaderType === 'vertex' ? { CUSTOM_VERTEX_UPDATE_WORLDPOS: SWAY_GLSL } : null;
  }
}

// ---------- Геометрия травинки ----------

/**
 * Одна травинка высотой 1 и шириной 1 (масштаб задаёт матрица экземпляра):
 * три сужающихся сегмента и острый кончик, слегка изогнутые вперёд.
 * Нормали наклонены от вертикали: со случайным поворотом травинок солнце
 * освещает их по-разному, и луг не сливается в ровную заливку.
 */
function bladeGeometry(base: Color3, tip: Color3): VertexData {
  const levels = [
    { y: 0, w: 1 },
    { y: 0.38, w: 0.78 },
    { y: 0.72, w: 0.45 },
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const pushVertex = (x: number, y: number) => {
    positions.push(x, y, 0.14 * y * y);
    const c = Color3.Lerp(base, tip, y);
    colors.push(c.r, c.g, c.b, 1);
  };
  for (const l of levels) {
    pushVertex(-0.5 * l.w, l.y);
    pushVertex(0.5 * l.w, l.y);
  }
  pushVertex(0, 1);
  for (let i = 0; i < levels.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const last = (levels.length - 1) * 2;
  indices.push(last, last + 1, last + 2);

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  vd.normals = positions.flatMap((_, i) => (i % 3 === 0 ? [0, 0.72, -0.69] : []));
  return vd;
}

// ---------- Поле травы ----------

interface Chunk {
  mesh: Mesh;
  /** Прямоугольник куска — для расстояния до камеры. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Всего травинок в куске. */
  full: number;
}

export class GrassField {
  private readonly plugin: GrassWindPlugin;
  private readonly material: StandardMaterial;
  private readonly bladeData: VertexData;
  private chunks: Chunk[] = [];
  private builtDensity: GrassDensity | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly scene: Scene, private readonly opts: GrassOptions) {
    const m = (this.material = new StandardMaterial('grass', scene));
    m.diffuseColor = new Color3(1, 1, 1);
    m.specularColor = new Color3(0, 0, 0);
    m.backFaceCulling = false;
    this.plugin = new GrassWindPlugin(m);

    this.bladeData = bladeGeometry(opts.baseColor, opts.tipColor);

    this.unsubscribe = onSettingsApplied((s) => this.build(s.grass));
    this.build(settings.grass);
  }

  dispose(): void {
    this.unsubscribe();
    this.clear();
    this.material.dispose(true);
  }

  private clear(): void {
    for (const c of this.chunks) {
      this.opts.glow?.removeExcludedMesh(c.mesh);
      c.mesh.dispose();
    }
    this.chunks = [];
  }

  /** Пересоздаёт траву, если изменилась плотность. */
  private build(density: GrassDensity): void {
    if (density === this.builtDensity) return;
    this.builtDensity = density;
    this.clear();
    if (density === 'off') return;

    const { area } = this.opts;
    const perM2 = BLADES_PER_M2[density] * (this.opts.densityScale ?? 1);
    let seed = this.opts.seed ?? 12345;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    const heightAt = this.opts.heightAt ?? (() => 0);
    const mat = new Matrix();
    const q = new Quaternion();
    const scale = new Vector3();
    const pos = new Vector3();

    for (let cx = area.minX; cx < area.maxX; cx += CHUNK) {
      for (let cz = area.minZ; cz < area.maxZ; cz += CHUNK) {
        const x1 = Math.min(cx + CHUNK, area.maxX);
        const z1 = Math.min(cz + CHUNK, area.maxZ);
        // Препятствия, задевающие кусок, — чтобы не проверять все для каждой травинки
        const circles = area.circles.filter(
          (o) => o.x + o.r > cx && o.x - o.r < x1 && o.z + o.r > cz && o.z - o.r < z1,
        );
        const rects = (area.rects ?? []).filter(
          (r) => r.x + r.w / 2 > cx && r.x - r.w / 2 < x1 && r.z + r.d / 2 > cz && r.z - r.d / 2 < z1,
        );
        const tries = Math.round((x1 - cx) * (z1 - cz) * perM2);
        const matrices = new Float32Array(tries * 16);
        const colors = new Float32Array(tries * 4);
        let n = 0;
        let yMin = Infinity, yMax = -Infinity;
        for (let i = 0; i < tries; i++) {
          const x = cx + rnd() * (x1 - cx);
          const z = cz + rnd() * (z1 - cz);
          const keep = rnd();
          if (area.coverage && keep > area.coverage(x, z)) continue;
          if (circles.some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + 0.1) ** 2)) continue;
          if (rects.some((r) => Math.abs(x - r.x) < r.w / 2 + 0.1 && Math.abs(z - r.z) < r.d / 2 + 0.1)) continue;

          const h = 0.25 + rnd() * rnd() * 0.5;
          const w = 0.05 + rnd() * 0.04;
          scale.set(w, h, h);
          Quaternion.RotationYawPitchRollToRef(rnd() * Math.PI * 2, (rnd() - 0.5) * 0.35, (rnd() - 0.5) * 0.35, q);
          const y = heightAt(x, z);
          yMin = Math.min(yMin, y);
          yMax = Math.max(yMax, y);
          pos.set(x, y, z);
          Matrix.ComposeToRef(scale, q, pos, mat);
          mat.copyToArray(matrices, n * 16);

          // Лёгкий разброс оттенка и изредка сухие желтоватые травинки
          const dry = rnd() < 0.06;
          const k = 0.75 + rnd() * 0.4;
          colors.set(dry ? [1.25 * k, 1.1 * k, 0.6 * k, 1] : [k * (0.95 + rnd() * 0.1), k, k * (0.9 + rnd() * 0.15), 1], n * 4);
          n++;
        }
        if (n === 0) continue;

        // У каждого куска своя геометрия (7 вершин): буфер цветов экземпляров
        // Babylon хранит в геометрии, и у клонов он оказался бы общим
        const mesh = new Mesh(`grass-${cx}-${cz}`, this.scene);
        this.bladeData.applyToMesh(mesh);
        mesh.material = this.material;
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.thinInstanceSetBuffer('matrix', matrices.subarray(0, n * 16), 16, true);
        mesh.thinInstanceSetBuffer('color', colors.subarray(0, n * 4), 4, true);
        // Границы куска с запасом на наклон и ветер — для отсечения по камере
        mesh.doNotSyncBoundingInfo = true;
        mesh.setBoundingInfo(new BoundingInfo(new Vector3(cx - 0.6, yMin - 0.2, cz - 0.6), new Vector3(x1 + 0.6, yMax + 1, z1 + 0.6)));
        this.opts.glow?.addExcludedMesh(mesh);
        this.chunks.push({ mesh, x0: cx, z0: cz, x1, z1, full: n });
      }
    }
  }

  /**
   * Каждый кадр: прореживание по расстоянию от камеры, ветер, примятие.
   * @param bendAt позиция ног героя (y — высота над землёй) или null
   * @param bendRadius радиус примятия, м
   */
  update(cameraPos: Vector3, bendAt: Vector3 | null, bendRadius: number): void {
    if (this.chunks.length === 0) return;
    const maxDist = this.opts.fixedDistance ?? Math.min(settings.grassDist, settings.view);
    for (const c of this.chunks) {
      // Расстояние от камеры до ближайшей точки куска
      const dx = Math.max(c.x0 - cameraPos.x, 0, cameraPos.x - c.x1);
      const dz = Math.max(c.z0 - cameraPos.z, 0, cameraPos.z - c.z1);
      const d = Math.hypot(dx, dz);
      const visible = d < maxDist;
      if (c.mesh.isEnabled() !== visible) c.mesh.setEnabled(visible);
      if (!visible) continue;
      // Вблизи — вся трава, дальше плавно редеет до 20%. Порядок травинок случайный,
      // поэтому отбрасывание хвоста буфера прореживает кусок равномерно.
      const t = d / maxDist;
      const k = t < 0.35 ? 1 : 1 - ((t - 0.35) / 0.65) * 0.8;
      const count = Math.max(1, Math.round(c.full * k));
      if (c.mesh.thinInstanceCount !== count) c.mesh.thinInstanceCount = count;
    }

    const w = this.plugin.wind;
    const windOn = settings.grassWind;
    w[2] = windOn ? wind.strength : 0;
    w[3] = windOn ? (performance.now() / 1000) % 1000 : 0;
    const b = this.plugin.bend;
    if (bendAt && settings.grassBend) {
      b[0] = bendAt.x;
      b[1] = clamp(bendAt.y, 0, 10);
      b[2] = bendAt.z;
      b[3] = bendRadius;
    } else {
      b[3] = 0;
    }
  }
}
