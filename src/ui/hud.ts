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
const fpsEl = byId('fps');
const modeBtn = byId<HTMLButtonElement>('mode');
const crossEl = byId('cross');
const keysEl = byId<HTMLDetailsElement>('keys');

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Короткая надпись посреди экрана. */
export function say(text: string): void {
  toastEl.textContent = text;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.opacity = '0'), 1600);
}

/** Счёт кристаллов и подсказка, сколько нужно до портала. */
export function setCrystals(got: number, total: number, required: number, portalOpen: boolean): void {
  gotEl.textContent = String(got);
  totalEl.textContent = String(total);
  portalHint.textContent = portalOpen ? '· портал открыт' : `· портал после ${required}`;
  portalHint.classList.toggle('open', portalOpen);
}

export function setLevelTitle(text: string): void {
  levelTitle.textContent = text;
}

let hintLevel = 1;
let hintMode: string | null = null;

/** Памятка по кнопкам раскрывается сама только по настройке; дальше её открывает игрок. */
function syncKeyHint(): void {
  hintMode = settings.keyHint;
  keysEl.open = hintMode === 'open' || (hintMode === 'first' && hintLevel === 1);
}

/** Новый уровень: памятка снова принимает положение из настроек. */
export function setHintLevel(level: number): void {
  hintLevel = level;
  syncKeyHint();
}

export function showCameraMode(mode: CameraMode, announce = true): void {
  modeBtn.innerHTML = `Камера: ${mode.name}<span class="kbd-hint"> (C)</span>`;
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
    // Другие настройки не должны сворачивать памятку, которую игрок раскрыл сам
    if (s.keyHint !== hintMode) syncKeyHint();
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
