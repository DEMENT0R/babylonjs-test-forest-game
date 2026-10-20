// Каталог норы: места во дворе (слоты) и что в них можно поставить.
// Нора не редактор: у каждого места свой короткий список вещей, поэтому сохранение —
// крошечный JSON «место → вещь», и чужую нору можно построить по нему один в один.

/** Цена: кристаллы из общего счёта. */
export interface Cost { crystals: number }

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
  { id: 'lantern', slot: 'porch', name: 'Фонарик', desc: 'Светлячок в банке, светит вечером', cost: { crystals: 20 } },
  { id: 'basket', slot: 'porch', name: 'Корзинка с ягодами', desc: 'Кто-то собрал и оставил у двери', cost: { crystals: 15 } },
  { id: 'stumpTable', slot: 'table', name: 'Пенёк-стол', desc: 'Старый пень, гладкий сверху', cost: { crystals: 10 } },
  { id: 'teaTable', slot: 'table', name: 'Стол с чайником', desc: 'Чай из шиповника на двоих', cost: { crystals: 25 } },
  { id: 'mushrooms', slot: 'bed', name: 'Грибная грядка', desc: 'Лисички и опята в ряд', cost: { crystals: 15 } },
  { id: 'pumpkins', slot: 'bed', name: 'Тыквы', desc: 'Три рыжих бока на солнце', cost: { crystals: 20 } },
];

export const itemById = (id: string): ItemDef | undefined => ITEMS.find((i) => i.id === id);
export const slotById = (id: string): SlotDef | undefined => SLOTS.find((s) => s.id === id);
export const itemsFor = (slot: SlotId): ItemDef[] => ITEMS.filter((i) => i.slot === slot);
