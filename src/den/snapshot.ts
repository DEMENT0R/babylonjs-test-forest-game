// Нора для гостей: что видно другу — уровень норы, что где стоит и сколько дней
// росла поляна. Кристаллы, материалы и кладовка не уходят никуда.
// Тот же снимок пойдёт на сервер, когда будет бэкенд: parseSnapshot проверяет любой
// чужой JSON по каталогу, а не доверяет ему.

import { itemById, slotById, TIERS, type ItemId, type SlotId } from './catalog';
import { den } from './state';
import { DECOR } from './decor';

export interface DenSnapshot {
  v: 1;
  tier: number;
  slots: Partial<Record<SlotId, ItemId>>;
  /** Дней с пройденным уровнем — столько деталей на поляне. */
  days: number;
}

/** Своя нора сейчас. */
export function snapshot(days: number): DenSnapshot {
  return { v: 1, tier: den.tier, slots: { ...den.slots }, days: Math.min(days, DECOR.length) };
}

/** Чужая нора из ссылки или с сервера; null — формат не наш или версия новее. */
export function parseSnapshot(raw: unknown): DenSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const tier = Number(r.tier);
  if (!Number.isInteger(tier) || tier < 0 || tier >= TIERS.length) return null;
  const slots: DenSnapshot['slots'] = {};
  if (r.slots && typeof r.slots === 'object') {
    for (const [slot, id] of Object.entries(r.slots as Record<string, unknown>)) {
      const item = typeof id === 'string' ? itemById(id) : undefined;
      const def = slotById(slot);
      // Вещь из другого места или место, которое на этом уровне ещё закрыто, — мимо
      if (item && def && item.slot === def.id && def.tier <= tier) slots[def.id] = item.id;
    }
  }
  const days = Math.max(0, Math.min(DECOR.length, Math.floor(Number(r.days) || 0)));
  return { v: 1, tier, slots, days };
}

/** Короткий код для ссылки: JSON в base64url. В снимке только латиница и цифры. */
export function encodeSnapshot(s: DenSnapshot): string {
  return btoa(JSON.stringify(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSnapshot(code: string): DenSnapshot | null {
  try {
    return parseSnapshot(JSON.parse(atob(code.replace(/-/g, '+').replace(/_/g, '/'))));
  } catch {
    return null;
  }
}

const HASH = '#den=';

/** Ссылка на игру, которая сразу открывает эту нору в гостях. */
export function shareUrl(s: DenSnapshot): string {
  return location.origin + location.pathname + HASH + encodeSnapshot(s);
}

/** Нора из адреса страницы: undefined — ссылки нет, null — она испорчена. */
export function snapshotFromUrl(): DenSnapshot | null | undefined {
  if (!location.hash.startsWith(HASH)) return undefined;
  return decodeSnapshot(location.hash.slice(HASH.length));
}

/** Убрать нору из адреса — после визита «назад» и перезагрузка ведут в свою игру. */
export function clearUrl(): void {
  if (location.hash.startsWith(HASH)) history.replaceState(null, '', location.pathname + location.search);
}
