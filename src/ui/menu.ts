// Главное меню: пункты, прогресс текущей игры, справка по управлению и авторы.

import { Engine } from '@babylonjs/core';
import { byId } from '../utils';

const INFO = {
  help: `<h4>Управление</h4><dl>
    <dt>WASD / стрелки</dt><dd>движение</dd><dt>Shift</dt><dd>бег</dd><dt>Space</dt><dd>прыжок</dd>
    <dt>Мышь</dt><dd>повернуть камеру; в режиме «из-за плеча» клик захватывает курсор</dd>
    <dt>Колесо</dt><dd>приблизить или отдалить камеру</dd><dt>C</dt><dd>режим камеры: из-за плеча, за спиной, свободная</dd>
    <dt>H</dt><dd>сменить героя</dd><dt>O</dt><dd>настройки</dd><dt>Esc</dt><dd>пауза и главное меню</dd>
    <dt>Телефон</dt><dd>стик слева, кнопка прыжка справа, свайп поворачивает камеру</dd></dl>`,
  about: `<h4>Авторы</h4>
    <p>Движок — Babylon.js ${Engine.Version}.</p>
    <p>Волк и олень — Quaternius, Ultimate Animated Animals (CC0).</p>
    <p>Лиса — PixelMannen (CC0), риг и анимация @tomkranis (CC BY 4.0), из Khronos glTF Sample Assets.</p>
    <p>Шрифты — Unbounded и JetBrains Mono.</p>`,
} as const;
type InfoKey = keyof typeof INFO;

export interface MenuActions {
  onContinue: () => void;
  onNewGame: () => void;
  onChangeHero: () => void;
  onSettings: () => void;
}

/** Прогресс текущей игры; null — игра ещё не начата. */
export interface MenuProgress { heroName: string; got: number; total: number }

export class MainMenu {
  private readonly info = byId('menu-info');
  private readonly progressEl = byId('menu-progress');
  private readonly btnContinue = byId('m-continue');
  private readonly btnHero = byId('m-hero');
  private readonly btnNew = byId('m-new');
  private readonly btnSettings = byId('m-settings');
  private infoOpen: InfoKey | null = null;

  constructor(actions: MenuActions) {
    this.btnContinue.addEventListener('click', actions.onContinue);
    this.btnNew.addEventListener('click', actions.onNewGame);
    this.btnHero.addEventListener('click', () => {
      this.closeInfo();
      actions.onChangeHero();
    });
    this.btnSettings.addEventListener('click', actions.onSettings);
    byId('m-help').addEventListener('click', () => this.toggleInfo('help'));
    byId('m-about').addEventListener('click', () => this.toggleInfo('about'));
  }

  update(progress: MenuProgress | null): void {
    const started = progress !== null;
    this.btnContinue.hidden = !started;
    this.btnHero.hidden = !started;
    this.btnNew.textContent = started ? 'Новая игра' : 'Играть';
    this.progressEl.hidden = !started;
    if (progress) this.progressEl.innerHTML = `${progress.heroName} · кристаллы <b>${progress.got}</b> / ${progress.total}`;
  }

  focusFirst(): void {
    document.querySelector<HTMLElement>('.menu-list button:not([hidden])')?.focus();
  }

  focusSettings(): void {
    this.btnSettings.focus();
  }

  closeInfo(): void {
    this.infoOpen = null;
    this.info.hidden = true;
  }

  private toggleInfo(key: InfoKey): void {
    this.infoOpen = this.infoOpen === key ? null : key;
    this.info.hidden = !this.infoOpen;
    if (this.infoOpen) this.info.innerHTML = INFO[this.infoOpen];
  }

  /** Стрелки вверх/вниз ходят по пунктам меню. Возвращает true, если клавиша обработана. */
  handleKey(e: KeyboardEvent): boolean {
    if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return false;
    e.preventDefault();
    const items = [...document.querySelectorAll<HTMLElement>('.menu-list button:not([hidden])')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const step = e.code === 'ArrowDown' ? 1 : -1;
    items[(i + step + items.length) % items.length].focus();
    return true;
  }
}
