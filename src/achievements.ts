// Достижения: долгие цели поверх статистики и коллекций «Дневника».
// Каждое считает прогресс «сейчас / цель»; заработанное запоминается навсегда.

import { skyFor } from './constellations';
import { TIERS } from './den/catalog';
import { den } from './den/state';
import { HEROES } from './heroes';
import { journal, NOTES, save, SHADES } from './journal';
import { DECOR } from './den/decor';
import { currentStreak, daysPlayed, progress, totalStars } from './levels/progress';
import { CAMPAIGN_LENGTH } from './levels/recipes';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** Прогресс: сколько есть и сколько нужно. */
  progress: () => readonly [cur: number, goal: number];
  /** Как показывать прогресс, если не штуками: км, часы. */
  unit?: 'km' | 'h';
}

const s = () => journal.stats;
const count = <T>(xs: readonly T[], f: (x: T) => unknown) => xs.filter(f).length;

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first', name: 'Первый портал', desc: 'Пройди уровень', progress: () => [s().levels, 1] },
  { id: 'campaign', name: 'Сквозь восемь лесов', desc: 'Пройди кампанию', progress: () => [progress.unlocked - 1, CAMPAIGN_LENGTH] },
  { id: 'daily', name: 'Лес дня', desc: 'Пройди Лес дня', progress: () => [progress.daily ? 1 : 0, 1] },
  { id: 'walk1', name: 'Лесная тропа', desc: 'Пройди километр', progress: () => [s().distance / 1000, 1], unit: 'km' },
  { id: 'walk10', name: 'Дальняя дорога', desc: 'Пройди 10 км', progress: () => [s().distance / 1000, 10], unit: 'km' },
  { id: 'hour', name: 'Час в лесу', desc: 'Проведи в лесу час', progress: () => [s().time / 3600, 1], unit: 'h' },
  { id: 'jumps', name: 'Попрыгунья', desc: 'Прыгни 500 раз', progress: () => [s().jumps, 500] },
  { id: 'jumps2', name: 'Кузнечик', desc: 'Прыгни 3000 раз', progress: () => [s().jumps, 3000] },
  { id: 'crystals', name: 'Звонкий карман', desc: 'Собери 100 кристаллов', progress: () => [s().crystals, 100] },
  { id: 'crystals2', name: 'Кристальный ручей', desc: 'Собери 1000 кристаллов', progress: () => [s().crystals, 1000] },
  { id: 'combo', name: 'Звенящая серия', desc: 'Собери серию ×5', progress: () => [s().bestCombo, 5] },
  { id: 'combo2', name: 'Перезвон', desc: 'Собери серию ×10', progress: () => [s().bestCombo, 10] },
  { id: 'sky', name: 'Первое созвездие', desc: 'Зажги созвездие целиком', progress: () => [skyFor(totalStars()).done, 1] },
  { id: 'herd', name: 'Вся стая', desc: 'Открой всех героев', progress: () => [totalStars(), Math.max(...HEROES.map((h) => h.stars))] },
  { id: 'shade', name: 'Редкая находка', desc: 'Найди редкий кристалл', progress: () => [count(Object.values(journal.shades), Boolean), 1] },
  {
    id: 'rainbow',
    name: 'Радуга леса',
    desc: 'Собери все оттенки',
    progress: () => [count(Object.values(journal.shades), Boolean), Object.keys(SHADES).length],
  },
  { id: 'notes', name: 'Летописец', desc: 'Прочти все записки путника', progress: () => [journal.notes, NOTES.length] },
  { id: 'week', name: 'Неделя в лесу', desc: 'Проходи уровень 7 дней подряд', progress: () => [currentStreak().days, 7] },
  { id: 'home', name: 'Новоселье', desc: 'Поставь у норы первую вещь', progress: () => [den.owned.length, 1] },
  { id: 'burrow', name: 'Большая нора', desc: 'Дорасти нору до второй комнаты', progress: () => [den.tier, TIERS.length - 1] },
  { id: 'bloom', name: 'Поляна в цвету', desc: 'Вырасти на поляне у норы всё', progress: () => [daysPlayed(), DECOR.length] },
];

export const isDone = (a: Achievement): boolean => journal.badges.includes(a.id) || a.progress()[0] >= a.progress()[1];

/** Записывает достижения, выполненные с прошлой проверки, и возвращает их. */
export function checkAchievements(): Achievement[] {
  const fresh = ACHIEVEMENTS.filter((a) => !journal.badges.includes(a.id) && a.progress()[0] >= a.progress()[1]);
  if (fresh.length) {
    journal.badges.push(...fresh.map((a) => a.id));
    save();
  }
  return fresh;
}

/** Прогресс для подписи: «3,2 / 10 км», «120 / 500». */
export function progressText(a: Achievement): string {
  const [cur, goal] = a.progress();
  const c = Math.min(cur, goal);
  if (a.unit === 'km') return `${c.toFixed(1).replace('.', ',')} / ${goal} км`;
  if (a.unit === 'h') return `${Math.floor(c * 60)} / ${goal * 60} мин`;
  return `${Math.floor(c).toLocaleString('ru-RU')} / ${goal.toLocaleString('ru-RU')}`;
}
