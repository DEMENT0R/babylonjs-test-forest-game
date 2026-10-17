// Настройки графики и управления: пресеты, сохранение в localStorage,
// тени и пост-обработка для каждой сцены (сцена выбора героя и игровая сцена).

import {
  Color4,
  DefaultRenderingPipeline,
  ImageProcessingConfiguration,
  Scene,
  SSAO2RenderingPipeline,
  ShadowGenerator,
  type AbstractMesh,
  type Camera,
  type DirectionalLight,
  type Engine,
  type GlowLayer,
} from '@babylonjs/core';

export type ShadowMode = 'off' | 'hard' | 'soft' | 'pcf';
export type AntiAliasing = 'off' | 'fxaa' | 'msaa';
/** Доля пикселей экрана или 'dpr' — родное разрешение (Retina). */
export type RenderScale = number | 'dpr';
export type PresetId = 'low' | 'medium' | 'high' | 'ultra';
export type GrassDensity = 'off' | 'sparse' | 'normal' | 'dense';

export interface GraphicsSettings {
  scale: RenderScale;
  shadows: ShadowMode;
  shadowRes: number;
  shadowDist: number;
  aa: AntiAliasing;
  bloom: boolean;
  glow: boolean;
  tone: boolean;
  vignette: boolean;
  ssao: boolean;
  fog: boolean;
  /** Дальность прорисовки в метрах. */
  view: number;
  grass: GrassDensity;
  /** Дальность травы, м (не больше дальности прорисовки). */
  grassDist: number;
  grassWind: boolean;
  grassBend: boolean;
  /** Снегопад и светлячки. */
  particles: boolean;
}

export interface Settings extends GraphicsSettings {
  preset: PresetId | 'custom';
  /** Поле зрения в градусах. */
  fov: number;
  sens: number;
  /** Чувствительность правого стика геймпада. */
  padSens: number;
  invertY: boolean;
  /** Сенсорный стик: на своём месте или появляется под пальцем в левой части экрана. */
  stick: 'float' | 'fixed';
  fps: boolean;
  /** Памятка по кнопкам: раскрыта на первом уровне, всегда или всегда свёрнута. */
  keyHint: 'first' | 'open' | 'closed';
  /** Звук включён (клавиша M). */
  sound: boolean;
  /** Громкость 0…1: общая, шагов, природы (ветер, птицы) и фоновой музыки. */
  volume: number;
  stepsVolume: number;
  natureVolume: number;
  musicVolume: number;
}

export const PRESETS: Record<PresetId, GraphicsSettings> = {
  low:    { scale: 0.6,   shadows: 'off',  shadowRes: 512,  shadowDist: 30, aa: 'off',  bloom: false, glow: false, tone: false, vignette: false, ssao: false, fog: true, view: 70,
            grass: 'off',    grassDist: 30, grassWind: false, grassBend: false, particles: false },
  medium: { scale: 0.8,   shadows: 'hard', shadowRes: 1024, shadowDist: 40, aa: 'fxaa', bloom: false, glow: true,  tone: true,  vignette: false, ssao: false, fog: true, view: 100,
            grass: 'sparse', grassDist: 35, grassWind: true,  grassBend: true,  particles: true },
  high:   { scale: 1,     shadows: 'soft', shadowRes: 2048, shadowDist: 50, aa: 'fxaa', bloom: true,  glow: true,  tone: true,  vignette: true,  ssao: false, fog: true, view: 140,
            grass: 'normal', grassDist: 50, grassWind: true,  grassBend: true,  particles: true },
  ultra:  { scale: 'dpr', shadows: 'pcf',  shadowRes: 4096, shadowDist: 70, aa: 'msaa', bloom: true,  glow: true,  tone: true,  vignette: true,  ssao: true,  fog: true, view: 200,
            grass: 'dense',  grassDist: 70, grassWind: true,  grassBend: true,  particles: true },
};

const DEFAULTS: Settings = {
  preset: 'high', ...PRESETS.high, fov: 60, sens: 1, padSens: 1, invertY: false, stick: 'float', fps: false, keyHint: 'first',
  sound: true, volume: 0.8, stepsVolume: 0.8, natureVolume: 0.6, musicVolume: 0.5,
};
const STORAGE_KEY = 'tihaya-polyana-settings';

/** Текущие настройки. Объект живёт всё время работы игры, меняется на месте. */
export const settings: Settings = loadSettings();

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Settings> | null;
    if (saved && typeof saved === 'object') return { ...DEFAULTS, ...saved };
  } catch {
    // Повреждённые данные или запрещённое хранилище — просто берём значения по умолчанию
  }
  return { ...DEFAULTS };
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Приватный режим или квота — настройки просто не переживут перезагрузку
  }
}

export function applyPreset(id: PresetId): void {
  Object.assign(settings, PRESETS[id], { preset: id });
}

// ---------- Освещение сцен ----------

/**
 * Контекст освещения сцены: солнце, генератор теней (пересоздаётся при смене
 * настроек), пайплайн пост-обработки, свечение.
 */
export interface LightingContext {
  readonly scene: Scene;
  readonly sun: DirectionalLight;
  readonly camera: Camera;
  /** Фиксированный размер области теней; без него берётся settings.shadowDist. */
  readonly shadowFrustum?: number;
  readonly allowSsao: boolean;
  /** Базовая плотность тумана (делится на дальность прорисовки); меняется вместе с биомом. */
  fogBase: number;
  /** Фиксированная дальняя плоскость камеры; без неё — дальность прорисовки + 20 м. */
  readonly fixedMaxZ?: number;
  glow: GlowLayer | null;
  casters: AbstractMesh[];
  shadowGen: ShadowGenerator | null;
  pipeline: DefaultRenderingPipeline | null;
  ssao: SSAO2RenderingPipeline | null;
  /** Графические настройки, под которые контекст собран последний раз. */
  builtFor: string | null;
}

export interface LightingOptions {
  scene: Scene;
  sun: DirectionalLight;
  camera: Camera;
  shadowFrustum?: number;
  allowSsao?: boolean;
  fogBase?: number;
  fixedMaxZ?: number;
}

const contexts: LightingContext[] = [];

export function createLightingContext(o: LightingOptions): LightingContext {
  const ctx: LightingContext = {
    scene: o.scene,
    sun: o.sun,
    camera: o.camera,
    shadowFrustum: o.shadowFrustum,
    allowSsao: o.allowSsao ?? false,
    fogBase: o.fogBase ?? 1.73,
    fixedMaxZ: o.fixedMaxZ,
    glow: null,
    casters: [],
    shadowGen: null,
    pipeline: null,
    ssao: null,
    builtFor: null,
  };
  contexts.push(ctx);
  return ctx;
}

export function addShadowCaster(ctx: LightingContext, mesh: AbstractMesh): void {
  ctx.casters.push(mesh);
  ctx.shadowGen?.addShadowCaster(mesh, false);
}

function buildShadows(ctx: LightingContext): void {
  ctx.shadowGen?.dispose();
  ctx.shadowGen = null;
  ctx.casters = ctx.casters.filter((m) => !m.isDisposed());
  ctx.sun.shadowEnabled = settings.shadows !== 'off';
  if (settings.shadows === 'off') return;

  const g = new ShadowGenerator(settings.shadowRes, ctx.sun);
  g.darkness = 0.35;
  g.bias = 0.0008;
  g.normalBias = 0.02;
  if (settings.shadows === 'soft') {
    g.useBlurExponentialShadowMap = true;
    g.blurKernel = Math.max(8, settings.shadowRes / 128);
    g.depthScale = 60;
  } else if (settings.shadows === 'pcf') {
    g.usePercentageCloserFiltering = true;
    g.filteringQuality = ShadowGenerator.QUALITY_HIGH;
  }
  ctx.sun.shadowFrustumSize = ctx.shadowFrustum ?? settings.shadowDist;
  ctx.sun.shadowMinZ = 1;
  ctx.sun.shadowMaxZ = 160;
  for (const m of ctx.casters) g.addShadowCaster(m, false);
  ctx.shadowGen = g;
}

function buildPipeline(ctx: LightingContext, engine: Engine): void {
  if (!ctx.pipeline) {
    const p = new DefaultRenderingPipeline(`dp${contexts.indexOf(ctx)}`, true, ctx.scene, [ctx.camera]);
    p.imageProcessingEnabled = true;
    p.bloomThreshold = 0.75;
    p.bloomWeight = 0.3;
    p.bloomKernel = 48;
    p.bloomScale = 0.5;
    ctx.pipeline = p;
  }
  const p = ctx.pipeline;
  const ip = p.imageProcessing;
  p.fxaaEnabled = settings.aa === 'fxaa';
  p.samples = settings.aa === 'msaa' && engine.webGLVersion > 1 ? 4 : 1;
  p.bloomEnabled = settings.bloom;
  ip.toneMappingEnabled = settings.tone;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = settings.tone ? 1.15 : 1;
  ip.contrast = settings.tone ? 1.05 : 1;
  ip.vignetteEnabled = settings.vignette;
  ip.vignetteWeight = 1.4;
  ip.vignetteColor = new Color4(0, 0, 0, 0);
  if (ctx.glow) ctx.glow.isEnabled = settings.glow;

  // Ambient occlusion — только для игровой сцены
  if (ctx.allowSsao) {
    const want = settings.ssao && SSAO2RenderingPipeline.IsSupported;
    if (want && !ctx.ssao) {
      try {
        const s = new SSAO2RenderingPipeline('ssao', ctx.scene, { ssaoRatio: 0.5, blurRatio: 1 }, [ctx.camera]);
        s.radius = 1.2;
        s.totalStrength = 1.1;
        s.samples = 16;
        s.maxZ = 60;
        ctx.ssao = s;
      } catch (e) {
        console.warn(e);
        ctx.ssao = null;
      }
    } else if (!want && ctx.ssao) {
      ctx.ssao.dispose();
      ctx.ssao = null;
    }
  }

  const scene = ctx.scene;
  scene.fogMode = settings.fog ? Scene.FOGMODE_EXP2 : Scene.FOGMODE_NONE;
  scene.fogDensity = ctx.fogBase / settings.view;
  ctx.camera.maxZ = ctx.fixedMaxZ ?? settings.view + 20;
}

// ---------- Применение ----------

type Listener = (s: Readonly<Settings>) => void;
const listeners: Listener[] = [];

/** Подписка на применение настроек (FOV камеры, FPS-счётчик, «пятно» тени и т. п.). */
export function onSettingsApplied(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Пересобрать тени и туман одной сцены — после смены уровня или биома. */
export function refreshLighting(ctx: LightingContext, engine: Engine): void {
  buildShadows(ctx);
  buildPipeline(ctx, engine);
}

// Трава и частицы пересобираются сами — их настройки не трогают тени и пост-обработку
const GRAPHICS_KEYS = (Object.keys(PRESETS.high) as (keyof GraphicsSettings)[]).filter((k) => !k.startsWith('grass') && k !== 'particles');

/**
 * Применяет текущие настройки ко всем сценам и сохраняет их.
 * Тени и пост-обработка пересобираются, только если изменилась графика, —
 * громкость, FOV и прочее применяются мгновенно.
 */
export function applySettings(engine: Engine): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const scale = settings.scale === 'dpr' ? dpr : settings.scale;
  engine.setHardwareScalingLevel(1 / scale);
  const graphics = JSON.stringify(GRAPHICS_KEYS.map((k) => settings[k]));
  for (const ctx of contexts) {
    if (ctx.builtFor === graphics) continue;
    buildShadows(ctx);
    buildPipeline(ctx, engine);
    ctx.builtFor = graphics;
  }
  for (const fn of listeners) fn(settings);
  saveSettings();
}
