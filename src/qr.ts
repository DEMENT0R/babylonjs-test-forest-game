// QR-код ссылки — чтобы делиться игрой вживую: навёл камеру телефона и открыл.

import qrcode from 'qrcode-generator';

/** Поля вокруг кода в модулях: меньше четырёх камеры читают хуже. */
const QUIET = 4;

/**
 * SVG QR-кода: тёмные модули на белом и одним путём — чётко при любом масштабе.
 * Уровень коррекции M держит блики на экране и не делает код слишком густым.
 */
export function qrSvg(text: string, label: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + QUIET * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  }
  return `<svg class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
}
