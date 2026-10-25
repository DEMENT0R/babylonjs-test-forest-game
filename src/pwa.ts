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
const isAndroid = /Android/.test(ua);

/** Сколько ждать окна установки после нажатия: Chrome присылает его не сразу после открытия страницы. */
const PROMPT_WAIT_MS = 4000;

/** Как поставить игру вручную на Android — у каждого браузера свой пункт меню. */
function androidInstallHint(): string {
  // Встроенный браузер Telegram, VK и т. п. ставить сайты не умеет
  if (/; wv\)/.test(ua)) return 'Это встроенный браузер приложения — открой игру в Chrome через меню «Открыть в браузере»';
  if (/YaBrowser|YaSearchBrowser/.test(ua)) return 'В Яндекс Браузере открой меню ⋮ и выбери «Добавить ярлык». Как полноценное приложение игра ставится из Chrome';
  if (/SamsungBrowser/.test(ua)) return 'В Samsung Internet нажми ⤓ в адресной строке или открой меню ☰ → «Добавить страницу на» → «Главный экран»';
  if (/Firefox/.test(ua)) return 'В Firefox открой меню ⋮ и выбери «Установить» или «Добавить на главный экран»';
  if (/Chrome\//.test(ua) && !/EdgA|OPR|MiuiBrowser|HuaweiBrowser|HeyTapBrowser/.test(ua)) {
    return 'В Chrome открой меню ⋮ и выбери «Установить приложение» или «Добавить на главный экран». Если игра уже установлена, открой её с главного экрана';
  }
  return 'Открой меню браузера и выбери «Установить приложение» или «Добавить на главный экран» — надёжнее всего это работает в Chrome';
}

/** Как поставить игру вручную, если браузер не дал своего окна установки. */
function manualInstallHint(): string {
  if (isIos) return 'Нажми «Поделиться» в Safari и выбери «На экран „Домой“»';
  if (isAndroid) return androidInstallHint();
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
  // Нажали раньше, чем браузер прислал окно установки, — отдать событие прямо ожидающему
  let waiter: ((e: InstallPromptEvent | null) => void) | null = null;
  addEventListener('beforeinstallprompt', (e) => {
    // Своя кнопка вместо баннера браузера
    e.preventDefault();
    if (waiter) waiter(e as InstallPromptEvent);
    else deferred = e as InstallPromptEvent;
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
    note('✓ Игра установлена — её можно запускать с главного экрана');
  });

  /** Подождать окна установки, если браузер вообще умеет его присылать (Chromium). */
  const waitForPrompt = (): Promise<InstallPromptEvent | null> => {
    if (!('onbeforeinstallprompt' in window)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(null), PROMPT_WAIT_MS);
      const done = (e: InstallPromptEvent | null) => {
        clearTimeout(timer);
        waiter = null;
        resolve(e);
      };
      waiter = done;
    });
  };

  btn.addEventListener('click', async () => {
    if (waiter) return;
    let prompt = deferred;
    deferred = null;
    if (!prompt) {
      note('Браузер готовит установку…');
      prompt = await waitForPrompt();
      if (!prompt) {
        note(manualInstallHint());
        return;
      }
    }
    // Окно установки показывается один раз на событие; после отказа браузер пришлёт новое
    try {
      await prompt.prompt();
    } catch {
      // Пока ждали, нажатие «остыло» — браузер требует нового
      deferred = prompt;
      note('Всё готово — нажми «Установить» ещё раз');
    }
  });
}
