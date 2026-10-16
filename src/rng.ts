// Детерминированный ГПСЧ (mulberry32). Один сид — один и тот же уровень на любом компьютере.

function hash(seed: number, label: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return Math.imul(h, 0xc2b2ae35) >>> 0;
}

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Случайное число в [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Целое в [min, max] включительно. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * Независимый поток для подсистемы: деревья, кристаллы и платформы берут свои потоки,
   * поэтому лишняя ёлка не сдвигает кристаллы.
   */
  static stream(seed: number, label: string): Rng {
    return new Rng(hash(seed, label));
  }
}
