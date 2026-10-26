// Каталог норы: материалы с уровней, места во дворе (слоты) и что в них можно поставить.
// Нора не редактор: у каждого места свой короткий список вещей, поэтому сохранение —
// крошечный JSON «место → вещь», и чужую нору можно построить по нему один в один.

import type { BiomeId } from '../levels/biomes';
import { plural } from '../utils';

export type MaterialId = 'cone' | 'acorn' | 'pebble' | 'icicle' | 'feather' | 'shell';

/** Материал для норы: у каждого биома свой, лежит на его уровнях. */
export interface MaterialDef {
  id: MaterialId;
  biome: BiomeId;
  /** Во множественном числе, с большой буквы: «Шишки». */
  name: string;
  /** Формы для «1 шишка», «2 шишки», «5 шишек». */
  forms: readonly [one: string, few: string, many: string];
  color: readonly [r: number, g: number, b: number];
}

export const MATERIALS: readonly MaterialDef[] = [
  { id: 'cone', biome: 'meadow', name: 'Шишки', forms: ['шишка', 'шишки', 'шишек'], color: [0.55, 0.36, 0.2] },
  { id: 'acorn', biome: 'autumn', name: 'Жёлуди', forms: ['жёлудь', 'жёлудя', 'желудей'], color: [0.78, 0.52, 0.22] },
  { id: 'pebble', biome: 'rocky', name: 'Гладкие камни', forms: ['гладкий камень', 'гладких камня', 'гладких камней'], color: [0.7, 0.72, 0.76] },
  { id: 'icicle', biome: 'winter', name: 'Сосульки', forms: ['сосулька', 'сосульки', 'сосулек'], color: [0.7, 0.9, 1] },
  { id: 'feather', biome: 'night', name: 'Совиные перья', forms: ['совиное перо', 'совиных пера', 'совиных перьев'], color: [0.86, 0.84, 0.95] },
  { id: 'shell', biome: 'lakes', name: 'Ракушки', forms: ['ракушка', 'ракушки', 'ракушек'], color: [1, 0.78, 0.74] },
];

export const materialById = (id: string): MaterialDef | undefined => MATERIALS.find((m) => m.id === id);
export const materialOf = (biome: BiomeId): MaterialDef => MATERIALS.find((m) => m.biome === biome)!;
/** «3 шишки». */
export const amount = (m: { forms: readonly [string, string, string] }, n: number): string => `${n} ${plural(n, ...m.forms)}`;

/** Цена: кристаллы из общего счёта, материалы и урожай со двора. */
export interface Cost { crystals: number; mats?: Partial<Record<MaterialId, number>>; crops?: Partial<Record<CropId, number>> }

/** «✦ 20 · 2 шишки · 1 горсть шиповника»; без кристаллов — без «✦ 0». */
export function costText(cost: Cost): string {
  const parts = cost.crystals || !cost.mats && !cost.crops ? [`✦ ${cost.crystals}`] : [];
  for (const [id, n] of Object.entries(cost.mats ?? {})) parts.push(amount(materialById(id)!, n));
  for (const [id, n] of Object.entries(cost.crops ?? {})) parts.push(amount(cropById(id)!, n));
  return parts.join(' · ');
}

// ---------- Урожай во дворе ----------

export type CropId = 'rosehip' | 'berry' | 'honey';

/** Урожай: растёт во дворе сам, в реальном времени, пока игрока нет. */
export interface CropDef {
  id: CropId;
  /** Во множественном числе, с большой буквы — для кошелька. */
  name: string;
  forms: readonly [one: string, few: string, many: string];
  /** Где растёт: куст или улей. */
  source: string;
  /** С какого уровня норы растёт. */
  tier: number;
  color: readonly [r: number, g: number, b: number];
  /** Место во дворе. */
  x: number;
  z: number;
}

export const CROPS: readonly CropDef[] = [
  { id: 'rosehip', name: 'Шиповник', forms: ['горсть шиповника', 'горсти шиповника', 'горстей шиповника'], source: 'Куст шиповника', tier: 0, color: [0.86, 0.22, 0.14], x: -4.6, z: 6.2 },
  { id: 'berry', name: 'Черника', forms: ['горсть черники', 'горсти черники', 'горстей черники'], source: 'Черничник', tier: 1, color: [0.25, 0.3, 0.62], x: 3.9, z: 2.8 },
  { id: 'honey', name: 'Мёд', forms: ['сота с мёдом', 'соты с мёдом', 'сот с мёдом'], source: 'Улей', tier: 2, color: [1, 0.72, 0.18], x: 4.9, z: 4.6 },
];

export const cropById = (id: string): CropDef | undefined => CROPS.find((c) => c.id === id);
/** Урожай вырастает раз в CROP_GROW_MS и ждёт сбора; на кусте помещается CROP_CAP, у большой норы — на один больше. */
export const CROP_GROW_MS = 2 * 3600_000;
export const CROP_CAP = 3;

// ---------- Котелок: усилители на один уровень ----------

export type BoostId = 'tea' | 'honeycomb' | 'firefly' | 'feather';

export interface BoostDef {
  id: BoostId;
  name: string;
  /** Одним словом — для кнопки «Котелок». */
  short: string;
  desc: string;
  cost: Cost;
}

/** Сколько секунд в начале уровня дует ветер в спину от медовых сот. */
export const HONEY_WIND = 20;

export const BOOSTS: readonly BoostDef[] = [
  { id: 'tea', name: 'Шиповниковый отвар', short: 'отвар', desc: 'Запал восстанавливается вдвое быстрее', cost: { crystals: 5, crops: { rosehip: 2 }, mats: { cone: 1 } } },
  { id: 'honeycomb', name: 'Медовые соты', short: 'соты', desc: `Первые ${HONEY_WIND} секунд — ветер в спину`, cost: { crystals: 5, crops: { honey: 1 }, mats: { acorn: 1 } } },
  { id: 'firefly', name: 'Светлячок в банке', short: 'светлячок', desc: 'Стрелка показывает на ближайший кристалл', cost: { crystals: 5, crops: { berry: 2 }, mats: { pebble: 1 } } },
  { id: 'feather', name: 'Совиное перо', short: 'перо', desc: 'Планирование на весь уровень, даже без апгрейда', cost: { crystals: 5, crops: { berry: 1, rosehip: 1 }, mats: { feather: 1 } } },
];

export const boostById = (id: string): BoostDef | undefined => BOOSTS.find((b) => b.id === id);

/** Уровень норы: что она собой представляет и сколько стоит до него дорасти. */
export interface TierDef {
  name: string;
  /** Что меняется на этом уровне — для карточки улучшения. */
  desc: string;
  cost: Cost;
}

export const TIERS: readonly TierDef[] = [
  { name: 'Ямка под корнями', desc: 'Вход под корнями сосны, во дворе — три места', cost: { crystals: 0 } },
  { name: 'Нора с дверцей', desc: 'Круглая дверца, скамейка и место у тропинки', cost: { crystals: 40, mats: { cone: 3 } } },
  { name: 'Нора с окошком', desc: 'Тёплый свет в окошке, ящик с цветами, пруд и фонари', cost: { crystals: 90, mats: { acorn: 3, pebble: 3 } } },
  { name: 'Большая нора', desc: 'Вторая комната, труба с дымком и костровище посреди двора', cost: { crystals: 160, mats: { icicle: 3, feather: 3, shell: 3 } } },
];

export type SlotId = 'porch' | 'table' | 'bed' | 'bench' | 'sign' | 'pond' | 'light' | 'fire';

export interface SlotDef {
  id: SlotId;
  name: string;
  /** Где во дворе: двор — круг вокруг (0, 0), нора — за ним, на +z. */
  x: number;
  z: number;
  /** Куда смотрит вещь (рад, 0 — к камере). */
  yaw: number;
  /** С какого уровня норы место открыто. */
  tier: number;
}

export const SLOTS: readonly SlotDef[] = [
  { id: 'porch', name: 'У входа', x: 1.7, z: 2.9, yaw: -0.4, tier: 0 },
  { id: 'table', name: 'Стол', x: -2.4, z: 1.2, yaw: 0.5, tier: 0 },
  { id: 'bed', name: 'Грядка', x: 2.9, z: 0, yaw: -0.3, tier: 0 },
  { id: 'bench', name: 'Скамейка', x: -1, z: -2, yaw: 0.2, tier: 1 },
  { id: 'sign', name: 'У тропинки', x: 1.6, z: -3.6, yaw: -0.2, tier: 1 },
  { id: 'pond', name: 'Пруд', x: -3.8, z: -1.8, yaw: 0, tier: 2 },
  { id: 'light', name: 'Фонари', x: 4.2, z: -2.2, yaw: -0.6, tier: 2 },
  { id: 'fire', name: 'Посреди двора', x: 0.5, z: 0.3, yaw: 0, tier: 3 },
];

export type ItemId =
  | 'mat' | 'lantern' | 'basket' | 'stumpTable' | 'teaTable' | 'mushrooms' | 'pumpkins'
  | 'log' | 'bench' | 'signpost' | 'mailbox' | 'pond' | 'snowman' | 'posts' | 'chimes' | 'campfire' | 'crystalStone';

export interface ItemDef {
  id: ItemId;
  slot: SlotId;
  name: string;
  desc: string;
  cost: Cost;
}

export const ITEMS: readonly ItemDef[] = [
  { id: 'mat', slot: 'porch', name: 'Коврик из мха', desc: 'Мягко вытереть лапы', cost: { crystals: 10 } },
  { id: 'lantern', slot: 'porch', name: 'Фонарик', desc: 'Светлячок в банке, светит вечером', cost: { crystals: 20, mats: { cone: 2 } } },
  { id: 'basket', slot: 'porch', name: 'Корзинка с ягодами', desc: 'Кто-то собрал и оставил у двери', cost: { crystals: 15, mats: { acorn: 2 } } },
  { id: 'stumpTable', slot: 'table', name: 'Пенёк-стол', desc: 'Старый пень, гладкий сверху', cost: { crystals: 10 } },
  { id: 'teaTable', slot: 'table', name: 'Стол с чайником', desc: 'Чай из шиповника на двоих', cost: { crystals: 25, mats: { pebble: 2 } } },
  { id: 'mushrooms', slot: 'bed', name: 'Грибная грядка', desc: 'Лисички и опята в ряд', cost: { crystals: 15, mats: { cone: 2 } } },
  { id: 'pumpkins', slot: 'bed', name: 'Тыквы', desc: 'Три рыжих бока на солнце', cost: { crystals: 20, mats: { acorn: 3 } } },
  { id: 'log', slot: 'bench', name: 'Бревно', desc: 'Посидеть и посмотреть на лес', cost: { crystals: 15 } },
  { id: 'bench', slot: 'bench', name: 'Скамейка', desc: 'Со спинкой, из сосновых досок', cost: { crystals: 30, mats: { cone: 3 } } },
  { id: 'signpost', slot: 'sign', name: 'Указатель', desc: '«К норе» и «В лес» — чтобы гости не заблудились', cost: { crystals: 15, mats: { cone: 1 } } },
  { id: 'mailbox', slot: 'sign', name: 'Почтовый ящик', desc: 'Для записок от друзей', cost: { crystals: 30, mats: { pebble: 2 } } },
  { id: 'pond', slot: 'pond', name: 'Пруд с ракушками', desc: 'Маленький, но настоящий', cost: { crystals: 40, mats: { shell: 4 } } },
  { id: 'snowman', slot: 'pond', name: 'Снеговик', desc: 'Не тает — он из сосулек', cost: { crystals: 35, mats: { icicle: 3 } } },
  { id: 'posts', slot: 'light', name: 'Гирлянда', desc: 'Огоньки на верёвке между столбиками', cost: { crystals: 40, mats: { feather: 2, cone: 2 } } },
  { id: 'chimes', slot: 'light', name: 'Музыка ветра', desc: 'Ракушки и перья на ветке', cost: { crystals: 35, mats: { shell: 2, feather: 2 } } },
  { id: 'campfire', slot: 'fire', name: 'Костёр', desc: 'Тёплый, с брёвнами вокруг', cost: { crystals: 50, mats: { pebble: 4 } } },
  {
    id: 'crystalStone',
    slot: 'fire',
    name: 'Кристальный камень',
    desc: 'По частице от каждого леса',
    cost: { crystals: 80, mats: { cone: 1, acorn: 1, pebble: 1, icicle: 1, feather: 1, shell: 1 } },
  },
];

// ---------- Сила: апгрейды запала ----------

export type PowerId = 'cap' | 'regen' | 'double' | 'glide';

/** Ступень апгрейда: что она даёт и сколько стоит. */
export interface PowerStep { desc: string; cost: Cost }

export interface PowerDef {
  id: PowerId;
  name: string;
  /** С какого уровня норы апгрейд можно купить. */
  tier: number;
  steps: readonly PowerStep[];
}

/** Ёмкость запала и множитель восстановления по ступеням — с нулевой, базовой. */
export const CAPACITY = [100, 130, 160, 200] as const;
export const REGEN_STEP = 0.2;

export const POWERS: readonly PowerDef[] = [
  {
    id: 'cap',
    name: 'Выносливость',
    tier: 0,
    steps: [
      { desc: `Запала ${CAPACITY[1]} вместо ${CAPACITY[0]}`, cost: { crystals: 30, mats: { cone: 2 } } },
      { desc: `Запала ${CAPACITY[2]}`, cost: { crystals: 60, mats: { acorn: 3 } } },
      { desc: `Запала ${CAPACITY[3]}`, cost: { crystals: 100, mats: { pebble: 3, icicle: 2 } } },
    ],
  },
  {
    id: 'regen',
    name: 'Второе дыхание',
    tier: 0,
    steps: [
      { desc: 'Запал восстанавливается на 20% быстрее', cost: { crystals: 25, mats: { cone: 1 } } },
      { desc: 'На 40% быстрее', cost: { crystals: 50, mats: { acorn: 2 } } },
      { desc: 'На 60% быстрее', cost: { crystals: 90, mats: { shell: 3 } } },
    ],
  },
  {
    id: 'double',
    name: 'Двойной прыжок',
    tier: 1,
    steps: [{ desc: 'Ещё один прыжок в воздухе — нажми прыжок снова', cost: { crystals: 80, mats: { pebble: 2, icicle: 3 } } }],
  },
  {
    id: 'glide',
    name: 'Планирование',
    tier: 2,
    steps: [{ desc: 'Падая, держи прыжок — спускаешься медленно, как на крыльях', cost: { crystals: 80, mats: { feather: 4 } } }],
  },
];

export const powerById = (id: string): PowerDef | undefined => POWERS.find((p) => p.id === id);

export const itemById = (id: string): ItemDef | undefined => ITEMS.find((i) => i.id === id);
export const slotById = (id: string): SlotDef | undefined => SLOTS.find((s) => s.id === id);
export const itemsFor = (slot: SlotId): ItemDef[] => ITEMS.filter((i) => i.slot === slot);
