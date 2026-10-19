// Прогресс кампании в localStorage: текущий уровень, открытые уровни, рекорды.

export interface LevelRecord {
  /** Собраны все кристаллы. */
  star: boolean;
  /** Выполнено задание уровня; в старых сохранениях поля нет. */
  quest?: boolean;
  /** Лучшее время прохождения, с. */
  time: number;
}

export interface Progress {
  /** Уровень, с которого продолжать. */
  current: number;
  /** Самый дальний открытый уровень. */
  unlocked: number;
  records: Record<number, LevelRecord>;
  /** Лучшее время в «Лесе дня» — только за последний день, когда в него играли. */
  daily?: { date: string; time: number };
  /** Серия: последний день, когда проходили уровень, и сколько дней подряд. */
  streak?: { last: string; days: number };
}

const KEY = 'tihaya-polyana-progress';

function load(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Progress> | null;
    if (p && typeof p === 'object' && Number.isInteger(p.current) && Number.isInteger(p.unlocked)) {
      return { current: p.current!, unlocked: Math.max(p.unlocked!, p.current!), records: p.records ?? {}, daily: p.daily, streak: p.streak };
    }
  } catch {
    // Повреждённые данные — начинаем сначала
  }
  return { current: 1, unlocked: 1, records: {} };
}

export const progress: Progress = load();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Хранилище недоступно — прогресс проживёт до перезагрузки
  }
}

export function setCurrentLevel(index: number): void {
  progress.current = index;
  save();
}

/** Записывает прохождение и открывает следующий уровень. */
export function completeLevel(index: number, star: boolean, quest: boolean, time: number): void {
  const prev = progress.records[index];
  progress.records[index] = {
    star: star || (prev?.star ?? false),
    quest: quest || (prev?.quest ?? false),
    time: prev ? Math.min(prev.time, time) : time,
  };
  progress.unlocked = Math.max(progress.unlocked, index + 1);
  progress.current = index + 1;
  save();
}

/** Дата по местному времени — ключ «Леса дня» и серии: 2026-10-19; shift — сдвиг в днях. */
export function todayKey(shift = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Серия дней подряд с пройденным уровнем; 0 — прервана. today — сегодня уже засчитано. */
export function currentStreak(): { days: number; today: boolean } {
  const s = progress.streak;
  if (!s) return { days: 0, today: false };
  if (s.last === todayKey()) return { days: s.days, today: true };
  return { days: s.last === todayKey(-1) ? s.days : 0, today: false };
}

/** Засчитать сегодняшний день в серию; возвращает новую длину, если день засчитан только что. */
export function markPlayedToday(): number | null {
  const { days, today } = currentStreak();
  if (today) return null;
  progress.streak = { last: todayKey(), days: days + 1 };
  save();
  return days + 1;
}

/** Лучшее время в «Лесе дня» за эту дату. */
export function dailyBest(date: string): number | undefined {
  return progress.daily?.date === date ? progress.daily.time : undefined;
}

export function completeDaily(date: string, time: number): void {
  const best = dailyBest(date);
  progress.daily = { date, time: best === undefined ? time : Math.min(best, time) };
  save();
}

/** Всего звёзд по всем уровням: за кристаллы и за задания. */
export function totalStars(): number {
  let n = 0;
  for (const r of Object.values(progress.records)) n += (r.star ? 1 : 0) + (r.quest ? 1 : 0);
  return n;
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
