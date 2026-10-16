// Навигация по интерфейсу без мыши (геймпадом): фокус ходит по кнопкам и полям
// открытого экрана, группа сегментов (.seg) считается одной остановкой.

import type { NavDir } from '../gamepad';

const FOCUSABLE = 'button, input, summary, [tabindex]';

function isFocusable(el: HTMLElement): boolean {
  return el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0;
}

/** Остановки фокуса по порядку разметки; из группы сегментов — выбранный вариант. */
function stops(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const groups = new Set<Element>();
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (!isFocusable(el)) continue;
    const g = el.closest('.seg');
    if (!g) {
      out.push(el);
    } else if (!groups.has(g)) {
      groups.add(g);
      out.push(g.querySelector<HTMLElement>('[aria-pressed="true"]') ?? el);
    }
  }
  return out;
}

/** Синтетическая клавиша — экраны уже умеют обрабатывать стрелки, Enter и Esc. */
export function sendKey(code: string): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true }));
}

/** Ползунок шагает на одно деление и сообщает об этом так же, как при перетаскивании. */
function stepRange(r: HTMLInputElement, dir: number): void {
  const before = r.value;
  if (dir > 0) r.stepUp();
  else r.stepDown();
  if (r.value === before) return;
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
}

export function navigate(root: HTMLElement, dir: NavDir): void {
  const list = stops(root);
  if (!list.length) return;
  const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
  if (!active) {
    list[0].focus();
    return;
  }

  if (dir === 'left' || dir === 'right') {
    const d = dir === 'right' ? 1 : -1;
    if (active instanceof HTMLInputElement && active.type === 'range') {
      stepRange(active, d);
      return;
    }
    const seg = active.closest('.seg');
    if (seg) {
      const opts = [...seg.querySelectorAll<HTMLElement>('button')].filter(isFocusable);
      opts[Math.max(0, Math.min(opts.length - 1, opts.indexOf(active) + d))]?.focus();
      return;
    }
    // Остальное (вкладки настроек, карточки героев) уже слушает стрелки
    sendKey(dir === 'right' ? 'ArrowRight' : 'ArrowLeft');
    return;
  }

  const group = active.closest('.seg');
  const i = list.findIndex((el) => el === active || (group !== null && el.closest('.seg') === group));
  const next = list[(i + (dir === 'down' ? 1 : -1) + list.length) % list.length];
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}

/** Нажать то, что в фокусе (или поставить фокус на первый элемент экрана). */
export function activate(root: HTMLElement): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && root.contains(active) && isFocusable(active)) active.click();
  else stops(root)[0]?.focus();
}
