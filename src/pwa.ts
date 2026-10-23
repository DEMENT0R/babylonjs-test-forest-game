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

  setupInstall((msg) => {
    text.textContent = msg;
    btn.hidden = true;
    el.hidden = false;
  });
}

/** Событие установки из Chromium; в типах DOM его пока нет. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ua = navigator.userAgent;
/** Safari на iPhone и iPad: API установки нет, ставят через «Поделиться». */
const isIosSafari = (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) && !/CriOS|FxiOS|EdgiOS/.test(ua);

/** Кнопка «Установить» в меню: видна, пока игра открыта во вкладке и браузер умеет её поставить. */
function setupInstall(note: (msg: string) => void): void {
  const btn = byId<HTMLButtonElement>('m-install');
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return;

  let deferred: InstallPromptEvent | null = null;
  addEventListener('beforeinstallprompt', (e) => {
    // Своя кнопка вместо баннера браузера
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    btn.hidden = false;
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
    note('✓ Игра установлена — её можно запускать с главного экрана');
  });
  if (isIosSafari) btn.hidden = false;

  btn.addEventListener('click', async () => {
    if (!deferred) {
      if (isIosSafari) note('Нажми «Поделиться» в Safari и выбери «На экран „Домой“»');
      return;
    }
    // Окно установки показывается один раз на событие; после отказа браузер пришлёт новое
    const prompt = deferred;
    deferred = null;
    btn.hidden = true;
    await prompt.prompt();
  });
}
