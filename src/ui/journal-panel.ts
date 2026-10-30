// Панель «Дневник» в главном меню: что игрок нашёл в лесу, по вкладкам.

import { ACHIEVEMENTS, isDone, progressText } from '../achievements';
import { ATLAS_KINDS, ATLAS_TOTAL, atlasCount, journal, NOTES, SHADES } from '../journal';
import { BIOMES, type BiomeId } from '../levels/biomes';
import { ITEMS } from '../den/catalog';
import { DECOR } from '../den/decor';
import type { SecretKind } from '../levels/generator';
import { daysPlayed } from '../levels/progress';
import { plural } from '../utils';
import type { InfoTab } from './menu';

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
    <p>Иногда среди золотых кристаллов попадается редкий — у каждого биома свой цвет. А пока тебя нет, такие кристаллы растут в саду у норы.</p>
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
  return `<dl>
    <dt>Пройдено</dt><dd>${km}</dd>
    <dt>В лесу</dt><dd>${time}</dd>
    <dt>Прыжков</dt><dd>${n(s.jumps)}</dd>
    <dt>Кристаллов</dt><dd>${n(s.crystals)}</dd>
    <dt>Тайников</dt><dd>${n(s.secrets)}</dd>
    <dt>Порталов</dt><dd>${n(s.levels)} ${plural(s.levels, 'раз', 'раза', 'раз')}</dd></dl>`;
}

function clearingHtml(): string {
  const n = Math.min(daysPlayed(), DECOR.length);
  const next = DECOR[n];
  return `<h5>Поляна у норы · ${n} из ${DECOR.length}</h5>
    <p>За каждый день, когда ты проходишь уровень, на поляне у норы появляется что-то новое. Пропущенный день ничего не отнимает.</p>
    ${n ? `<ul>${DECOR.slice(0, n).map((d) => `<li>${d.name}</li>`).join('')}</ul>` : ''}
    ${next ? '<p>Что будет дальше — увидишь завтра.</p>' : '<p>Поляна расцвела целиком.</p>'}`;
}

const KIND_NAMES: Record<SecretKind, string> = { tree: 'Дерево', stone: 'Камень', ring: 'Круг', ledge: 'Уступ', pearl: 'Жемчуг' };

/** Атлас тайн: биомы по строкам, виды тайников по столбцам; жемчужина — только у озёр. */
function atlasHtml(): string {
  const kinds = Object.keys(KIND_NAMES) as SecretKind[];
  const n = atlasCount();
  const head = `<tr><th></th>${kinds.map((k) => `<th>${KIND_NAMES[k]}</th>`).join('')}</tr>`;
  const rows = (Object.keys(ATLAS_KINDS) as BiomeId[]).map((b) => {
    const cells = kinds.map((k) => {
      if (!ATLAS_KINDS[b].includes(k)) return '<td class="na">—</td>';
      return journal.atlas[b]?.includes(k) ? '<td class="got">✦</td>' : '<td>·</td>';
    });
    return `<tr><th>${BIOMES[b].name}</th>${cells.join('')}</tr>`;
  });
  const next = ITEMS.filter((i) => i.atlas && i.atlas > n).sort((a, b) => a.atlas! - b.atlas!)[0];
  return `<h5>Атлас тайн · ${n} из ${ATLAS_TOTAL}</h5>
    <p>Первый тайник каждого вида в каждом лесу — новая запись. Всего раскрыто тайников: ${journal.stats.secrets}.</p>
    <table class="atlas">${head}${rows.join('')}</table>
    ${next ? `<p>Ещё ${next.atlas! - n} — и для норы откроется «${next.name}».</p>` : '<p>Все вещи из тайников для норы открыты.</p>'}`;
}

/** Достижения: заработанные сверху, у остальных — прогресс полоской. */
function achievementsHtml(): string {
  const done = ACHIEVEMENTS.filter(isDone);
  const rest = ACHIEVEMENTS.filter((a) => !isDone(a));
  const row = (a: (typeof ACHIEVEMENTS)[number], got: boolean) => {
    const [cur, goal] = a.progress();
    const k = Math.min(1, cur / goal);
    return `<li class="badge${got ? '' : ' off'}"><b>${got ? '🏅' : '○'} ${a.name}</b><span>${a.desc}${got ? '' : ` · ${progressText(a)}`}</span>${
      got ? '' : `<i style="--k:${k.toFixed(3)}"></i>`
    }</li>`;
  };
  return `<h5>Достижения · ${done.length} из ${ACHIEVEMENTS.length}</h5>
    <ul class="badge-list">${[...done.map((a) => row(a, true)), ...rest.map((a) => row(a, false))].join('')}</ul>`;
}

export const JOURNAL_TABS: InfoTab[] = [
  { id: 'achievements', name: 'Достижения', html: achievementsHtml },
  { id: 'finds', name: 'Находки', html: () => shadesHtml() + notesHtml() },
  { id: 'secrets', name: 'Тайны', html: atlasHtml },
  { id: 'clearing', name: 'Поляна', html: clearingHtml },
  { id: 'stats', name: 'В пути', html: statsHtml },
];
