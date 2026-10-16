// Геймпад: опрос стандартной раскладки (Xbox, PlayStation, Switch Pro) раз в кадр,
// мёртвая зона стиков, нажатия «по фронту» и автоповтор направлений для меню.

import { now } from './utils';

/** Кнопки стандартной раскладки W3C Gamepad. */
export const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;
type Button = (typeof BTN)[keyof typeof BTN];

export type NavDir = 'up' | 'down' | 'left' | 'right';

const DEAD_ZONE = 0.2;
/** Отклонение стика, которое в меню считается направлением. */
const NAV_THRESHOLD = 0.6;
const REPEAT_DELAY = 0.4;
const REPEAT_RATE = 0.11;

/** Стик с круглой мёртвой зоной; за её пределами отклонение снова растёт от 0 до 1. */
function stick(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEAD_ZONE) return [0, 0];
  const k = Math.min(1, (m - DEAD_ZONE) / (1 - DEAD_ZONE)) / m;
  return [x * k, y * k];
}

class GamepadInput {
  /** Есть ли подключённый геймпад. */
  connected = false;
  /** Левый и правый стик, -1…1 (y вниз, как в Gamepad API). */
  readonly move = { x: 0, y: 0 };
  readonly look = { x: 0, y: 0 };
  /** Геймпадом пользовались в этом кадре (для подсказок по кнопкам). */
  used = false;

  private held: boolean[] = [];
  private prev: boolean[] = [];
  private navDir: NavDir | null = null;
  private navNext = 0;
  private navFired: NavDir | null = null;

  /** Прочитать состояние; вызывать один раз в начале кадра. */
  poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    // Из нескольких геймпадов слушаем тот, которым пользовались последним
    let gp: Gamepad | null = null;
    for (const p of pads) if (p?.connected && (!gp || p.timestamp > gp.timestamp)) gp = p;
    this.connected = !!gp;
    this.prev = this.held;
    if (!gp) {
      this.held = [];
      this.move.x = this.move.y = this.look.x = this.look.y = 0;
      this.used = false;
      this.navDir = this.navFired = null;
      return;
    }
    this.held = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    const a = gp.axes;
    [this.move.x, this.move.y] = stick(a[0] ?? 0, a[1] ?? 0);
    [this.look.x, this.look.y] = stick(a[2] ?? 0, a[3] ?? 0);
    this.used = this.held.some(Boolean) || this.move.x !== 0 || this.move.y !== 0 || this.look.x !== 0 || this.look.y !== 0;
    this.updateNav();
  }

  /** Кнопка зажата. */
  down(b: Button): boolean {
    return !!this.held[b];
  }

  /** Кнопку нажали в этом кадре. */
  pressed(b: Button): boolean {
    return !!this.held[b] && !this.prev[b];
  }

  /** Считать нажатие уже обработанным, чтобы до отпускания его не увидел никто другой. */
  consume(b: Button): void {
    this.prev[b] = true;
  }

  /** Направление крестовины или левого стика для меню: сразу при нажатии, потом с автоповтором. */
  nav(): NavDir | null {
    return this.navFired;
  }

  private updateNav(): void {
    const { x, y } = this.move;
    let dir: NavDir | null = null;
    if (this.down(BTN.UP)) dir = 'up';
    else if (this.down(BTN.DOWN)) dir = 'down';
    else if (this.down(BTN.LEFT)) dir = 'left';
    else if (this.down(BTN.RIGHT)) dir = 'right';
    else if (Math.max(Math.abs(x), Math.abs(y)) > NAV_THRESHOLD) {
      dir = Math.abs(y) >= Math.abs(x) ? (y < 0 ? 'up' : 'down') : x < 0 ? 'left' : 'right';
    }
    const t = now();
    this.navFired = null;
    if (dir !== this.navDir) {
      this.navDir = dir;
      this.navFired = dir;
      this.navNext = t + REPEAT_DELAY;
    } else if (dir && t >= this.navNext) {
      this.navFired = dir;
      this.navNext = t + REPEAT_RATE;
    }
  }
}

export const gamepad = new GamepadInput();
