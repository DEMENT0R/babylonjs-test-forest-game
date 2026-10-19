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

/** Записки путника, который прошёл лес раньше героя; находятся по порядку. */
export const NOTES: readonly string[] = [
  'Если ты это читаешь — ты тоже слышишь, как звенят кристаллы. Иди на звон.',
  'Каменный круг старше леса. Деревья выросли вокруг него, а не наоборот.',
  'Портал не любит спешки, но и не ждёт вечно. Восемь из десяти кристаллов — его цена.',
  'Сегодня видел лису. Она нашла кристалл быстрее меня и даже не оглянулась.',
  'Осенью кристаллы светят теплее. Или мне так кажется, потому что холодно.',
  'Ночью звёзды над лесом складываются в фигуры. Каждый раз, когда я прохожу круг, их становится больше.',
  'Волк не отходил от меня весь день. Кажется, он тоже ищет дорогу домой.',
  'В озёрах вода тёплая, будто снизу её греет что-то светлое.',
  'На плато ветер такой, что слышно, как поют камни.',
  'Олень прыгнул на уступ, куда я не смог бы забраться и с лестницей.',
  'Снег скрипит под ногами. Иногда кажется, что кто-то идёт следом — но это только эхо.',
  'Я оставляю эти камни тем, кто придёт после. Лес большой, но в нём никогда не бываешь один.',
];

/** Вероятность, что на уровне лежит камень с запиской (пока не все найдены). */
export const NOTE_CHANCE = 0.35;

/** Счётчики за всё время игры. */
export interface Stats {
  /** Пройдено, м (по горизонтали). */
  distance: number;
  jumps: number;
  crystals: number;
  /** Пройдено уровней, вместе с «Лесом дня». */
  levels: number;
  /** Время в лесу, с. */
  time: number;
}

interface Journal {
  /** Сколько редких кристаллов найдено в каждом биоме. */
  shades: Partial<Record<BiomeId, number>>;
  /** Сколько записок найдено — они идут по порядку. */
  notes: number;
  stats: Stats;
}

const emptyStats = (): Stats => ({ distance: 0, jumps: 0, crystals: 0, levels: 0, time: 0 });

const KEY = 'tihaya-polyana-journal';

function load(): Journal {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Journal> | null;
    if (j && typeof j === 'object') {
      return { shades: j.shades ?? {}, notes: Math.min(NOTES.length, j.notes ?? 0), stats: { ...emptyStats(), ...j.stats } };
    }
  } catch {
    // Повреждённые данные — дневник начинается заново
  }
  return { shades: {}, notes: 0, stats: emptyStats() };
}

export const journal: Journal = load();

/** Счётчики копятся в памяти каждый кадр, а на диск — по этому вызову (итог уровня, меню). */
export function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(journal));
  } catch {
    // Хранилище недоступно — находки проживут до перезагрузки
  }
}

/** Записка найдена; возвращает её текст. */
export function addNote(): string {
  const text = NOTES[journal.notes];
  journal.notes = Math.min(NOTES.length, journal.notes + 1);
  save();
  return text;
}

/** Записывает редкий кристалл биома; возвращает, сколько их теперь найдено в этом биоме. */
export function addShade(biome: BiomeId): number {
  const n = (journal.shades[biome] ?? 0) + 1;
  journal.shades[biome] = n;
  save();
  return n;
}
