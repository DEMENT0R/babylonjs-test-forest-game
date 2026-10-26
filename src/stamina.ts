// Запал: силы на особые движения — рывок, высокий и двойной прыжок, планирование.
// Обычные бег и прыжок запал не тратят: он нужен только сверх них и сам восстанавливается.

/** Что умеет герой с запалом — база, апгрейды из норы и усилитель уровня. */
export interface Stamina {
  /** Сколько запала помещается. */
  max: number;
  /** Сколько восстанавливается в секунду. */
  regen: number;
  /** Второй прыжок в воздухе. */
  double: boolean;
  /** Планирование: зажатый прыжок при падении. */
  glide: boolean;
}

export const BASE_STAMINA: Readonly<Stamina> = { max: 100, regen: 15, double: false, glide: false };

/** Цена рывка, высокого и двойного прыжка; планирование тратит запал каждую секунду. */
export const DASH_COST = 40;
export const HIGH_JUMP_COST = 30;
export const DOUBLE_JUMP_COST = 35;
export const GLIDE_COST = 20;
/** Сколько запала даёт кристалл. */
export const CRYSTAL_ENERGY = 25;
/** Пауза после траты, прежде чем запал начнёт восстанавливаться, с. */
export const REGEN_DELAY = 1;
