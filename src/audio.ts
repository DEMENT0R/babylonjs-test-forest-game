// Звук: всё синтезируется на лету через Web Audio API — без звуковых файлов.
// Ветер — розовый шум с порывами из общей модели (wind.ts), птицы — свисты и трели нескольких «видов»
// (и изредка кукушка), шаги — короткие шумовые щелчки, зависящие от поверхности и веса героя.

import type { Ambience, BiomeId } from './levels/biomes';
import { Music } from './music';
import type { Player } from './player';
import { onSettingsApplied, settings, type Settings } from './settings';
import { clamp } from './utils';
import { wind } from './wind';
import type { Surface, World } from './world';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[(Math.random() * xs.length) | 0];
/** Полутоны пентатоники — по ним поднимается звон серии кристаллов. */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

// ---------- Буферы шума и реверберация ----------

function whiteNoise(ac: AudioContext, seconds: number): AudioBuffer {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Стерео розовый шум (фильтр Пола Келлета) — каналы разные, звук получается объёмным. */
function pinkNoise(ac: AudioContext, seconds: number): AudioBuffer {
  const buf = ac.createBuffer(2, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    // Плавно сводим края, чтобы петля не щёлкала
    const fade = Math.floor(ac.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] *= k;
      d[d.length - 1 - i] *= k;
    }
  }
  return buf;
}

/** Импульс «леса» для свёртки: затухающий шум с приглушёнными верхами. */
function forestImpulse(ac: AudioContext, seconds = 1.6): AudioBuffer {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += ((Math.random() * 2 - 1) - lp) * 0.35;
      d[i] = lp * Math.pow(1 - i / len, 3.2);
    }
  }
  return buf;
}

// ---------- Параметры шагов ----------

interface SurfaceSound {
  /** Центр полосы шума, Гц. */
  freq: number;
  q: number;
  dur: number;
  noise: number;
  /** Глухой удар (низ), доля. */
  thump: number;
  thumpFreq: number;
  /** Хрустящих «зёрен» в одном шаге (снег). */
  grains?: number;
}

const SURFACES: Record<Surface, SurfaceSound> = {
  grass: { freq: 1700, q: 0.7, dur: 0.11, noise: 0.3, thump: 0.25, thumpFreq: 95 },
  path: { freq: 2000, q: 1.1, dur: 0.08, noise: 0.4, thump: 0.25, thumpFreq: 110 },
  stone: { freq: 950, q: 2.2, dur: 0.05, noise: 0.33, thump: 0.55, thumpFreq: 150 },
  snow: { freq: 2300, q: 0.9, dur: 0.05, noise: 0.37, thump: 0.12, thumpFreq: 80, grains: 5 },
  // Плеск: низкий широкий шум с «хвостом» капель
  water: { freq: 850, q: 0.5, dur: 0.22, noise: 0.5, thump: 0.08, thumpFreq: 70, grains: 3 },
};

// ---------- Движок звука ----------

export class GameAudio {
  private ac: AudioContext | null = null;
  private master!: GainNode;
  private stepsBus!: GainNode;
  private natureBus!: GainNode;
  private musicBus!: GainNode;
  private music: Music | null = null;
  private biome: BiomeId = 'meadow';
  /** Игровые сигналы: кристаллы и портал. Громкость — общая. */
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private stepNoise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private leavesGain!: GainNode;
  private birdTimer: ReturnType<typeof setTimeout> | undefined;
  /** Голоса текущего биома. */
  private ambience: Ambience = { birds: 1, cuckoo: true, crickets: 0, frogs: 0, owls: 0, wind: 1 };

  /**
   * @param lite облегчённый звук для слабых устройств: крупный буфер вывода, вдвое меньшая
   * частота дискретизации, короткие ревербераторы и меньше «зёрен» в шагах
   */
  constructor(private readonly lite = false) {
    onSettingsApplied((s) => this.applyVolumes(s));
    document.addEventListener('visibilitychange', () => {
      if (!this.ac) return;
      if (document.hidden) void this.ac.suspend();
      else void this.ac.resume();
    });
  }

  /**
   * Браузер разрешает звук только после действия пользователя —
   * вызывать из обработчика клика или клавиши. Повторные вызовы безопасны.
   */
  unlock(): void {
    if (this.ac) {
      if (this.ac.state === 'suspended' && !document.hidden) void this.ac.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ac = (this.ac = this.createContext(Ctor));

    this.master = ac.createGain();
    // Мягкий лимитер, чтобы наложение звуков не клиппило
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ac.destination);

    this.stepsBus = ac.createGain();
    this.natureBus = ac.createGain();
    // Срез верхов, чтобы шаги не шипели
    const stepsLp = ac.createBiquadFilter();
    stepsLp.type = 'lowpass';
    stepsLp.frequency.value = 3200;
    stepsLp.Q.value = 0.5;
    this.stepsBus.connect(stepsLp).connect(this.master);
    this.natureBus.connect(this.master);
    this.sfxBus = ac.createGain();
    this.sfxBus.gain.value = 0.6;
    this.sfxBus.connect(this.master);

    this.reverb = ac.createConvolver();
    this.reverb.buffer = forestImpulse(ac, this.lite ? 0.8 : 1.6);
    const wet = ac.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.natureBus);
    // Немного леса и в шагах — сухой шаг выпрыгивает из реверберированного фона
    const stepsSend = ac.createGain();
    stepsSend.gain.value = 0.12;
    stepsLp.connect(stepsSend).connect(this.reverb);

    // У музыки своя шина и свой, более долгий хвост — её громкость не зависит от природы
    this.musicBus = ac.createGain();
    this.musicBus.connect(this.master);
    const musicVerb = ac.createConvolver();
    musicVerb.buffer = forestImpulse(ac, this.lite ? 1.4 : 3);
    const musicWet = ac.createGain();
    musicWet.gain.value = 0.5;
    musicVerb.connect(musicWet).connect(this.musicBus);
    this.music = new Music(ac, this.musicBus, musicVerb, () => this.running && settings.musicVolume > 0);
    this.music.setBiome(this.biome);

    this.stepNoise = whiteNoise(ac, 1);
    this.applyVolumes(settings);
    this.startWind();
    this.scheduleBird(rand(1, 3));
    this.scheduleVoice('crickets', 0.6, 2.2, () => this.cricket());
    this.scheduleVoice('owls', 9, 22, () => this.owl());
    this.scheduleVoice('frogs', 1.5, 5, () => this.frog());
  }

  /**
   * Контекст звука. Облегчённому — буфер побольше (заминка процессора не рвёт звук,
   * шаги запаздывают на доли секунды) и 22 кГц: всё считается вдвое дешевле,
   * а выше 11 кГц у нас почти ничего не звучит.
   */
  private createContext(Ctor: typeof AudioContext): AudioContext {
    if (this.lite) {
      try {
        return new Ctor({ latencyHint: 'playback', sampleRate: 22050 });
      } catch {
        // Старый браузер не принимает параметры — берём как есть
      }
    }
    return new Ctor();
  }

  /** Звуковая атмосфера уровня: какие голоса и как часто звучат. */
  setAmbience(a: Ambience): void {
    this.ambience = a;
  }

  /** Лад фоновой музыки — по биому уровня. */
  setMusic(id: BiomeId): void {
    this.biome = id;
    this.music?.setBiome(id);
  }

  /** Серия кристаллов для музыки: count — её длина, 0 — серии нет. */
  setCombo(count: number): void {
    this.music?.setCombo(count);
  }

  private applyVolumes(s: Readonly<Settings>): void {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    this.master.gain.setTargetAtTime(s.sound ? s.volume : 0, t, 0.05);
    this.stepsBus.gain.setTargetAtTime(s.stepsVolume, t, 0.05);
    this.natureBus.gain.setTargetAtTime(s.natureVolume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.musicVolume, t, 0.05);
  }

  private get running(): boolean {
    return !!this.ac && this.ac.state === 'running' && settings.sound;
  }

  // ---------- Ветер ----------

  private startWind(): void {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = pinkNoise(ac, 6);
    src.loop = true;

    // Гул ветра — низкочастотная часть шума
    this.windFilter = ac.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ac.createGain();
    this.windGain.gain.value = 0.5;
    src.connect(this.windFilter).connect(this.windGain).connect(this.natureBus);

    // Шелест листвы — верхняя полоса, громче на порывах
    const leaves = ac.createBiquadFilter();
    leaves.type = 'bandpass';
    leaves.frequency.value = 4200;
    leaves.Q.value = 0.5;
    this.leavesGain = ac.createGain();
    this.leavesGain.gain.value = 0.06;
    src.connect(leaves).connect(this.leavesGain).connect(this.natureBus);

    src.start();
    // Порывы задаёт общая модель ветра — та же, что качает траву
    this.gust(wind.target, 0.5);
    wind.onGust((strength, tau) => this.gust(strength, tau));
  }

  /** Новый порыв: плавно меняем силу и «тембр» ветра. */
  private gust(strength: number, tau: number): void {
    const ac = this.ac!;
    const t = ac.currentTime;
    this.windGain.gain.setTargetAtTime(0.35 + strength * 0.6, t, tau);
    this.windFilter.frequency.setTargetAtTime(300 + strength * 700, t, tau);
    this.leavesGain.gain.setTargetAtTime(0.02 + strength * strength * 0.16, t, tau);
  }

  // ---------- Птицы ----------

  private scheduleBird(delaySec: number): void {
    clearTimeout(this.birdTimer);
    this.birdTimer = setTimeout(() => {
      const rate = this.ambience.birds;
      if (rate > 0 && this.running && settings.natureVolume > 0) this.bird();
      // Где птиц меньше, паузы между ними длиннее; где их нет — просто проверяем позже
      this.scheduleBird(rate > 0 ? rand(1.2, 5.5) / rate : 3);
    }, delaySec * 1000);
  }

  /**
   * Голос биома (сверчки, совы…): звучит со случайной паузой от min до max секунд,
   * делённой на частоту голоса в текущем биоме; при частоте 0 молчит.
   */
  private scheduleVoice(key: 'crickets' | 'owls' | 'frogs', min: number, max: number, play: () => void): void {
    const tick = () => {
      const rate = this.ambience[key];
      if (rate > 0 && this.running && settings.natureVolume > 0) play();
      setTimeout(tick, (rate > 0 ? rand(min, max) / rate : 3) * 1000);
    };
    setTimeout(tick, rand(min, max) * 1000);
  }

  /** Сверчок: несколько коротких пульсаций высокого тона. */
  private cricket(): void {
    const ac = this.ac!;
    const ch = this.birdChannel(rand(0.2, 1));
    ch.input.gain.value *= 0.45;
    const f = rand(4200, 5200);
    let t = ac.currentTime + 0.02;
    const bursts = rand(1, 3) | 0;
    for (let b = 0; b <= bursts; b++) {
      const pulses = (rand(3, 6) | 0) + 1;
      for (let i = 0; i < pulses; i++) {
        this.note(ch.input, t, f, f * 0.99, 0.018, 0.9);
        t += 0.034;
      }
      t += rand(0.12, 0.3);
    }
    ch.done(t);
  }

  /** Лягушка: короткое гортанное «ква», иногда два-три подряд. */
  private frog(): void {
    const ac = this.ac!;
    const ch = this.birdChannel(rand(0.3, 1));
    ch.input.gain.value *= 0.5;
    const f = rand(120, 190);
    let t = ac.currentTime + 0.03;
    const n = (rand(1, 3.5) | 0);
    for (let i = 0; i < n; i++) {
      // Прямоугольная волна даёт «квакающий» тембр, глиссандо вниз — «а» в конце
      this.note(ch.input, t, f * 1.25, f, 0.13, 0.7, 'square');
      this.note(ch.input, t, f * 2.5, f * 2, 0.1, 0.25, 'sine');
      t += rand(0.18, 0.3);
    }
    ch.done(t);
  }

  /** Сова: глухое «у-ху… хуу» вдалеке. */
  private owl(): void {
    const ac = this.ac!;
    const ch = this.birdChannel(rand(0.5, 0.95));
    const f = rand(360, 420);
    const t = ac.currentTime + 0.05;
    this.note(ch.input, t, f * 1.02, f, 0.22, 1.3, 'sine');
    this.note(ch.input, t + 0.5, f * 1.05, f * 0.97, 0.18, 1.1, 'sine');
    this.note(ch.input, t + 0.78, f, f * 0.94, 0.55, 1.4, 'sine', 3);
    ch.done(t + 1.4);
  }

  /** Канал одной птицы: панорама, «даль» через фильтр, отправка в ревербератор. */
  private birdChannel(distance: number): { input: GainNode; done: (at: number) => void } {
    const ac = this.ac!;
    const input = ac.createGain();
    input.gain.value = 0.32 * (1 - distance * 0.75);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000 - distance * 6000;
    const pan = ac.createStereoPanner();
    pan.pan.value = rand(-0.9, 0.9);
    const send = ac.createGain();
    send.gain.value = 0.3 + distance * 0.7;
    input.connect(lp).connect(pan);
    pan.connect(this.natureBus);
    pan.connect(send).connect(this.reverb);
    return {
      input,
      done: (at) => setTimeout(() => [input, lp, pan, send].forEach((n) => n.disconnect()), (at - ac.currentTime + 2) * 1000),
    };
  }

  /** Одна нота: тон с глиссандо и короткой огибающей. */
  private note(out: AudioNode, at: number, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', vibrato = 0): void {
    const ac = this.ac!;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
    if (vibrato > 0) {
      const lfo = ac.createOscillator();
      const depth = ac.createGain();
      lfo.frequency.value = rand(18, 30);
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(at);
      lfo.stop(at + dur + 0.02);
    }
    const g = ac.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + Math.min(0.012, dur * 0.3));
    g.gain.setTargetAtTime(0, at + dur * 0.6, dur * 0.18);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.1);
  }

  private bird(): void {
    const ac = this.ac!;
    const kinds = ['chirp', 'chirp', 'trill', 'whistle', 'whistle', 'cuckoo'] as const;
    const kind = pick(this.ambience.cuckoo ? kinds : kinds.slice(0, -1));
    const ch = this.birdChannel(kind === 'cuckoo' ? rand(0.6, 1) : rand(0, 0.9));
    let t = ac.currentTime + 0.05;

    if (kind === 'chirp') {
      // Воробьиное «чик-чирик»: быстрые нисходящие свисты
      const base = rand(3500, 5500);
      const n = (rand(2, 6) | 0) + 1;
      for (let i = 0; i < n; i++) {
        const f = base * rand(0.9, 1.15);
        const d = rand(0.04, 0.08);
        this.note(ch.input, t, f * 1.4, f * 0.75, d, 1);
        t += d + rand(0.04, 0.12);
      }
    } else if (kind === 'trill') {
      // Трель: серия очень коротких одинаковых нот
      const f = rand(4000, 6500);
      const n = (rand(8, 16) | 0);
      const d = rand(0.02, 0.035);
      for (let i = 0; i < n; i++) {
        const k = 1 - (i / n) * 0.15;
        this.note(ch.input, t, f * k * 1.08, f * k, d, 0.8 * (0.6 + 0.4 * Math.sin((i / n) * Math.PI)));
        t += d + 0.018;
      }
    } else if (kind === 'whistle') {
      // Мелодичный свист с вибрато — «иволга»
      const base = rand(1800, 3000);
      const n = (rand(2, 4) | 0) + 1;
      for (let i = 0; i < n; i++) {
        const d = rand(0.14, 0.32);
        const f0 = base * pick([1, 1.25, 1.5, 0.84]);
        this.note(ch.input, t, f0, f0 * rand(0.85, 1.25), d, 0.9, 'sine', f0 * 0.02);
        t += d + rand(0.05, 0.14);
      }
    } else {
      // Кукушка: «ку-ку» малой терцией, несколько раз
      const f = rand(640, 720);
      const n = (rand(2, 6) | 0) + 1;
      for (let i = 0; i < n; i++) {
        this.note(ch.input, t, f, f * 0.98, 0.2, 1.4, 'triangle');
        this.note(ch.input, t + 0.32, f * 0.82, f * 0.8, 0.28, 1.4, 'triangle');
        t += 0.95;
      }
    }
    ch.done(t);
  }

  // ---------- Игровые сигналы ----------

  /** Канал сигнала с хвостом реверберации. */
  private sfxOut(): GainNode {
    const ac = this.ac!;
    const out = ac.createGain();
    const send = ac.createGain();
    send.gain.value = 0.5;
    out.connect(this.sfxBus);
    out.connect(send).connect(this.reverb);
    setTimeout(() => {
      out.disconnect();
      send.disconnect();
    }, 4000);
    return out;
  }

  /**
   * Звон подобранного кристалла; последний — коротким арпеджио.
   * step — номер в серии быстрых сборов: каждый следующий звучит на ступень пентатоники выше.
   */
  chime(last = false, step = 0): void {
    if (!this.ac || !settings.sound) return;
    const out = this.sfxOut();
    const t = this.ac.currentTime + 0.01;
    const k = 2 ** (PENTATONIC[Math.min(step, PENTATONIC.length - 1)] / 12);
    const notes = last ? [1047, 1319, 1568, 2093] : [1319, 1976];
    notes.forEach((f, i) => this.note(out, t + i * 0.07, f * k, f * k, 0.35, 0.5, 'sine'));
  }

  /** Портал открылся: восходящий аккорд. */
  portalOpen(): void {
    if (!this.ac || !settings.sound) return;
    const out = this.sfxOut();
    const t = this.ac.currentTime + 0.05;
    [392, 523, 659, 784, 1047].forEach((f, i) => this.note(out, t + i * 0.12, f, f * 1.01, 0.9, 0.45, 'triangle'));
  }

  /** Вход в портал: шумовой «вжух» с восходящим тоном. */
  portalEnter(): void {
    if (!this.ac || !settings.sound) return;
    const ac = this.ac;
    const out = this.sfxOut();
    const t = ac.currentTime + 0.01;
    const src = ac.createBufferSource();
    src.buffer = this.stepNoise;
    src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(4000, t + 1);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 1.4);
    this.note(out, t, 220, 880, 1.1, 0.35, 'sine');
  }

  // ---------- Деревья ----------

  /**
   * Тряхнули дерево: шелест кроны — серия коротких всплесков высокого шума;
   * с заснеженной ели вместо этого глухо ссыпается снег.
   * @param strength 0…1 — сила толчка
   */
  rustle(strength: number, snowy: boolean, pan = 0): void {
    if (!this.running) return;
    const ac = this.ac!;
    const t = ac.currentTime;
    const out = ac.createStereoPanner();
    out.pan.value = clamp(pan, -0.8, 0.8);
    out.connect(this.natureBus);
    const grains = snowy ? 2 : this.lite ? 3 : 6;
    const len = snowy ? 0.5 : 0.7;
    let end = t;
    for (let i = 0; i < grains; i++) {
      const at = t + (i / grains) * len * rand(0.6, 1);
      const src = ac.createBufferSource();
      src.buffer = this.stepNoise;
      src.playbackRate.value = rand(0.8, 1.2);
      const f = ac.createBiquadFilter();
      f.type = snowy ? 'lowpass' : 'bandpass';
      f.frequency.value = snowy ? rand(500, 900) : rand(2800, 5200);
      f.Q.value = snowy ? 0.7 : 0.6;
      const g = ac.createGain();
      const dur = snowy ? rand(0.25, 0.4) : rand(0.12, 0.26);
      // Шелест стихает вместе с колебаниями дерева
      const peak = (snowy ? 0.35 : 0.12) * strength * (1 - i / (grains + 1));
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.03 + dur);
      src.connect(f).connect(g).connect(out);
      src.start(at, rand(0, 0.6), dur + 0.08);
      end = Math.max(end, at + dur + 0.1);
    }
    setTimeout(() => out.disconnect(), (end - t + 0.2) * 1000);
  }

  // ---------- Шаги ----------

  /**
   * Один удар лапы.
   * @param weight 0…1 — «тяжесть» героя (олень тяжелее лисы)
   * @param force громкость удара, 1 — обычный шаг
   * @param pitch множитель тона: задние лапы галопа звучат ниже
   */
  footfall(surface: Surface, weight: number, force = 1, pan = 0, delay = 0, pitch = 1): void {
    if (!this.running) return;
    const ac = this.ac!;
    const sp = SURFACES[surface];
    const t = ac.currentTime + delay;
    const out = ac.createStereoPanner();
    out.pan.value = pan;
    out.connect(this.stepsBus);

    // Шорох/хруст — полоса шума; снег хрустит серией коротких «зёрен».
    // Плавная атака, чтобы шаг не щёлкал; зёрнам — короче, иначе они сольются
    const grains = Math.min(sp.grains ?? 1, this.lite ? 2 : Infinity);
    const attack = grains > 1 ? 0.008 : 0.018;
    let gt = t;
    for (let i = 0; i < grains; i++) {
      const src = ac.createBufferSource();
      src.buffer = this.stepNoise;
      src.playbackRate.value = rand(0.85, 1.15);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = sp.freq * pitch * rand(0.8, 1.2) * (1.15 - weight * 0.3);
      bp.Q.value = sp.q;
      const g = ac.createGain();
      const dur = sp.dur * (0.8 + weight * 0.5);
      const peak = sp.noise * force * (0.5 + weight * 0.6) * (grains > 1 ? rand(0.5, 1) * (1 - i / (grains + 1)) : 1);
      g.gain.setValueAtTime(0, gt);
      g.gain.linearRampToValueAtTime(peak, gt + attack);
      g.gain.exponentialRampToValueAtTime(0.001, gt + attack + dur);
      src.connect(bp).connect(g).connect(out);
      src.start(gt, rand(0, 0.8), attack + dur + 0.05);
      gt += rand(0.014, 0.028);
    }

    // Глухой удар — короткий низкий тон с падающей частотой
    const osc = ac.createOscillator();
    osc.type = 'sine';
    const f = sp.thumpFreq * pitch * (1.3 - weight * 0.5);
    osc.frequency.setValueAtTime(f * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const og = ac.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(sp.thump * force * (0.3 + weight), t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.12);
    osc.onended = () => out.disconnect();
  }
}

// ---------- Ритм шагов ----------

/** Поворотный галоп: две задние, две передние — доли интервала g и громкость каждой лапы. */
const GALLOP = [
  { at: 0, force: 1, pitch: 0.88 },
  { at: 0.8, force: 0.6, pitch: 0.88 },
  { at: 1.9, force: 0.7, pitch: 1 },
  { at: 2.6, force: 0.9, pitch: 1 },
] as const;

/**
 * Следит за игроком и выдаёт удары лап в такт движению:
 * шагом — одиночные удары через каждые stride метров, рысью — пары,
 * галопом — «тыгдык» из четырёх лап и пауза полёта; плюс приземление после прыжка.
 */
export class Footsteps {
  /** Фаза цикла шага, 0…1: на переходе через 1 звучит удар. */
  private phase = 0;
  private wasOnGround = true;
  private airTime = 0;
  private side = 1;

  constructor(private readonly audio: GameAudio, private readonly world: World) {}

  reset(): void {
    this.phase = 0;
    this.wasOnGround = true;
    this.airTime = 0;
  }

  update(dt: number, player: Player): void {
    const hero = player.hero;
    if (!hero) return;
    const d = hero.def;
    const weight = clamp(d.height / 2.1, 0.3, 1);
    const speed = player.horizontalSpeed;
    const surface = this.world.surfaceAt(player.pos.x, player.pos.z, player.pos.y);

    if (!player.onGround) {
      this.airTime += dt;
      this.wasOnGround = false;
      return;
    }
    if (!this.wasOnGround) {
      // Приземление: громче после долгого полёта
      if (this.airTime > 0.15) {
        const force = clamp(0.8 + this.airTime * 1.2, 0.8, 2);
        this.audio.footfall(surface, weight, force, -0.15);
        this.audio.footfall(surface, weight, force * 0.8, 0.15, 0.035);
      }
      this.wasOnGround = true;
      this.airTime = 0;
      this.phase = 0;
    }

    if (speed < 0.4) {
      this.phase = 0;
      return;
    }
    const runK = clamp((speed - d.walk) / (d.run - d.walk), 0, 1);
    const gallop = runK > 0.5;
    // Шаг и рысь — по пройденным метрам (длина шага растёт с размером героя и скоростью),
    // галоп — своим темпом: мелкий зверь скачет чаще, крупный реже
    const rate = gallop
      ? (3.4 - d.height * 0.7) * (0.8 + runK * 0.2)
      : speed / Math.max(0.6, d.height * (0.85 + runK * 2.5));
    this.phase += rate * dt;
    if (this.phase < 1) return;
    this.phase -= 1;
    this.side = -this.side;
    // Живой разброс силы и лёгкий сдвиг по времени — чтобы не звучал метроном
    const force = (0.7 + runK * 0.5) * rand(0.75, 1.1);
    const pan = this.side * 0.12;
    const jitter = rand(0, 0.015);

    if (gallop) {
      // Интервал между лапами чуть длиннее у крупного зверя
      const g = 0.05 + d.height * 0.008;
      GALLOP.forEach((leg, i) => {
        const at = Math.max(0, jitter + leg.at * g + rand(-0.006, 0.006));
        const legPan = (i % 2 ? -pan : pan) * 0.8;
        this.audio.footfall(surface, weight, force * 0.85 * leg.force * rand(0.85, 1.1), legPan, at, leg.pitch);
      });
      return;
    }
    this.audio.footfall(surface, weight, force, pan, jitter);
    // Рысь: диагональные лапы ставятся почти вместе — пара ударов
    if (runK > 0.2) this.audio.footfall(surface, weight, force * rand(0.6, 0.85), -pan, jitter + rand(0.05, 0.08));
  }
}
