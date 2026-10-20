// Переход между уровнями: экран затемняется, показывает итог и название
// следующего уровня, пока под ним строится новый уровень.

import { byId } from '../utils';

const fade = byId('fade');
const eyebrow = byId('fade-eyebrow');
const title = byId('fade-title');
const sub = byId('fade-sub');
const note = byId('fade-note');
const hint = byId('fade-hint');

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Дать браузеру отрисовать кадр — иначе тяжёлая сборка уровня «съест» анимацию. */
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export interface TransitionText {
  eyebrow: string;
  title: string;
  sub: string;
  /** Строка-событие под итогом: серия дней, новое созвездие и тому подобное. */
  note?: string;
}

let busy = false;
/** Пока экран ждёт нажатия — функция, которая его отпускает. */
let release: (() => void) | null = null;

/**
 * Ждать, пока игрок нажмёт клавишу, кликнет или тапнет (геймпад — через continueTransition).
 * Автоповтор не считается: зажатая у портала W иначе сразу пролистнула бы итог.
 */
function waitForPress(): Promise<void> {
  hint.hidden = false;
  return new Promise<void>((resolve) => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      done();
    };
    const done = () => {
      removeEventListener('keydown', onKey, true);
      fade.removeEventListener('pointerdown', done);
      hint.hidden = true;
      release = null;
      resolve();
    };
    addEventListener('keydown', onKey, true);
    fade.addEventListener('pointerdown', done);
    release = done;
  });
}

/** Отпустить экран итога, если он ждёт нажатия. */
export function continueTransition(): void {
  release?.();
}

/** Обновить надпись на уже показанном экране перехода (например, когда стал известен уровень). */
export function setTransitionText(text: Partial<TransitionText>): void {
  if (text.eyebrow !== undefined) eyebrow.textContent = text.eyebrow;
  if (text.title !== undefined) title.textContent = text.title;
  if (text.sub !== undefined) sub.textContent = text.sub;
  if (text.note !== undefined) {
    note.textContent = text.note;
    note.hidden = !text.note;
  }
}

export function isTransitioning(): boolean {
  return busy;
}

/**
 * Затемнить экран, выполнить work (сборку уровня) и проявить сцену обратно.
 * Надпись держится не меньше holdMs, даже если уровень собрался мгновенно.
 * Если в итоге есть события (note) — дальше экран ждёт нажатия, чтобы их успели прочитать.
 */
export async function transition(text: TransitionText, work: () => void, holdMs = 1600): Promise<void> {
  if (busy) return;
  busy = true;
  setTransitionText({ note: '', ...text });
  fade.classList.add('show');
  await wait(650);
  await nextFrame();
  const t0 = performance.now();
  try {
    work();
  } finally {
    await wait(Math.max(0, holdMs - (performance.now() - t0)));
    if (text.note) await waitForPress();
    fade.classList.remove('show');
    busy = false;
  }
}
