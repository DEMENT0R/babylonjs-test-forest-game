// Что за устройство: телефон или компьютер и насколько он силён —
// для настроек графики по умолчанию при первом запуске.

const ua = navigator.userAgent;

/** Телефон или планшет (iPadOS притворяется Mac, но выдаёт себя сенсорным экраном). */
export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

export type DeviceTier = 'weak' | 'mid' | 'strong';

/**
 * Грубая оценка мощности по видеочипу, ядрам и памяти.
 * renderer — строка WebGL-рендерера (браузер может её скрыть, тогда судим по остальному).
 */
export function deviceTier(renderer: string): DeviceTier {
  const gpu = renderer.toLowerCase();
  // Программный рендер — без видеокарты вовсе
  if (/swiftshader|llvmpipe|softpipe|basic render/.test(gpu)) return 'weak';
  if (!isMobile) return 'strong';

  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const adreno = /adreno[^\d]*(\d{3})/.exec(gpu);
  const mali = /mali-g(\d+)/.exec(gpu);
  // Флагманы последних лет: Adreno 640+ (Snapdragon 855 и новее), Mali-G7x/G610+, Immortalis, Apple
  const strongGpu =
    (adreno && +adreno[1] >= 640) ||
    (mali && (+mali[1] >= 610 || (+mali[1] >= 76 && +mali[1] < 100))) ||
    /immortalis|xclipse|apple/.test(gpu);
  if (strongGpu && memory >= 4) return 'mid';
  if (!adreno && !mali && cores >= 8 && memory >= 8) return 'mid';
  return 'weak';
}
