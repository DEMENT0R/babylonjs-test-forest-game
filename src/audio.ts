// Звук: всё синтезируется на лету через Web Audio API — без звуковых файлов.
// Ветер — розовый шум с порывами из общей модели (wind.ts), птицы — свисты и трели нескольких «видов»
// (и изредка кукушка), шаги — короткие шумовые щелчки, зависящие от поверхности и веса героя.

import type { Ambience } from './levels/biomes';
import type { Player } from './player';
import { onSettingsApplied, settings, type Settings } from './settings';
import { clamp } from './utils';
import { wind } from './wind';
import type { Surface, World } from './world';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[(Math.random() * xs.length) | 0];

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
  grass: { freq: 1700, q: 0.7, dur: 0.11, noise: 0.45, thump: 0.25, thumpFreq: 95 },
  path: { freq: 3200, q: 1.1, dur: 0.08, noise: 0.6, thump: 0.25, thumpFreq: 110 },
  stone: { freq: 950, q: 2.2, dur: 0.05, noise: 0.5, thump: 0.55, thumpFreq: 150 },
  snow: { freq: 2300, q: 0.9, dur: 0.05, noise: 0.55, thump: 0.12, thumpFreq: 80, grains: 5 },
};

// ---------- Движок звука ----------

export class GameAudio {
  private ac: AudioContext | null = null;
  private master!: GainNode;
  private stepsBus!: GainNode;
  private natureBus!: GainNode;
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

  constructor() {
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
    const ac = (this.ac = new Ctor());

    this.master = ac.createGain();
    // Мягкий лимитер, чтобы наложение звуков не клиппило
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ac.destination);

    this.stepsBus = ac.createGain();
    this.natureBus = ac.createGain();
    this.stepsBus.connect(this.master);
    this.natureBus.connect(this.master);
    this.sfxBus = ac.createGain();
    this.sfxBus.gain.value = 0.6;
    this.sfxBus.connect(this.master);

    this.reverb = ac.createConvolver();
    this.reverb.buffer = forestImpulse(ac);
    const wet = ac.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.natureBus);

    this.stepNoise = whiteNoise(ac, 1);
    this.applyVolumes(settings);
    this.startWind();
    this.scheduleBird(rand(1, 3));
    this.scheduleVoice('crickets', 0.6, 2.2, () => this.cricket());
    this.scheduleVoice('owls', 9, 22, () => this.owl());
  }

  /** Звуковая атмосфера уровня: какие голоса и как часто звучат. */
  setAmbience(a: Ambience): void {
    this.ambience = a;
  }

  private applyVolumes(s: Readonly<Settings>): void {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    this.master.gain.setTargetAtTime(s.sound ? s.volume : 0, t, 0.05);
    this.stepsBus.gain.setTargetAtTime(s.stepsVolume, t, 0.05);
    this.natureBus.gain.setTargetAtTime(s.natureVolume, t, 0.05);
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
  private scheduleVoice(key: 'crickets' | 'owls', min: number, max: number, play: () => void): void {
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

  /** Звон подобранного кристалла; последний — коротким арпеджио. */
  chime(last = false): void {
    if (!this.ac || !settings.sound) return;
    const out = this.sfxOut();
    const t = this.ac.currentTime + 0.01;
    const notes = last ? [1047, 1319, 1568, 2093] : [1319, 1976];
    notes.forEach((f, i) => this.note(out, t + i * 0.07, f, f, 0.35, 0.5, 'sine'));
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

  // ---------- Шаги ----------

  /**
   * Один удар лапы.
   * @param weight 0…1 — «тяжесть» героя (олень тяжелее лисы)
   * @param force громкость удара, 1 — обычный шаг
   */
  footfall(surface: Surface, weight: number, force = 1, pan = 0, delay = 0): void {
    if (!this.running) return;
    const ac = this.ac!;
    const sp = SURFACES[surface];
    const t = ac.currentTime + delay;
    const out = ac.createStereoPanner();
    out.pan.value = pan;
    out.connect(this.stepsBus);

    // Шорох/хруст — полоса шума; снег хрустит серией коротких «зёрен»
    const grains = sp.grains ?? 1;
    let gt = t;
    for (let i = 0; i < grains; i++) {
      const src = ac.createBufferSource();
      src.buffer = this.stepNoise;
      src.playbackRate.value = rand(0.85, 1.15);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = sp.freq * rand(0.8, 1.2) * (1.15 - weight * 0.3);
      bp.Q.value = sp.q;
      const g = ac.createGain();
      const dur = sp.dur * (0.8 + weight * 0.5);
      const peak = sp.noise * force * (0.5 + weight * 0.6) * (grains > 1 ? rand(0.5, 1) * (1 - i / (grains + 1)) : 1);
      g.gain.setValueAtTime(0, gt);
      g.gain.linearRampToValueAtTime(peak, gt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, gt + dur);
      src.connect(bp).connect(g).connect(out);
      src.start(gt, rand(0, 0.8), dur + 0.05);
      gt += rand(0.014, 0.028);
    }

    // Глухой удар — короткий низкий тон с падающей частотой
    const osc = ac.createOscillator();
    osc.type = 'sine';
    const f = sp.thumpFreq * (1.3 - weight * 0.5);
    osc.frequency.setValueAtTime(f * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const og = ac.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(sp.thump * force * (0.3 + weight), t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.12);
    osc.onended = () => out.disconnect();
  }
}

// ---------- Ритм шагов ----------

/**
 * Следит за игроком и выдаёт удары лап в такт движению:
 * шаг — через каждые stride метров, на бегу — сдвоенный удар галопа,
 * плюс приземление после прыжка.
 */
export class Footsteps {
  private travelled = 0;
  private wasOnGround = true;
  private airTime = 0;
  private side = 1;

  constructor(private readonly audio: GameAudio, private readonly world: World) {}

  reset(): void {
    this.travelled = 0;
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
      this.travelled = 0;
    }

    if (speed < 0.4) {
      this.travelled = 0;
      return;
    }
    const runK = clamp((speed - d.walk) / (d.run - d.walk), 0, 1);
    // Длина шага растёт с размером героя и на бегу
    const stride = Math.max(0.6, d.height * (0.85 + runK * 1.1));
    this.travelled += speed * dt;
    if (this.travelled < stride) return;
    this.travelled -= stride;
    this.side = -this.side;
    const force = 0.7 + runK * 0.5;
    const pan = this.side * 0.12;
    this.audio.footfall(surface, weight, force, pan);
    // Четыре лапы: на бегу каждый «шаг» — пара ударов
    if (runK > 0.3) this.audio.footfall(surface, weight, force * 0.75, -pan, rand(0.05, 0.08));
  }
}
