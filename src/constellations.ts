// Звёздное небо игрока: каждая заработанная звезда зажигает следующую точку созвездия.
// Созвездия процедурные, но одинаковые у всех: фигура, имя и место на небе зависят
// только от номера созвездия. Здесь — чистая геометрия, без Babylon.js; рисуют небо
// меню (ui/sky-panel.ts) и ночное небо уровня (starsky.ts).

import { Rng } from './rng';

/** Направление на звезду: единичный вектор, y — вверх. */
export type Dir = readonly [x: number, y: number, z: number];

export interface SkyStar {
  dir: Dir;
  /** Яркость 0..1. */
  mag: number;
}

export interface Constellation {
  name: string;
  /** В порядке зажигания: каждая следующая звезда связана линией с уже зажжённой. */
  stars: SkyStar[];
  edges: [number, number][];
}

/** Мест под созвездия на небе; звёзды сверх них рассыпаются звёздной пылью. */
const SLOTS = 24;
/** Градусов неба на единицу фигуры: фигура — около 30° в поперечнике. */
const SCALE = 1.5;
const SEED = 20261019;
const DEG = Math.PI / 180;

// ---------- Имена ----------

type Gender = 0 | 1 | 2;
const ADJ: readonly (readonly [string, string, string])[] = [
  ['Тихий', 'Тихая', 'Тихое'],
  ['Спящий', 'Спящая', 'Спящее'],
  ['Северный', 'Северная', 'Северное'],
  ['Дальний', 'Дальняя', 'Дальнее'],
  ['Малый', 'Малая', 'Малое'],
  ['Седой', 'Седая', 'Седое'],
  ['Лесной', 'Лесная', 'Лесное'],
  ['Серебряный', 'Серебряная', 'Серебряное'],
  ['Старый', 'Старая', 'Старое'],
  ['Летящий', 'Летящая', 'Летящее'],
  ['Хрустальный', 'Хрустальная', 'Хрустальное'],
  ['Сонный', 'Сонная', 'Сонное'],
  ['Зимний', 'Зимняя', 'Зимнее'],
  ['Туманный', 'Туманная', 'Туманное'],
  ['Рыжий', 'Рыжая', 'Рыжее'],
  ['Бродячий', 'Бродячая', 'Бродячее'],
  ['Ночной', 'Ночная', 'Ночное'],
  ['Звонкий', 'Звонкая', 'Звонкое'],
];
const NOUN: readonly (readonly [string, Gender])[] = [
  ['Лис', 0], ['Ручей', 0], ['Олень', 0], ['Ветер', 0], ['Ёж', 0], ['Гриб', 0], ['Ковш', 0],
  ['Ключ', 0], ['Колокол', 0], ['Филин', 0], ['Журавль', 0], ['Лист', 0], ['Мост', 0],
  ['Барсук', 0], ['Костёр', 0], ['Жёлудь', 0], ['Клён', 0], ['Челнок', 0], ['Заяц', 0],
  ['Сова', 1], ['Ель', 1], ['Цапля', 1], ['Лодка', 1], ['Арфа', 1], ['Тропа', 1], ['Свеча', 1],
  ['Рысь', 1], ['Улитка', 1], ['Шишка', 1], ['Лань', 1], ['Белка', 1], ['Ива', 1], ['Стрела', 1],
  ['Перо', 2], ['Облако', 2], ['Гнездо', 2], ['Озеро', 2], ['Крыло', 2], ['Веретено', 2],
];

// ---------- Места на небе ----------

/** Центры созвездий: равномерно по куполу (высота 30–80°), по порядку — как можно дальше от уже занятых. */
function slotCenters(): Dir[] {
  const pts: Dir[] = [];
  const y0 = Math.sin(30 * DEG), y1 = Math.sin(80 * DEG);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < SLOTS; i++) {
    const y = y0 + ((i + 0.5) / SLOTS) * (y1 - y0);
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  // Первое созвездие — высоко над головой, чуть к югу; дальше — самое далёкое от занятых
  const order: Dir[] = [];
  let best = pts.reduce((b, p) => (Math.abs(p[1] - 0.8) < Math.abs(b[1] - 0.8) ? p : b));
  while (pts.length) {
    order.push(best);
    pts.splice(pts.indexOf(best), 1);
    let far = -Infinity;
    for (const p of pts) {
      const d = Math.min(...order.map((o) => 1 - dot(o, p)));
      if (d > far) [far, best] = [d, p];
    }
  }
  return order;
}

const dot = (a: Dir, b: Dir) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function normalize(x: number, y: number, z: number): Dir {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Точка (u, v) в градусах на касательной плоскости к центру — на сферу (гномоническая проекция). */
function toSphere(c: Dir, u: number, v: number): Dir {
  const e = normalize(-c[2], 0, c[0]); // на восток: up × c
  const n: Dir = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
  const tu = Math.tan(u * DEG), tv = Math.tan(v * DEG);
  return normalize(c[0] + e[0] * tu + n[0] * tv, c[1] + e[1] * tu + n[1] * tv, c[2] + e[2] * tu + n[2] * tv);
}

// ---------- Фигуры ----------

type P = [number, number];

/** Пересекаются ли отрезки ab и cd (касание концами не считается). */
function crosses(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * Фигура k-го созвездия на касательной плоскости (в единицах SCALE градусов): цепочка из 4–8 звёзд с плавными поворотами,
 * иногда с ответвлением и замкнутым «ковшом». Звёзды не слипаются, линии не пересекаются.
 */
function shape(rng: Rng, k: number): { pts: P[]; edges: [number, number][] } {
  // Первые созвездия маленькие — первая награда приходит быстро
  const n = rng.int(Math.min(4 + (k >> 2), 5), Math.min(4 + (k >> 1), 8));
  for (;;) {
    const pts: P[] = [[0, 0]];
    const edges: [number, number][] = [];
    const heading: number[] = [rng.range(0, Math.PI * 2)];
    let tip = 0;
    let branched = false;
    let tries = 0;
    while (pts.length < n && tries++ < 200) {
      const branch: boolean = !branched && pts.length >= 3 && rng.chance(0.3);
      const from = branch ? rng.int(1, pts.length - 2) : tip;
      const turn = branch ? rng.pick([-1, 1]) * rng.range(60, 110) * DEG : rng.range(-65, 65) * DEG;
      const ang = heading[from] + turn;
      const len = rng.range(3.2, 5.4);
      const p: P = [pts[from][0] + Math.cos(ang) * len, pts[from][1] + Math.sin(ang) * len];
      if (Math.hypot(...p) > 10) continue;
      if (pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 2.6)) continue;
      if (edges.some(([a, b]) => a !== from && b !== from && crosses(pts[a], pts[b], pts[from], p))) continue;
      pts.push(p);
      heading.push(ang);
      edges.push([from, pts.length - 1]);
      tip = pts.length - 1;
      branched ||= branch;
    }
    if (pts.length < n) continue;
    // Иногда последняя звезда замыкает «ковш» на близкую несоседнюю
    if (rng.chance(0.35)) {
      const last = pts.length - 1;
      const linked = (a: number, b: number) => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
      const k = pts.findIndex(
        (q, i) =>
          i < last - 1 &&
          !linked(i, last) &&
          Math.hypot(q[0] - pts[last][0], q[1] - pts[last][1]) < 6.5 &&
          !edges.some(([a, b]) => a !== i && b !== i && a !== last && b !== last && crosses(pts[a], pts[b], q, pts[last])),
      );
      if (k >= 0) edges.push([k, last]);
    }
    // Центр фигуры — в центр слота
    const cx = pts.reduce((s, p) => s + p[0], 0) / n;
    const cy = pts.reduce((s, p) => s + p[1], 0) / n;
    return { pts: pts.map(([x, y]) => [x - cx, y - cy]), edges };
  }
}

function build(): Constellation[] {
  const centers = slotCenters();
  const usedNames = new Set<string>();
  const usedNouns = new Set<number>();
  return centers.map((c, k) => {
    const rng = Rng.stream(SEED + k, 'constellation');
    const { pts, edges } = shape(rng, k);
    const brightest = rng.int(0, pts.length - 1);
    const stars = pts.map(([u, v], i) => ({ dir: toSphere(c, u * SCALE, v * SCALE), mag: i === brightest ? 1 : rng.range(0.5, 0.9) }));
    let name = '';
    do {
      const free = NOUN.map((_, i) => i).filter((i) => !usedNouns.has(i));
      const ni = rng.pick(free.length ? free : NOUN.map((_, i) => i));
      const [noun, g] = NOUN[ni];
      name = `${rng.pick(ADJ)[g]} ${noun}`;
      usedNouns.add(ni);
    } while (usedNames.has(name));
    usedNames.add(name);
    return { name, stars, edges };
  });
}

export const CONSTELLATIONS: readonly Constellation[] = build();

/** Звезда сверх всех созвездий: россыпь по куполу. */
function dustStar(i: number): SkyStar {
  const rng = Rng.stream(SEED + i, 'dust');
  const y = rng.range(Math.sin(12 * DEG), 0.97);
  const a = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - y * y);
  return { dir: [Math.cos(a) * r, y, Math.sin(a) * r], mag: rng.range(0.45, 0.8) };
}

/** Фоновые звёзды — не заработанные, просто ночное небо. */
export const BACKGROUND: readonly SkyStar[] = (() => {
  const rng = Rng.stream(SEED, 'background');
  const out: SkyStar[] = [];
  for (let i = 0; i < 420; i++) {
    const y = rng.range(0.02, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - y * y);
    out.push({ dir: [Math.cos(a) * r, y, Math.sin(a) * r], mag: rng.next() ** 3 });
  }
  return out;
})();

export interface SkyProgress {
  /** Созвездия, где горит хотя бы одна звезда, и сколько в каждом зажжено. */
  lit: { c: Constellation; count: number; done: boolean; first: number }[];
  /** Звёзды сверх всех созвездий. */
  dust: { star: SkyStar; index: number }[];
  /** Сколько созвездий собрано целиком. */
  done: number;
  /** Ближайшее незаконченное созвездие и сколько звёзд до него осталось. */
  next: { c: Constellation; left: number } | null;
}

/** Небо при данном числе звёзд: первые звёзды — первому созвездию, следующие — второму и так далее. */
export function skyFor(total: number): SkyProgress {
  const lit: SkyProgress['lit'] = [];
  let first = 0;
  let next: SkyProgress['next'] = null;
  for (const c of CONSTELLATIONS) {
    const count = Math.min(c.stars.length, total - first);
    if (count <= 0) {
      next ??= { c, left: c.stars.length };
      break;
    }
    lit.push({ c, count, done: count === c.stars.length, first });
    if (count < c.stars.length) next = { c, left: c.stars.length - count };
    first += c.stars.length;
    if (next) break;
  }
  const dust: SkyProgress['dust'] = [];
  for (let i = first; i < total && !next; i++) dust.push({ star: dustStar(i), index: i });
  return { lit, dust, done: lit.filter((l) => l.done).length, next };
}
