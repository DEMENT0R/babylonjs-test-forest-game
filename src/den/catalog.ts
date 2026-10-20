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
export const amount = (m: MaterialDef, n: number): string => `${n} ${plural(n, ...m.forms)}`;

/** Цена: кристаллы из общего счёта и материалы. */
export interface Cost { crystals: number; mats?: Partial<Record<MaterialId, number>> }

/** «✦ 20 · 2 шишки». */
export function costText(cost: Cost): string {
  const parts = [`✦ ${cost.crystals}`];
  for (const [id, n] of Object.entries(cost.mats ?? {})) parts.push(amount(materialById(id)!, n));
  return parts.join(' · ');
}

export type SlotId = 'porch' | 'table' | 'bed';

export interface SlotDef {
  id: SlotId;
  name: string;
  /** Где во дворе: двор — круг вокруг (0, 0), нора — за ним, на +z. */
  x: number;
  z: number;
  /** Куда смотрит вещь (рад, 0 — к камере). */
  yaw: number;
}

export const SLOTS: readonly SlotDef[] = [
  { id: 'porch', name: 'У входа', x: 1.7, z: 2.9, yaw: -0.4 },
  { id: 'table', name: 'Стол', x: -2.4, z: 1.2, yaw: 0.5 },
  { id: 'bed', name: 'Грядка', x: 2.9, z: 0, yaw: -0.3 },
];

export type ItemId = 'mat' | 'lantern' | 'basket' | 'stumpTable' | 'teaTable' | 'mushrooms' | 'pumpkins';

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
];

export const itemById = (id: string): ItemDef | undefined => ITEMS.find((i) => i.id === id);
export const slotById = (id: string): SlotDef | undefined => SLOTS.find((s) => s.id === id);
export const itemsFor = (slot: SlotId): ItemDef[] => ITEMS.filter((i) => i.slot === slot);
