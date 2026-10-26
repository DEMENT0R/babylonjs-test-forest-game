// Нора игрока в localStorage: какие вещи куплены, что где стоит и сколько материалов.
// Кристаллы не копятся отдельно: счёт — все собранные за игру минус потраченные на нору,
// поэтому старым сохранениям не нужен перенос.

import { journal } from '../journal';
import { BASE_STAMINA, type Stamina } from '../stamina';
import { clamp } from '../utils';
import {
  amount,
  CAPACITY,
  itemById,
  materialById,
  MATERIALS,
  POWERS,
  REGEN_STEP,
  slotById,
  TIERS,
  type Cost,
  type ItemDef,
  type ItemId,
  type MaterialId,
  type PowerDef,
  type PowerId,
  type SlotId,
} from './catalog';

export interface DenState {
  /** Версия формата — на неё смотрит и чтение чужой норы. */
  v: 1;
  /** Уровень норы — номер в TIERS. */
  tier: number;
  owned: ItemId[];
  slots: Partial<Record<SlotId, ItemId>>;
  /** Потрачено кристаллов. */
  spent: number;
  /** Материалы на руках. */
  mats: Partial<Record<MaterialId, number>>;
  /** Апгрейды запала: сколько ступеней куплено. */
  power: Partial<Record<PowerId, number>>;
}

const KEY = 'tihaya-polyana-den';

function load(): DenState {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DenState> | null;
    if (d && typeof d === 'object') {
      const tier = clamp(Math.floor(Number(d.tier) || 0), 0, TIERS.length - 1);
      const owned = (Array.isArray(d.owned) ? d.owned : []).filter((id) => itemById(id));
      const slots: DenState['slots'] = {};
      for (const [slot, id] of Object.entries(d.slots ?? {})) {
        const item = itemById(id);
        if (item && item.slot === slot && owned.includes(item.id) && slotById(slot)!.tier <= tier) slots[slot as SlotId] = item.id;
      }
      const mats: DenState['mats'] = {};
      for (const m of MATERIALS) {
        const n = Math.floor(Number(d.mats?.[m.id]) || 0);
        if (n > 0) mats[m.id] = n;
      }
      const power: DenState['power'] = {};
      for (const p of POWERS) {
        const n = clamp(Math.floor(Number(d.power?.[p.id]) || 0), 0, p.steps.length);
        if (n > 0) power[p.id] = n;
      }
      return { v: 1, tier, owned, slots, spent: Math.max(0, Number(d.spent) || 0), mats, power };
    }
  } catch {
    // Повреждённые данные — нора начинается с пустого двора
  }
  return { v: 1, tier: 0, owned: [], slots: {}, spent: 0, mats: {}, power: {} };
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

/** Материал подобран на уровне (n штук); возвращает, сколько его теперь. */
export function addMaterial(id: MaterialId, n = 1): number {
  den.mats[id] = matCount(id) + n;
  save();
  return den.mats[id]!;
}

/** Место открыто на нынешнем уровне норы. */
export const slotOpen = (slot: SlotId): boolean => (slotById(slot)?.tier ?? Infinity) <= den.tier;

/** Следующий уровень норы; null — нора уже самая большая. */
export const nextTier = (): (typeof TIERS)[number] | null => TIERS[den.tier + 1] ?? null;

/** Перейти на следующий уровень норы; false — не хватило или расти некуда. */
export function upgrade(): boolean {
  const next = nextTier();
  if (!next || !pay(next.cost)) return false;
  den.tier++;
  save();
  return true;
}

/** Купить вещь и сразу поставить её на место; false — не хватило или место закрыто. */
export function buy(item: ItemDef): boolean {
  if (!slotOpen(item.slot)) return false;
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
  if (!den.owned.includes(item.id) || !slotOpen(item.slot)) return;
  den.slots[item.slot] = item.id;
  save();
}

/** Сколько ступеней апгрейда куплено. */
export const powerLevel = (id: PowerId): number => den.power[id] ?? 0;

/** Купить следующую ступень апгрейда; false — не хватило, нора мала или ступеней больше нет. */
export function buyPower(p: PowerDef): boolean {
  const n = powerLevel(p.id);
  if (n >= p.steps.length || den.tier < p.tier || !pay(p.steps[n].cost)) return false;
  den.power[p.id] = n + 1;
  save();
  return true;
}

/** Запал с апгрейдами из норы. */
export function staminaWithPowers(): Stamina {
  return {
    max: CAPACITY[powerLevel('cap')],
    regen: BASE_STAMINA.regen * (1 + REGEN_STEP * powerLevel('regen')),
    double: powerLevel('double') > 0,
    glide: powerLevel('glide') > 0,
  };
}

/** Освободить место. */
export function clearSlot(slot: SlotId): void {
  if (!slotById(slot)) return;
  delete den.slots[slot];
  save();
}
