// Дневник игрока: находки на уровнях, отдельно от прогресса кампании, в localStorage.

import type { BiomeId } from './levels/biomes';
import type { SecretKind } from './levels/generator';

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

/**
 * Записки у стоянок путника — по одной в конце каждого региона, на его особом уровне.
 * Длинные: это сюжет. В общем счёте записок идут после NOTES.
 */
export const CAMP_NOTES: readonly string[] = [
  'Здесь я ночевал впервые за много лет. Порталы гаснут — один за другим, как свечи на ветру. Я хранитель каменного круга, вернее, был им. Если круги погаснут совсем, лес распадётся на отдельные поляны, и между ними не останется дорог. Я иду их зажечь.',
  'В роще я понял, что кто-то идёт за мной. Порталы, которые я зажигаю, кто-то проходит следом — и они горят ярче. Спасибо тебе, кто бы ты ни был.',
  'Холодно. Пальцы не слушаются, поэтому коротко. Каждый кристалл — капля света, которую лес отдаёт сам. Мы не забираем его. Мы просто несём свет от поляны к поляне.',
  'Камни на плато поют старую песню. В ней говорится, что хранитель не выбирает себя сам. Его выбирает лес — того, кто пройдёт весь путь до Старого круга.',
  'Ночью я видел, как звёзды над лесом складываются в фигуры. Это не звёзды. Это все, кто шёл этой дорогой до нас. Однажды и мы станем такими звёздами.',
  'Старый круг за озёрами. Чувствую, что дальше не пойду: ноги уже не те. Но ты дойдёшь. Последнюю записку я оставлю у круга. Не торопись — портал не любит спешки, но и не ждёт вечно.',
];

/** Все записки: сначала с полян (NOTES), потом у стоянок (CAMP_NOTES) — номер в этом общем списке. */
export const NOTE_TOTAL = NOTES.length + CAMP_NOTES.length;
export const noteText = (id: number): string => (id < NOTES.length ? NOTES[id] : CAMP_NOTES[id - NOTES.length]);
/** Записка у стоянки региона k. */
export const campNote = (k: number): number => NOTES.length + k;

/**
 * Записки с полян по регионам: по две на каждый лес, номера в NOTES.
 * Порядок внутри NOTES прежний — по нему переводятся старые сохранения.
 */
export const REGION_NOTES: readonly (readonly number[])[] = [[0, 1], [4, 3], [10, 6], [8, 9], [5, 2], [7, 11]];

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
  /** Самая длинная серия быстро собранных кристаллов. */
  bestCombo: number;
  /** Раскрыто тайников, вместе с повторными на перепройденных уровнях. */
  secrets: number;
}

/** Сад у норы: кристалл вырастает раз в GARDEN_GROW_MS реального времени, не больше GARDEN_CAP. */
export const GARDEN_CAP = 3;
export const GARDEN_GROW_MS = 3 * 3600_000;

interface Journal {
  /** Сколько редких кристаллов найдено в каждом биоме. */
  shades: Partial<Record<BiomeId, number>>;
  /** Прочитанные записки — номера в общем списке (noteText). */
  notesRead: number[];
  stats: Stats;
  /** Сад: с какого момента растёт следующий кристалл (мс) и сколько уже выросло. */
  garden: { since: number; ready: number };
  /** Когда игра последний раз сохраняла дневник, мс — по нему видно, долго ли игрока не было. */
  seen?: number;
  /** Заработанные достижения (id). */
  badges: string[];
  /** Атлас тайн: какие виды тайников уже раскрыты в каждом биоме. */
  atlas: Partial<Record<BiomeId, SecretKind[]>>;
}

const emptyStats = (): Stats => ({ distance: 0, jumps: 0, crystals: 0, levels: 0, time: 0, bestCombo: 0, secrets: 0 });

const KEY = 'tihaya-polyana-journal';

function load(): Journal {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Journal> | null;
    if (j && typeof j === 'object') {
      return {
        shades: j.shades ?? {},
        // Раньше записки шли по порядку и хранился только их счёт
        notesRead: Array.isArray(j.notesRead)
          ? j.notesRead.filter((n) => Number.isInteger(n) && n >= 0 && n < NOTE_TOTAL)
          : Array.from({ length: Math.min(NOTES.length, (j as { notes?: number }).notes ?? 0) }, (_, i) => i),
        stats: { ...emptyStats(), ...j.stats },
        garden: j.garden ?? { since: Date.now(), ready: 0 },
        seen: j.seen,
        badges: Array.isArray(j.badges) ? j.badges : [],
        atlas: j.atlas && typeof j.atlas === 'object' ? j.atlas : {},
      };
    }
  } catch {
    // Повреждённые данные — дневник начинается заново
  }
  return { shades: {}, notesRead: [], stats: emptyStats(), garden: { since: Date.now(), ready: 0 }, badges: [], atlas: {} };
}

export const journal: Journal = load();

/** После такого перерыва следующая записка путника ждёт у старта. */
export const WELCOME_AFTER_MS = 24 * 3600_000;

/**
 * Игрока не было дольше суток, и записки ещё остались: следующая лежит у каменного
 * круга, пока её не прочтут. Считается один раз при загрузке, до первого сохранения.
 */
export let welcomeNote = journal.seen !== undefined && Date.now() - journal.seen >= WELCOME_AFTER_MS && journal.notesRead.filter((n) => n < NOTES.length).length < NOTES.length;

/** Записка у круга прочитана. */
export function takeWelcome(): void {
  welcomeNote = false;
}

/** Счётчики копятся в памяти каждый кадр, а на диск — по этому вызову (итог уровня, меню). */
export function save(): void {
  journal.seen = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(journal));
  } catch {
    // Хранилище недоступно — находки проживут до перезагрузки
  }
}

/** Досчитать, что выросло в саду с прошлого раза; возвращает, сколько кристаллов ждёт. */
export function growGarden(): number {
  const g = journal.garden;
  const now = Date.now();
  // Полный сад не растёт: отсчёт следующего кристалла начнётся, когда его соберут
  if (g.ready >= GARDEN_CAP) {
    g.since = now;
    return g.ready;
  }
  const grown = Math.floor((now - g.since) / GARDEN_GROW_MS);
  if (grown > 0) {
    g.ready = Math.min(GARDEN_CAP, g.ready + grown);
    g.since = g.ready >= GARDEN_CAP ? now : g.since + grown * GARDEN_GROW_MS;
    save();
  }
  return g.ready;
}

export function harvestGarden(): void {
  const g = journal.garden;
  if (g.ready >= GARDEN_CAP) g.since = Date.now();
  g.ready = Math.max(0, g.ready - 1);
  save();
}

/**
 * Оттенок для кристалла из сада: чаще — из тех, что ещё не найдены,
 * чтобы сад помогал собрать коллекцию.
 */
export function gardenShade(): BiomeId {
  const ids = Object.keys(SHADES) as BiomeId[];
  const missing = ids.filter((id) => !journal.shades[id]);
  const pool = missing.length && Math.random() < 0.6 ? missing : ids;
  return pool[Math.floor(Math.random() * pool.length)];
}

export const isNoteRead = (id: number): boolean => journal.notesRead.includes(id);

/**
 * Какую записку положить на поляну уровня: непрочитанную из двух записок этого региона;
 * region null — Дальний лес или Лес дня — любую непрочитанную с полян. null — читать нечего.
 */
export function nextNote(region: number | null): number | null {
  const pool = region === null ? NOTES.map((_, i) => i) : REGION_NOTES[region];
  return pool.find((id) => !isNoteRead(id)) ?? null;
}

/** Записка прочитана; возвращает её текст. */
export function readNote(id: number): string {
  if (!isNoteRead(id)) journal.notesRead.push(id);
  save();
  return noteText(id);
}

/** Клетки атласа тайн: какие тайники бывают в каждом биоме — жемчужина только там, где озёра. */
export const ATLAS_KINDS: Record<BiomeId, readonly SecretKind[]> = {
  meadow: ['tree', 'stone', 'ring', 'ledge'],
  autumn: ['tree', 'stone', 'ring', 'ledge'],
  rocky: ['tree', 'stone', 'ring', 'ledge'],
  winter: ['tree', 'stone', 'ring', 'ledge'],
  night: ['tree', 'stone', 'ring', 'ledge'],
  lakes: ['tree', 'stone', 'ring', 'ledge', 'pearl'],
};
export const ATLAS_TOTAL = Object.values(ATLAS_KINDS).reduce((n, k) => n + k.length, 0);

/** Сколько клеток атласа заполнено. */
export const atlasCount = (): number => Object.values(journal.atlas).reduce((n, k) => n + (k?.length ?? 0), 0);

/** Тайник раскрыт: true — это первая такая находка в биоме, в атласе новая запись. */
export function addAtlas(biome: BiomeId, kind: SecretKind): boolean {
  const got = (journal.atlas[biome] ??= []);
  if (got.includes(kind)) return false;
  got.push(kind);
  save();
  return true;
}

/** Записывает редкий кристалл биома; возвращает, сколько их теперь найдено в этом биоме. */
export function addShade(biome: BiomeId): number {
  const n = (journal.shades[biome] ?? 0) + 1;
  journal.shades[biome] = n;
  save();
  return n;
}
