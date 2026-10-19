// Панель «Дневник» в главном меню: что игрок нашёл в лесу.

import { journal, NOTES, SHADES } from '../journal';
import { BIOMES, type BiomeId } from '../levels/biomes';
import { plural } from '../utils';

const rgb = ([r, g, b]: readonly number[]) => `rgb(${r * 255} ${g * 255} ${b * 255})`;

function shadesHtml(): string {
  const ids = Object.keys(SHADES) as BiomeId[];
  const found = ids.filter((id) => journal.shades[id]).length;
  const rows = ids.map((id) => {
    const n = journal.shades[id] ?? 0;
    const s = SHADES[id];
    return n
      ? `<li class="shade"><i style="--c:${rgb(s.color)}"></i>${s.name}<span>${BIOMES[id].name}${n > 1 ? ` · ×${n}` : ''}</span></li>`
      : `<li class="shade off"><i></i>???<span>${BIOMES[id].name}</span></li>`;
  });
  return `<h5>Оттенки кристаллов · ${found} из ${ids.length}</h5>
    <p>Иногда среди золотых кристаллов попадается редкий — у каждого биома свой цвет. А пока тебя нет, такие кристаллы растут в саду у каменного круга.</p>
    <ul class="shade-list">${rows.join('')}</ul>`;
}

function notesHtml(): string {
  const found = NOTES.slice(0, journal.notes).map((t, i) => `<li class="note"><b>${i + 1}.</b> ${t}</li>`);
  const hint = journal.notes < NOTES.length ? `<p>Ещё ${NOTES.length - journal.notes} — ищи светящиеся камни на полянах.</p>` : '';
  return `<h5>Записки путника · ${journal.notes} из ${NOTES.length}</h5>
    ${found.length ? `<ul>${found.join('')}</ul>` : '<p>Кто-то прошёл этот лес раньше и оставил на полянах камни с записками.</p>'}${hint}`;
}

function statsHtml(): string {
  const s = journal.stats;
  const km = s.distance >= 1000 ? `${(s.distance / 1000).toFixed(1)} км` : `${Math.round(s.distance)} м`;
  const h = Math.floor(s.time / 3600), m = Math.floor((s.time % 3600) / 60);
  const time = h ? `${h} ч ${m} мин` : `${m} мин`;
  const n = (v: number) => Math.round(v).toLocaleString('ru-RU');
  return `<h5>В пути</h5><dl>
    <dt>Пройдено</dt><dd>${km}</dd>
    <dt>В лесу</dt><dd>${time}</dd>
    <dt>Прыжков</dt><dd>${n(s.jumps)}</dd>
    <dt>Кристаллов</dt><dd>${n(s.crystals)}</dd>
    <dt>Порталов</dt><dd>${n(s.levels)} ${plural(s.levels, 'раз', 'раза', 'раз')}</dd></dl>`;
}

export function journalHtml(): string {
  return statsHtml() + shadesHtml() + notesHtml();
}
