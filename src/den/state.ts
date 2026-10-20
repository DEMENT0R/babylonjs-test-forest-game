// Нора игрока в localStorage: какие вещи куплены и что где стоит.
// Кристаллы не копятся отдельно: счёт — все собранные за игру минус потраченные на нору,
// поэтому старым сохранениям не нужен перенос.

import { journal } from '../journal';
import { itemById, slotById, type Cost, type ItemDef, type ItemId, type SlotId } from './catalog';

export interface DenState {
  /** Версия формата — на неё смотрит и чтение чужой норы. */
  v: 1;
  owned: ItemId[];
  slots: Partial<Record<SlotId, ItemId>>;
  /** Потрачено кристаллов. */
  spent: number;
}

const KEY = 'tihaya-polyana-den';

function load(): DenState {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DenState> | null;
    if (d && typeof d === 'object') {
      const owned = (Array.isArray(d.owned) ? d.owned : []).filter((id) => itemById(id));
      const slots: DenState['slots'] = {};
      for (const [slot, id] of Object.entries(d.slots ?? {})) {
        const item = itemById(id);
        if (item && item.slot === slot && owned.includes(item.id)) slots[slot as SlotId] = item.id;
      }
      return { v: 1, owned, slots, spent: Math.max(0, Number(d.spent) || 0) };
    }
  } catch {
    // Повреждённые данные — нора начинается с пустого двора
  }
  return { v: 1, owned: [], slots: {}, spent: 0 };
}

export const den: DenState = load();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(den));
  } catch {
    // Хранилище недоступно — нора проживёт до перезагрузки
  }
}

/** Кристаллов на счету. */
export function crystals(): number {
  return Math.max(0, journal.stats.crystals - den.spent);
}

/** Сколько не хватает кристаллов; 0 — хватает. */
export function shortOf(cost: Cost): number {
  return Math.max(0, cost.crystals - crystals());
}

export const canAfford = (cost: Cost): boolean => shortOf(cost) === 0;

/** Купить вещь и сразу поставить её на место; false — не хватило. */
export function buy(item: ItemDef): boolean {
  if (den.owned.includes(item.id)) {
    place(item);
    return true;
  }
  if (!canAfford(item.cost)) return false;
  den.spent += item.cost.crystals;
  den.owned.push(item.id);
  den.slots[item.slot] = item.id;
  save();
  return true;
}

/** Поставить купленную вещь на её место (прежняя уходит в кладовку). */
export function place(item: ItemDef): void {
  if (!den.owned.includes(item.id)) return;
  den.slots[item.slot] = item.id;
  save();
}

/** Освободить место. */
export function clearSlot(slot: SlotId): void {
  if (!slotById(slot)) return;
  delete den.slots[slot];
  save();
}
