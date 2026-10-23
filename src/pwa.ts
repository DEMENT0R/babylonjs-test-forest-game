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
const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

/** Как поставить игру вручную, если браузер не дал своего окна установки. */
function manualInstallHint(): string {
  if (isIos) return 'Нажми «Поделиться» в Safari и выбери «На экран „Домой“»';
  if (/Firefox/.test(ua)) return 'Firefox на компьютере не устанавливает сайты как приложения — открой игру в Chrome или Edge';
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'В Safari выбери «Файл» → «Добавить в Dock»';
  return 'Браузер пока не предлагает установку — поищи «Установить приложение» в его меню. Если игра уже установлена, открой её с рабочего стола';
}

/** Кнопка «Установить» в меню: видна, пока игра открыта во вкладке, а не как приложение. */
function setupInstall(note: (msg: string) => void): void {
  const btn = byId<HTMLButtonElement>('m-install');
  const installed = ['standalone', 'fullscreen', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches && !document.fullscreenElement)
    || (navigator as { standalone?: boolean }).standalone === true;
  if (installed) return;
  btn.hidden = false;

  let deferred: InstallPromptEvent | null = null;
  addEventListener('beforeinstallprompt', (e) => {
    // Своя кнопка вместо баннера браузера
    e.preventDefault();
    deferred = e as InstallPromptEvent;
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
    note('✓ Игра установлена — её можно запускать с главного экрана');
  });

  btn.addEventListener('click', async () => {
    if (!deferred) {
      note(manualInstallHint());
      return;
    }
    // Окно установки показывается один раз на событие; после отказа браузер пришлёт новое
    const prompt = deferred;
    deferred = null;
    await prompt.prompt();
  });
}
