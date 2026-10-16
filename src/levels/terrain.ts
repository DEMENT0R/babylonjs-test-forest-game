// Рельеф уровня: высота земли в любой точке. Всё, что стоит на земле, —
// герой, деревья, трава, платформы, камера — берёт высоту отсюда.
//
// Холмы — фрактальный шум из сида (у каменного плато — «гребни»), по краю
// уровня земля поднимается валом. Центральная поляна, боковые поляны и площадки
// под цепочками платформ выравниваются с плавным переходом. Готовая высота
// запекается в сетку 1 м и читается билинейно — быстро и одинаково для всех.

export interface Terrain {
  heightAt(x: number, z: number): number;
}

/** Плоская земля на нулевой высоте. */
export const FLAT_TERRAIN: Terrain = { heightAt: () => 0 };

export interface Relief {
  /** Перепад высот холмов, м. */
  amp: number;
  /** Характерный размер холма, м. */
  scale: number;
  /** Острые гребни вместо округлых холмов. */
  ridged?: boolean;
  /** Высота вала за границей уровня, м. */
  border: number;
}

/** Выровненная площадка: внутри r — ровно на высоте target, дальше плавно к холмам. */
export interface Flat {
  x: number;
  z: number;
  r: number;
  fade: number;
  /** 1 — полностью ровно, меньше — только сглаживание. */
  strength: number;
  target: number;
}

// ---------- Шум ----------

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const tx = x - ix, tz = z - iz;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sz;
}

/** Три октавы шума, результат примерно в [-1, 1]. */
function fbm(x: number, z: number, seed: number, ridged: boolean): number {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < 3; o++) {
    let n = valueNoise(x, z, seed + o * 101);
    if (ridged) n = 1 - Math.abs(n * 2 - 1);
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    z *= 2.03;
  }
  return (sum / norm) * 2 - 1;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- Рельеф ----------

/** Сырые холмы без площадок; ноль в центре уровня. */
export function rawRelief(seed: number, half: number, relief: Relief): (x: number, z: number) => number {
  if (relief.amp <= 0 && relief.border <= 0) return () => 0;
  const f = (x: number, z: number) => relief.amp * fbm(x / relief.scale, z / relief.scale, seed, !!relief.ridged);
  const base = f(0, 0);
  return (x, z) => {
    const edge = Math.max(Math.abs(x), Math.abs(z));
    return f(x, z) - base + relief.border * smoothstep(half - 10, half + 14, edge);
  };
}

/** Запекает рельеф с площадками в сетку 1 м. */
export function bakeTerrain(raw: (x: number, z: number) => number, flats: readonly Flat[], extent: number): Terrain {
  const step = 1;
  const n = Math.ceil((extent * 2) / step) + 1;
  const grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = -extent + j * step;
    for (let i = 0; i < n; i++) {
      const x = -extent + i * step;
      let h = raw(x, z);
      for (const f of flats) {
        const d = Math.hypot(x - f.x, z - f.z);
        if (d >= f.r + f.fade) continue;
        // 0 у площадки, 1 там, где холмы уже не тронуты
        const w = smoothstep(f.r, f.r + f.fade, d);
        h = f.target + (h - f.target) * (1 - f.strength * (1 - w));
      }
      grid[j * n + i] = h;
    }
  }
  return {
    heightAt(x: number, z: number): number {
      const fx = Math.min(n - 1.001, Math.max(0, (x + extent) / step));
      const fz = Math.min(n - 1.001, Math.max(0, (z + extent) / step));
      const i = Math.floor(fx), j = Math.floor(fz);
      const tx = fx - i, tz = fz - j;
      const k = j * n + i;
      const a = grid[k], b = grid[k + 1], c = grid[k + n], d = grid[k + n + 1];
      return a + (b - a) * tx + (c - a + (a - b + d - c) * tx) * tz;
    },
  };
}
