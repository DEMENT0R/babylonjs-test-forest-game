// Рецепты уровней: первые восемь заданы вручную — так проще выстроить кривую сложности,
// дальше бесконечный режим, где параметры растут до потолка, а биом выбирается по сиду.

import { Rng } from '../rng';
import { BIOMES, type BiomeId } from './biomes';
import type { Quest } from './quests';

export interface LevelRecipe {
  /** Номер уровня, с 1. */
  index: number;
  seed: number;
  biome: BiomeId;
  /** Половина стороны игровой области, м. */
  half: number;
  crystals: number;
  /** Цепочек платформ; на вершине каждой — кристалл. */
  chains: number;
  /** Ступеней в цепочке, от и до. */
  steps: readonly [min: number, max: number];
  /** Доля кристаллов, спрятанных вплотную к камням и деревьям. */
  hidden: number;
  /** Дополнительных полян помимо центральной. */
  clearings: number;
  /** Множитель рельефа биома: первые уровни почти плоские. */
  relief: number;
  /** Задание на вторую звезду. */
  quest: Quest;
}

/** Доля кристаллов, после которой открывается портал. */
export const PORTAL_SHARE = 0.8;
export const CAMPAIGN_LENGTH = 8;

const CAMPAIGN: readonly Omit<LevelRecipe, 'index' | 'seed' | 'quest'>[] = [
  { biome: 'meadow', half: 42, crystals: 8, chains: 1, steps: [2, 2], hidden: 0, clearings: 2, relief: 0.35 },
  { biome: 'meadow', half: 50, crystals: 10, chains: 1, steps: [2, 3], hidden: 0.1, clearings: 3, relief: 0.6 },
  { biome: 'autumn', half: 55, crystals: 12, chains: 2, steps: [2, 3], hidden: 0.2, clearings: 3, relief: 0.8 },
  { biome: 'winter', half: 62, crystals: 13, chains: 2, steps: [3, 3], hidden: 0.3, clearings: 4, relief: 1 },
  { biome: 'rocky', half: 60, crystals: 14, chains: 3, steps: [3, 4], hidden: 0.3, clearings: 4, relief: 1 },
  { biome: 'night', half: 72, crystals: 16, chains: 3, steps: [3, 4], hidden: 0.4, clearings: 5, relief: 1.1 },
  { biome: 'lakes', half: 80, crystals: 18, chains: 3, steps: [3, 5], hidden: 0.45, clearings: 5, relief: 1.2 },
  { biome: 'rocky', half: 85, crystals: 20, chains: 4, steps: [4, 5], hidden: 0.5, clearings: 6, relief: 1.3 },
];

// Задания чередуются; лимиты времени с запасом на поиск кристаллов: задание про темп, а не про идеальный маршрут
const CAMPAIGN_QUESTS: readonly Quest[] = [
  { kind: 'time', limit: 150, intro: 'Солнце клонится к лесу — успей до заката' },
  { kind: 'walk', intro: 'Совы спят до вечера — не разбуди их топотом' },
  { kind: 'time', limit: 210, intro: 'Ветер метёт листву — поспеши, пока видна тропа' },
  { kind: 'jumps', spare: 6, intro: 'Снег глубокий — береги силы' },
  { kind: 'time', limit: 240, intro: 'Над скалами собирается гроза — успей до первых капель' },
  { kind: 'walk', intro: 'Ночью лес слышит каждый шаг — ступай тихо' },
  { kind: 'time', limit: 330, intro: 'Над озёрами поднимается туман — не задерживайся' },
  { kind: 'jumps', spare: 6, intro: 'Камни скользкие — прыгай только по делу' },
];

const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

export function recipeFor(index: number): LevelRecipe {
  const seed = 1000 + index * 7919;
  const base = CAMPAIGN[index - 1];
  if (base) return { ...base, index, seed, quest: CAMPAIGN_QUESTS[index - 1] };
  // Бесконечный режим: каждый следующий уровень немного больше, но с потолком
  const extra = index - CAMPAIGN_LENGTH;
  const rng = Rng.stream(seed, 'recipe');
  return {
    index,
    seed,
    biome: rng.pick(BIOME_IDS),
    half: Math.min(100, 70 + extra * 3 + rng.int(0, 10)),
    crystals: Math.min(26, 16 + extra),
    chains: Math.min(6, 3 + Math.floor(extra / 2)),
    steps: [3, Math.min(6, 4 + Math.floor(extra / 3))],
    hidden: Math.min(0.6, 0.4 + extra * 0.02),
    clearings: Math.min(8, 5 + Math.floor(extra / 2)),
    relief: Math.min(1.5, 1.2 + extra * 0.03),
    quest: rng.pick<Quest>([
      { kind: 'time', limit: Math.min(480, 360 + extra * 15), intro: 'Лес засыпает — успей до темноты' },
      { kind: 'walk', intro: 'В чаще дремлют звери — не беги' },
      { kind: 'jumps', spare: 6, intro: 'Тропа долгая — береги силы на прыжки' },
    ]),
  };
}

export function requiredCrystals(total: number): number {
  return Math.max(1, Math.ceil(total * PORTAL_SHARE));
}
