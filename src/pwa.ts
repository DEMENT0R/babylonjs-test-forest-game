// Офлайн и обновления: service worker из vite-plugin-pwa кэширует всю сборку.
// Новую версию он только скачивает — плашка в меню предлагает перезапустить игру,
// чтобы перезагрузка не оборвала забег посреди уровня.

import { registerSW } from 'virtual:pwa-register';
import { byId } from './utils';

/** Как часто спрашивать сервер о новой версии, пока игра открыта. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

export function setupPwa(): void {
  const el = byId('menu-update');
  const text = byId('menu-update-text');
  const btn = byId<HTMLButtonElement>('menu-update-btn');

  const updateSW = registerSW({
    onNeedRefresh() {
      text.textContent = 'Вышла новая версия игры';
      btn.hidden = false;
      el.hidden = false;
    },
    onOfflineReady() {
      text.textContent = '✓ Игра сохранена — теперь запускается и без сети';
      btn.hidden = true;
      el.hidden = false;
      setTimeout(() => (el.hidden = true), 6000);
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine && !reg.installing) void reg.update().catch(() => {});
      };
      setInterval(check, CHECK_EVERY_MS);
      // Игру часто сворачивают надолго — проверить, вернувшись
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Обновляю…';
    void updateSW(true);
  });
}
