// Задания уровней: дополнительная цель, за которую дают вторую звезду.
// Задание описывает рецепт, а QuestRun следит за ним, пока идёт уровень.

import { formatTime } from './progress';

export type Quest =
  /** Дойти до портала, уложившись в лимит, с. */
  | { kind: 'time'; limit: number; intro: string }
  /** Пройти уровень, ни разу не побежав. */
  | { kind: 'walk'; intro: string }
  /** Прыжков не больше, чем платформ на уровне, плюс запас. */
  | { kind: 'jumps'; spare: number; intro: string };

/** Что заданию нужно знать об уровне. */
export interface QuestLevel { platforms: number }

/** Что заданию нужно знать о герое в кадре. */
export interface QuestInput { running: boolean; jumped: boolean }

/** «Не больше 21 прыжка», но «не больше 25 прыжков». */
function jumpsWord(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'прыжка' : 'прыжков';
}

export class QuestRun {
  private time = 0;
  private jumps = 0;
  private broken = false;
  /** Лимит прыжков; для остальных заданий не нужен. */
  private readonly maxJumps: number;

  constructor(readonly quest: Quest, level: QuestLevel) {
    // Каждую платформу хватит одного прыжка — на вершину любой цепочки забраться можно
    this.maxJumps = quest.kind === 'jumps' ? level.platforms + quest.spare : 0;
  }

  /** Цель одной строкой — для экрана перехода и HUD. */
  get goal(): string {
    switch (this.quest.kind) {
      case 'time':
        return `Дойди до портала за ${formatTime(this.quest.limit)}`;
      case 'walk':
        return 'Пройди уровень без бега';
      case 'jumps':
        return `Не больше ${this.maxJumps} ${jumpsWord(this.maxJumps)}`;
    }
  }

  /** Задание уже не выполнить на этом уровне. */
  get failed(): boolean {
    return this.broken || (this.quest.kind === 'time' && this.time > this.quest.limit);
  }

  tick(dt: number, input: QuestInput): void {
    this.time += dt;
    if (input.jumped) this.jumps++;
    if (this.quest.kind === 'walk' && input.running) this.broken = true;
    if (this.quest.kind === 'jumps' && this.jumps > this.maxJumps) this.broken = true;
  }

  /** Проверка при входе в портал. */
  passed(): boolean {
    return !this.failed;
  }

  /** Строка для HUD с текущим прогрессом. */
  get status(): string {
    switch (this.quest.kind) {
      case 'time':
        return this.failed ? 'время вышло' : `осталось ${formatTime(Math.ceil(this.quest.limit - this.time))}`;
      case 'walk':
        return this.failed ? 'был бег' : 'пока шагом';
      case 'jumps':
        return this.failed ? 'прыжки кончились' : `осталось ${this.maxJumps - this.jumps}`;
    }
  }
}
