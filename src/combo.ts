// Серия быстрых сборов: кристаллы подряд, каждый не позже окна после предыдущего.
// Время — по часам уровня, так что пауза и настройки серию не обрывают.

import { clamp } from './utils';

/** Сколько секунд после кристалла ждать следующий, чтобы серия не оборвалась. */
export const COMBO_WINDOW = 3;

/** Ступень серии для вида счётчика: 0 — до ×5, 1 — до ×10, 2 — дальше. */
export const comboTier = (count: number): number => (count >= 10 ? 2 : count >= 5 ? 1 : 0);

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

  /** Взято n кристаллов в момент t; best — рекорд серии на этот момент. Возвращает длину серии. */
  add(n: number, t: number, best: number): number {
    if (this.count > 0 && t - this.last < COMBO_WINDOW) {
      this.count += n;
    } else {
      this.bestBefore = best;
      this.count = n;
    }
    this.last = t;
    return this.count;
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
