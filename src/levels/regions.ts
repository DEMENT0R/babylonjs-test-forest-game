// Регионы кампании: шесть лесов подряд, в каждом пять обычных уровней и шестой — особый.
// Номер уровня сквозной (1..36): прогресс хранится по нему, регион вычисляется.
// После последнего региона кампания продолжается бесконечным «Дальним лесом».

import type { BiomeId } from './biomes';

export interface Region {
  id: string;
  name: string;
  biome: BiomeId;
  /** Слова путника на заставке, когда начинается этот лес. */
  intro: string;
}

export const REGIONS: readonly Region[] = [
  { id: 'edge', name: 'Опушка', biome: 'meadow', intro: 'Здесь начинается лес. Иди на звон — кристаллы покажут дорогу.' },
  { id: 'grove', name: 'Осенняя роща', biome: 'autumn', intro: 'Листья в роще шуршат, как страницы. Я прочёл бы их все, если бы умел.' },
  { id: 'pass', name: 'Зимний перевал', biome: 'winter', intro: 'На перевале холодно, но порталы горят ярче. Не стой на месте.' },
  { id: 'plateau', name: 'Каменное плато', biome: 'rocky', intro: 'Камни на плато помнят всех, кто шёл раньше. Прислушайся.' },
  { id: 'nightwood', name: 'Ночной лес', biome: 'night', intro: 'Ночью лес честнее: видно только то, что светится само.' },
  { id: 'lakeland', name: 'Озёрный край', biome: 'lakes', intro: 'За озёрами — Старый круг. Я почти дошёл. Догоняй.' },
];

/** Уровней в регионе: пять обычных и последний — особый. */
export const REGION_LEVELS = 6;
export const CAMPAIGN_LENGTH = REGIONS.length * REGION_LEVELS;
/** Как зовётся бесконечный режим после кампании. */
export const FAR_FOREST = 'Дальний лес';

/** Где уровень в кампании: регион, номер в нём с нуля и особый ли; null — уже Дальний лес. */
export function regionOf(index: number): { region: Region; n: number; special: boolean } | null {
  if (index < 1 || index > CAMPAIGN_LENGTH) return null;
  const n = (index - 1) % REGION_LEVELS;
  return { region: REGIONS[Math.floor((index - 1) / REGION_LEVELS)], n, special: n === REGION_LEVELS - 1 };
}

/** Подпись места: «Осенняя роща · 3 из 6» или «Дальний лес». */
export function placeName(index: number): string {
  const r = regionOf(index);
  return r ? `${r.region.name} · ${r.n + 1} из ${REGION_LEVELS}` : FAR_FOREST;
}
