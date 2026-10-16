// Биомы: палитра, небо и солнце, состав леса и травы. Механики у всех пока общие.

import { Color3 } from '@babylonjs/core';
import type { Relief } from './terrain';

export type BiomeId = 'meadow' | 'autumn' | 'rocky' | 'winter' | 'night' | 'lakes';
export type TreeKind = 'pine' | 'birch';

export interface Biome {
  id: BiomeId;
  name: string;
  sky: Color3;
  /** Базовая плотность тумана (делится на дальность прорисовки). */
  fogBase: number;
  sun: { dir: Vector; color: Color3; intensity: number };
  hemi: { intensity: number; ground: Color3 };
  ground: Color3;
  /** Утоптанная площадка вокруг каменного круга. */
  path: Color3;
  stone: Color3;
  grass: { root: Color3; tip: Color3; /** Множитель плотности из настроек. */ density: number };
  trees: {
    kind: TreeKind;
    /** Деревьев на 100 м² внутри уровня. */
    density: number;
    trunk: Color3;
    leaves: Color3[];
  };
  rocks: { density: number; color: Color3 };
  /** Рельеф при множителе уровня 1. */
  relief: Relief;
  ambience: Ambience;
  /** Земля под ногами вне камня и площадки — для звука шагов. */
  surface: 'grass' | 'snow';
  /** Частицы в воздухе. */
  particles?: 'snow' | 'fireflies';
  /** Ночь: ближайшие к герою кристаллы светят на округу. */
  crystalLights?: boolean;
  /** Вода в низинах: наибольший уровень относительно центра, цвет и сколько озёр прокопать. */
  water?: { level: number; color: Color3; lakes: number };
}

const QUIET: Ambience = { birds: 0, cuckoo: false, crickets: 0, frogs: 0, owls: 0, wind: 1 };

type Vector = readonly [x: number, y: number, z: number];

/** Звуковая атмосфера биома: частоты голосов (0 — нет, 1 — как в летнем лесу). */
export interface Ambience {
  birds: number;
  cuckoo: boolean;
  crickets: number;
  frogs: number;
  owls: number;
  /** Множитель силы ветра (звук и колыхание травы). */
  wind: number;
}

const rgb = (r: number, g: number, b: number) => new Color3(r, g, b);

export const BIOMES: Record<BiomeId, Biome> = {
  meadow: {
    id: 'meadow',
    name: 'Лесная поляна',
    sky: rgb(0.55, 0.72, 0.78),
    fogBase: 1.73,
    sun: { dir: [-0.5, -1, -0.35], color: rgb(1, 0.95, 0.85), intensity: 1.1 },
    hemi: { intensity: 0.75, ground: rgb(0.25, 0.3, 0.25) },
    ground: rgb(0.42, 0.6, 0.36),
    path: rgb(0.66, 0.58, 0.44),
    stone: rgb(0.62, 0.6, 0.56),
    grass: { root: rgb(0.23, 0.33, 0.2), tip: rgb(0.6, 0.8, 0.32), density: 1 },
    trees: {
      kind: 'pine',
      density: 0.75,
      trunk: rgb(0.4, 0.28, 0.18),
      leaves: [rgb(0.2, 0.45, 0.25), rgb(0.28, 0.52, 0.22), rgb(0.16, 0.38, 0.3)],
    },
    rocks: { density: 0.25, color: rgb(0.55, 0.55, 0.58) },
    relief: { amp: 2.4, scale: 38, border: 5 },
    ambience: { ...QUIET, birds: 1, cuckoo: true },
    surface: 'grass',
  },
  autumn: {
    id: 'autumn',
    name: 'Осенняя роща',
    sky: rgb(0.78, 0.72, 0.62),
    fogBase: 2.1,
    sun: { dir: [-0.8, -0.6, -0.2], color: rgb(1, 0.82, 0.6), intensity: 1.15 },
    hemi: { intensity: 0.7, ground: rgb(0.35, 0.28, 0.2) },
    ground: rgb(0.55, 0.55, 0.32),
    path: rgb(0.62, 0.5, 0.36),
    stone: rgb(0.6, 0.57, 0.52),
    grass: { root: rgb(0.44, 0.42, 0.24), tip: rgb(0.82, 0.72, 0.36), density: 0.7 },
    trees: {
      kind: 'birch',
      density: 0.9,
      trunk: rgb(0.88, 0.86, 0.8),
      leaves: [rgb(0.95, 0.62, 0.18), rgb(0.88, 0.42, 0.14), rgb(0.95, 0.8, 0.3), rgb(0.62, 0.5, 0.2)],
    },
    rocks: { density: 0.2, color: rgb(0.58, 0.54, 0.5) },
    relief: { amp: 3.4, scale: 32, border: 6 },
    ambience: { ...QUIET, birds: 0.7, wind: 1.15 },
    surface: 'grass',
  },
  rocky: {
    id: 'rocky',
    name: 'Каменное плато',
    sky: rgb(0.62, 0.7, 0.8),
    fogBase: 1.4,
    sun: { dir: [-0.3, -1, 0.5], color: rgb(1, 0.97, 0.92), intensity: 1.0 },
    hemi: { intensity: 0.65, ground: rgb(0.3, 0.3, 0.3) },
    ground: rgb(0.46, 0.52, 0.4),
    path: rgb(0.6, 0.58, 0.54),
    stone: rgb(0.58, 0.58, 0.6),
    grass: { root: rgb(0.24, 0.3, 0.22), tip: rgb(0.55, 0.68, 0.38), density: 0.4 },
    trees: {
      kind: 'pine',
      density: 0.3,
      trunk: rgb(0.36, 0.27, 0.2),
      leaves: [rgb(0.18, 0.36, 0.28), rgb(0.22, 0.42, 0.26)],
    },
    rocks: { density: 1.1, color: rgb(0.56, 0.56, 0.6) },
    relief: { amp: 4.6, scale: 30, ridged: true, border: 8 },
    ambience: { ...QUIET, birds: 0.5, wind: 1.3 },
    surface: 'grass',
  },
  winter: {
    id: 'winter',
    name: 'Зимний лес',
    sky: rgb(0.8, 0.84, 0.9),
    fogBase: 2.6,
    sun: { dir: [-0.6, -0.55, -0.4], color: rgb(0.95, 0.96, 1), intensity: 0.75 },
    hemi: { intensity: 0.7, ground: rgb(0.55, 0.58, 0.64) },
    ground: rgb(0.8, 0.83, 0.88),
    path: rgb(0.7, 0.72, 0.77),
    stone: rgb(0.56, 0.57, 0.62),
    // Сухая трава торчит из-под снега
    grass: { root: rgb(0.62, 0.6, 0.52), tip: rgb(0.74, 0.66, 0.44), density: 0.25 },
    trees: {
      kind: 'pine',
      density: 0.8,
      trunk: rgb(0.3, 0.24, 0.2),
      // Заснеженные ели
      leaves: [rgb(0.74, 0.8, 0.82), rgb(0.55, 0.66, 0.64), rgb(0.84, 0.88, 0.9)],
    },
    rocks: { density: 0.35, color: rgb(0.66, 0.68, 0.73) },
    relief: { amp: 3, scale: 34, border: 7 },
    ambience: { ...QUIET, birds: 0.2, wind: 1.4 },
    surface: 'snow',
    particles: 'snow',
  },
  night: {
    id: 'night',
    name: 'Ночной лес',
    sky: rgb(0.05, 0.07, 0.13),
    fogBase: 2.2,
    // «Солнце» — луна: холодный слабый свет
    sun: { dir: [-0.3, -1, 0.45], color: rgb(0.55, 0.66, 1), intensity: 0.4 },
    hemi: { intensity: 0.28, ground: rgb(0.04, 0.05, 0.09) },
    ground: rgb(0.24, 0.34, 0.28),
    path: rgb(0.36, 0.34, 0.31),
    stone: rgb(0.46, 0.48, 0.54),
    grass: { root: rgb(0.1, 0.17, 0.12), tip: rgb(0.32, 0.48, 0.32), density: 0.9 },
    trees: {
      kind: 'pine',
      density: 0.85,
      trunk: rgb(0.3, 0.22, 0.17),
      leaves: [rgb(0.14, 0.3, 0.24), rgb(0.18, 0.36, 0.22), rgb(0.12, 0.26, 0.26)],
    },
    rocks: { density: 0.3, color: rgb(0.5, 0.52, 0.58) },
    relief: { amp: 2.6, scale: 36, border: 6 },
    ambience: { ...QUIET, crickets: 1, owls: 1, wind: 0.7 },
    surface: 'grass',
    particles: 'fireflies',
    crystalLights: true,
  },
  lakes: {
    id: 'lakes',
    name: 'Озёрный край',
    sky: rgb(0.62, 0.74, 0.76),
    fogBase: 2.3,
    sun: { dir: [-0.4, -0.9, -0.5], color: rgb(1, 0.96, 0.86), intensity: 1.05 },
    hemi: { intensity: 0.75, ground: rgb(0.24, 0.32, 0.28) },
    ground: rgb(0.38, 0.56, 0.36),
    path: rgb(0.62, 0.57, 0.46),
    stone: rgb(0.58, 0.6, 0.58),
    grass: { root: rgb(0.2, 0.34, 0.2), tip: rgb(0.55, 0.78, 0.36), density: 1.1 },
    // Летние берёзы с зелёными кронами
    trees: {
      kind: 'birch',
      density: 0.7,
      trunk: rgb(0.86, 0.85, 0.8),
      leaves: [rgb(0.36, 0.6, 0.26), rgb(0.44, 0.66, 0.3), rgb(0.3, 0.52, 0.28)],
    },
    rocks: { density: 0.3, color: rgb(0.52, 0.55, 0.55) },
    relief: { amp: 2.6, scale: 30, border: 6 },
    ambience: { ...QUIET, birds: 0.6, frogs: 1, wind: 0.9 },
    surface: 'grass',
    water: { level: -0.6, color: rgb(0.24, 0.42, 0.46), lakes: 4 },
  },
};
