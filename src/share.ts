// «Поделиться»: ссылка на игру и результат Леса дня — короткий текст в буфер обмена, как в Wordle.

import { BIOMES } from './levels/biomes';
import { currentStreak, formatTime, progress } from './levels/progress';
import { dailyRecipe } from './levels/recipes';

/** Текст результата за дату; null — в этот день Лес дня ещё не пройден. */
export function dailyShareText(date: string): string | null {
  const d = progress.daily;
  if (!d || d.date !== date) return null;
  const [, m, day] = date.split('-');
  const biome = BIOMES[dailyRecipe(date).biome].name;
  const { days } = currentStreak();
  const parts = [`⏱ ${formatTime(d.time)}`];
  if (d.quest) parts.push('★ задание');
  if (days > 1) parts.push(`🔥 ${days}`);
  return `Тихая поляна · Лес дня ${day}.${m} · ${biome}\n${parts.join(' · ')}\n${gameUrl()}`;
}

/** Ссылка на игру: без query и hash — она ведёт на игру, а не на чьё-то состояние. */
export const gameUrl = (): string => location.origin + location.pathname;

/** Копирует текст; на старых браузерах и без HTTPS — через скрытое поле. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
