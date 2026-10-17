// Фоновая музыка: тихий эмбиент, который сочиняется на ходу. Медленные аккорды-«подушки»
// и редкие ноты колокольчика, бродящие по ладу биома. Никаких файлов — только осцилляторы.

import type { BiomeId } from './levels/biomes';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Mood {
  /** Тоника, Гц. */
  root: number;
  /** Ступени лада в полутонах от тоники. */
  scale: readonly number[];
  /** Средняя пауза между нотами мелодии, с. */
  gap: number;
  /** Срез фильтра подушки: светлее или глуше, Гц. */
  bright: number;
}

const MOODS: Record<BiomeId, Mood> = {
  // Летний лес — светлая мажорная пентатоника
  meadow: { root: 293.66, scale: [0, 2, 4, 7, 9], gap: 2.6, bright: 1600 },
  // Осень — дорийский, чуть грустнее
  autumn: { root: 220, scale: [0, 2, 3, 7, 9], gap: 3, bright: 1300 },
  // Каменное плато — ниже и суровее
  rocky: { root: 164.81, scale: [0, 2, 3, 7, 10], gap: 3.4, bright: 1100 },
  // Зима — редкие высокие ноты, холодный минор
  winter: { root: 246.94, scale: [0, 2, 3, 7, 8], gap: 4, bright: 2000 },
  // Ночь — минорная пентатоника, медленно и глухо
  night: { root: 196, scale: [0, 3, 5, 7, 10], gap: 4.2, bright: 900 },
  // Озёра — лидийский, «водный» и прозрачный
  lakes: { root: 261.63, scale: [0, 2, 4, 6, 7, 11], gap: 2.8, bright: 1800 },
};

/** Частота ступени лада: degree может выходить за октаву в обе стороны. */
function pitch(m: Mood, degree: number): number {
  const n = m.scale.length;
  const oct = Math.floor(degree / n);
  const step = m.scale[((degree % n) + n) % n];
  return m.root * Math.pow(2, oct + step / 12);
}

export class Music {
  private mood: Mood = MOODS.meadow;
  /** Ступень, на которой остановилась мелодия. */
  private degree = 0;

  /**
   * out — шина музыки, reverb — общий ревербератор; canPlay — можно ли сейчас звучать
   * (контекст работает и звук включён): пока нельзя, ноты не копятся.
   */
  constructor(
    private readonly ac: AudioContext,
    private readonly out: AudioNode,
    private readonly reverb: AudioNode,
    private readonly canPlay: () => boolean,
  ) {
    this.loop(rand(2, 4), () => this.pad(), 9, 14);
    this.loop(rand(4, 6), () => this.melody(), 0, 0);
  }

  setBiome(id: BiomeId): void {
    this.mood = MOODS[id];
    this.degree = 0;
  }

  /** Повторять play со случайной паузой; у мелодии пауза своя — от лада. */
  private loop(firstDelay: number, play: () => void, min: number, max: number): void {
    const tick = () => {
      if (this.canPlay()) play();
      const gap = max > 0 ? rand(min, max) : this.mood.gap * rand(0.5, 1.6);
      setTimeout(tick, gap * 1000);
    };
    setTimeout(tick, firstDelay * 1000);
  }

  /** Подушка: два-три тона аккорда на ступенях лада, медленно вплывают и тают. */
  private pad(): void {
    const ac = this.ac;
    const m = this.mood;
    const t = ac.currentTime + 0.05;
    const len = rand(8, 12);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = m.bright;
    lp.Q.value = 0.3;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + len * 0.35);
    g.gain.setTargetAtTime(0, t + len * 0.6, len * 0.15);
    lp.connect(g);
    g.connect(this.out);
    const send = ac.createGain();
    send.gain.value = 0.6;
    g.connect(send).connect(this.reverb);

    // Аккорд от случайной ступени: через одну, как терции; на октаву ниже мелодии
    const base = (Math.random() * m.scale.length) | 0;
    const tones = [base, base + 2, base + (Math.random() < 0.5 ? 4 : 3)].slice(0, Math.random() < 0.4 ? 2 : 3);
    for (const d of tones) {
      const f = pitch(m, d - m.scale.length);
      // Две слегка расстроенные волны — подушка «дышит»
      for (const [type, detune, gain] of [['sine', -4, 0.05], ['triangle', 5, 0.025]] as const) {
        const osc = ac.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        osc.detune.value = detune;
        const og = ac.createGain();
        og.gain.value = gain;
        osc.connect(og).connect(lp);
        osc.start(t);
        osc.stop(t + len + 3);
      }
    }
    setTimeout(() => [lp, g, send].forEach((n) => n.disconnect()), (len + 4) * 1000);
  }

  /** Нота колокольчика: шаг мелодии на соседнюю ступень, иногда скачок или пауза. */
  private melody(): void {
    if (Math.random() < 0.2) return; // пауза — тишина тоже музыка
    const m = this.mood;
    const n = m.scale.length;
    const step = Math.random() < 0.75 ? (Math.random() < 0.5 ? -1 : 1) : Math.random() < 0.5 ? -2 : 2;
    // Держим мелодию в пределах полутора октав над тоникой
    this.degree = Math.max(0, Math.min(Math.round(n * 1.5), this.degree + step));
    const f = pitch(m, this.degree);
    this.bell(f, rand(0.6, 1));
    // Изредка вторая нота следом — короткий мотив
    if (Math.random() < 0.25) {
      this.degree = Math.max(0, this.degree + (Math.random() < 0.5 ? -1 : 1));
      this.bell(pitch(m, this.degree), rand(0.4, 0.7), rand(0.35, 0.6));
    }
  }

  /** Мягкий колокольчик: синус и тихий обертон, быстрая атака и долгое затухание. */
  private bell(f: number, gain: number, delay = 0): void {
    const ac = this.ac;
    const t = ac.currentTime + 0.03 + delay;
    const dur = rand(2.2, 3.4);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * gain, t + 0.015);
    g.gain.setTargetAtTime(0, t + 0.02, dur * 0.28);
    const pan = ac.createStereoPanner();
    pan.pan.value = rand(-0.5, 0.5);
    g.connect(pan).connect(this.out);
    const send = ac.createGain();
    send.gain.value = 0.8;
    pan.connect(send).connect(this.reverb);
    for (const [mul, level] of [[1, 1], [2.01, 0.18], [3, 0.06]] as const) {
      const osc = ac.createOscillator();
      osc.frequency.value = f * mul;
      const og = ac.createGain();
      og.gain.value = level;
      osc.connect(og).connect(g);
      osc.start(t);
      osc.stop(t + dur + 0.5);
    }
    setTimeout(() => [g, pan, send].forEach((n) => n.disconnect()), (delay + dur + 1.5) * 1000);
  }
}
