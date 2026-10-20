// Главное меню в три яруса: игра (продолжить, играть, лес дня), прогресс (плитки «Уровни»,
// «Небо», «Дневник»), служебное (настройки, в подвале — «Об игре»).
// Панель справа бывает с вкладками (Q/E, на геймпаде LB/RB) — как «Дневник».

import { Engine } from '@babylonjs/core';
import { ACHIEVEMENTS, isDone } from '../achievements';
import { CHANGELOG, GAME_VERSION, hasUnseenChanges, markChangesSeen, versionOf } from '../changelog';
import { BIOMES } from '../levels/biomes';
import { currentStreak, dailyBest, formatTime, progress as saved, todayKey, totalStars } from '../levels/progress';
import { recipeFor } from '../levels/recipes';
import { byId, plural } from '../utils';
import { growGarden, welcomeNote } from '../journal';
import { copyText, dailyShareText } from '../share';
import { JOURNAL_TABS } from './journal-panel';
import { seenStars, skyHtml } from './sky-panel';

const CREDITS = `
    <p>Разработка — <a href="https://github.com/DEMENT0R" target="_blank" rel="noopener">Максим Безрукавников</a>, при участии Claude (Anthropic).</p>
    <p>Движок — Babylon.js ${Engine.Version}.</p>
    <p>Волк и олень — Quaternius, Ultimate Animated Animals (CC0).</p>
    <p>Лиса — PixelMannen (CC0), риг и анимация @tomkranis (CC BY 4.0), из Khronos glTF Sample Assets.</p>
    <p>Звуки ветра, птиц и шагов синтезируются в браузере (Web Audio API).</p>
    <p>Шрифты — Unbounded и JetBrains Mono.</p>`;
/** Начинается с описания игры из шапки меню — его там видит только тот, кто ещё не играл. */
const howtoHtml = (): string => `
    <p>${byId('menu-sub').textContent}</p>
    <h5>Звёзды</h5>
    <p>За уровень — две звезды: за все кристаллы и за задание. Звёзды открывают новых героев и окрасы и зажигают созвездия на «Небе».</p>
    <h5>Лес дня</h5>
    <p>Одна раскладка на день, у всех одинаковая. Лучшее время за день видно в меню, результатом можно поделиться.</p>
    <h5>Дневник</h5>
    <p>Достижения, редкие кристаллы, записки путника и поляна у круга, которая растёт день за днём.</p>
    <p>Клавиши и геймпад — в настройках, во вкладке «Управление».</p>`;
/** Вкладка панели: разметка строится заново при каждом показе. */
export interface InfoTab { id: string; name: string; html: () => string }

type InfoKey = 'levels' | 'sky' | 'journal' | 'about';

const TITLES: Record<InfoKey, string> = { levels: 'Уровни', sky: 'Звёздное небо', journal: 'Дневник', about: 'Об игре' };
/** Пункт меню, который открывает панель, — на него возвращается фокус при закрытии. */
const OPENERS: Record<InfoKey, string> = { levels: 'm-levels', sky: 'm-sky', journal: 'm-journal', about: 'm-about' };

const TAB_HINT = (key: string, pad: string, cls: string) =>
  `<span class="${cls}" aria-hidden="true"><kbd class="key-only">${key}</kbd><kbd class="pad-only">${pad}</kbd></span>`;

const SHARE_LABEL = 'Поделиться результатом дня ⧉';

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const changesHtml = (): string =>
  CHANGELOG.map(
    (d, i) => `<h5>${versionOf(i)} · <time datetime="${d.date}">${dateFmt.format(new Date(`${d.date}T12:00:00`)).replace(/\s?г\.$/, '')}</time></h5><ul>${d.items.map((i) => `<li>${i}</li>`).join('')}</ul>`,
  ).join('');

export interface MenuActions {
  onContinue: () => void;
  onNewGame: () => void;
  onChangeHero: () => void;
  onSettings: () => void;
  onPickLevel: (index: number) => void;
  onDaily: () => void;
}

/** Прогресс текущей игры; null — игра ещё не начата. */
export interface MenuProgress { heroName: string; place: string; got: number; total: number }

const levelName = (i: number) => BIOMES[recipeFor(i).biome].name;
const starHtml = (got: boolean, what: string) =>
  `<span class="star${got ? '' : ' off'}" title="${what}${got ? '' : ' — нет'}">★</span>`;

export class MainMenu {
  private readonly root = byId('menu');
  private readonly info = byId('menu-info');
  private readonly infoTitle = byId('menu-info-title');
  private readonly infoBody = byId('menu-info-body');
  private readonly infoTabs = byId('menu-info-tabs');
  private readonly progressEl = byId('menu-progress');
  private readonly btnContinue = byId('m-continue');
  private readonly btnHero = byId('m-hero');
  private readonly btnNew = byId('m-new');
  private readonly btnSettings = byId('m-settings');
  private readonly changesDot = byId('m-changes-dot');
  private infoOpen: InfoKey | null = null;
  /** Последняя открытая вкладка каждой панели — пока страница не перезагружена. */
  private readonly tabOf: Partial<Record<InfoKey, string>> = {};

  constructor(actions: MenuActions) {
    byId('m-version').textContent = `v${GAME_VERSION}`;
    this.btnContinue.addEventListener('click', actions.onContinue);
    this.btnNew.addEventListener('click', actions.onNewGame);
    this.btnHero.addEventListener('click', () => {
      this.closeInfo();
      actions.onChangeHero();
    });
    this.btnSettings.addEventListener('click', actions.onSettings);
    byId('m-daily-share').addEventListener('click', () => void this.shareDaily());
    byId('m-daily').addEventListener('click', () => {
      this.closeInfo();
      actions.onDaily();
    });
    for (const key of Object.keys(OPENERS) as InfoKey[]) {
      byId(OPENERS[key]).addEventListener('click', () => this.toggleInfo(key));
    }
    byId('menu-info-close').addEventListener('click', () => this.closeInfo(true));
    byId('menu-news').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (b) this.openTab('journal', b.dataset.tab!);
    });
    this.infoTabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (t) this.selectTab(t.dataset.tab!, true);
    });
    this.infoBody.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-level]');
      if (!b) return;
      this.closeInfo();
      actions.onPickLevel(Number(b.dataset.level));
    });
    this.changesDot.hidden = !hasUnseenChanges();
  }

  get isInfoOpen(): boolean {
    return this.infoOpen !== null;
  }

  update(progress: MenuProgress | null): void {
    const started = progress !== null;
    this.btnContinue.hidden = !started;
    // Во время игры главное — «Продолжить», перезапуск уходит во второй ряд
    this.btnNew.textContent = started ? 'Начать уровень заново' : `Играть · уровень ${saved.current}`;
    this.btnNew.classList.toggle('minor', started);
    this.progressEl.hidden = !started;
    if (progress) {
      byId('menu-place').textContent = progress.place;
      this.btnHero.textContent = `${progress.heroName} ↺`;
      byId('menu-got').textContent = String(progress.got);
      byId('menu-total').textContent = String(progress.total);
    }
    // Описание игры нужно только тому, кто ещё не играл
    byId('menu-sub').hidden = started || Object.keys(saved.records).length > 0;
    byId('m-levels-count').textContent = `открыто ${saved.unlocked}`;
    byId('m-journal-count').textContent = `🏅 ${ACHIEVEMENTS.filter(isDone).length}/${ACHIEVEMENTS.length}`;
    if (this.infoOpen === 'levels') this.renderInfo();
    this.syncSky();
    const best = dailyBest(todayKey());
    byId('m-daily-best').textContent = best === undefined ? 'новый' : `рекорд ${formatTime(best)}`;
    byId('m-daily-share').hidden = best === undefined;
    this.syncNews();
  }

  /** Копирует результат Леса дня для чата; отклик — на самой кнопке. */
  private async shareDaily(): Promise<void> {
    const text = dailyShareText(todayKey());
    if (!text) return;
    const btn = byId('m-daily-share');
    btn.textContent = (await copyText(text)) ? 'Скопировано ✓ — вставь в чат' : 'Не удалось скопировать';
    setTimeout(() => (btn.textContent = SHARE_LABEL), 2500);
  }

  /**
   * Новости в шапке, важное сверху: записка у круга и сад (ведут в «Находки» дневника),
   * огонёк серии — сколько дней подряд пройден уровень, и напоминание, если сегодня ещё нет.
   */
  private syncNews(): void {
    const items: string[] = [];
    const link = (tab: string, html: string) => `<li><button type="button" class="link" data-tab="${tab}">${html}</button></li>`;
    if (welcomeNote) items.push(link('finds', '✉ Пока тебя не было, у каменного круга оставили записку'));
    const ready = growGarden();
    if (ready) {
      items.push(link('finds', `✦ В саду у каменного круга ${plural(ready, 'вырос', 'выросло', 'выросло')} ${ready} ${plural(ready, 'кристалл', 'кристалла', 'кристаллов')}`));
    }
    const { days, today } = currentStreak();
    if (days) items.push(`<li>🔥 ${days} ${plural(days, 'день', 'дня', 'дней')} подряд${today ? '' : ' <span>· пройди уровень сегодня, чтобы не прервать</span>'}</li>`);
    const el = byId('menu-news');
    el.hidden = !items.length;
    el.innerHTML = items.join('');
  }

  /** Открыть панель сразу на нужной вкладке (или переключить вкладку уже открытой). */
  private openTab(key: InfoKey, tab: string): void {
    this.tabOf[key] = tab;
    if (this.infoOpen === key) this.selectTab(tab);
    else this.toggleInfo(key);
  }

  /** Число звёзд у пункта «Небо» и точка, если есть звёзды, которых игрок ещё не видел на небе. */
  private syncSky(): void {
    const total = totalStars();
    byId('m-sky-count').textContent = `★ ${total}`;
    byId('m-sky-dot').hidden = total <= seenStars();
  }

  focusFirst(): void {
    this.root.querySelector<HTMLElement>('.menu-list button:not([hidden])')?.focus();
  }

  focusSettings(): void {
    this.btnSettings.focus();
  }

  /** refocus — вернуть фокус на пункт, открывший панель (когда закрывают её саму). */
  closeInfo(refocus = false): void {
    const was = this.infoOpen;
    this.infoOpen = null;
    this.info.hidden = true;
    this.root.classList.remove('info-open');
    for (const id of Object.values(OPENERS)) byId(id).setAttribute('aria-expanded', 'false');
    if (refocus && was) byId(OPENERS[was]).focus();
  }

  private toggleInfo(key: InfoKey): void {
    if (this.infoOpen === key) {
      this.closeInfo(true);
      return;
    }
    this.closeInfo();
    // С непрочитанными новостями «Об игре» открывается сразу на них
    if (key === 'about' && hasUnseenChanges()) this.tabOf.about = 'changes';
    this.infoOpen = key;
    this.info.hidden = false;
    this.root.classList.add('info-open');
    byId(OPENERS[key]).setAttribute('aria-expanded', 'true');
    this.infoTitle.textContent = TITLES[key];
    this.renderInfo();
    this.infoBody.scrollTop = 0;
    if (key === 'sky') this.syncSky();
    // Когда панель закрывает меню целиком (телефон), фокус переезжает в неё
    const target =
      key === 'levels'
        ? this.infoBody.querySelector<HTMLElement>('[aria-current="true"]')
        : this.coversMenu()
          ? byId('menu-info-close')
          : null;
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }

  /** Содержимое панели: одна страница или вкладки. */
  private content(key: InfoKey): string | InfoTab[] {
    switch (key) {
      case 'levels': return this.levelsHtml();
      case 'sky': return skyHtml(totalStars());
      case 'journal': return JOURNAL_TABS;
      case 'about':
        return [
          { id: 'howto', name: 'Как играть', html: howtoHtml },
          { id: 'changes', name: 'Что нового', html: changesHtml },
          { id: 'credits', name: 'Авторы', html: () => CREDITS },
        ];
    }
  }

  private renderInfo(): void {
    const key = this.infoOpen!;
    const c = this.content(key);
    this.infoTabs.hidden = typeof c === 'string';
    if (typeof c === 'string') {
      this.infoBody.removeAttribute('role');
      this.infoBody.removeAttribute('aria-labelledby');
      this.infoBody.innerHTML = c;
      return;
    }
    const cur = c.find((t) => t.id === this.tabOf[key]) ?? c[0];
    this.tabOf[key] = cur.id;
    const tab = (t: InfoTab) =>
      `<button type="button" role="tab" id="info-tab-${t.id}" data-tab="${t.id}" aria-controls="menu-info-body" aria-selected="${t === cur}" tabindex="${t === cur ? 0 : -1}">${t.name}</button>`;
    this.infoTabs.innerHTML = TAB_HINT('Q', 'LB', 'hint-l') + c.map(tab).join('') + TAB_HINT('E', 'RB', 'hint-r');
    this.infoBody.setAttribute('role', 'tabpanel');
    this.infoBody.setAttribute('aria-labelledby', `info-tab-${cur.id}`);
    this.infoBody.innerHTML = cur.html();
    if (cur.id === 'changes') {
      markChangesSeen();
      this.changesDot.hidden = true;
    }
  }

  /** Вкладки открытой панели; null — панель без вкладок или закрыта. */
  private tabs(): InfoTab[] | null {
    const c = this.infoOpen && this.content(this.infoOpen);
    return Array.isArray(c) ? c : null;
  }

  /** focus — перевести фокус на выбранную вкладку (выбрали её с клавиатуры или геймпада). */
  private selectTab(id: string, focus = false): void {
    if (!this.infoOpen) return;
    this.tabOf[this.infoOpen] = id;
    this.renderInfo();
    this.infoBody.scrollTop = 0;
    if (focus) byId(`info-tab-${id}`).focus();
  }

  /** Соседняя вкладка открытой панели по кругу; у панели без вкладок — ничего. */
  switchTab(delta: number): void {
    const tabs = this.tabs();
    if (!tabs) return;
    const i = tabs.findIndex((t) => t.id === this.tabOf[this.infoOpen!]);
    this.selectTab(tabs[(i + delta + tabs.length) % tabs.length].id, true);
  }

  /** Панель поверх меню, а не рядом с ним — так её раскладывают стили на узком экране. */
  private coversMenu(): boolean {
    return getComputedStyle(this.root.querySelector('.menu-col')!).display === 'none';
  }

  /** Открытые уровни: биом, звёзды за кристаллы и задание, лучшее время. */
  private levelsHtml(): string {
    const rows: string[] = [];
    for (let i = 1; i <= saved.unlocked; i++) {
      const r = saved.records[i];
      const stars = r ? `${starHtml(r.star, 'все кристаллы')}${starHtml(r.quest ?? false, 'задание')} ` : '';
      const meta = r ? `${stars}${formatTime(r.time)}` : 'не пройден';
      rows.push(
        `<button type="button" data-level="${i}" aria-current="${i === saved.current}"><b>${i}</b>${levelName(i)}<span>${meta}</span></button>`,
      );
    }
    return `<p>Две звезды за уровень: за все кристаллы и за задание.</p><div class="level-list">${rows.join('')}</div>`;
  }

  /**
   * Клавиши меню: Esc закрывает открытую панель, стрелки вверх/вниз ходят по пунктам
   * (или по уровням в открытом списке), влево/вправо — по плиткам и ссылкам подвала. Возвращает true, если клавиша обработана.
   */
  handleKey(e: KeyboardEvent): boolean {
    if (e.code === 'Escape' && this.infoOpen) {
      e.preventDefault();
      this.closeInfo(true);
      return true;
    }
    const onTab = (document.activeElement as HTMLElement | null)?.getAttribute('role') === 'tab';
    if ((e.code === 'KeyQ' || e.code === 'KeyE' || (onTab && (e.code === 'ArrowLeft' || e.code === 'ArrowRight'))) && this.tabs()) {
      e.preventDefault();
      this.switchTab(e.code === 'KeyQ' || e.code === 'ArrowLeft' ? -1 : 1);
      return true;
    }
    // Влево-вправо — только по соседним плиткам или ссылкам в одном ряду
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const row = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.menu-tiles, .menu-foot');
      if (!row) return false;
      e.preventDefault();
      const items = [...row.querySelectorAll<HTMLElement>('button')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.code === 'ArrowRight' ? 1 : -1) + items.length) % items.length].focus();
      return true;
    }
    if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return false;
    e.preventDefault();
    const inInfo = this.info.contains(document.activeElement);
    const scope = inInfo ? this.info : this.root.querySelector<HTMLElement>('.menu-col')!;
    const items = [...scope.querySelectorAll<HTMLElement>('button')].filter((b) => b.tabIndex >= 0 && b.getClientRects().length > 0);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const step = e.code === 'ArrowDown' ? 1 : -1;
    const next = items[i < 0 ? 0 : (i + step + items.length) % items.length];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
    return true;
  }
}
