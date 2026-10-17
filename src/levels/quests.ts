// Задания уровней: дополнительная цель, за которую дают вторую звезду.
// Задание описывает рецепт, а QuestRun следит за ним, пока идёт уровень.

import { formatTime } from './progress';

export type Quest =
  /** Дойти до портала, уложившись в лимит, с. */
  { kind: 'time'; limit: number; intro: string };

/** Цель одной строкой — для экрана перехода и HUD. */
export function questGoal(q: Quest): string {
  return `Дойди до портала за ${formatTime(q.limit)}`;
}

export class QuestRun {
  private time = 0;

  constructor(readonly quest: Quest) {}

  /** Задание уже не выполнить на этом уровне. */
  get failed(): boolean {
    return this.time > this.quest.limit;
  }

  tick(dt: number): void {
    this.time += dt;
  }

  /** Проверка при входе в портал. */
  passed(): boolean {
    return !this.failed;
  }

  /** Строка для HUD с текущим прогрессом. */
  get status(): string {
    if (this.failed) return 'время вышло';
    return `осталось ${formatTime(Math.ceil(this.quest.limit - this.time))}`;
  }
}
