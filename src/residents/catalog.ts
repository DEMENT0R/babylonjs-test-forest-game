// Жители леса: кто они, где живут и о чём просят. Просьба — шаг цепочки: житель говорит
// пару строк, а выполняется она на уровнях. Цепочки короткие и написаны вручную.

import type { CropId, MaterialId } from '../den/catalog';
import type { BiomeId } from '../levels/biomes';
import type { SecretKind } from '../levels/generator';

export type ResidentId = 'hedgehog';

/**
 * Шаг цепочки просьб. Житель говорит ask, а когда просьба выполнена и герой пришёл — thanks.
 * bring — принести материалы или урожай из норы: житель забирает их при встрече;
 * find — найти потерянную вещь на вершине цепочки платформ уровня биома и отнести хозяину;
 * quest — выполнить задание уровня в биоме; combo — собрать серию не меньше n;
 * secret — раскрыть тайник такого вида в биоме.
 * Кроме bring, всё делается на уровнях, а потом надо прийти к жителю и рассказать.
 */
export type RequestStep = { ask: string; thanks: string } & (
  | { kind: 'bring'; mats?: Partial<Record<MaterialId, number>>; crops?: Partial<Record<CropId, number>> }
  | { kind: 'find'; biome: BiomeId; item: LostItem }
  | { kind: 'quest'; biome: BiomeId }
  | { kind: 'combo'; n: number }
  | { kind: 'secret'; biome: BiomeId; secret: SecretKind }
);

/** Потерянная вещь: имя в винительном падеже («отнеси ежу яблоко») и вид модели. */
export interface LostItem { name: string; look: 'apple' | 'acorn' | 'button' }

export interface ResidentDef {
  id: ResidentId;
  name: string;
  /** Кому отнести: дательный падеж. */
  dative: string;
  /** Значок в строке просьбы. */
  icon: string;
  /** Где живёт: здесь его встречают. */
  biome: BiomeId;
  file: string;
  /** Высота модели в игре, м, и поворот, чтобы смотрела вдоль +Z. */
  height: number;
  yaw: number;
  /** Что он говорит при первой встрече — перед первой просьбой. */
  hello: string;
  steps: readonly RequestStep[];
  /** Цепочка пройдена. */
  done: string;
}

export const RESIDENTS: readonly ResidentDef[] = [
  {
    id: 'hedgehog',
    name: 'Ёж',
    dative: 'ежу',
    icon: '🦔',
    biome: 'meadow',
    file: 'hedgehog.glb',
    height: 0.42,
    yaw: 0,
    hello: 'Ой, здравствуй! Я ёж, живу тут, под старым пнём.',
    steps: [
      {
        kind: 'bring',
        mats: { cone: 3 },
        ask: 'Зима скоро, а у меня в кладовой ни одной шишки. Принесёшь три?',
        thanks: 'Три шишки! Теперь зимовать не страшно. Спасибо!',
      },
      {
        kind: 'find',
        biome: 'meadow',
        item: { name: 'красное яблоко', look: 'apple' },
        ask: 'Нёс домой яблоко и уронил его, когда лез на уступы. Оно где-то наверху, на нашей поляне.',
        thanks: 'Моё яблоко! Целое, даже не помялось.',
      },
      {
        kind: 'combo',
        n: 4,
        ask: 'Люблю, когда кристаллы звенят подряд, будто колокольчики. Собери серию из четырёх и расскажи мне!',
        thanks: 'Четыре подряд! Я отсюда слышал — дзынь-дзынь-дзынь-дзынь.',
      },
      {
        kind: 'bring',
        mats: { acorn: 2 },
        ask: 'Говорят, в осенней роще жёлуди с ладонь. Вот бы взглянуть хоть на два!',
        thanks: 'И правда с ладонь! Ты настоящий друг.',
      },
    ],
    done: 'Заходи ещё — у меня всегда найдётся сушёный гриб к чаю.',
  },
];

export const residentById = (id: string): ResidentDef | undefined => RESIDENTS.find((r) => r.id === id);
