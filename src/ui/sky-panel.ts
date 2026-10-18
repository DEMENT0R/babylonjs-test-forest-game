// Панель «Небо» в главном меню: карта купола с созвездиями игрока (зенит в центре,
// горизонт по краю). Звёзды, которых игрок ещё не видел, загораются по очереди.

import { BACKGROUND, CONSTELLATIONS, skyFor, type Dir } from '../constellations';

const KEY = 'tihaya-polyana-sky-seen';
const C = 100;
const R = 94;

/** Сколько звёзд игрок уже видел на карте неба. */
export function seenStars(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

function markSeen(n: number): void {
  try {
    localStorage.setItem(KEY, String(n));
  } catch {
    // Хранилище недоступно — анимация повторится в следующий раз
  }
}

/** Ниже этой высоты, рад, звёзд на карте нет: их всё равно закрывает лес. */
const LOW = 0.2;

/** Азимутальная проекция: высота над горизонтом — расстояние от центра, край карты — высота LOW. */
function project([x, y, z]: Dir): [number, number] {
  const r = ((Math.PI / 2 - Math.asin(Math.min(1, y))) / (Math.PI / 2 - LOW)) * R;
  const a = Math.atan2(z, x);
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

const f = (v: number) => v.toFixed(1);
const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

export function skyHtml(total: number): string {
  const sky = skyFor(total);
  const seen = Math.min(seenStars(), total);
  const back: string[] = [];
  const lines: string[] = [];
  const stars: string[] = [];
  const names: string[] = [];
  let delay = 0;
  const star = (d: Dir, mag: number, index: number) => {
    const [x, y] = project(d);
    const fresh = index >= seen;
    const style = fresh ? ` style="animation-delay:${(0.3 + 0.35 * delay++).toFixed(2)}s"` : '';
    stars.push(`<circle class="sky-star${fresh ? ' new' : ''}" cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + mag * 0.9)}"${style}/>`);
  };

  for (const s of BACKGROUND) {
    if (s.dir[1] < Math.sin(LOW)) continue;
    const [x, y] = project(s.dir);
    back.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.25 + s.mag * 0.55)}" opacity="${f(0.2 + s.mag * 0.5)}"/>`);
  }

  // Следующее созвездие — пунктирный контур-подсказка поверх уже зажжённых звёзд
  const ghost = sky.next?.c;
  if (ghost) {
    const lit = sky.lit.find((l) => l.c === ghost)?.count ?? 0;
    for (const [a, b] of ghost.edges) {
      const [x1, y1] = project(ghost.stars[a].dir), [x2, y2] = project(ghost.stars[b].dir);
      if (a >= lit || b >= lit) lines.push(`<line class="sky-hint" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`);
    }
    ghost.stars.slice(lit).forEach((s) => {
      const [x, y] = project(s.dir);
      stars.push(`<circle class="sky-ghost" cx="${f(x)}" cy="${f(y)}" r="1.1"/>`);
    });
  }

  // Подписаны последние собранные созвездия, остальные — во всплывающей подсказке и в списке
  const lastDone = sky.done - 1;
  sky.lit.forEach(({ c, count, done, first }, k) => {
    const edges: string[] = [];
    for (const [a, b] of c.edges) {
      if (a >= count || b >= count) continue;
      const [x1, y1] = project(c.stars[a].dir), [x2, y2] = project(c.stars[b].dir);
      edges.push(`<line class="sky-line${done ? '' : ' part'}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`);
    }
    lines.push(`<g><title>${c.name}${done ? '' : ` — ${count} из ${c.stars.length}`}</title>${edges.join('')}</g>`);
    c.stars.slice(0, count).forEach((s, i) => star(s.dir, s.mag, first + i));
    const fresh = first + c.stars.length > seen;
    if (done && k >= lastDone - 1) {
      const pts = c.stars.map((s) => project(s.dir));
      // Подпись под фигурой, но не за краем карты
      const x = Math.min(170, Math.max(30, pts.reduce((s, p) => s + p[0], 0) / pts.length));
      const y = Math.min(196, Math.max(...pts.map((p) => p[1])) + 6);
      names.push(`<text class="sky-name${fresh ? ' new' : ''}" x="${f(x)}" y="${f(y)}">${c.name}</text>`);
    }
  });
  for (const { star: s, index } of sky.dust) star(s.dir, s.mag * 0.7, index);
  markSeen(total);

  const summary = total
    ? `<p class="sky-summary">★ <b>${total}</b> ${plural(total, 'звезда', 'звезды', 'звёзд')} · созвездий <b>${sky.done}</b> из ${CONSTELLATIONS.length}</p>`
    : '<p>Каждая звезда за уровень — за все кристаллы или за задание — зажигает звезду на этом небе. Ночью оно видно над лесом.</p>';
  const next = sky.next
    ? `<p>Следующее — «${sky.next.c.name}»: ещё ${sky.next.left} ★</p>`
    : '<p>Все созвездия собраны — новые звёзды рассыпаются по небу.</p>';
  const doneList = sky.lit.filter((l) => l.done).map((l) => `<li>${l.c.name}</li>`);
  return `${summary}${next}
    <svg class="sky-map" viewBox="0 0 200 200" role="img" aria-label="Звёздное небо: ${total} ★, созвездий ${sky.done}">
      <defs><radialGradient id="sky-bg"><stop offset="0" stop-color="#16244a"/><stop offset="1" stop-color="#070c1a"/></radialGradient></defs>
      <circle cx="${C}" cy="${C}" r="${R + 2}" fill="url(#sky-bg)"/>
      <g class="sky-back">${back.join('')}</g>
      <g>${lines.join('')}</g><g>${stars.join('')}</g><g>${names.join('')}</g>
    </svg>
    ${doneList.length ? `<h5>Собранные созвездия</h5><ul>${doneList.join('')}</ul>` : ''}`;
}
