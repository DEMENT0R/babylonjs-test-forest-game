// Задания уровней: дополнительная цель, за которую дают вторую звезду.
// Задание описывает рецепт, а QuestRun следит за ним, пока идёт уровень.

import { formatTime } from './progress';

export type Quest =
  /** Дойти до портала, уложившись в лимит, с. */
  | { kind: 'time'; limit: number; intro: string }
  /** Пройти уровень, ни разу не побежав. */
  | { kind: 'walk'; intro: string };

/** Что заданию нужно знать о герое в кадре. */
export interface QuestInput { running: boolean }

/** Цель одной строкой — для экрана перехода и HUD. */
export function questGoal(q: Quest): string {
  switch (q.kind) {
    case 'time':
      return `Дойди до портала за ${formatTime(q.limit)}`;
    case 'walk':
      return 'Пройди уровень без бега';
  }
}

export class QuestRun {
  private time = 0;
  private broken = false;

  constructor(readonly quest: Quest) {}

  /** Задание уже не выполнить на этом уровне. */
  get failed(): boolean {
    return this.broken || (this.quest.kind === 'time' && this.time > this.quest.limit);
  }

  tick(dt: number, input: QuestInput): void {
    this.time += dt;
    if (this.quest.kind === 'walk' && input.running) this.broken = true;
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
    }
  }
}
