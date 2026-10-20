// Нора игрока в localStorage: какие вещи куплены, что где стоит и сколько материалов.
// Кристаллы не копятся отдельно: счёт — все собранные за игру минус потраченные на нору,
// поэтому старым сохранениям не нужен перенос.

import { journal } from '../journal';
import { amount, itemById, materialById, MATERIALS, slotById, type Cost, type ItemDef, type ItemId, type MaterialId, type SlotId } from './catalog';

export interface DenState {
  /** Версия формата — на неё смотрит и чтение чужой норы. */
  v: 1;
  owned: ItemId[];
  slots: Partial<Record<SlotId, ItemId>>;
  /** Потрачено кристаллов. */
  spent: number;
  /** Материалы на руках. */
  mats: Partial<Record<MaterialId, number>>;
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
      const mats: DenState['mats'] = {};
      for (const m of MATERIALS) {
        const n = Math.floor(Number(d.mats?.[m.id]) || 0);
        if (n > 0) mats[m.id] = n;
      }
      return { v: 1, owned, slots, spent: Math.max(0, Number(d.spent) || 0), mats };
    }
  } catch {
    // Повреждённые данные — нора начинается с пустого двора
  }
  return { v: 1, owned: [], slots: {}, spent: 0, mats: {} };
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

export const matCount = (id: MaterialId): number => den.mats[id] ?? 0;

/** Чего не хватает: «✦ 5», «2 шишки»; пусто — хватает всего. */
export function shortOf(cost: Cost): string[] {
  const out: string[] = [];
  const c = cost.crystals - crystals();
  if (c > 0) out.push(`✦ ${c}`);
  for (const [id, n] of Object.entries(cost.mats ?? {})) {
    const lack = n - matCount(id as MaterialId);
    if (lack > 0) out.push(amount(materialById(id)!, lack));
  }
  return out;
}

export const canAfford = (cost: Cost): boolean => shortOf(cost).length === 0;

/** Списать цену; false — не хватило, ничего не списано. */
function pay(cost: Cost): boolean {
  if (!canAfford(cost)) return false;
  den.spent += cost.crystals;
  for (const [id, n] of Object.entries(cost.mats ?? {})) den.mats[id as MaterialId] = matCount(id as MaterialId) - n;
  return true;
}

/** Материал подобран на уровне; возвращает, сколько его теперь. */
export function addMaterial(id: MaterialId): number {
  den.mats[id] = matCount(id) + 1;
  save();
  return den.mats[id]!;
}

/** Купить вещь и сразу поставить её на место; false — не хватило. */
export function buy(item: ItemDef): boolean {
  if (den.owned.includes(item.id)) {
    place(item);
    return true;
  }
  if (!pay(item.cost)) return false;
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
