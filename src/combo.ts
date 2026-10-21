// Серия быстрых сборов: кристаллы подряд, каждый не позже окна после предыдущего.
// Время — по часам уровня, так что пауза и настройки серию не обрывают.

import { clamp } from './utils';

/** Сколько секунд после кристалла ждать следующий, чтобы серия не оборвалась. */
export const COMBO_WINDOW = 5;

/** Ступень серии для вида счётчика: 0 — до ×5, 1 — до ×10, 2 — дальше. */
export const comboTier = (count: number): number => (count >= 10 ? 2 : count >= 5 ? 1 : 0);

/** С какой длины серии дует «ветер в спину» — и держится, пока серия не оборвётся. */
export const WIND_FROM = 5;

/** Ступени серии, за которые дают материалы для норы: длина серии → сколько штук. */
const REWARDS: readonly (readonly [count: number, mats: number])[] = [[3, 1], [5, 1], [10, 2]];

/** Сколько материалов положено за рост серии с prev до count (ступени могут проскочить разом). */
const rewardFor = (prev: number, count: number): number =>
  REWARDS.reduce((sum, [at, mats]) => (prev < at && count >= at ? sum + mats : sum), 0);

/** Что дал очередной сбор. */
export interface ComboStep {
  count: number;
  /** Материалов для норы за пройденные ступени; 0 — ступени не было. */
  reward: number;
}

/** Итог оборвавшейся серии. */
export interface ComboEnd {
  count: number;
  /** Побит рекорд, который был до начала серии (короткие серии не в счёт). */
  record: boolean;
}

export class Combo {
  /** Кристаллов в текущей серии; 0 — серии нет. */
  count = 0;
  private last = -Infinity;
  /** Рекорд до начала текущей серии — чтобы в конце сказать, побит ли он. */
  private bestBefore = 0;

  /** Взято n кристаллов в момент t; best — рекорд серии на этот момент. */
  add(n: number, t: number, best: number): ComboStep {
    let prev = this.count;
    if (prev > 0 && t - this.last < COMBO_WINDOW) {
      this.count += n;
    } else {
      this.bestBefore = best;
      this.count = n;
      prev = 0;
    }
    this.last = t;
    return { count: this.count, reward: rewardFor(prev, this.count) };
  }

  /** Доля окна, что ещё осталась: 1 — кристалл только что взят, 0 — окно вышло. */
  left(t: number): number {
    return this.count > 0 ? clamp(1 - (t - this.last) / COMBO_WINDOW, 0, 1) : 0;
  }

  /** Окно вышло — серия обрывается; возвращает её итог или null, если обрываться нечему. */
  expire(t: number): ComboEnd | null {
    if (this.count === 0 || t - this.last < COMBO_WINDOW) return null;
    const end = { count: this.count, record: this.count >= 3 && this.count > this.bestBefore };
    this.count = 0;
    return end;
  }

  reset(): void {
    this.count = 0;
    this.last = -Infinity;
  }
}
