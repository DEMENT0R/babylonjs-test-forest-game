// Производительность: предел кадров в секунду и авто-разрешение,
// которое снижает долю пикселей, когда кадров не хватает, и возвращает её, когда есть запас.

import { Engine } from '@babylonjs/core';
import { onSettingsApplied, renderScale, settings } from './settings';

/**
 * Движок с пределом кадров. Пропущенный кадр не начинается вовсе, поэтому
 * getDeltaTime(), частицы и анимации считают время между нарисованными кадрами.
 */
export class GameEngine extends Engine {
  /** Предел FPS; 0 — без предела. */
  fpsCap = 0;
  /** Когда по расписанию следующий кадр. */
  private nextFrameAt = 0;

  protected override _isOverFrameTime(timestamp?: number): boolean {
    if (!timestamp || !this.fpsCap) return false;
    // Допуск в 4 мс: кадр экрана приходит чуть раньше ровных 1000/fps,
    // и без допуска 30 FPS на 60 Гц то и дело проваливались бы в 20
    if (timestamp < this.nextFrameAt - 4) return true;
    // Расписание, а не «прошло с прошлого кадра»: на 90 Гц так выходит 60 кадров, а не 45.
    // Отставание больше кадра не копим — иначе после подвисания кадры пошли бы залпом
    const interval = 1000 / this.fpsCap;
    this.nextFrameAt = Math.max(this.nextFrameAt, timestamp - interval) + interval;
    return false;
  }
}

/** Шаг и нижняя граница поправки разрешения (доля от выбранного в настройках). */
const STEP = 0.1;
const MIN_FACTOR = 0.5;
/** Окно замера FPS, с. */
const WINDOW = 1.5;
/** Ниже этой доли от цели кадров не хватает, выше второй — есть запас. */
const LOW = 0.85;
const HIGH = 0.95;

export class AutoScale {
  /** Поправка к разрешению из настроек: 1 — как выбрано, меньше — снижено. */
  private factor = 1;
  private frames = 0;
  private time = 0;
  /** Секунды, в которые замер не ведётся: загрузка уровня, компиляция шейдеров. */
  private holdTime = 2;
  private lowWindows = 0;
  private highWindows = 0;
  /** Сколько окон с запасом ждать перед повышением; растёт, если повышение не удержалось. */
  private upWait = 4;
  private justRaised = false;
  private appliedFor = '';

  constructor(private readonly engine: GameEngine) {
    onSettingsApplied((s) => {
      engine.fpsCap = s.fpsCap;
      // Новое разрешение или выключенный авто-режим — начинаем с выбранного игроком
      const key = `${renderScale()}|${s.autoScale}`;
      if (key !== this.appliedFor) {
        this.appliedFor = key;
        this.reset();
      }
      this.applyScale();
    });
  }

  /** Не мерить ближайшие секунды — например, пока строится уровень. */
  hold(seconds = 2): void {
    this.holdTime = Math.max(this.holdTime, seconds);
    this.frames = this.time = 0;
  }

  /**
   * Вызывать каждый нарисованный кадр.
   * @param dt время кадра, с
   * @param active идёт игра (в меню, на паузе и в переходах не мерим)
   */
  update(dt: number, active: boolean): void {
    if (!settings.autoScale || !active || document.hidden) return;
    if (this.holdTime > 0) {
      this.holdTime -= dt;
      return;
    }
    // Длинная пауза кадра — свернули вкладку или подгрузка, а не медленная отрисовка
    if (dt > 0.5) return;
    this.frames++;
    this.time += dt;
    if (this.time < WINDOW) return;
    const fps = this.frames / this.time;
    this.frames = this.time = 0;

    const target = settings.fpsCap || 60;
    if (fps < target * LOW) {
      this.highWindows = 0;
      // Сразу после повышения — значит, оно было лишним: в следующий раз ждём дольше
      if (this.justRaised) {
        this.upWait = Math.min(this.upWait * 2, 40);
        this.lower();
      } else if (++this.lowWindows >= 2) {
        this.lower();
      }
    } else {
      this.lowWindows = 0;
      if (fps >= target * HIGH && this.factor < 1 && ++this.highWindows >= this.upWait) this.raise();
      else this.justRaised = false;
    }
  }

  private lower(): void {
    this.lowWindows = this.highWindows = 0;
    this.justRaised = false;
    if (this.factor <= MIN_FACTOR) return;
    this.factor = Math.max(MIN_FACTOR, +(this.factor - STEP).toFixed(2));
    this.applyScale();
  }

  private raise(): void {
    this.highWindows = 0;
    this.justRaised = true;
    this.factor = Math.min(1, +(this.factor + STEP).toFixed(2));
    this.applyScale();
  }

  private reset(): void {
    this.factor = 1;
    this.upWait = 4;
    this.lowWindows = this.highWindows = 0;
    this.justRaised = false;
    this.hold();
  }

  private applyScale(): void {
    this.engine.setHardwareScalingLevel(1 / (renderScale() * this.factor));
  }
}
