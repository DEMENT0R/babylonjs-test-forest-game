// Регионы кампании: шесть лесов подряд, в каждом пять обычных уровней и шестой — особый.
// Номер уровня сквозной (1..36): прогресс хранится по нему, регион вычисляется.
// После последнего региона кампания продолжается бесконечным «Дальним лесом».

import type { BiomeId } from './biomes';

/**
 * Особый уровень в конце региона. trail — тропа огоньков от старта к стоянке путника,
 * кристаллы вдоль неё; gather — уровень меньше, но портал открывается только за все кристаллы;
 * ascent — одна огромная цепочка платформ, кристаллы на ступенях по пути вверх;
 * night — свет биома приглушён, путь освещает фонарь героя, и чем больше собрано, тем он ярче.
 */
export type SpecialKind = 'trail' | 'gather' | 'ascent' | 'night' | 'finale';

/** Что сказать об особом уровне в начале. */
export const SPECIAL_INTRO: Record<SpecialKind, string> = {
  trail: 'Особый уровень: огоньки ведут к стоянке путника',
  gather: 'Особый уровень: портал откроется, только когда соберёшь все кристаллы',
  ascent: 'Особый уровень: одна высокая лестница до самого неба — кристаллы на ступенях',
  night: 'Особый уровень: темно — каждый собранный кристалл делает твой фонарь ярче',
  finale: 'Старый круг: огоньки ведут к последней стоянке путника',
};

export interface Region {
  id: string;
  name: string;
  biome: BiomeId;
  /** Слова путника на заставке, когда начинается этот лес. */
  intro: string;
  /** Каким будет шестой, особый уровень. */
  special: SpecialKind;
}

export const REGIONS: readonly Region[] = [
  { id: 'edge', name: 'Опушка', biome: 'meadow', intro: 'Здесь начинается лес. Иди на звон — кристаллы покажут дорогу.', special: 'trail' },
  { id: 'grove', name: 'Осенняя роща', biome: 'autumn', intro: 'Листья в роще шуршат, как страницы. Я прочёл бы их все, если бы умел.', special: 'gather' },
  { id: 'pass', name: 'Зимний перевал', biome: 'winter', intro: 'На перевале холодно, но порталы горят ярче. Не стой на месте.', special: 'trail' },
  { id: 'plateau', name: 'Каменное плато', biome: 'rocky', intro: 'Камни на плато помнят всех, кто шёл раньше. Прислушайся.', special: 'ascent' },
  { id: 'nightwood', name: 'Ночной лес', biome: 'night', intro: 'Ночью лес честнее: видно только то, что светится само.', special: 'night' },
  { id: 'lakeland', name: 'Озёрный край', biome: 'lakes', intro: 'За озёрами — Старый круг. Я почти дошёл. Догоняй.', special: 'gather' },
];

/** Уровней в регионе: пять обычных и последний — особый. */
export const REGION_LEVELS = 6;
export const CAMPAIGN_LENGTH = REGIONS.length * REGION_LEVELS;
/** Как зовётся бесконечный режим после кампании. */
export const FAR_FOREST = 'Дальний лес';
/** Финал — уровень сразу после последнего региона: Старый круг, где путник оставил последнюю записку. */
export const FINALE = CAMPAIGN_LENGTH + 1;
export const FINALE_NAME = 'Старый круг';

/** Где уровень в кампании: регион, номер в нём с нуля и особый ли; null — уже Дальний лес. */
export function regionOf(index: number): { region: Region; n: number; special: boolean } | null {
  if (index < 1 || index > CAMPAIGN_LENGTH) return null;
  const n = (index - 1) % REGION_LEVELS;
  return { region: REGIONS[Math.floor((index - 1) / REGION_LEVELS)], n, special: n === REGION_LEVELS - 1 };
}

/** Подпись места: «Осенняя роща · 3 из 6» или «Дальний лес». */
export function placeName(index: number): string {
  const r = regionOf(index);
  return r ? `${r.region.name} · ${r.n + 1} из ${REGION_LEVELS}` : index === FINALE ? FINALE_NAME : FAR_FOREST;
}
