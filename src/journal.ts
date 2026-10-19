// Дневник игрока: находки на уровнях, отдельно от прогресса кампании, в localStorage.

import type { BiomeId } from './levels/biomes';

/** Оттенок редкого кристалла — у каждого биома свой. */
export interface Shade { name: string; color: readonly [r: number, g: number, b: number] }

export const SHADES: Record<BiomeId, Shade> = {
  meadow: { name: 'Изумрудный', color: [0.3, 1, 0.45] },
  autumn: { name: 'Рубиновый', color: [1, 0.25, 0.3] },
  rocky: { name: 'Аметистовый', color: [0.7, 0.4, 1] },
  winter: { name: 'Ледяной', color: [0.55, 0.9, 1] },
  night: { name: 'Лунный', color: [0.92, 0.95, 1] },
  lakes: { name: 'Бирюзовый', color: [0.15, 0.95, 0.8] },
};

/** Вероятность, что на уровне окажется редкий кристалл. */
export const RARE_CHANCE = 0.2;

interface Journal {
  /** Сколько редких кристаллов найдено в каждом биоме. */
  shades: Partial<Record<BiomeId, number>>;
}

const KEY = 'tihaya-polyana-journal';

function load(): Journal {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Journal> | null;
    if (j && typeof j === 'object') return { shades: j.shades ?? {} };
  } catch {
    // Повреждённые данные — дневник начинается заново
  }
  return { shades: {} };
}

export const journal: Journal = load();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(journal));
  } catch {
    // Хранилище недоступно — находки проживут до перезагрузки
  }
}

/** Записывает редкий кристалл биома; возвращает, сколько их теперь найдено в этом биоме. */
export function addShade(biome: BiomeId): number {
  const n = (journal.shades[biome] ?? 0) + 1;
  journal.shades[biome] = n;
  save();
  return n;
}
