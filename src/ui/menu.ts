// Главное меню в три яруса: игра (продолжить, играть, лес дня), прогресс (плитки «Уровни»,
// «Небо», «Дневник»), служебное (настройки, в подвале — «Об игре»).
// Панель справа бывает с вкладками (Q/E, на геймпаде LB/RB) — как «Дневник».

import { Engine } from '@babylonjs/core';
import { ACHIEVEMENTS, isDone } from '../achievements';
import { CHANGELOG, GAME_VERSION, hasUnseenChanges, markChangesSeen, versionOf } from '../changelog';
import { BIOMES } from '../levels/biomes';
import { currentStreak, dailyBest, formatTime, progress as saved, todayKey, totalStars } from '../levels/progress';
import { recipeFor } from '../levels/recipes';
import { CAMPAIGN_LENGTH, FAR_FOREST, REGION_LEVELS, REGIONS, regionOf } from '../levels/regions';
import { byId, plural } from '../utils';
import { ATLAS_KINDS, growGarden, journal, welcomeNote } from '../journal';
import { crystals } from '../den/state';
import { copyText, dailyShareText, gameUrl } from '../share';
import { qrSvg } from '../qr';
import { isOpen, nextUnlock, seenButton, syncLocks } from '../unlocks';
import { JOURNAL_TABS } from './journal-panel';
import { RESIDENTS } from '../residents/catalog';
import { stateOf } from '../residents/state';
import { seenStars, skyHtml } from './sky-panel';

const CREDITS = `
    <p>Разработка — <a href="https://github.com/DEMENT0R" target="_blank" rel="noopener">Максим Безрукавников</a>, при участии Claude (Anthropic).</p>
    <p>Движок — Babylon.js ${Engine.Version}.</p>
    <p>Волк и олень — Quaternius, Ultimate Animated Animals (CC0).</p>
    <p>Лиса — PixelMannen (CC0), риг и анимация @tomkranis (CC BY 4.0), из Khronos glTF Sample Assets.</p>
    <p>Жители леса — Poly by Google и Tipatat Chennavasin (белка), CC BY 3.0, через Poly Pizza.</p>
    <p>Звуки ветра, птиц и шагов синтезируются в браузере (Web Audio API).</p>
    <p>Шрифты — Unbounded и JetBrains Mono.</p>
    <p>QR-код — qrcode-generator, Kazuhiko Arase (MIT).</p>`;
/** Начинается с описания игры из шапки меню — его там видит только тот, кто ещё не играл. */
const howtoHtml = (): string => `
    <p>${byId('menu-sub').textContent}</p>
    <h5>Шесть лесов</h5>
    <p>Путь лежит через шесть лесов — Опушку, Осеннюю рощу, Зимний перевал, Каменное плато, Ночной лес и Озёрный край, — по шесть уровней в каждом. За ними начинается бесконечный Дальний лес.</p>
    <h5>Звёзды</h5>
    <p>За уровень — две звезды: за все кристаллы и за задание. Звёзды открывают новых героев и окрасы и зажигают созвездия на «Небе».</p>
    <h5>Запал</h5>
    <p>Бегать и прыгать можно сколько угодно. Запал нужен для особых движений: рывка (E, B на геймпаде или кнопка «Рывок») и высокого прыжка — для него прыжок надо держать. Запал восстанавливается сам, а каждый кристалл добавляет ещё. Полоска внизу экрана показывает, сколько его осталось. В норе, в «Силе», запал можно усилить: больше запаса, быстрее восстановление, двойной прыжок и планирование. В Лесу дня у всех одинаковый базовый запал.</p>
    <h5>Урожай и котелок</h5>
    <p>У норы растут шиповник, черника и мёд — сами, пока тебя нет. Из урожая и находок в «Котелке» варятся усилители на один уровень: отвар для запала, медовые соты для ветра в спину, светлячок, который показывает на кристаллы, и совиное перо для планирования. Сваренный усилитель берётся с собой и тратится в начале следующего уровня, кроме Леса дня.</p>
    <h5>Жители леса</h5>
    <p>Когда у тебя появится нора, в лесу с тобой захотят познакомиться его жители. Подойди — житель расскажет, о чём просит: принести материалы или урожай, найти потерянную вещь, выполнить задание уровня в его лесу, собрать серию или раскрыть тайник. Когда просьба выполнена, загляни к нему и расскажи. Что нужно сделать, видно под заданием уровня и в «Дневнике», во вкладке «Жители». Сразу просьб бывает не больше двух. Жителя встречают на полянах его леса. Выполнишь все просьбы — житель переедет к твоей норе: он будет помогать по хозяйству, а если кликнуть по нему, скажет что-нибудь новое, каждый день своё. Друзья в гостях тоже его увидят.</p>
    <h5>Тайники</h5>
    <p>На уровнях спрятаны тайники с находками для норы. Если в кроне дерева блестят золотые искры, толкни его с разбега или приземлись рядом — находка упадёт. Тайник под камнем видно, только когда подойдёшь близко. В грибном круге надо немного постоять. Гнездо на высоком уступе достаётся высоким прыжком, а на дальних уровнях — только двойным. На озёрах на мелководье поблёскивает жемчужина: зайди за ней в воду. Сколько тайников найдено на уровне, видно на экране итога. Первый тайник каждого вида в каждом лесу записывается в атлас тайн в «Дневнике», а за записи в атласе для норы открываются вещи, которых больше нигде не достать.</p>
    <h5>Редкие события</h5>
    <p>Изредка в лесу случается особенное. Если над лесом радуга, найди поляну под ней — подует ветер в спину. Ночью бывает звездопад: встань под ним и получишь редкий кристалл. А если белка утащила кристалл, догони её, рывок в этом поможет.</p>
    <h5>Лес дня</h5>
    <p>Одна раскладка на день, у всех одинаковая. Лучшее время за день видно в меню, результатом можно поделиться.</p>
    <h5>Нора</h5>
    <p>Свой двор под большой сосной. Собранные кристаллы — это и счёт норы: за них во дворе появляются вещи. Нору можно улучшать: у неё появятся дверца, окошко, вторая комната, а во дворе — новые места. Для части вещей и улучшений нужны материалы: на каждом уровне лежат находки его биома — шишки, жёлуди, камни, сосульки, перья, ракушки. Ещё их дают за серию: если брать кристаллы быстро, один за другим, на ×3, ×5 и ×10 прибавятся находки, а с ×5 дует ветер в спину: пока серия не оборвётся, бежишь быстрее и прыгаешь выше. Вещи можно менять и убирать — купленное не пропадает. Кнопка «Позвать в гости» копирует ссылку, по которой друг увидит твою нору. Пока тебя нет, в саду у норы растут редкие кристаллы, а за каждый день с пройденным уровнем поляна вокруг обрастает цветами и грибами.</p>
    <h5>Дневник</h5>
    <p>Достижения, редкие кристаллы, записки путника, атлас тайн и поляна у норы, которая растёт день за днём.</p>
    <p>Клавиши и геймпад — в настройках, во вкладке «Управление».</p>`;
/** Вкладка панели: разметка строится заново при каждом показе. */
export interface InfoTab { id: string; name: string; html: () => string }

type InfoKey = 'levels' | 'sky' | 'journal' | 'about' | 'share';

const TITLES: Record<InfoKey, string> = { levels: 'Карта', sky: 'Звёздное небо', journal: 'Дневник', about: 'Об игре', share: 'Поделиться игрой' };
/** Пункт меню, который открывает панель, — на него возвращается фокус при закрытии. */
const OPENERS: Record<InfoKey, string> = { levels: 'm-levels', sky: 'm-sky', journal: 'm-journal', about: 'm-about', share: 'm-share' };

const COPY_LABEL = 'Скопировать ссылку ⧉';

/** «Поделиться игрой»: QR-код ссылки — показать с экрана, — сама ссылка и кнопки. */
function shareHtml(): string {
  const url = gameUrl();
  // С localhost и адреса в локальной сети телефон друга игру не откроет — честно предупредить
  const local = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(location.hostname);
  return `<div class="share-qr">
      ${qrSvg(url, 'QR-код ссылки на игру')}
      <p>Наведи камеру телефона на код — откроется игра. Её можно поставить на главный экран и играть без сети.</p>
      ${local ? '<p class="share-warn">Сейчас игра открыта с этого компьютера — по такому адресу с другого устройства она может не открыться.</p>' : ''}
      <code class="share-url">${url}</code>
      <div class="btn-row">
        <button type="button" class="small-btn" data-copy>${COPY_LABEL}</button>
        ${'share' in navigator ? '<button type="button" class="small-btn" data-native-share>Отправить…</button>' : ''}
      </div>
    </div>`;
}

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
  onDen: () => void;
}

/** Прогресс текущей игры; null — игра ещё не начата. */
export interface MenuProgress { heroName: string; place: string; got: number; total: number }

/** Регион уровня, а после кампании — Дальний лес и его биом. */
const levelName = (i: number) => regionOf(i)?.region.name ?? `${FAR_FOREST} · ${BIOMES[recipeFor(i).biome].name.toLowerCase()}`;
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
    byId('m-den').addEventListener('click', () => {
      this.closeInfo();
      actions.onDen();
    });
    for (const key of Object.keys(OPENERS) as InfoKey[]) {
      byId(OPENERS[key]).addEventListener('click', () => this.toggleInfo(key));
    }
    byId('menu-info-close').addEventListener('click', () => this.closeInfo(true));
    byId('menu-news').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab], [data-den]');
      if (b?.dataset.den !== undefined) actions.onDen();
      else if (b) this.openTab('journal', b.dataset.tab!);
    });
    this.infoTabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (t) this.selectTab(t.dataset.tab!, true);
    });
    this.infoBody.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const copy = t.closest<HTMLElement>('[data-copy]');
      if (copy) {
        void copyText(gameUrl()).then((ok) => {
          copy.textContent = ok ? 'Скопировано ✓' : 'Не удалось скопировать';
          setTimeout(() => (copy.textContent = COPY_LABEL), 2500);
        });
        return;
      }
      if (t.closest('[data-native-share]')) {
        // Окно «Поделиться» системы; отмену пользователем молча пропускаем
        navigator.share({ title: 'Тихая поляна', url: gameUrl() }).catch(() => {});
        return;
      }
      const b = t.closest<HTMLElement>('[data-level]');
      if (!b) return;
      this.closeInfo();
      actions.onPickLevel(Number(b.dataset.level));
    });
    this.changesDot.hidden = !hasUnseenChanges();
    // Нажатый новый пункт больше не помечен точкой
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.fresh');
      if (b) seenButton(b.id);
    });
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
    byId('m-den-info').textContent = `✦ ${crystals()}`;
    syncLocks();
    const next = nextUnlock();
    byId('menu-next').hidden = !next;
    byId('menu-next').textContent = next ?? '';
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
   * Новости в шапке, важное сверху: записка у круга (ведёт в «Находки» дневника), сад (в нору),
   * огонёк серии — сколько дней подряд пройден уровень, и напоминание, если сегодня ещё нет.
   */
  private syncNews(): void {
    const items: string[] = [];
    const link = (tab: string, html: string) => `<li><button type="button" class="link" data-tab="${tab}">${html}</button></li>`;
    if (welcomeNote) items.push(link('finds', '✉ Пока тебя не было, у каменного круга оставили записку'));
    // Сад растёт и до того, как нора откроется, — к открытию в нём уже будут кристаллы
    const ready = growGarden();
    if (ready && isOpen('den')) {
      items.push(
        `<li><button type="button" class="link" data-den>✦ В саду у норы ${plural(ready, 'вырос', 'выросло', 'выросло')} ${ready} ${plural(ready, 'кристалл', 'кристалла', 'кристаллов')}</button></li>`,
      );
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
      // «Тайны» — с первого раскрытого тайника, «Жители» — с первого знакомства
      case 'journal':
        return JOURNAL_TABS.filter((t) => (t.id !== 'secrets' || journal.stats.secrets > 0) && (t.id !== 'residents' || RESIDENTS.some((r) => stateOf(r).met)));
      case 'share': return shareHtml();
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

  /**
   * Карта: регионы по порядку вдоль тропы, в каждом — шесть уровней (последний особый),
   * звёзды, тайники атласа и житель этого леса. Ещё не открытые регионы — в тумане.
   * После кампании — список уровней Дальнего леса.
   */
  private levelsHtml(): string {
    const cards = REGIONS.map((region, k) => {
      const first = k * REGION_LEVELS + 1;
      const color = BIOMES[region.biome].ground;
      const style = `--c:rgb(${color.r * 255} ${color.g * 255} ${color.b * 255})`;
      if (first > saved.unlocked) {
        return `<section class="map-region fog" style="${style}"><h5>${region.name}</h5><p>В тумане — откроется после ${first - 1}-го уровня</p></section>`;
      }
      let stars = 0;
      const dots: string[] = [];
      for (let n = 0; n < REGION_LEVELS; n++) {
        const i = first + n;
        const r = saved.records[i];
        stars += (r?.star ? 1 : 0) + (r?.quest ? 1 : 0);
        const special = n === REGION_LEVELS - 1;
        const label = `Уровень ${i}${special ? ', особый' : ''}${r ? `: ${r.star ? '★' : '☆'}${r.quest ? '★' : '☆'}${r.time !== undefined ? ` · ${formatTime(r.time)}` : ''}` : i <= saved.unlocked ? ': не пройден' : ': ещё закрыт'}`;
        dots.push(
          i <= saved.unlocked
            ? `<button type="button" class="map-dot${special ? ' special' : ''}${r ? ' done' : ''}" data-level="${i}" aria-current="${i === saved.current}" title="${label}" aria-label="${label}"><b>${i}</b><i>${r ? `${starHtml(r.star, 'все кристаллы')}${starHtml(r.quest ?? false, 'задание')}` : ''}</i></button>`
            : `<span class="map-dot locked${special ? ' special' : ''}" title="${label}"><b>${i}</b></span>`,
        );
      }
      const atlas = journal.atlas[region.biome]?.length ?? 0;
      const who = RESIDENTS.find((r) => r.biome === region.biome);
      const st = who && stateOf(who);
      const resident = !who || !st?.met ? '' : ` · ${who.icon} ${st.step >= who.steps.length ? 'у норы' : `просьб ${st.step}/${who.steps.length}`}`;
      return `<section class="map-region" style="${style}"><h5>${region.name}</h5>
        <p>★ ${stars}/${REGION_LEVELS * 2} · тайны ${atlas}/${ATLAS_KINDS[region.biome].length}${resident}</p>
        <div class="map-dots">${dots.join('')}</div></section>`;
    });
    const far: string[] = [];
    for (let i = CAMPAIGN_LENGTH + 1; i <= saved.unlocked; i++) {
      const r = saved.records[i];
      const meta = r ? `${starHtml(r.star, 'все кристаллы')}${starHtml(r.quest ?? false, 'задание')} ${r.time !== undefined ? formatTime(r.time) : ''}` : 'не пройден';
      far.push(`<button type="button" data-level="${i}" aria-current="${i === saved.current}"><b>${i}</b>${levelName(i)}<span>${meta}</span></button>`);
    }
    return `<p>Две звезды за уровень: за все кристаллы и за задание. Шестой уровень каждого леса — особый.</p>
      <div class="map">${cards.join('')}</div>
      ${far.length ? `<h5>${FAR_FOREST}</h5><div class="level-list">${far.join('')}</div>` : ''}`;
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
    // Влево-вправо — по соседним плиткам или ссылкам в одном ряду и по уровням на карте
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const row = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.menu-tiles, .menu-foot, .map');
      if (!row) return false;
      e.preventDefault();
      const items = [...row.querySelectorAll<HTMLElement>('button')].filter((b) => b.getClientRects().length > 0);
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
