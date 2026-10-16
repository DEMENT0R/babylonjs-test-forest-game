// Мелкие общие помощники без зависимостей от остального кода.

export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/** Время в секундах с момента загрузки страницы. */
export const now = (): number => performance.now() / 1000;

/** Приводит угол к диапазону (-π, π] — для плавного поворота кратчайшим путём. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Экспоненциальное сглаживание с шагом, независимым от частоты кадров (в разумных пределах). */
export const damp = (rate: number, dt: number): number => Math.min(1, rate * dt);

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`В разметке нет элемента #${id}`);
  return el as T;
}
