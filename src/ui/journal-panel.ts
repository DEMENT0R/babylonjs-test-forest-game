// Панель «Дневник» в главном меню: что игрок нашёл в лесу.

import { journal, SHADES } from '../journal';
import { BIOMES, type BiomeId } from '../levels/biomes';

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
    <p>Иногда среди золотых кристаллов попадается редкий — у каждого биома свой цвет.</p>
    <ul class="shade-list">${rows.join('')}</ul>`;
}

export function journalHtml(): string {
  return shadesHtml();
}
