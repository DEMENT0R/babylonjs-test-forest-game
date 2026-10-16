// Генератор уровня: из рецепта и сида строит чистые данные — где стоят деревья,
// камни, платформы и кристаллы. Ничего не рисует; меши строит levels/level.ts.
//
// Порядок: поляны → цепочки платформ → лес (Poisson-диск, рощи по шуму, сплошная
// стена леса по краю) → камни → кристаллы → проверка достижимости. Если цепочка
// платформ оказалась недостижимой, уровень перегенерируется с другим потоком.

import { Rng } from '../rng';
import { BIOMES, type Biome } from './biomes';
import { requiredCrystals, type LevelRecipe } from './recipes';
import { bakeTerrain, MAX_WALK_SLOPE, rawRelief, slopeAt, type Flat, type Terrain } from './terrain';

export interface Obstacle {
  x: number;
  z: number;
  /** Радиус столкновения. */
  r: number;
  /** Высота земли у основания. */
  y0: number;
  /** Высота над основанием — для камеры. */
  top: number;
  /** Радиус, в котором препятствие закрывает обзор камере (крона шире ствола). */
  view: number;
}
export interface Platform {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Высота над основанием. */
  h: number;
  /** Высота земли под платформой; верх — y0 + h. */
  y0: number;
  /** Круглая плита (под порталом) — рисуется цилиндром. */
  round?: boolean;
}
export interface Clearing { x: number; z: number; r: number }
export interface TreeSpot { x: number; z: number; s: number; yaw: number; tint: number }
export interface RockSpot { x: number; z: number; s: number; rx: number; ry: number; rz: number }
export interface PillarSpot { x: number; z: number; h: number; yaw: number }
/** y — высота опоры (земли или верха платформы); кристалл висит на метр выше. */
export interface CrystalSpot { x: number; z: number; y: number }

export interface LevelLayout {
  recipe: LevelRecipe;
  biome: Biome;
  half: number;
  terrain: Terrain;
  /** Уровень воды (null — биом без воды). */
  waterLevel: number | null;
  spawn: { x: number; z: number };
  portal: { x: number; z: number };
  clearings: Clearing[];
  trees: TreeSpot[];
  rocks: RockSpot[];
  pillars: PillarSpot[];
  platforms: Platform[];
  crystals: CrystalSpot[];
  obstacles: Obstacle[];
  required: number;
  /** Сколько попыток понадобилось (для отладки). */
  attempts: number;
}

// ---------- Ограничения движения ----------

/** Высота прыжка самого слабого прыгуна — волка: v² / 2g при v = 9, g = 24. */
export const MIN_HERO_JUMP = (9 * 9) / (2 * 24);
/** Подъём ступени с запасом под прыжок волка. */
const MAX_STEP = 1.25;
/** Зазор между краями соседних ступеней. */
const MAX_GAP = 2.4;
/** Радиус столкновения самого крупного героя (олень) — проходы уже него закрыты. */
const HERO_R = 0.7;
/** Центральная поляна с каменным кругом и порталом. */
export const CENTER_R = 9;
/** Утоптанная площадка в центре. */
export const PATH_R = 7;
const PILLAR_RING = 5.5;
/** Глубина, в которую уже не зайти. */
export const MAX_WADE_DEPTH = 0.9;
/** Ширина сплошной стены леса за границей уровня. */
const BORDER = 9;

// ---------- Помощники ----------

/** Равномерная, но не сеточная расстановка точек (алгоритм Бридсона). */
function poisson(rng: Rng, x0: number, z0: number, x1: number, z1: number, r: number, k = 18): { x: number; z: number }[] {
  const cell = r / Math.SQRT2;
  const gw = Math.ceil((x1 - x0) / cell);
  const gh = Math.ceil((z1 - z0) / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts: { x: number; z: number }[] = [];
  const active: number[] = [];
  const put = (x: number, z: number) => {
    pts.push({ x, z });
    active.push(pts.length - 1);
    grid[Math.floor((z - z0) / cell) * gw + Math.floor((x - x0) / cell)] = pts.length - 1;
  };
  const fits = (x: number, z: number) => {
    if (x < x0 || x >= x1 || z < z0 || z >= z1) return false;
    const gx = Math.floor((x - x0) / cell), gz = Math.floor((z - z0) / cell);
    for (let j = Math.max(0, gz - 2); j <= Math.min(gh - 1, gz + 2); j++) {
      for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
        const p = grid[j * gw + i];
        if (p >= 0 && (pts[p].x - x) ** 2 + (pts[p].z - z) ** 2 < r * r) return false;
      }
    }
    return true;
  };
  put(rng.range(x0, x1), rng.range(z0, z1));
  while (active.length) {
    const ai = rng.int(0, active.length - 1);
    const p = pts[active[ai]];
    let placed = false;
    for (let t = 0; t < k; t++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(r, 2 * r);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (fits(x, z)) {
        put(x, z);
        placed = true;
        break;
      }
    }
    if (!placed) active.splice(ai, 1);
  }
  return pts;
}

/** Плавный шум 0…1 — для рощ и проплешин. */
function valueNoise(rng: Rng, half: number, cell: number): (x: number, z: number) => number {
  const n = Math.ceil((half * 2 + BORDER * 2) / cell) + 2;
  const v = Array.from({ length: n * n }, () => rng.next());
  const o = half + BORDER;
  return (x, z) => {
    const fx = (x + o) / cell, fz = (z + o) / cell;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const at = (i: number, j: number) => v[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
    const a = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * sx;
    const b = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * sx;
    return a + (b - a) * sz;
  };
}

const inRect = (x: number, z: number, p: Platform, pad: number) => Math.abs(x - p.x) < p.w / 2 + pad && Math.abs(z - p.z) < p.d / 2 + pad;

// ---------- Генерация ----------

export function generateLevel(recipe: LevelRecipe): LevelLayout {
  for (let attempt = 0; attempt < 12; attempt++) {
    const layout = tryGenerate(recipe, attempt);
    if (layout) return layout;
  }
  // Сюда не попадаем на практике; на крайний случай — уровень без платформ
  return tryGenerate({ ...recipe, chains: 0 }, 99)!;
}

function tryGenerate(recipe: LevelRecipe, attempt: number): LevelLayout | null {
  const biome = BIOMES[recipe.biome];
  const half = recipe.half;
  const seed = recipe.seed + attempt * 104729;
  const spawn = { x: 0, z: -2.5 };
  const portal = { x: 0, z: 0 };

  // Поляны
  const rc = Rng.stream(seed, 'clearings');
  const clearings: Clearing[] = [{ x: 0, z: 0, r: CENTER_R }];
  for (let t = 0; t < 400 && clearings.length < recipe.clearings + 1; t++) {
    const r = rc.range(6, 10);
    const x = rc.range(-half + r + 4, half - r - 4);
    const z = rc.range(-half + r + 4, half - r - 4);
    if (clearings.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + r + (c === clearings[0] ? 8 : 5))) clearings.push({ x, z, r });
  }

  // Плита портала — низкая, на неё просто заходят
  const platforms: Platform[] = [{ x: portal.x, z: portal.z, w: 2.6, d: 2.6, h: 0.25, y0: 0, round: true }];

  // Цепочки платформ — в боковых полянах
  const rp = Rng.stream(seed, 'platforms');
  const chainStarts: Platform[] = [];
  const chainTops: Platform[] = [];
  for (let c = 0; c < recipe.chains; c++) {
    const host = clearings[1 + (c % Math.max(1, clearings.length - 1))] ?? { x: rp.range(-half / 2, half / 2), z: rp.range(-half / 2, half / 2), r: 6 };
    const chain = buildChain(rp, host, recipe.steps, half, platforms);
    if (!chain) return null;
    platforms.push(...chain);
    chainStarts.push(chain[0]);
    chainTops.push(chain[chain.length - 1]);
  }

  // Рельеф: холмы, а под полянами и цепочками платформ — ровные площадки
  const r0 = biome.relief;
  const raw = rawRelief(seed, half, { ...r0, amp: r0.amp * recipe.relief, border: r0.border * Math.min(1, recipe.relief + 0.4) });
  const flats: Flat[] = [];
  const water = biome.water;
  // Уровень воды не выше того, что затопляет 6% естественных низин, — иначе озёра сольются в море
  let waterLevel: number | null = null;
  if (water) {
    const hs: number[] = [];
    for (let x = -half + 3; x < half - 3; x += 3) for (let z = -half + 3; z < half - 3; z += 3) hs.push(raw(x, z));
    hs.sort((a, b) => a - b);
    waterLevel = Math.min(water.level, hs[Math.floor(hs.length * 0.06)]);
  }
  // Поляны и площадки платформ держим над водой
  const dry = (h: number) => (waterLevel !== null ? Math.max(h, waterLevel + 0.4) : h);
  if (water) {
    // Озёра — котловины вдали от полян, платформ и центра
    const rl = Rng.stream(seed, 'lakes');
    for (let t = 0, made = 0; t < 200 && made < water.lakes; t++) {
      const r = rl.range(6, 12);
      const x = rl.range(-half + r + 6, half - r - 6), z = rl.range(-half + r + 6, half - r - 6);
      if (clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r + 6)) continue;
      if (platforms.some((p) => Math.hypot(p.x - x, p.z - z) < r + 10)) continue;
      flats.push({ x, z, r, fade: 7, strength: 1, target: waterLevel! - 1.3 });
      made++;
    }
  }
  for (const c of clearings.slice(1)) flats.push({ x: c.x, z: c.z, r: c.r * 0.6, fade: c.r, strength: 0.65, target: dry(raw(c.x, c.z)) });
  for (let c = 0; c < chainStarts.length; c++) {
    // Вся цепочка стоит на одной высоте — на уровне первой ступени
    const target = dry(raw(chainStarts[c].x, chainStarts[c].z));
    const first = platforms.indexOf(chainStarts[c]);
    const last = platforms.indexOf(chainTops[c]);
    for (const p of platforms.slice(first, last + 1)) flats.push({ x: p.x, z: p.z, r: Math.hypot(p.w, p.d) / 2 + 1.5, fade: 6, strength: 1, target });
  }
  flats.push({ x: 0, z: 0, r: CENTER_R + 1, fade: 10, strength: 1, target: 0 });
  const terrain = bakeTerrain(raw, flats, half + 60);
  for (const p of platforms) p.y0 = terrain.heightAt(p.x, p.z);
  const tops: CrystalSpot[] = chainTops.map((p) => ({ x: p.x, z: p.z, y: p.y0 + p.h }));
  const at = (x: number, z: number) => terrain.heightAt(x, z);
  /** Глубина воды в точке (0 — суша). */
  const depth = (x: number, z: number) => (waterLevel !== null ? Math.max(0, waterLevel - at(x, z)) : 0);

  const obstacles: Obstacle[] = [];

  // Каменный круг вокруг портала
  const pillars: PillarSpot[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p = { x: Math.cos(a) * PILLAR_RING, z: Math.sin(a) * PILLAR_RING, h: 2.4 + (i % 2) * 0.8, yaw: -a };
    pillars.push(p);
    obstacles.push({ x: p.x, z: p.z, r: 0.6, y0: at(p.x, p.z), top: p.h, view: 0.5 });
  }

  // Лес: внутри — рощи с проплешинами, по краю — сплошная стена
  const rt = Rng.stream(seed, 'trees');
  const grove = valueNoise(rt, half, 18);
  const trees: TreeSpot[] = [];
  const pine = biome.trees.kind === 'pine';
  const addTree = (x: number, z: number, s: number) => {
    trees.push({ x, z, s, yaw: rt.range(0, Math.PI * 2), tint: rt.int(0, biome.trees.leaves.length - 1) });
    obstacles.push({ x, z, r: (pine ? 0.45 : 0.35) * s, y0: at(x, z), top: (pine ? 5.4 : 5.6) * s, view: (pine ? 1.1 : 1.3) * s });
  };
  // Плотность Poisson-диска примерно 1/(1.6 r²); с учётом отбраковки берём с запасом
  const want = biome.trees.density / 100 / 0.55;
  const rTree = Math.sqrt(1 / (1.6 * want));
  for (const p of poisson(rt, -half, -half, half, half, rTree)) {
    if (Math.max(Math.abs(p.x), Math.abs(p.z)) > half - 3) continue;
    let keep = 0.3 + 0.7 * grove(p.x, p.z);
    for (const c of clearings) {
      const d = Math.hypot(p.x - c.x, p.z - c.z) - c.r - (c === clearings[0] ? 3 : 0);
      if (d < 0) keep = 0;
      else if (d < 3) keep *= d / 3;
    }
    if (platforms.some((pl) => inRect(p.x, p.z, pl, 2.5))) keep = 0;
    // Деревья не растут в воде и у самой кромки
    if (waterLevel !== null && at(p.x, p.z) < waterLevel + 0.3) keep = 0;
    if (rt.next() < keep) addTree(p.x, p.z, rt.range(0.8, 1.5));
  }
  for (const p of poisson(rt, -half - BORDER, -half - BORDER, half + BORDER, half + BORDER, 2.6)) {
    if (Math.max(Math.abs(p.x), Math.abs(p.z)) < half - 1) continue;
    if (waterLevel !== null && at(p.x, p.z) < waterLevel + 0.3) continue;
    addTree(p.x, p.z, rt.range(1.1, 1.8));
  }

  // Камни
  const rr = Rng.stream(seed, 'rocks');
  const rocks: RockSpot[] = [];
  const rRock = Math.sqrt(1 / (1.6 * (biome.rocks.density / 100 / 0.6)));
  for (const p of poisson(rr, -half + 3, -half + 3, half - 3, half - 3, rRock)) {
    const s = rr.range(0.6, biome.id === 'rocky' ? 2.4 : 2);
    if (Math.hypot(p.x, p.z) < CENTER_R + 1) continue;
    if (platforms.some((pl) => inRect(p.x, p.z, pl, 2 + s))) continue;
    if (obstacles.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < o.r + s * 0.65 + 0.8)) continue;
    if (!rr.chance(0.6)) continue;
    if (depth(p.x, p.z) > 0.5) continue;
    rocks.push({ x: p.x, z: p.z, s, rx: rr.range(0, 3), ry: rr.range(0, 3), rz: rr.range(0, 3) });
    obstacles.push({ x: p.x, z: p.z, r: s * 0.65, y0: at(p.x, p.z), top: s * 0.6, view: s * 0.55 });
  }

  // Карта проходимости и проверка платформ
  const nav = new NavGrid(half, obstacles, platforms, spawn, terrain, depth);
  if (!chainStarts.every((p) => nav.reachableNearRect(p, 1.2))) return null;

  // Кристаллы
  const rk = Rng.stream(seed, 'crystals');
  const crystals: CrystalSpot[] = [...tops];
  const free = (x: number, z: number) =>
    Math.max(Math.abs(x), Math.abs(z)) < half - 3 &&
    Math.hypot(x, z) > CENTER_R &&
    !platforms.some((pl) => inRect(x, z, pl, 1)) &&
    obstacles.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + 0.9) &&
    crystals.every((c) => Math.hypot(c.x - x, c.z - z) > 7) &&
    depth(x, z) === 0 &&
    nav.reachableNear(x, z, 0.8);
  const ground = recipe.crystals - tops.length;
  const hiddenCount = Math.round(ground * recipe.hidden);
  const hideBehind = obstacles.filter((o) => o.r > 0.5 && Math.max(Math.abs(o.x), Math.abs(o.z)) < half - 5 && Math.hypot(o.x, o.z) > CENTER_R + 3);
  for (let i = 0, t = 0; i < hiddenCount && t < 300; t++) {
    const o = rk.pick(hideBehind);
    if (!o) break;
    const a = rk.range(0, Math.PI * 2);
    const x = o.x + Math.cos(a) * (o.r + HERO_R + 0.3), z = o.z + Math.sin(a) * (o.r + HERO_R + 0.3);
    if (free(x, z)) {
      crystals.push({ x, z, y: at(x, z) });
      i++;
    }
  }
  // По кристаллу в боковых полянах — их видно издалека, они ведут игрока по уровню
  for (const c of clearings.slice(1)) {
    if (crystals.length >= recipe.crystals) break;
    for (let t = 0; t < 30; t++) {
      const x = c.x + rk.range(-c.r, c.r) * 0.5, z = c.z + rk.range(-c.r, c.r) * 0.5;
      if (free(x, z)) {
        crystals.push({ x, z, y: at(x, z) });
        break;
      }
    }
  }
  for (let t = 0; crystals.length < recipe.crystals && t < 3000; t++) {
    const x = rk.range(-half + 4, half - 4), z = rk.range(-half + 4, half - 4);
    if (Math.hypot(x - spawn.x, z - spawn.z) > 12 && free(x, z)) crystals.push({ x, z, y: at(x, z) });
  }

  return {
    recipe,
    biome,
    half,
    terrain,
    waterLevel,
    spawn,
    portal,
    clearings,
    trees,
    rocks,
    pillars,
    platforms,
    crystals,
    obstacles,
    required: requiredCrystals(crystals.length),
    attempts: attempt + 1,
  };
}

/** Цепочка ступеней, каждая следующая выше предыдущей не больше чем на MAX_STEP. */
function buildChain(rng: Rng, host: Clearing, steps: readonly [number, number], half: number, existing: Platform[]): Platform[] | null {
  const n = rng.int(steps[0], steps[1]);
  for (let t = 0; t < 20; t++) {
    const chain: Platform[] = [];
    let dir = rng.range(0, Math.PI * 2);
    let h = 0;
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const last = i === n - 1;
      const w = rng.range(2.4, 3.4) + (last ? 0.6 : 0);
      const d = rng.range(2.4, 3.4) + (last ? 0.6 : 0);
      h += rng.range(0.7, MAX_STEP);
      let x: number, z: number;
      if (i === 0) {
        x = host.x + rng.range(-1, 1) * host.r * 0.3;
        z = host.z + rng.range(-1, 1) * host.r * 0.3;
      } else {
        const prev = chain[i - 1];
        dir += rng.range(-0.7, 0.7);
        const along = (pw: number, pd: number) => (Math.abs(Math.cos(dir)) * pw + Math.abs(Math.sin(dir)) * pd) / 2;
        const step = along(prev.w, prev.d) + along(w, d) + rng.range(0.4, MAX_GAP);
        x = prev.x + Math.cos(dir) * step;
        z = prev.z + Math.sin(dir) * step;
        // Настоящий зазор между прямоугольниками — он и ограничен прыжком
        const gx = Math.abs(x - prev.x) - (w + prev.w) / 2;
        const gz = Math.abs(z - prev.z) - (d + prev.d) / 2;
        const gap = Math.hypot(Math.max(gx, 0), Math.max(gz, 0));
        if (Math.max(gx, gz) < 0.3 || gap > MAX_GAP) ok = false;
      }
      const p = { x, z, w, d, h, y0: 0 };
      if (Math.abs(x) + w / 2 > half - 5 || Math.abs(z) + d / 2 > half - 5) ok = false;
      if (Math.hypot(x, z) < CENTER_R + 4) ok = false;
      // С чужими цепочками — с большим отступом, со своими ступенями (кроме соседней) — без наложения
      const overlaps = (q: Platform, pad: number) => Math.abs(q.x - x) < (q.w + w) / 2 + pad && Math.abs(q.z - z) < (q.d + d) / 2 + pad;
      if (existing.some((q) => overlaps(q, 1.5)) || chain.slice(0, -1).some((q) => overlaps(q, 0.3))) ok = false;
      chain.push(p);
    }
    if (ok) return chain;
  }
  return null;
}

// ---------- Проходимость ----------

/** Сетка 0.5 м: какие клетки достижимы пешком от точки старта (крутые склоны — стены). */
class NavGrid {
  private static readonly CELL = 0.5;
  private readonly n: number;
  private readonly reach: Uint8Array;

  constructor(
    private readonly half: number,
    obstacles: Obstacle[],
    platforms: Platform[],
    spawn: { x: number; z: number },
    terrain: Terrain,
    depth: (x: number, z: number) => number,
  ) {
    const C = NavGrid.CELL;
    const n = (this.n = Math.ceil((half * 2) / C));
    const blocked = new Uint8Array(n * n);
    const lim = half - 1.5;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + (i + 0.5) * C, z = -half + (j + 0.5) * C;
        if (Math.abs(x) > lim || Math.abs(z) > lim) blocked[j * n + i] = 1;
        // С запасом: склон на грани допустимого в игре пешком не всегда берётся
        else if (slopeAt(terrain, x, z).slope > MAX_WALK_SLOPE * 0.9) blocked[j * n + i] = 1;
        else if (depth(x, z) > MAX_WADE_DEPTH * 0.85) blocked[j * n + i] = 1;
      }
    }
    const stamp = (x0: number, z0: number, x1: number, z1: number, test: (x: number, z: number) => boolean) => {
      const i0 = Math.max(0, Math.floor((x0 + half) / C)), i1 = Math.min(n - 1, Math.floor((x1 + half) / C));
      const j0 = Math.max(0, Math.floor((z0 + half) / C)), j1 = Math.min(n - 1, Math.floor((z1 + half) / C));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (test(-half + (i + 0.5) * C, -half + (j + 0.5) * C)) blocked[j * n + i] = 1;
        }
      }
    };
    for (const o of obstacles) {
      const R = o.r + HERO_R;
      stamp(o.x - R, o.z - R, o.x + R, o.z + R, (x, z) => (x - o.x) ** 2 + (z - o.z) ** 2 < R * R);
    }
    for (const p of platforms) stamp(p.x - p.w / 2 - 0.3, p.z - p.d / 2 - 0.3, p.x + p.w / 2 + 0.3, p.z + p.d / 2 + 0.3, () => true);

    // Поиск в ширину от точки старта
    const reach = (this.reach = new Uint8Array(n * n));
    const start = this.index(spawn.x, spawn.z);
    if (start < 0 || blocked[start]) return;
    const queue = new Int32Array(n * n);
    let head = 0, tail = 0;
    queue[tail++] = start;
    reach[start] = 1;
    while (head < tail) {
      const c = queue[head++];
      const ci = c % n, cj = (c / n) | 0;
      const visit = (i: number, j: number) => {
        if (i < 0 || j < 0 || i >= n || j >= n) return;
        const k = j * n + i;
        if (blocked[k] || reach[k]) return;
        reach[k] = 1;
        queue[tail++] = k;
      };
      visit(ci + 1, cj);
      visit(ci - 1, cj);
      visit(ci, cj + 1);
      visit(ci, cj - 1);
    }
  }

  private index(x: number, z: number): number {
    const i = Math.floor((x + this.half) / NavGrid.CELL), j = Math.floor((z + this.half) / NavGrid.CELL);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }

  /** Есть ли достижимая клетка в радиусе r от точки. */
  reachableNear(x: number, z: number, r: number): boolean {
    for (let dz = -r; dz <= r; dz += NavGrid.CELL) {
      for (let dx = -r; dx <= r; dx += NavGrid.CELL) {
        if (dx * dx + dz * dz > r * r) continue;
        const k = this.index(x + dx, z + dz);
        if (k >= 0 && this.reach[k]) return true;
      }
    }
    return false;
  }

  /** Можно ли подойти к платформе вплотную (на расстояние pad от края). */
  reachableNearRect(p: Platform, pad: number): boolean {
    const C = NavGrid.CELL;
    for (let z = p.z - p.d / 2 - pad; z <= p.z + p.d / 2 + pad; z += C) {
      for (let x = p.x - p.w / 2 - pad; x <= p.x + p.w / 2 + pad; x += C) {
        const k = this.index(x, z);
        if (k >= 0 && this.reach[k]) return true;
      }
    }
    return false;
  }
}
