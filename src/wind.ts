// Ветер — общий для звука и травы: порывы происходят в одно время,
// поэтому трава гнётся ровно тогда, когда ветер слышно.

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Направление ветра в плоскости XZ (нормализовано). */
export const WIND_DIR = { x: 0.8, z: 0.6 };

type GustListener = (strength: number, tau: number) => void;

class Wind {
  /** Текущая сила ветра 0…1.3, плавно догоняет цель порыва. */
  strength = 0.4;
  /** Сила, к которой идёт текущий порыв. */
  target = 0.4;
  private tau = 2;
  /** Множитель биома: зимой ветер сильнее. */
  private scale = 1;
  private nextGust = 0;
  private readonly listeners: GustListener[] = [];

  setScale(scale: number): void {
    this.scale = scale;
    this.nextGust = 0;
  }

  /** Подписка на начало порыва: сила и постоянная времени нарастания, с. */
  onGust(fn: GustListener): void {
    this.listeners.push(fn);
  }

  /** Порыв прямо сейчас, вне очереди: трава гнётся, ветер слышно; следующий — как обычно. */
  gustNow(target: number, tau: number): void {
    this.target = Math.min(1.3, target * this.scale);
    this.tau = tau;
    this.nextGust = rand(3, 6);
    for (const fn of this.listeners) fn(this.target, this.tau);
  }

  update(dt: number): void {
    this.nextGust -= dt;
    if (this.nextGust <= 0) {
      // Изредка — сильный порыв, обычно — лёгкий ветерок
      this.target = Math.min(1.3, (Math.random() < 0.25 ? rand(0.8, 1) : rand(0.25, 0.6)) * this.scale);
      this.tau = rand(1, 2.5);
      this.nextGust = rand(3, 9);
      for (const fn of this.listeners) fn(this.target, this.tau);
    }
    this.strength += (this.target - this.strength) * (1 - Math.exp(-dt / this.tau));
  }
}

export const wind = new Wind();
