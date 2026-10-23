// Игровой HUD: счёт кристаллов, всплывающие подсказки, FPS, кнопка режима камеры.

import type { Engine } from '@babylonjs/core';
import type { CameraMode } from '../camera';
import { onSettingsApplied, settings } from '../settings';
import { byId } from '../utils';

const toastEl = byId('toast');
const gotEl = byId('got');
const totalEl = byId('total');
const portalHint = byId('portal-hint');
const levelTitle = byId('level-title');
const questEl = byId('quest');
const questGoal = byId('quest-goal');
const questStatus = byId('quest-status');
const fpsEl = byId('fps');
const modeBtn = byId<HTMLButtonElement>('mode');
const crossEl = byId('cross');
const keysEl = byId<HTMLDetailsElement>('keys');

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Короткая надпись посреди экрана; ms — сколько она держится. */
export function say(text: string, ms = 1600): void {
  toastEl.textContent = text;
  // Длинный текст (записки) — мельче и шире, чтобы читался, а не кричал
  toastEl.classList.toggle('long', text.length > 70);
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.opacity = '0'), ms);
}

/** Счёт кристаллов и подсказка, сколько нужно до портала. */
export function setCrystals(got: number, total: number, required: number, portalOpen: boolean): void {
  gotEl.textContent = String(got);
  totalEl.textContent = String(total);
  portalHint.textContent = portalOpen ? '· портал открыт' : `· портал после ${required}`;
  portalHint.classList.toggle('open', portalOpen);
}

const comboEl = byId('combo');
const comboN = byId('combo-n');
const comboFill = byId('combo-fill');
const comboNote = byId('combo-note');
let comboTimer: ReturnType<typeof setTimeout> | undefined;

/** Серия выросла до count: число крупнее с каждым кристаллом (до ×10), цвет — по ступени.
 *  note — подпись под числом (награда за ступень); держится, пока серия не кончится. */
export function showCombo(count: number, tier: number, note?: string): void {
  if (count < 2) return;
  clearTimeout(comboTimer);
  comboN.textContent = String(count);
  if (note !== undefined) comboNote.textContent = note;
  else if (comboEl.classList.contains('ending')) comboNote.textContent = '';
  comboEl.style.setProperty('--s', String(1 + Math.min(count - 2, 8) * 0.075));
  comboEl.classList.toggle('t1', tier === 1);
  comboEl.classList.toggle('t2', tier === 2);
  comboEl.classList.remove('ending', 'pulse');
  void comboEl.offsetWidth; // перезапуск анимации пульса
  comboEl.classList.add('on', 'pulse');
}

/** Полоска окна серии: left — доля оставшегося времени. */
export function setComboLeft(left: number): void {
  comboFill.style.transform = `scaleX(${left})`;
}

/** Серия оборвалась: число гаснет; побитый рекорд немного задерживается на экране. */
export function endCombo(record: boolean): void {
  comboEl.classList.add('ending');
  comboNote.textContent = record ? 'рекорд серии!' : '';
  clearTimeout(comboTimer);
  comboTimer = setTimeout(() => comboEl.classList.remove('on'), record ? 1600 : 350);
}

/** Новый уровень: счётчик пропадает сразу, без затухания. */
export function clearCombo(): void {
  clearTimeout(comboTimer);
  comboEl.classList.remove('on', 'pulse', 'ending');
}

/** Строка задания: цель и прогресс; обновляет DOM, только когда текст меняется. */
export function setQuest(goal: string, status: string, state: 'active' | 'failed' | 'done'): void {
  if (questGoal.textContent !== goal) questGoal.textContent = goal;
  const text = `· ${status}`;
  if (questStatus.textContent !== text) questStatus.textContent = text;
  questEl.classList.toggle('failed', state === 'failed');
  questEl.classList.toggle('done', state === 'done');
}

export function setLevelTitle(text: string): void {
  levelTitle.textContent = text;
}

const KEYS_SHOWN_KEY = 'tihaya-polyana-keys-shown';

/** Памятку уже показывали при прошлом запуске — больше она на экране не нужна. */
const keysShownBefore = (() => {
  try {
    return localStorage.getItem(KEYS_SHOWN_KEY) === '1';
  } catch {
    return false;
  }
})();

/** Памятка по кнопкам видна только на первом уровне при первом запуске, дальше — справка в настройках. */
export function setHintLevel(level: number): void {
  const show = !keysShownBefore && level === 1;
  keysEl.hidden = !show;
  keysEl.open = show;
  if (!show) return;
  try {
    localStorage.setItem(KEYS_SHOWN_KEY, '1');
  } catch {
    // Хранилище недоступно — памятка покажется и в следующий раз
  }
}

export function showCameraMode(mode: CameraMode, announce = true): void {
  modeBtn.innerHTML = `<span class="mode-pre">Камера: </span>${mode.name}<span class="kbd-hint"> (C)</span>`;
  crossEl.hidden = mode.id !== 'shoulder';
  if (announce) say(mode.id === 'shoulder' ? 'Из-за плеча — кликни для захвата мыши' : mode.name);
}

export interface HudActions {
  onMenu: () => void;
  onHeroSelect: () => void;
  onSettings: () => void;
  onCycleCamera: () => void;
}

export function setupHud(actions: HudActions): void {
  byId('to-menu').addEventListener('click', actions.onMenu);
  byId('back').addEventListener('click', actions.onHeroSelect);
  byId('hud-settings').addEventListener('click', actions.onSettings);
  modeBtn.addEventListener('click', actions.onCycleCamera);
  onSettingsApplied((s) => {
    fpsEl.hidden = !s.fps;
  });
}

let fpsTimer = 0;

/** Обновляет счётчик FPS не чаще четырёх раз в секунду. */
export function tickFps(engine: Engine): void {
  if (!settings.fps) return;
  fpsTimer += engine.getDeltaTime();
  if (fpsTimer > 250) {
    fpsTimer = 0;
    fpsEl.textContent = `${Math.round(engine.getFps())} FPS`;
  }
}
