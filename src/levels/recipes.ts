// Рецепты уровней. Кампания — шесть регионов по шесть уровней (src/levels/regions.ts):
// биом задаёт регион, а размер и сложность плавно растут от первого уровня к последнему.
// Дальше — бесконечный «Дальний лес», где параметры растут до потолка, а биом выбирается по сиду.

import { Rng } from '../rng';
import { BIOMES, type BiomeId } from './biomes';
import type { Quest } from './quests';
import { CAMPAIGN_LENGTH, FINALE, regionOf, type SpecialKind } from './regions';

export { CAMPAIGN_LENGTH } from './regions';

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
  /** Особый уровень в конце региона. */
  special?: SpecialKind;
}

/** Доля кристаллов, после которой открывается портал. */
export const PORTAL_SHARE = 0.8;

type Shape = Omit<LevelRecipe, 'index' | 'seed' | 'quest' | 'biome'>;

/** Первый и последний уровень кампании; между ними параметры растут плавно. */
const FIRST: Shape = { half: 42, crystals: 8, chains: 1, steps: [2, 2], hidden: 0, clearings: 2, relief: 0.35 };
const LAST: Shape = { half: 85, crystals: 20, chains: 4, steps: [4, 5], hidden: 0.5, clearings: 6, relief: 1.3 };

/** Первые два уровня учат: успеть до заката и пройти шагом («Шагом» открывается к второму уровню). */
const OPENING_QUESTS: readonly Quest[] = [
  { kind: 'time', intro: 'Солнце клонится к лесу — успей до заката' },
  { kind: 'walk', intro: 'Совы спят до вечера — не разбуди их топотом' },
];

const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

export function recipeFor(index: number): LevelRecipe {
  const seed = 1000 + index * 7919;
  const place = regionOf(index);
  if (place) {
    // Сложность растёт быстрее в начале: первые регионы учат, последние — проверяют
    const t = Math.pow((index - 1) / (CAMPAIGN_LENGTH - 1), 0.8);
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const stepsMax = Math.round(lerp(FIRST.steps[1], LAST.steps[1]));
    const biome = place.region.biome;
    const recipe: LevelRecipe = {
      index,
      seed,
      biome,
      half: Math.round(lerp(FIRST.half, LAST.half)),
      crystals: Math.round(lerp(FIRST.crystals, LAST.crystals)),
      chains: Math.round(lerp(FIRST.chains, LAST.chains)),
      steps: [Math.min(stepsMax, Math.round(lerp(FIRST.steps[0], LAST.steps[0]))), stepsMax],
      hidden: +lerp(FIRST.hidden, LAST.hidden).toFixed(2),
      clearings: Math.round(lerp(FIRST.clearings, LAST.clearings)),
      relief: +lerp(FIRST.relief, LAST.relief).toFixed(2),
      quest: OPENING_QUESTS[index - 1] ?? campaignQuest(index, biome, seed),
    };
    if (!place.special) return recipe;
    const special = place.region.special;
    // «Собери всё» — на уровне поменьше и почти без спрятанных; подъём — одна высокая цепочка
    if (special === 'gather') return { ...recipe, special, half: Math.round(recipe.half * 0.75), hidden: recipe.hidden / 3 };
    if (special === 'ascent') return { ...recipe, special, chains: 1, steps: [9, 11] };
    return { ...recipe, special };
  }
  // Старый круг: тихая поляна, тропа к последней стоянке — без спешки
  if (index === FINALE) {
    return { ...LAST, index, seed, biome: 'meadow', special: 'finale', hidden: 0.2, quest: { kind: 'explore', intro: 'Здесь всё началось — обойди поляны' } };
  }
  // Дальний лес: каждый следующий уровень немного больше, но с потолком
  const extra = index - FINALE;
  const rng = Rng.stream(seed, 'recipe');
  const biome = rng.pick(BIOME_IDS);
  return {
    index,
    seed,
    biome,
    half: Math.min(100, LAST.half - 3 + extra * 2 + rng.int(0, 8)),
    crystals: Math.min(26, LAST.crystals + Math.floor(extra / 2)),
    chains: Math.min(6, LAST.chains + Math.floor(extra / 3)),
    steps: [LAST.steps[0] - 1, Math.min(6, LAST.steps[1] + Math.floor(extra / 4))],
    hidden: Math.min(0.6, LAST.hidden + extra * 0.01),
    clearings: Math.min(8, LAST.clearings + Math.floor(extra / 3)),
    relief: Math.min(1.5, LAST.relief + extra * 0.02),
    quest: maybeCombo(rng.pick(endlessQuests(biome)), seed),
  };
}

/** Задание уровня кампании: по сиду, но не такое же, как на предыдущем уровне. */
function campaignQuest(index: number, biome: BiomeId, seed: number): Quest {
  const pool = endlessQuests(biome);
  const prev = index > 1 ? recipeFor(index - 1).quest.kind : null;
  const rng = Rng.stream(seed, 'quest');
  let q = rng.pick(pool);
  // Серия — изредка и тоже не два раза подряд
  for (let t = 0; t < 8; t++) {
    q = rng.chance(COMBO_SHARE) ? COMBO_QUEST : rng.pick(pool);
    if (q.kind !== prev) break;
  }
  return q;
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
  return Rng.stream(seed, 'combo-quest').chance(COMBO_SHARE) ? COMBO_QUEST : quest;
}

const COMBO_QUEST: Quest = { kind: 'combo', intro: 'Кристаллы звенят в лад — собери их одним махом' };

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
