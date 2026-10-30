// Нора игрока в localStorage: какие вещи куплены, что где стоит и сколько материалов.
// Кристаллы не копятся отдельно: счёт — все собранные за игру минус потраченные на нору,
// поэтому старым сохранениям не нужен перенос.

import { atlasCount, journal } from '../journal';
import { movedIn } from '../residents/state';
import { BASE_STAMINA, type Stamina } from '../stamina';
import { clamp } from '../utils';
import {
  amount,
  BOOSTS,
  CAPACITY,
  cropById,
  CROP_CAP,
  CROP_GROW_MS,
  CROPS,
  itemById,
  materialById,
  MATERIALS,
  POWERS,
  REGEN_STEP,
  slotById,
  TIERS,
  type BoostDef,
  type BoostId,
  type Cost,
  type CropDef,
  type CropId,
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
  /** Урожай на кустах и в улье: сколько ждёт сбора и с какого момента растёт следующий. */
  crops: Partial<Record<CropId, { ready: number; since: number }>>;
  /** Собранный урожай на руках. */
  stock: Partial<Record<CropId, number>>;
  /** Сваренные усилители. */
  boosts: Partial<Record<BoostId, number>>;
  /** Усилитель, который возьмётся с собой на следующий уровень. */
  packed: BoostId | null;
}

/** Целое неотрицательное число из сохранения. */
const count = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));

/** Словарь «id → число» из сохранения: только известные id и только положительные. */
function counts<K extends string>(raw: unknown, ids: readonly { id: K }[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  for (const { id } of ids) if (count(r[id]) > 0) out[id] = count(r[id]);
  return out;
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
      const crops: DenState['crops'] = {};
      for (const c of CROPS) {
        const g = d.crops?.[c.id];
        if (g && typeof g === 'object') crops[c.id] = { ready: count(g.ready), since: Number(g.since) || Date.now() };
      }
      const boosts = counts(d.boosts, BOOSTS);
      const packed = d.packed && boosts[d.packed] ? d.packed : null;
      return { v: 1, tier, owned, slots, spent: Math.max(0, Number(d.spent) || 0), mats, power, crops, stock: counts(d.stock, CROPS), boosts, packed };
    }
  } catch {
    // Повреждённые данные — нора начинается с пустого двора
  }
  return { v: 1, tier: 0, owned: [], slots: {}, spent: 0, mats: {}, power: {}, crops: {}, stock: {}, boosts: {}, packed: null };
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
  for (const [id, n] of Object.entries(cost.crops ?? {})) {
    const lack = n - stockOf(id as CropId);
    if (lack > 0) out.push(amount(cropById(id)!, lack));
  }
  return out;
}

export const canAfford = (cost: Cost): boolean => shortOf(cost).length === 0;

/** Списать цену; false — не хватило, ничего не списано. */
function pay(cost: Cost): boolean {
  if (!canAfford(cost)) return false;
  den.spent += cost.crystals;
  for (const [id, n] of Object.entries(cost.mats ?? {})) den.mats[id as MaterialId] = matCount(id as MaterialId) - n;
  for (const [id, n] of Object.entries(cost.crops ?? {})) den.stock[id as CropId] = stockOf(id as CropId) - n;
  return true;
}

/** Отдать материалы жителю леса; false — не хватило, ничего не отдано. */
export function give(cost: Cost): boolean {
  if (!pay(cost)) return false;
  save();
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

/** Улучшения норы дешевле в кристаллах, когда рядом живёт барсук. */
const DISCOUNT = 0.8;

/** Следующий уровень норы с ценой, какая она сейчас; null — нора уже самая большая. */
export function nextTier(): (typeof TIERS)[number] | null {
  const t = TIERS[den.tier + 1];
  if (!t) return null;
  const off = movedIn().some((r) => r.perk.kind === 'discount');
  return off ? { ...t, cost: { ...t.cost, crystals: Math.round(t.cost.crystals * DISCOUNT) } } : t;
}

/** Перейти на следующий уровень норы; false — не хватило или расти некуда. */
export function upgrade(): boolean {
  const next = nextTier();
  if (!next || !pay(next.cost)) return false;
  den.tier++;
  save();
  return true;
}

/** Купить вещь и сразу поставить её на место; false — не хватило или место закрыто. */
/** Вещь из тайников ещё не открыта: в атласе мало записей. */
export const atlasLocked = (item: ItemDef): boolean => (item.atlas ?? 0) > atlasCount();

export function buy(item: ItemDef): boolean {
  if (!slotOpen(item.slot) || atlasLocked(item)) return false;
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

// ---------- Урожай и котелок ----------

export const stockOf = (id: CropId): number => den.stock[id] ?? 0;

/** Урожай растёт у нынешней норы. */
export const cropOpen = (c: CropDef): boolean => c.tier <= den.tier;

/** Сколько урожая помещается на кусте: у большой норы — на один больше, и ещё на один, если за кустом смотрит житель. */
export const cropCap = (id: CropId): number =>
  CROP_CAP + (den.tier >= 3 ? 1 : 0) + (movedIn().some((r) => r.perk.kind === 'crop' && r.perk.crop === id) ? 1 : 0);

/**
 * Досчитать, что выросло на кустах с прошлого раза, — как сад кристаллов:
 * полный куст не растёт, отсчёт следующего начнётся после сбора.
 */
export function growCrops(): void {
  const now = Date.now();
  for (const c of CROPS) {
    if (!cropOpen(c)) continue;
    const cap = cropCap(c.id);
    const g = (den.crops[c.id] ??= { ready: 0, since: now });
    if (g.ready >= cap) {
      g.since = now;
      continue;
    }
    const grown = Math.floor((now - g.since) / CROP_GROW_MS);
    if (grown > 0) {
      g.ready = Math.min(cap, g.ready + grown);
      g.since = g.ready >= cap ? now : g.since + grown * CROP_GROW_MS;
    }
  }
  save();
}

export const cropReady = (id: CropId): number => den.crops[id]?.ready ?? 0;

/** Собрать весь урожай; возвращает, сколько чего собрано. */
export function harvestCrops(): Partial<Record<CropId, number>> {
  const got: Partial<Record<CropId, number>> = {};
  for (const c of CROPS) {
    const g = den.crops[c.id];
    if (!g?.ready) continue;
    if (g.ready >= cropCap(c.id)) g.since = Date.now();
    got[c.id] = g.ready;
    den.stock[c.id] = stockOf(c.id) + g.ready;
    g.ready = 0;
  }
  save();
  return got;
}

export const boostCount = (id: BoostId): number => den.boosts[id] ?? 0;

/** Сварить усилитель; false — не хватило. Первый сваренный сразу берётся с собой. */
export function brew(b: BoostDef): boolean {
  if (!pay(b.cost)) return false;
  den.boosts[b.id] = boostCount(b.id) + 1;
  den.packed ??= b.id;
  save();
  return true;
}

/** Взять усилитель с собой на следующий уровень; null — ничего не брать. */
export function pack(id: BoostId | null): void {
  den.packed = id && boostCount(id) > 0 ? id : null;
  save();
}

/** Уровень начинается: взятый с собой усилитель тратится; кончились — больше не берётся. */
export function takePacked(): BoostId | null {
  const id = den.packed;
  if (!id || boostCount(id) <= 0) return null;
  den.boosts[id] = boostCount(id) - 1;
  if (!den.boosts[id]) {
    delete den.boosts[id];
    den.packed = null;
  }
  save();
  return id;
}

/** Освободить место. */
export function clearSlot(slot: SlotId): void {
  if (!slotById(slot)) return;
  delete den.slots[slot];
  save();
}
