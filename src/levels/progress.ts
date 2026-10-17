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
}

const KEY = 'tihaya-polyana-progress';

function load(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Progress> | null;
    if (p && typeof p === 'object' && Number.isInteger(p.current) && Number.isInteger(p.unlocked)) {
      return { current: p.current!, unlocked: Math.max(p.unlocked!, p.current!), records: p.records ?? {} };
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

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
