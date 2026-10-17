// Задания уровней: дополнительная цель, за которую дают вторую звезду.
// Задание описывает рецепт, а QuestRun следит за ним, пока идёт уровень.

import type { LevelLayout } from './generator';
import { formatTime } from './progress';

export type Quest =
  /** Дойти до портала, уложившись в лимит, с. */
  | { kind: 'time'; limit: number; intro: string }
  /** Пройти уровень, ни разу не побежав. */
  | { kind: 'walk'; intro: string }
  /** Прыжков не больше, чем платформ на уровне, плюс запас. */
  | { kind: 'jumps'; spare: number; intro: string }
  /** Собрать кристаллы на вершинах всех цепочек. */
  | { kind: 'tops'; intro: string }
  /** Найти все спрятанные кристаллы. */
  | { kind: 'hidden'; intro: string }
  /** После первого прыжка не стоять на земле дольше нескольких секунд. */
  | { kind: 'hop'; intro: string }
  /** Побывать на всех боковых полянах. */
  | { kind: 'explore'; intro: string }
  /** Искупаться в каждом озере. */
  | { kind: 'swim'; intro: string }
  /** Ни разу не зайти в воду. */
  | { kind: 'dry'; intro: string };

export type QuestKind = Quest['kind'];

/** Сколько можно простоять на земле в задании «без остановок», с. */
const HOP_GROUND = 2.5;
/** Глубина, с которой вода считается купанием, а не мелководьем у берега, м. */
const SWIM_DEPTH = 0.3;

/** Что заданию нужно знать о герое в кадре. */
export interface QuestInput {
  x: number;
  z: number;
  running: boolean;
  jumped: boolean;
  onGround: boolean;
  /** Глубина воды у ног; 0 — сухо или герой над водой в прыжке. */
  wet: number;
}

/** Сколько целей на уровне у заданий со счётчиком; null — у задания нет счётчика. */
function targetCount(kind: QuestKind, layout: LevelLayout): number | null {
  switch (kind) {
    case 'tops':
      return layout.crystals.filter((c) => c.kind === 'top').length;
    case 'hidden':
      return layout.crystals.filter((c) => c.kind === 'hidden').length;
    case 'explore':
      return layout.clearings.length - 1;
    case 'swim':
    case 'dry':
      return layout.lakes.length;
    default:
      return null;
  }
}

/** Задание, которое на этом уровне не выполнить (нет цепочек, тайников или озёр), заменяется заданием на время. */
export function fitQuest(q: Quest, layout: LevelLayout): Quest {
  if (targetCount(q.kind, layout) !== 0) return q;
  return { kind: 'time', limit: Math.round(120 + layout.half * 2.5), intro: 'Лес засыпает — успей до темноты' };
}

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
  /** Сколько герой стоит на земле после прыжка; null — ещё не прыгал. */
  private grounded: number | null = null;
  /** Цели заданий со счётчиком и уже достигнутые из них. */
  private readonly targets: number | null;
  private readonly reached = new Set<number>();

  constructor(
    readonly quest: Quest,
    private readonly layout: LevelLayout,
  ) {
    // Каждую платформу хватит одного прыжка — на вершину любой цепочки забраться можно
    this.maxJumps = quest.kind === 'jumps' ? layout.platforms.length + quest.spare : 0;
    this.targets = targetCount(quest.kind, layout);
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
      case 'tops':
        return 'Собери кристаллы на всех вершинах';
      case 'hidden':
        return 'Найди все спрятанные кристаллы';
      case 'hop':
        return 'Скачи без остановок';
      case 'explore':
        return 'Побывай на всех полянах';
      case 'swim':
        return 'Искупайся в каждом озере';
      case 'dry':
        return 'Не замочи ног';
    }
  }

  /** Задание уже не выполнить на этом уровне. */
  get failed(): boolean {
    return this.broken || (this.quest.kind === 'time' && this.time > this.quest.limit);
  }

  /** Все цели задания со счётчиком достигнуты; остаётся дойти до портала. */
  get complete(): boolean {
    return this.targets !== null && this.reached.size >= this.targets;
  }

  tick(dt: number, input: QuestInput): void {
    this.time += dt;
    if (input.jumped) this.jumps++;
    switch (this.quest.kind) {
      case 'walk':
        if (input.running) this.broken = true;
        break;
      case 'jumps':
        if (this.jumps > this.maxJumps) this.broken = true;
        break;
      case 'hop':
        // Отсчёт идёт с первого прыжка и сбрасывается в каждом новом
        if (input.jumped) this.grounded = 0;
        else if (this.grounded !== null) this.grounded = input.onGround ? this.grounded + dt : 0;
        if ((this.grounded ?? 0) > HOP_GROUND) this.broken = true;
        break;
      case 'explore':
        this.layout.clearings.forEach((c, i) => {
          if (i > 0 && Math.hypot(input.x - c.x, input.z - c.z) < c.r) this.reached.add(i);
        });
        break;
      case 'swim':
        if (input.wet > SWIM_DEPTH) {
          const i = this.lakeAt(input.x, input.z);
          if (i >= 0) this.reached.add(i);
        }
        break;
      case 'dry':
        if (input.wet > 0) this.broken = true;
        break;
    }
  }

  /** Собраны кристаллы с этими номерами. */
  onCollect(indices: readonly number[]): void {
    const want = this.quest.kind === 'tops' ? 'top' : this.quest.kind === 'hidden' ? 'hidden' : null;
    if (!want) return;
    for (const i of indices) if (this.layout.crystals[i].kind === want) this.reached.add(i);
  }

  /** Проверка при входе в портал. */
  passed(): boolean {
    return !this.failed && (this.targets === null || this.complete);
  }

  /** Строка для HUD с текущим прогрессом. */
  get status(): string {
    const count = `${this.reached.size}/${this.targets}`;
    switch (this.quest.kind) {
      case 'time':
        return this.failed ? 'время вышло' : `осталось ${formatTime(Math.ceil(this.quest.limit - this.time))}`;
      case 'walk':
        return this.failed ? 'был бег' : 'пока шагом';
      case 'jumps':
        return this.failed ? 'прыжки кончились' : `осталось ${this.maxJumps - this.jumps}`;
      case 'tops':
        return `вершины ${count}`;
      case 'hidden':
        return `тайники ${count}`;
      case 'hop':
        return this.failed ? 'слишком долго на земле' : this.grounded === null ? 'начни с прыжка' : 'не останавливайся';
      case 'explore':
        return `поляны ${count}`;
      case 'swim':
        return `озёра ${count}`;
      case 'dry':
        return this.failed ? 'ноги промокли' : 'пока сухо';
    }
  }

  /** Номер озера в точке; −1 — вода вне озёр (низина у края карты). */
  private lakeAt(x: number, z: number): number {
    // Котловина шире заданного радиуса на ширину откоса
    return this.layout.lakes.findIndex((l) => Math.hypot(x - l.x, z - l.z) < l.r + 7);
  }
}
