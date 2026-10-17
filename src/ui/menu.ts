// Главное меню: пункты, прогресс текущей игры, справка по управлению и авторы.

import { Engine } from '@babylonjs/core';
import { BIOMES } from '../levels/biomes';
import { formatTime, progress as saved } from '../levels/progress';
import { recipeFor } from '../levels/recipes';
import { byId } from '../utils';

const INFO = {
  help: `<h4>Управление</h4><dl>
    <dt>WASD / стрелки</dt><dd>движение</dd><dt>Shift</dt><dd>бег</dd><dt>Space</dt><dd>прыжок</dd>
    <dt>Мышь</dt><dd>повернуть камеру; в режиме «из-за плеча» клик захватывает курсор</dd>
    <dt>Колесо</dt><dd>приблизить или отдалить камеру</dd><dt>C</dt><dd>режим камеры: из-за плеча, за спиной, свободная</dd>
    <dt>H</dt><dd>сменить героя</dd><dt>O</dt><dd>настройки</dd><dt>M</dt><dd>включить или выключить звук</dd><dt>F</dt><dd>во весь экран и обратно</dd><dt>Esc</dt><dd>пауза и главное меню</dd>
    <dt>Телефон</dt><dd>стик слева, кнопка прыжка справа, свайп поворачивает камеру</dd>
    <dt>Геймпад</dt><dd>левый стик — ходьба (до упора или с LB — бег), правый — камера, A — прыжок,
      Y — режим камеры, крестовина ↑↓ — зум, View — настройки, Start — пауза;
      в меню крестовина или стик выбирают пункт, A — нажать, B — назад, LB/RB — вкладки настроек</dd></dl>`,
  about: `<h4>Авторы</h4>
    <p>Разработка — <a href="https://github.com/DEMENT0R" target="_blank" rel="noopener">Максим Безрукавников</a>, при участии Claude (Anthropic).</p>
    <p>Движок — Babylon.js ${Engine.Version}.</p>
    <p>Волк и олень — Quaternius, Ultimate Animated Animals (CC0).</p>
    <p>Лиса — PixelMannen (CC0), риг и анимация @tomkranis (CC BY 4.0), из Khronos glTF Sample Assets.</p>
    <p>Звуки ветра, птиц и шагов синтезируются в браузере (Web Audio API).</p>
    <p>Шрифты — Unbounded и JetBrains Mono.</p>`,
} as const;
type InfoKey = keyof typeof INFO | 'levels';

export interface MenuActions {
  onContinue: () => void;
  onNewGame: () => void;
  onChangeHero: () => void;
  onSettings: () => void;
  onPickLevel: (index: number) => void;
}

/** Прогресс текущей игры; null — игра ещё не начата. */
export interface MenuProgress { heroName: string; level: number; got: number; total: number }

const levelName = (i: number) => BIOMES[recipeFor(i).biome].name;

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
    byId('m-levels').addEventListener('click', () => this.toggleInfo('levels'));
    this.info.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-level]');
      if (!b) return;
      this.closeInfo();
      actions.onPickLevel(Number(b.dataset.level));
    });
    byId('m-help').addEventListener('click', () => this.toggleInfo('help'));
    byId('m-about').addEventListener('click', () => this.toggleInfo('about'));
  }

  update(progress: MenuProgress | null): void {
    const started = progress !== null;
    this.btnContinue.hidden = !started;
    this.btnHero.hidden = !started;
    this.btnNew.textContent = started ? 'Начать уровень заново' : `Играть · уровень ${saved.current}`;
    this.progressEl.hidden = !started;
    if (progress) {
      this.progressEl.innerHTML = `Уровень ${progress.level} · ${progress.heroName} · кристаллы <b>${progress.got}</b> / ${progress.total}`;
    }
    if (this.infoOpen === 'levels') this.info.innerHTML = this.levelsHtml();
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
    if (this.infoOpen) this.info.innerHTML = this.infoOpen === 'levels' ? this.levelsHtml() : INFO[this.infoOpen];
    if (this.infoOpen === 'levels') this.info.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  }

  /** Открытые уровни: биом, звезда за все кристаллы и лучшее время. */
  private levelsHtml(): string {
    const rows: string[] = [];
    for (let i = 1; i <= saved.unlocked; i++) {
      const r = saved.records[i];
      const meta = r ? `${r.star ? '<span class="star">★</span> ' : ''}${formatTime(r.time)}` : 'не пройден';
      rows.push(
        `<button type="button" data-level="${i}" aria-current="${i === saved.current}"><b>${i}</b>${levelName(i)}<span>${meta}</span></button>`,
      );
    }
    return `<h4>Уровни</h4><p>Звезда — собраны все кристаллы уровня.</p><div class="level-list">${rows.join('')}</div>`;
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
