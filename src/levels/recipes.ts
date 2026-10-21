// Рецепты уровней: первые восемь заданы вручную — так проще выстроить кривую сложности,
// дальше бесконечный режим, где параметры растут до потолка, а биом выбирается по сиду.

import { Rng } from '../rng';
import { BIOMES, type BiomeId } from './biomes';
import type { Quest } from './quests';

export interface LevelRecipe {
  /** Номер уровня, с 1; 0 — «Лес дня». */
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

// У каждого уровня кампании своё задание; лимиты времени и прыжков считаются по раскладке уровня
const CAMPAIGN_QUESTS: readonly Quest[] = [
  { kind: 'time', intro: 'Солнце клонится к лесу — успей до заката' },
  { kind: 'walk', intro: 'Совы спят до вечера — не разбуди их топотом' },
  { kind: 'hop', intro: 'Опавшие листья пружинят — скачи, не останавливаясь' },
  { kind: 'jumps', intro: 'Снег глубокий — береги силы' },
  { kind: 'hidden', intro: 'Кристаллы попрятались за камнями и деревьями' },
  { kind: 'tops', intro: 'С вершин видно светлячков' },
  { kind: 'swim', intro: 'Вода в озёрах тёплая' },
  { kind: 'explore', intro: 'Кто-то оставил следы на полянах' },
];

const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

export function recipeFor(index: number): LevelRecipe {
  const seed = 1000 + index * 7919;
  const base = CAMPAIGN[index - 1];
  if (base) return { ...base, index, seed, quest: CAMPAIGN_QUESTS[index - 1] };
  // Бесконечный режим: каждый следующий уровень немного больше, но с потолком
  const extra = index - CAMPAIGN_LENGTH;
  const rng = Rng.stream(seed, 'recipe');
  const biome = rng.pick(BIOME_IDS);
  return {
    index,
    seed,
    biome,
    half: Math.min(100, 70 + extra * 3 + rng.int(0, 10)),
    crystals: Math.min(26, 16 + extra),
    chains: Math.min(6, 3 + Math.floor(extra / 2)),
    steps: [3, Math.min(6, 4 + Math.floor(extra / 3))],
    hidden: Math.min(0.6, 0.4 + extra * 0.02),
    clearings: Math.min(8, 5 + Math.floor(extra / 2)),
    relief: Math.min(1.5, 1.2 + extra * 0.03),
    quest: maybeCombo(rng.pick(endlessQuests(biome)), seed),
  };
}

/**
 * «Лес дня»: сид из даты, поэтому в один день у всех одна и та же раскладка.
 * Размер и сложность — как в начале бесконечного режима.
 */
export function dailyRecipe(date: string): LevelRecipe {
  let seed = 0;
  for (let i = 0; i < date.length; i++) seed = (Math.imul(seed, 31) + date.charCodeAt(i)) >>> 0;
  const rng = Rng.stream(seed, 'daily');
  const biome = rng.pick(BIOME_IDS);
  return {
    index: 0,
    seed,
    biome,
    half: 68 + rng.int(0, 10),
    crystals: 16,
    chains: 3,
    steps: [3, 4],
    hidden: 0.4,
    clearings: 5,
    relief: 1.1,
    quest: maybeCombo(rng.pick(endlessQuests(biome)), seed),
  };
}

/** Доля уровней бесконечного режима и Лесов дня с заданием на серию. */
const COMBO_SHARE = 1 / 8;

/**
 * Изредка задание на серию вместо выпавшего. Своя ветка случайности — список заданий
 * не меняется, и прочие уровни и Леса дня остаются с теми же заданиями, что были.
 */
function maybeCombo(quest: Quest, seed: number): Quest {
  if (!Rng.stream(seed, 'combo-quest').chance(COMBO_SHARE)) return quest;
  return { kind: 'combo', intro: 'Кристаллы звенят в лад — собери их одним махом' };
}

/** Задания бесконечного режима; про озёра — только там, где есть вода. */
function endlessQuests(biome: BiomeId): Quest[] {
  const quests: Quest[] = [
    { kind: 'time', intro: 'Лес засыпает — успей до темноты' },
    { kind: 'walk', intro: 'В чаще дремлют звери — не беги' },
    { kind: 'jumps', intro: 'Тропа долгая — береги силы на прыжки' },
    { kind: 'hop', intro: 'Земля холодная — скачи, не останавливаясь' },
    { kind: 'tops', intro: 'С вершин виден весь лес' },
    { kind: 'hidden', intro: 'Кристаллы попрятались' },
    { kind: 'explore', intro: 'Обойди все поляны' },
  ];
  if (BIOMES[biome].water) {
    quests.push({ kind: 'swim', intro: 'Вода в озёрах тёплая' }, { kind: 'dry', intro: 'Вода ледяная — обходи озёра' });
  }
  return quests;
}

export function requiredCrystals(total: number): number {
  return Math.max(1, Math.ceil(total * PORTAL_SHARE));
}
