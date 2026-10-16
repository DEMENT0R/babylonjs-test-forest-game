// Панель настроек: строки генерируются из описания UI_ROWS.

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
  /** Не сбрасывает пресет графики в «Своё» (управление, а не графика). */
  noPreset?: boolean;
}
interface SegRow extends RowBase { seg: readonly (readonly [SegValue, string])[]; preset?: boolean }
interface ToggleRow extends RowBase { toggle: true }
interface RangeRow extends RowBase { range: readonly [min: number, max: number, step: number]; fmt: (v: number) => string }
type Row = SegRow | ToggleRow | RangeRow;

const UI_ROWS: readonly (Section | Row)[] = [
  { sec: 'Графика' },
  { key: 'preset', label: 'Пресет', preset: true, seg: [['low', 'Низкое'], ['medium', 'Среднее'], ['high', 'Высокое'], ['ultra', 'Ультра'], ['custom', 'Своё']] },
  { key: 'scale', label: 'Разрешение рендера', hint: 'Доля пикселей экрана', seg: [[0.5, '50%'], [0.75, '75%'], [1, '100%'], ['dpr', 'Retina']] },
  { key: 'aa', label: 'Сглаживание', seg: [['off', 'Выкл'], ['fxaa', 'FXAA'], ['msaa', 'MSAA 4×']] },
  { key: 'view', label: 'Дальность прорисовки', range: [50, 250, 10], fmt: (v) => `${v} м` },
  { key: 'fog', label: 'Туман', toggle: true },
  { sec: 'Тени' },
  { key: 'shadows', label: 'Тени', hint: 'Мягкие — размытая карта, PCF — фильтрация', seg: [['off', 'Выкл'], ['hard', 'Жёсткие'], ['soft', 'Мягкие'], ['pcf', 'PCF']] },
  { key: 'shadowRes', label: 'Карта теней', seg: [[512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K']] },
  { key: 'shadowDist', label: 'Область теней', hint: 'Меньше — чётче вблизи', range: [20, 100, 5], fmt: (v) => `${v} м` },
  { key: 'ssao', label: 'Ambient occlusion (SSAO)', hint: 'Затенение в углах, тяжёлый эффект', toggle: true },
  { sec: 'Эффекты' },
  { key: 'glow', label: 'Свечение кристаллов', toggle: true },
  { key: 'bloom', label: 'Bloom', toggle: true },
  { key: 'tone', label: 'Тонмаппинг ACES', toggle: true },
  { key: 'vignette', label: 'Виньетка', toggle: true },
  { sec: 'Камера и управление' },
  { key: 'fov', label: 'Поле зрения', range: [45, 100, 1], fmt: (v) => `${v}°`, noPreset: true },
  { key: 'sens', label: 'Чувствительность мыши', range: [0.3, 3, 0.1], fmt: (v) => `${v.toFixed(1)}×`, noPreset: true },
  { key: 'invertY', label: 'Инверсия по вертикали', toggle: true, noPreset: true },
  { key: 'fps', label: 'Показывать FPS', toggle: true, noPreset: true },
];

/** Запись в настройки по ключу строки (типы значений гарантирует описание UI_ROWS). */
function set(key: Key, value: unknown): void {
  (settings as unknown as Record<string, unknown>)[key] = value;
}

export class SettingsPanel {
  private readonly el = byId('settings');
  private readonly body = byId('set-body');
  private visible = false;

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
    this.render();
    this.el.hidden = false;
    this.el.querySelector('button')?.focus();
  }

  close(): void {
    this.visible = false;
    this.el.hidden = true;
    this.afterClose();
  }

  /** Esc и O закрывают панель; пока она открыта, остальные клавиши игре не достаются. */
  handleKey(e: KeyboardEvent): void {
    if (e.code === 'Escape' || e.code === 'KeyO') this.close();
  }

  private apply(): void {
    applySettings(this.engine);
  }

  private render(): void {
    this.body.innerHTML = '';
    for (const it of UI_ROWS) {
      if ('sec' in it) {
        const d = document.createElement('div');
        d.className = 'sec';
        d.textContent = it.sec;
        this.body.appendChild(d);
        continue;
      }
      this.body.appendChild(this.renderRow(it));
    }
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent =
      (this.engine.webGLVersion > 1 ? 'WebGL 2' : 'WebGL 1 — MSAA, PCF и SSAO недоступны') + ' · настройки сохраняются в этом браузере';
    this.body.appendChild(note);
  }

  private renderRow(it: Row): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';
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
    const touched = () => {
      if (!it.noPreset) settings.preset = 'custom';
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
        if (!it.noPreset) this.render();
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
        if (!it.noPreset) this.render();
      });
      w.append(r, o);
      row.appendChild(w);
    }
    return row;
  }
}
