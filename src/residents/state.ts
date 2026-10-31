// Жители в localStorage: кого уже встретили, на каком шаге цепочки просьб и выполнена ли
// текущая просьба на уровнях (тогда осталось прийти к жителю).

import { RESIDENTS, type RequestStep, type ResidentDef, type ResidentId } from './catalog';

export interface ResidentState {
  /** Уже познакомились. */
  met: boolean;
  /** Номер текущей просьбы; равен длине цепочки — всё выполнено. */
  step: number;
  /** Просьба выполнена на уровне (вещь найдена, задание пройдено) — осталось прийти к жителю. */
  ready: boolean;
  /** День (номер от эпохи), когда житель у норы последний раз приносил подарок. */
  gift?: number;
}

/** Номер сегодняшнего дня от эпохи — для подарков и реплики дня. */
export const dayNumber = (): number => Math.floor(Date.now() / 86_400_000);
/** Подарки копятся не дольше стольких дней: житель не набивает кладовую, пока тебя нет. */
const GIFT_DAYS = 3;

const KEY = 'tihaya-polyana-residents';

function load(): Partial<Record<ResidentId, ResidentState>> {
  const out: Partial<Record<ResidentId, ResidentState>> = {};
  try {
    // carrying — прежнее имя ready, когда просьбы были только про потерянные вещи
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, Partial<ResidentState> & { carrying?: boolean }> | null;
    for (const r of RESIDENTS) {
      const s = raw?.[r.id];
      if (!s || typeof s !== 'object') continue;
      const step = Math.max(0, Math.min(r.steps.length, Math.floor(Number(s.step) || 0)));
      const gift = Number.isInteger(s.gift) ? s.gift : undefined;
      out[r.id] = { met: !!s.met, step, ready: !!(s.ready ?? s.carrying) && step < r.steps.length, gift };
    }
  } catch {
    // Повреждённые данные — знакомиться заново
  }
  return out;
}

const states = load();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(states));
  } catch {
    // Хранилище недоступно — проживёт до перезагрузки
  }
}

export const stateOf = (r: ResidentDef): ResidentState => states[r.id] ?? { met: false, step: 0, ready: false };

/** Текущая просьба; null — цепочка пройдена. */
export const currentStep = (r: ResidentDef): RequestStep | null => r.steps[stateOf(r).step] ?? null;

export function meet(r: ResidentDef): void {
  states[r.id] = { ...stateOf(r), met: true };
  save();
}

/** Просьба выполнена на уровне — теперь прийти к жителю. */
export function markReady(r: ResidentDef): void {
  states[r.id] = { ...stateOf(r), ready: true };
  save();
}

/** Все просьбы выполнены — житель живёт у норы. */
export const isMoved = (r: ResidentDef): boolean => stateOf(r).step >= r.steps.length;

/** Кто живёт у норы. */
export const movedIn = (): ResidentDef[] => RESIDENTS.filter(isMoved);

/** Знакомы, и просьба ещё не выполнена до конца. */
export const isActive = (r: ResidentDef): boolean => stateOf(r).met && currentStep(r) !== null;

/** Просьба выполнена — к следующей. */
export function advance(r: ResidentDef): void {
  const s = stateOf(r);
  const step = Math.min(r.steps.length, s.step + 1);
  // Переехал к норе — первый подарок принесёт завтра
  states[r.id] = { met: true, step, ready: false, gift: step >= r.steps.length ? dayNumber() : s.gift };
  save();
}

/** Подарки жителей у норы с прошлого раза: кто и сколько дней; дни отмечаются как полученные. */
export function takeGifts(): { def: ResidentDef; days: number }[] {
  const today = dayNumber();
  const out: { def: ResidentDef; days: number }[] = [];
  for (const r of movedIn()) {
    if (r.perk.kind !== 'gift') continue;
    const s = stateOf(r);
    const days = Math.min(GIFT_DAYS, today - (s.gift ?? today - 1));
    if (days <= 0) continue;
    states[r.id] = { ...s, gift: today };
    out.push({ def: r, days });
  }
  if (out.length) save();
  return out;
}
