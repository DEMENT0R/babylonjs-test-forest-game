// Биомы: палитра, небо и солнце, состав леса и травы. Механики у всех пока общие.

import { Color3 } from '@babylonjs/core';

export type BiomeId = 'meadow' | 'autumn' | 'rocky';
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
}

type Vector = readonly [x: number, y: number, z: number];

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
  },
  rocky: {
    id: 'rocky',
    name: 'Каменное плато',
    sky: rgb(0.62, 0.7, 0.8),
    fogBase: 1.4,
    sun: { dir: [-0.3, -1, 0.5], color: rgb(1, 0.97, 0.92), intensity: 1.2 },
    hemi: { intensity: 0.8, ground: rgb(0.3, 0.3, 0.3) },
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
  },
};
