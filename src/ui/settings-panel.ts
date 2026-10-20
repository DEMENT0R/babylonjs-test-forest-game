// Панель настроек: вкладки и строки генерируются из описания TABS.

import type { Engine } from '@babylonjs/core';
import { applyPreset, applySettings, settings, type PresetId, type Settings } from '../settings';
import { byId } from '../utils';

type Key = keyof Settings;
type SegValue = string | number;

interface Section { sec: string }
interface RowBase {
  key: Key;
  label: string;
  hint?: string;
  /** Строка на вкладке графики, но не из пресета: её изменение не переводит его в «Своё». */
  free?: true;
}
interface SegRow extends RowBase { seg: readonly (readonly [SegValue, string])[]; preset?: boolean }
interface ToggleRow extends RowBase { toggle: true }
interface RangeRow extends RowBase { range: readonly [min: number, max: number, step: number]; fmt: (v: number) => string }
type Row = SegRow | ToggleRow | RangeRow;

const percent = (v: number) => `${Math.round(v * 100)}%`;

interface Tab {
  id: string;
  name: string;
  /** Строки вкладки входят в пресет графики: их изменение переводит его в «Своё». */
  preset?: true;
  rows: readonly (Section | Row)[];
  /** Справка под строками вкладки. */
  info?: { title: string; html: string };
}

const KEYS_HELP = `<dl class="help">
    <dt>WASD / стрелки</dt><dd>движение</dd><dt>Shift</dt><dd>бег</dd><dt>Space</dt><dd>прыжок</dd>
    <dt>Мышь</dt><dd>повернуть камеру; в режиме «из-за плеча» клик захватывает курсор</dd>
    <dt>Колесо</dt><dd>приблизить или отдалить камеру</dd><dt>C</dt><dd>режим камеры: из-за плеча, за спиной, свободная</dd>
    <dt>H</dt><dd>сменить героя</dd><dt>O</dt><dd>настройки</dd><dt>M</dt><dd>включить или выключить звук</dd><dt>F</dt><dd>во весь экран и обратно</dd><dt>Esc</dt><dd>пауза и главное меню</dd>
    <dt>Телефон</dt><dd>стик слева (плавающий — под пальцем, или фиксированный, см. выше), кнопка прыжка справа, свайп поворачивает камеру; с геймпадом экранные кнопки прячутся</dd>
    <dt>Геймпад</dt><dd>левый стик — ходьба (до упора или с LB — бег), правый — камера, A — прыжок,
      Y — режим камеры, крестовина ↑↓ — зум, View — настройки, Start — пауза;
      в меню крестовина или стик выбирают пункт, A — нажать, B — назад, LB/RB — вкладки настроек</dd></dl>`;

const TABS: readonly Tab[] = [
  {
    id: 'graphics',
    name: 'Графика',
    preset: true,
    rows: [
      { key: 'preset', label: 'Пресет', preset: true, seg: [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое'], ['ultra', 'Ультра'], ['custom', 'Своё']] },
      { key: 'scale', label: 'Разрешение рендера', hint: 'Доля пикселей экрана', seg: [[0.5, '50%'], [0.6, '60%'], [0.8, '80%'], [1, '100%'], ['dpr', 'Retina']] },
      { key: 'autoScale', label: 'Авто-разрешение', hint: 'Снижает разрешение, когда кадров не хватает', toggle: true, free: true },
      { key: 'fpsCap', label: 'Предел кадров', hint: '30 — меньше греет телефон и бережёт батарею', seg: [[0, 'Нет'], [60, '60'], [30, '30']], free: true },
      { key: 'aa', label: 'Сглаживание', seg: [['off', 'Выкл'], ['fxaa', 'FXAA'], ['msaa', 'MSAA 4×']] },
      { key: 'view', label: 'Дальность прорисовки', range: [50, 250, 10], fmt: (v) => `${v} м` },
      { key: 'fog', label: 'Туман', toggle: true },
      { sec: 'Тени' },
      { key: 'shadows', label: 'Тени', hint: 'Мягкие — размытая карта, PCF — фильтрация', seg: [['off', 'Выкл'], ['hard', 'Жёсткие'], ['soft', 'Мягкие'], ['pcf', 'PCF']] },
      { key: 'shadowRes', label: 'Карта теней', seg: [[512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K']] },
      { key: 'shadowDist', label: 'Область теней', hint: 'Меньше — чётче вблизи', range: [20, 100, 5], fmt: (v) => `${v} м` },
      { key: 'ssao', label: 'Ambient occlusion (SSAO)', hint: 'Затенение в углах, тяжёлый эффект', toggle: true },
      { sec: 'Трава' },
      { key: 'grass', label: 'Трава', hint: 'Самая тяжёлая настройка на слабых видеокартах', seg: [['off', 'Выкл'], ['sparse', 'Редкая'], ['normal', 'Обычная'], ['dense', 'Густая']] },
      { key: 'grassDist', label: 'Дальность травы', hint: 'Вдали трава плавно редеет', range: [20, 80, 5], fmt: (v) => `${v} м` },
      { key: 'grassBend', label: 'Герой приминает траву', toggle: true },
      { sec: 'Эффекты' },
      { key: 'grassWind', label: 'Колыхание на ветру', hint: 'Трава и деревья', toggle: true },
      { key: 'glow', label: 'Свечение кристаллов', toggle: true },
      { key: 'particles', label: 'Снег и светлячки', toggle: true },
      { key: 'bloom', label: 'Bloom', toggle: true },
      { key: 'tone', label: 'Тонмаппинг ACES', toggle: true },
      { key: 'vignette', label: 'Виньетка', toggle: true },
    ],
  },
  {
    id: 'controls',
    name: 'Управление',
    rows: [
      { sec: 'Камера' },
      { key: 'fov', label: 'Поле зрения', range: [45, 100, 1], fmt: (v) => `${v}°` },
      { key: 'sens', label: 'Чувствительность мыши', range: [0.3, 3, 0.1], fmt: (v) => `${v.toFixed(1)}×` },
      { key: 'invertY', label: 'Инверсия по вертикали', hint: 'Для мыши и геймпада', toggle: true },
      { sec: 'Сенсорный экран' },
      { key: 'stick', label: 'Стик движения', hint: 'Плавающий появляется под пальцем в левой части экрана', seg: [['float', 'Плавающий'], ['fixed', 'Фиксированный']] },
      { sec: 'Геймпад' },
      { key: 'padSens', label: 'Чувствительность стика', hint: 'Правый стик поворачивает камеру', range: [0.3, 3, 0.1], fmt: (v) => `${v.toFixed(1)}×` },
    ],
    info: { title: 'Клавиши и кнопки', html: KEYS_HELP },
  },
  {
    id: 'sound',
    name: 'Звук',
    rows: [
      { key: 'sound', label: 'Звук', hint: 'Клавиша M', toggle: true },
      { key: 'volume', label: 'Общая громкость', range: [0, 1, 0.05], fmt: percent },
      { key: 'stepsVolume', label: 'Шаги', range: [0, 1, 0.05], fmt: percent },
      { key: 'natureVolume', label: 'Ветер и птицы', range: [0, 1, 0.05], fmt: percent },
      { key: 'musicVolume', label: 'Музыка', hint: 'Тихий эмбиент, свой у каждого биома', range: [0, 1, 0.05], fmt: percent },
    ],
  },
  {
    id: 'interface',
    name: 'Интерфейс',
    rows: [
      { key: 'keyHint', label: 'Памятка по кнопкам', hint: 'Подсказка в углу экрана, раскрывается кликом', seg: [['first', 'На 1-м уровне'], ['open', 'Всегда'], ['closed', 'Свёрнута']] },
      { key: 'fps', label: 'Показывать FPS', toggle: true },
    ],
  },
];

const TAB_KEY = 'tihaya-polyana-settings-tab';

function loadTab(): number {
  try {
    const i = TABS.findIndex((t) => t.id === localStorage.getItem(TAB_KEY));
    return i < 0 ? 0 : i;
  } catch {
    return 0;
  }
}

/** Запись в настройки по ключу строки (типы значений гарантирует описание TABS). */
function set(key: Key, value: unknown): void {
  (settings as unknown as Record<string, unknown>)[key] = value;
}

export class SettingsPanel {
  private readonly el = byId('settings');
  private readonly tabsEl = byId('set-tabs');
  private readonly body = byId('set-body');
  private visible = false;
  private tab = loadTab();

  /**
   * @param beforeOpen освободить курсор и сбросить ввод перед показом
   * @param afterClose вернуть фокус туда, откуда открыли
   */
  constructor(
    private readonly engine: Engine,
    private readonly beforeOpen: () => void,
    private readonly afterClose: () => void,
  ) {
    byId('set-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return this.visible;
  }

  open(): void {
    this.beforeOpen();
    this.visible = true;
    this.renderTabs();
    this.render();
    this.el.hidden = false;
    this.tabButton(this.tab)?.focus();
  }

  close(): void {
    this.visible = false;
    this.el.hidden = true;
    this.afterClose();
  }

  /**
   * Esc и O закрывают панель, Q/E (на геймпаде LB/RB) листают вкладки, стрелки — тоже, если фокус на вкладке.
   * Пока панель открыта, остальные клавиши игре не достаются.
   */
  handleKey(e: KeyboardEvent): void {
    if (e.code === 'Escape' || e.code === 'KeyO') {
      this.close();
      return;
    }
    const onTab = e.target instanceof HTMLElement && e.target.getAttribute('role') === 'tab';
    if (e.code === 'KeyQ' || (onTab && e.code === 'ArrowLeft')) this.switchTab(-1);
    else if (e.code === 'KeyE' || (onTab && e.code === 'ArrowRight')) this.switchTab(1);
    else return;
    e.preventDefault();
  }

  /** Соседняя вкладка по кругу; фокус переходит на неё. */
  switchTab(delta: number): void {
    this.selectTab((this.tab + delta + TABS.length) % TABS.length);
    this.tabButton(this.tab)?.focus();
  }

  private selectTab(i: number): void {
    if (i === this.tab) return;
    this.tab = i;
    try {
      localStorage.setItem(TAB_KEY, TABS[i].id);
    } catch {
      // Без хранилища вкладка просто не запомнится
    }
    this.renderTabs();
    this.render();
    this.body.parentElement!.scrollTop = 0;
  }

  private tabButton(i: number): HTMLElement | null {
    return document.getElementById(`set-tab-${TABS[i].id}`);
  }

  private renderTabs(): void {
    this.tabsEl.innerHTML = '';
    const hint = (key: string, pad: string, cls: string) => {
      const span = document.createElement('span');
      span.className = cls;
      span.setAttribute('aria-hidden', 'true');
      span.innerHTML = `<kbd class="key-only">${key}</kbd><kbd class="pad-only">${pad}</kbd>`;
      return span;
    };
    this.tabsEl.appendChild(hint('Q', 'LB', 'hint-l'));
    TABS.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `set-tab-${t.id}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === this.tab));
      b.setAttribute('aria-controls', 'set-body');
      b.tabIndex = i === this.tab ? 0 : -1;
      b.textContent = t.name;
      b.addEventListener('click', () => this.selectTab(i));
      this.tabsEl.appendChild(b);
    });
    this.tabsEl.appendChild(hint('E', 'RB', 'hint-r'));
    this.body.setAttribute('aria-labelledby', `set-tab-${TABS[this.tab].id}`);
  }

  private apply(): void {
    applySettings(this.engine);
  }

  private render(): void {
    // Перерисовка не должна терять фокус: без мыши (геймпад, клавиатура) иначе не продолжить
    const active = document.activeElement;
    const focusedKey = active && this.body.contains(active) ? active.closest<HTMLElement>('.row')?.dataset.key : undefined;
    this.body.innerHTML = '';
    for (const it of TABS[this.tab].rows) {
      if ('sec' in it) {
        const d = document.createElement('div');
        d.className = 'sec';
        d.textContent = it.sec;
        this.body.appendChild(d);
        continue;
      }
      this.body.appendChild(this.renderRow(it));
    }
    const { info } = TABS[this.tab];
    if (info) {
      const d = document.createElement('div');
      d.className = 'sec';
      d.textContent = info.title;
      this.body.appendChild(d);
      this.body.insertAdjacentHTML('beforeend', info.html);
    }
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent =
      (this.engine.webGLVersion > 1 ? 'WebGL 2' : 'WebGL 1 — MSAA, PCF и SSAO недоступны') + ' · настройки сохраняются в этом браузере';
    this.body.appendChild(note);
    if (focusedKey) {
      this.body.querySelector<HTMLElement>(`.row[data-key="${focusedKey}"] :is([aria-pressed="true"], input)`)?.focus();
    }
  }

  private renderRow(it: Row): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.key = it.key;
    const id = `set-${it.key}`;
    const isSeg = 'seg' in it;
    const lbl = document.createElement(isSeg ? 'div' : 'label');
    if (isSeg) lbl.className = 'lbl';
    else (lbl as HTMLLabelElement).htmlFor = id;
    lbl.textContent = it.label;
    if (it.hint) {
      const small = document.createElement('small');
      small.textContent = it.hint;
      lbl.appendChild(small);
    }
    row.appendChild(lbl);

    // Изменение графики переводит пресет в «Своё»
    const inPreset = !!TABS[this.tab].preset;
    const touched = () => {
      if (inPreset && !it.free) settings.preset = 'custom';
    };

    if ('seg' in it) {
      const g = document.createElement('div');
      g.className = 'seg';
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', it.label);
      for (const [v, text] of it.seg) {
        if (it.preset && v === 'custom' && settings.preset !== 'custom') continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.setAttribute('aria-pressed', String(settings[it.key] === v));
        b.addEventListener('click', () => {
          if (it.preset) {
            if (v === 'custom') return;
            applyPreset(v as PresetId);
          } else {
            set(it.key, v);
            touched();
          }
          this.apply();
          this.render();
        });
        g.appendChild(b);
      }
      row.appendChild(g);
    } else if ('toggle' in it) {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.className = 'switch';
      c.id = id;
      c.checked = !!settings[it.key];
      c.addEventListener('change', () => {
        set(it.key, c.checked);
        touched();
        this.apply();
        if (inPreset) this.render();
      });
      row.appendChild(c);
    } else {
      const w = document.createElement('div');
      w.className = 'range';
      const r = document.createElement('input');
      r.type = 'range';
      r.id = id;
      [r.min, r.max, r.step] = it.range.map(String);
      r.value = String(settings[it.key]);
      const o = document.createElement('output');
      o.htmlFor.add(id);
      o.textContent = it.fmt(Number(settings[it.key]));
      r.addEventListener('input', () => {
        set(it.key, +r.value);
        o.textContent = it.fmt(+r.value);
        touched();
        this.apply();
      });
      // Перерисовываем только по отпусканию, чтобы не сбить перетаскивание ползунка
      r.addEventListener('change', () => {
        if (inPreset) this.render();
      });
      w.append(r, o);
      row.appendChild(w);
    }
    return row;
  }
}
