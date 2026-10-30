// Жители в localStorage: кого уже встретили, на каком шаге цепочки просьб и не несёт ли
// герой потерянную вещь хозяину.

import { RESIDENTS, type RequestStep, type ResidentDef, type ResidentId } from './catalog';

export interface ResidentState {
  /** Уже познакомились. */
  met: boolean;
  /** Номер текущей просьбы; равен длине цепочки — всё выполнено. */
  step: number;
  /** Потерянная вещь найдена и ждёт, когда её отдадут. */
  carrying: boolean;
}

const KEY = 'tihaya-polyana-residents';

function load(): Partial<Record<ResidentId, ResidentState>> {
  const out: Partial<Record<ResidentId, ResidentState>> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, Partial<ResidentState>> | null;
    for (const r of RESIDENTS) {
      const s = raw?.[r.id];
      if (!s || typeof s !== 'object') continue;
      const step = Math.max(0, Math.min(r.steps.length, Math.floor(Number(s.step) || 0)));
      out[r.id] = { met: !!s.met, step, carrying: !!s.carrying && step < r.steps.length };
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

export const stateOf = (r: ResidentDef): ResidentState => states[r.id] ?? { met: false, step: 0, carrying: false };

/** Текущая просьба; null — цепочка пройдена. */
export const currentStep = (r: ResidentDef): RequestStep | null => r.steps[stateOf(r).step] ?? null;

export function meet(r: ResidentDef): void {
  states[r.id] = { ...stateOf(r), met: true };
  save();
}

/** Потерянная вещь найдена — теперь её надо отнести. */
export function carry(r: ResidentDef): void {
  states[r.id] = { ...stateOf(r), carrying: true };
  save();
}

/** Просьба выполнена — к следующей. */
export function advance(r: ResidentDef): void {
  const s = stateOf(r);
  states[r.id] = { met: true, step: Math.min(r.steps.length, s.step + 1), carrying: false };
  save();
}
