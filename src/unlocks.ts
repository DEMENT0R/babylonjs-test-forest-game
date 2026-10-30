// Открытие функций по ходу игры: новичок видит в меню только «Играть» и настройки,
// остальное появляется, когда начинает что-то значить, — с тостом и точкой «новое» на пункте.
// Что открыто, вычисляется из прогресса, а не хранится: у тех, кто уже играл, всё на месте сразу.
// Хранится только, о чём уже сказали и какие новые пункты меню ещё не нажимали.

import { den } from './den/state';
import { journal } from './journal';
import { progress, totalStars } from './levels/progress';
import { byId, plural } from './utils';

export type Feature = 'levels' | 'sky' | 'journal' | 'share' | 'walk' | 'den' | 'stamina' | 'daily';

interface FeatureDef {
  id: Feature;
  /** Что сказать, когда откроется; без него открывается молча. */
  told?: string;
  /** Пункт меню: на нём точка «новое», пока его не нажмут. */
  button?: string;
  /** Открывается за пройденный уровень с этим номером — для строки «что дальше». */
  after?: number;
  /** Имя в строке «что дальше»; без него функция там не упоминается. */
  teaser?: string;
  open: () => boolean;
}

/** Пройден уровень n (или дальше). */
const passed = (n: number) => progress.unlocked > n;

const FEATURES: readonly FeatureDef[] = [
  { id: 'levels', told: '«Уровни» — пройденные можно переиграть', button: 'm-levels', after: 1, open: () => passed(1) },
  { id: 'share', told: '«Поделиться» и «Установить» — внизу меню', button: 'm-share', after: 1, open: () => passed(1) },
  // Кнопка «Шагом» на экране; на уровне с заданием «без бега» она есть и раньше
  { id: 'walk', open: () => passed(1) },
  { id: 'sky', told: '«Небо» — звёзды складываются в созвездия', button: 'm-sky', open: () => totalStars() > 0 },
  {
    id: 'journal',
    told: '«Дневник» — достижения и находки',
    button: 'm-journal',
    open: () => journal.notes > 0 || journal.badges.length > 0 || Object.values(journal.shades).some(Boolean),
  },
  // Кто уже обживал нору или играл в Лес дня, тот их не теряет
  {
    id: 'den',
    told: '«Нора» — свой двор, он обустраивается за кристаллы',
    button: 'm-den',
    after: 2,
    teaser: 'своя нора',
    open: () => passed(2) || den.owned.length > 0 || den.tier > 0,
  },
  {
    id: 'stamina',
    told: 'запал — рывок (E, B на геймпаде или кнопка «Рывок») и высокий прыжок, если держать прыжок',
    after: 2,
    teaser: 'рывок',
    open: () => passed(2) || Object.values(den.power).some((n) => (n ?? 0) > 0),
  },
  {
    id: 'daily',
    told: '«Лес дня» — одна раскладка на день, у всех одинаковая',
    button: 'm-daily',
    after: 3,
    teaser: 'Лес дня',
    open: () => passed(3) || progress.daily !== undefined,
  },
];

interface Seen {
  /** О чём уже сказали. */
  told: Feature[];
  /** Открылось, но пункт меню ещё не нажимали. */
  unseen: Feature[];
}

const KEY = 'tihaya-polyana-unlocks';

function load(): Seen {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Seen> | null;
    if (s && Array.isArray(s.told) && Array.isArray(s.unseen)) return { told: s.told, unseen: s.unseen };
  } catch {
    // Повреждённые данные — считаем заново
  }
  // Первый запуск с открытием функций: что уже открыто прогрессом, считается объявленным — без тостов
  return { told: FEATURES.filter((f) => f.open()).map((f) => f.id), unseen: [] };
}

const seen = load();
save();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    // Хранилище недоступно — тосты могут повториться после перезагрузки
  }
}

export const isOpen = (id: Feature): boolean => FEATURES.find((f) => f.id === id)!.open();

/** Что открылось с прошлой проверки: запоминает, что сказано, и ставит точки на пунктах меню. */
export function freshUnlocks(): string[] {
  const fresh = FEATURES.filter((f) => !seen.told.includes(f.id) && f.open());
  if (!fresh.length) return [];
  seen.told.push(...fresh.map((f) => f.id));
  seen.unseen.push(...fresh.filter((f) => f.button).map((f) => f.id));
  save();
  return fresh.flatMap((f) => (f.told ? [f.told] : []));
}

/** Что открыто на время уровня, хоть и закрыто по прогрессу: «Шагом» в задании «без бега». */
let levelOpen: readonly Feature[] = [];

/**
 * Закрытое прячут стили — по списку в body[data-locked]; точки «новое» — на ещё не нажатых пунктах.
 * open — что открыто на время уровня; без него остаётся прежнее.
 */
export function syncLocks(open?: readonly Feature[]): void {
  if (open) levelOpen = open;
  document.body.dataset.locked = FEATURES.filter((f) => !f.open() && !levelOpen.includes(f.id)).map((f) => f.id).join(' ');
  for (const f of FEATURES) if (f.button) byId(f.button).classList.toggle('fresh', seen.unseen.includes(f.id));
}

/** Пункт меню нажали — точка «новое» с него снимается. */
export function seenButton(button: string): void {
  const f = FEATURES.find((d) => d.button === button);
  if (!f || !seen.unseen.includes(f.id)) return;
  seen.unseen = seen.unseen.filter((id) => id !== f.id);
  save();
  byId(button).classList.remove('fresh');
}

/** Строка «что дальше»: ближайшее, что откроется за уровни; null — всё уже открыто. */
export function nextUnlock(): string | null {
  const ahead = FEATURES.filter((f) => f.teaser && f.after && !f.open());
  if (!ahead.length) return null;
  const after = Math.min(...ahead.map((f) => f.after!));
  const names = ahead.filter((f) => f.after === after).map((f) => f.teaser!);
  const left = after + 1 - progress.unlocked;
  return `Ещё ${left} ${plural(left, 'уровень', 'уровня', 'уровней')} — и ${names.length > 1 ? 'откроются' : 'откроется'} ${names.join(' и ')}`;
}
