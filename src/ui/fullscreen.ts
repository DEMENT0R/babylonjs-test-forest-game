// Полноэкранный режим: кнопка в HUD и клавиша F. Где браузер его не умеет (iPhone), кнопки нет.

import { byId } from '../utils';

const btn = byId('fullscreen');

export function toggleFullscreen(): void {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

function sync(): void {
  btn.innerHTML = `${document.fullscreenElement ? 'Окно' : 'Во весь экран'}<span class="kbd-hint"> (F)</span>`;
}

export function setupFullscreen(): void {
  btn.hidden = !document.fullscreenEnabled;
  btn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', sync);
  sync();
}
