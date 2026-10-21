// Экран выбора героя: отдельная 3D-сцена — лесная поляна с каменным кругом и тремя подиумами,
// карточки героев поверх неё. Поляна одета в биом уровня, который игрок сейчас начнёт.

import {
  Color3,
  Color4,
  DirectionalLight,
  PointLight,
  GlowLayer,
  HemisphericLight,
  MeshBuilder,
  PointerEventTypes,
  Scene,
  StandardMaterial,
  UniversalCamera,
  Vector3,
  type Engine,
  type Mesh,
  type Node,
  type PBRMaterial,
} from '@babylonjs/core';
import { GrassField } from '../grass';
import { applyCoat, chooseCoat, coatFor, COATS, HEROES, loadHero, openCoats, type Hero, type HeroDef } from '../heroes';
import { BIOMES, type Biome } from '../levels/biomes';
import { Forest } from '../levels/forest';
import type { TreeSpot } from '../levels/generator';
import { totalStars } from '../levels/progress';
import { FLAT_TERRAIN } from '../levels/terrain';
import { AirParticles } from '../particles';
import { Rng } from '../rng';
import { addShadowCaster, createLightingContext, settings, type LightingContext } from '../settings';
import { byId, clamp, damp, now, wrapAngle } from '../utils';

const SLOT_X = [-3.4, 0, 3.4];
const CAM_Z = -9;
/** Наклон камеры вниз, как на широком экране: камера на 1.4 выше героя и в 9 позади. */
const PITCH = Math.atan2(1.4, 9);
/** Высота кадра «герой на подиуме» и какую долю свободной полосы экрана он занимает.
    Общая для всех героев, чтобы камера не дёргалась вперёд-назад при выборе. */
const FRAME_H = 2;
const FILL = 0.5;
/** Каменный круг за подиумами: центр, радиус и углы камней на дуге позади героев. */
const CIRCLE = { x: 0, z: 1.5, r: 7.5 };
const PILLAR_ANGLES = [0.35, 0.95, 1.5708, 2.19, 2.79];
/** Утоптанная площадка под подиумами — эллипс, шире по X. */
const PATH = { rx: 7.5, rz: 5.5, z: 0 };
/** Поляна, свободная от деревьев: эллипс вокруг круга. */
const CLEARING = { rx: 15, rz: 14 };
/** Закрытый герой стоит на подиуме тёмным силуэтом. */
const SILHOUETTE = new Color3(0.03, 0.04, 0.05);
/** Ночью силуэт светлее, иначе он теряется на тёмном лесе: луна обрисовывает форму. */
const NIGHT_SILHOUETTE = new Color3(0.07, 0.08, 0.1);

/** Сколько звёзд не хватает до героя (0 — открыт). */
export const starsMissing = (def: HeroDef): number => Math.max(0, def.stars - totalStars());

interface Slot {
  pod: Mesh;
  ring: Mesh;
  hero: Hero | null;
  /** Вес приветственной анимации (0 — не играет). */
  hello: number;
  /** Угол, под которым герой стоит, когда не выбран. */
  face: number;
}

export interface SelectActions {
  /** Игрок подтвердил выбор. */
  onStart: (def: HeroDef) => void;
  onBack: () => void;
  onSettings: () => void;
  /** Не реагировать на клики по сцене (например, открыты настройки). */
  isBlocked: () => boolean;
}

export class SelectScreen {
  readonly scene: Scene;
  private readonly camera: UniversalCamera;
  private readonly lighting: LightingContext;
  private readonly hemi: HemisphericLight;
  private readonly sun: DirectionalLight;
  /** Ночью над выбранным подиумом — тёплый свет, как от кристаллов на ночных уровнях. */
  private readonly lamp: PointLight;
  private readonly slots: Slot[];
  private readonly ringOn: StandardMaterial;
  private readonly ringOff: StandardMaterial;
  private readonly groundMat: StandardMaterial;
  private readonly pathMat: StandardMaterial;
  private readonly stoneMat: StandardMaterial;
  private readonly trees = clearingTrees();
  private grass: GrassField | null = null;
  private forest: Forest | null = null;
  private particles: AirParticles | null = null;
  private biome: Biome | null = null;
  private readonly cardsEl = byId('cards');
  private readonly playBtn = byId<HTMLButtonElement>('play');
  private readonly coatBtn = byId<HTMLButtonElement>('coat');
  private index = 0;
  private busy = false;
  private camX = 0;
  private camDist = -CAM_Z;
  private camFocusY = 1;
  /** Свободная полоса экрана между заголовком и карточками: середина и высота в долях экрана. */
  private band = { center: 0.4, size: 0.5 };
  private bandDirty = true;
  /** Все герои загружены и стоят на подиумах. */
  ready = false;

  constructor(engine: Engine, private readonly actions: SelectActions) {
    const scene = (this.scene = new Scene(engine));

    // Цвета и сила света — из биома; направление своё: солнце светит героям в лицо из-за камеры
    this.hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
    const sun = (this.sun = new DirectionalLight('s', new Vector3(-0.4, -1, 0.6), scene));
    sun.position = new Vector3(8, 20, -12);
    this.lamp = new PointLight('lamp', new Vector3(0, 1.8, -0.6), scene);
    this.lamp.diffuse = new Color3(1, 0.78, 0.4);
    this.lamp.specular = new Color3(0, 0, 0);
    this.lamp.range = 7;
    this.lamp.intensity = 0;

    this.camera = new UniversalCamera('sc', new Vector3(0, 2.4, CAM_Z), scene);
    this.camera.inputs.clear();
    this.camera.fov = 0.75;
    this.camera.minZ = 0.1;

    this.lighting = createLightingContext({ scene, sun, camera: this.camera, shadowFrustum: 16, fixedMaxZ: 200 });
    this.lighting.glow = new GlowLayer('sg', scene);
    this.lighting.glow.intensity = 0.5;

    const mat = (name: string, c: Color3) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = c;
      m.specularColor = new Color3(0, 0, 0);
      return m;
    };
    // Земля уходит в туман — края мира не видно
    const ground = MeshBuilder.CreateDisc('g', { radius: 150, tessellation: 64 }, scene);
    ground.rotation.x = Math.PI / 2;
    ground.material = this.groundMat = mat('gm', new Color3());
    ground.receiveShadows = true;
    ground.isPickable = false;
    const path = MeshBuilder.CreateDisc('path', { radius: 1, tessellation: 48 }, scene);
    path.rotation.x = Math.PI / 2;
    path.scaling.set(PATH.rx, PATH.rz, 1);
    path.position.set(0, 0.02, PATH.z);
    path.material = this.pathMat = mat('pm', new Color3());
    path.receiveShadows = true;
    path.isPickable = false;

    // Камни каменного круга — такие же, как на уровнях, дугой позади подиумов
    const podStone = (this.stoneMat = mat('ps', new Color3()));
    PILLAR_ANGLES.forEach((a, i) => {
      const h = 2.4 + (i % 2) * 0.8;
      const m = MeshBuilder.CreateBox('pillar', { width: 0.9, height: h + 1, depth: 0.6 }, scene);
      m.position.set(CIRCLE.x + Math.cos(a) * CIRCLE.r, (h - 1) / 2, CIRCLE.z + Math.sin(a) * CIRCLE.r);
      m.rotation.y = Math.PI / 2 - a;
      m.material = podStone;
      m.receiveShadows = true;
      m.isPickable = false;
      addShadowCaster(this.lighting, m);
    });
    this.ringOff = mat('ro', new Color3(0.5, 0.48, 0.44));
    this.ringOn = mat('ri', new Color3(1, 0.8, 0.3));
    this.ringOn.emissiveColor = new Color3(0.9, 0.6, 0.1);

    this.slots = HEROES.map((_, i) => {
      const pod = MeshBuilder.CreateCylinder('pod', { height: 0.35, diameter: 2.4, tessellation: 40 }, scene);
      pod.position.set(SLOT_X[i], 0.175, 0);
      pod.material = podStone;
      pod.receiveShadows = true;
      pod.metadata = { hero: i };
      addShadowCaster(this.lighting, pod);
      const ring = MeshBuilder.CreateTorus('ring', { diameter: 2.45, thickness: 0.07, tessellation: 48 }, scene);
      ring.position.set(SLOT_X[i], 0.36, 0);
      ring.material = this.ringOff;
      ring.isPickable = false;
      return { pod, ring, hero: null, hello: 0, face: Math.atan2(-SLOT_X[i], CAM_Z) };
    });

    this.setBiome(BIOMES.meadow);

    this.buildCards();
    this.playBtn.addEventListener('click', () => this.confirm());
    this.coatBtn.addEventListener('click', () => this.nextCoat());
    byId('sel-back').addEventListener('click', actions.onBack);
    byId('sel-settings').addEventListener('click', actions.onSettings);

    scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERTAP || actions.isBlocked()) return;
      let n: Node | null = pi.pickInfo?.pickedMesh ?? null;
      while (n && (n.metadata as { hero?: number } | null)?.hero === undefined) n = n.parent;
      if (n) this.choose((n.metadata as { hero: number }).hero);
    });
    scene.onBeforeRenderObservable.add(() => this.animate(Math.min(engine.getDeltaTime() / 1000, 0.05)));
    window.addEventListener('resize', () => (this.bandDirty = true));

    this.choose(this.index);
  }

  /**
   * Одеть поляну в биом: небо, свет, земля, камень, лес, трава и частицы — как на уровне,
   * в который игрок сейчас отправится.
   */
  setBiome(b: Biome): void {
    if (this.biome?.id === b.id) return;
    this.biome = b;
    const scene = this.scene;
    scene.clearColor = Color4.FromColor3(b.sky, 1);
    scene.fogColor = b.sky.clone();
    this.lighting.fogBase = b.fogBase;
    scene.fogDensity = b.fogBase / settings.view;
    this.hemi.intensity = b.hemi.intensity;
    this.hemi.groundColor = b.hemi.ground.clone();
    this.sun.diffuse = b.sun.color.clone();
    this.sun.intensity = b.sun.intensity;
    this.groundMat.diffuseColor = b.ground.clone();
    this.pathMat.diffuseColor = b.path.clone();
    this.stoneMat.diffuseColor = b.stone.clone();
    this.ringOff.diffuseColor = b.stone.scale(0.8);
    if (this.ready) this.refreshLocks();

    this.forest?.dispose();
    this.forest = new Forest(scene, this.lighting, { trees: this.trees, biome: b, terrain: FLAT_TERRAIN });
    this.particles?.dispose();
    this.particles = b.particles ? new AirParticles(scene, b.particles) : null;
    // Трава вокруг подиумов, камней и стволов, и под лесом вокруг поляны;
    // на утоптанной площадке и в глубине леса редеет
    this.grass?.dispose();
    this.grass = new GrassField(scene, {
      area: {
        minX: -30, maxX: 30, minZ: -3, maxZ: 32,
        circles: [
          ...SLOT_X.map((x) => ({ x, z: 0, r: 1.3 })),
          ...PILLAR_ANGLES.map((a) => ({ x: CIRCLE.x + Math.cos(a) * CIRCLE.r, z: CIRCLE.z + Math.sin(a) * CIRCLE.r, r: 0.6 })),
          ...this.trees.filter((t) => Math.abs(t.x) < 31 && t.z < 33).map((t) => ({ x: t.x, z: t.z, r: 0.45 * t.s })),
        ],
        coverage: (x, z) =>
          clamp((Math.hypot(x / PATH.rx, (z - PATH.z) / PATH.rz) - 0.75) * 3, 0.15, 1) *
          (1 - clamp(Math.hypot(x / CLEARING.rx, (z - CIRCLE.z) / CLEARING.rz) - 1, 0, 1) * 0.6),
      },
      baseColor: b.grass.root,
      tipColor: b.grass.tip,
      densityScale: b.grass.density,
      glow: this.lighting.glow,
      fixedDistance: 40,
      seed: 777,
    });
  }

  get selected(): HeroDef {
    return HEROES[this.index];
  }

  /** Загружает всех героев на подиумы. */
  async load(): Promise<void> {
    try {
      for (let i = 0; i < HEROES.length; i++) {
        const h = await loadHero(HEROES[i], this.lighting);
        h.root.position.set(SLOT_X[i], 0.35, 0);
        h.root.rotation.y = this.slots[i].face;
        h.meshes.forEach((m) => (m.metadata = { hero: i }));
        this.slots[i].hero = h;
      }
    } catch (err) {
      console.error(err);
      this.playBtn.textContent = 'Не удалось загрузить героев';
      return;
    }
    this.ready = true;
    this.refreshLocks();
    this.choose(this.index);
  }

  /** Блокирует кнопку «Играть», пока грузится герой для игровой сцены. */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.syncPlay();
  }

  /** Звёзд стало больше: открытые герои выходят из тени, карточки и кнопка обновляются. */
  refreshLocks(): void {
    HEROES.forEach((h, i) => {
      const missing = starsMissing(h);
      const card = this.cardsEl.children[i] as HTMLElement | undefined;
      if (card) {
        card.classList.toggle('locked', missing > 0);
        card.querySelector('.hero-lock')!.textContent = missing > 0 ? `★ ${h.stars} — ещё ${missing}` : '';
      }
      this.shade(this.slots[i].hero, missing > 0);
    });
    this.syncPlay();
  }

  /** Силуэт закрытого героя: альбедо в чёрный; открытый — в своём окрасе. */
  private shade(hero: Hero | null, locked: boolean): void {
    if (!hero) return;
    applyCoat(hero, coatFor(hero.def));
    if (!locked) return;
    for (const m of hero.meshes) {
      const mat = m.material as PBRMaterial | null;
      mat?.albedoColor?.copyFrom(this.biome?.crystalLights ? NIGHT_SILHOUETTE : SILHOUETTE);
    }
  }

  /** Следующий открытый окрас выбранного героя. */
  private nextCoat(): void {
    const coats = openCoats();
    const hero = this.slots[this.index].hero;
    if (coats.length < 2 || !hero || starsMissing(this.selected)) return;
    const i = coats.indexOf(coatFor(this.selected));
    chooseCoat(this.selected, coats[(i + 1) % coats.length]);
    applyCoat(hero, coatFor(this.selected));
    this.syncCoat();
  }

  /** Кнопка окраса: текущий окрас и, если есть закрытые, когда откроется следующий. */
  private syncCoat(): void {
    const locked = starsMissing(this.selected) > 0;
    const next = COATS.find((c) => !openCoats().includes(c));
    this.coatBtn.hidden = locked;
    this.coatBtn.textContent = `Окрас: ${coatFor(this.selected).name}${next ? ` · новый за ★ ${next.stars}` : ''}`;
    this.coatBtn.disabled = openCoats().length < 2;
  }

  private syncPlay(): void {
    if (!this.ready) return;
    const missing = starsMissing(this.selected);
    this.playBtn.disabled = this.busy || missing > 0;
    this.playBtn.textContent = missing > 0 ? `Откроется за ★ ${this.selected.stars}` : 'Играть';
    this.syncCoat();
  }

  choose(i: number): void {
    this.index = (i + HEROES.length) % HEROES.length;
    this.syncPlay();
    [...this.cardsEl.children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === this.index)));
    this.slots.forEach((s, k) => (s.ring.material = k === this.index ? this.ringOn : this.ringOff));
    // Выбранный герой здоровается
    const s = this.slots[this.index];
    const hello = s.hero?.anim('hello');
    if (hello) {
      hello.stop();
      hello.start(false, 1);
      s.hello = 0.01;
    }
  }

  chooseHero(def: HeroDef): void {
    this.choose(HEROES.indexOf(def));
  }

  /** ← → / A D, цифры 1–3, C — окрас, Enter или Space — играть. */
  handleKey(e: KeyboardEvent): void {
    if (e.code === 'KeyC' && !e.repeat) this.nextCoat();
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.choose(this.index - 1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.choose(this.index + 1);
    else if (/^Digit[1-9]$/.test(e.code)) {
      const n = +e.code.slice(5) - 1;
      if (n < HEROES.length) this.choose(n);
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      this.confirm();
    }
  }

  private confirm(): void {
    if (this.ready && !starsMissing(this.selected)) this.actions.onStart(this.selected);
  }

  private buildCards(): void {
    const bar = (n: number) => `<span class="bar">${[0, 1, 2, 3, 4].map((k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('')}</span>`;
    HEROES.forEach((h, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hero';
      b.id = `hero-${h.id}`;
      b.innerHTML = `<span class="hero-top"><span class="hero-name">${h.name}</span><span class="hero-key">${i + 1}</span></span>
        <span class="hero-tag">${h.tag}</span>
        <span class="hero-lock"></span>
        <span class="stats"><span>Скорость</span>${bar(h.stats[0])}<span>Прыжок</span>${bar(h.stats[1])}</span>`;
      // Повторный клик по выбранной карточке — сразу в игру
      b.addEventListener('click', () => (this.index === i && this.ready ? this.confirm() : this.choose(i)));
      this.cardsEl.appendChild(b);
    });
  }

  /** Где на экране свободно от заголовка и карточек — туда камера ставит героя. */
  private measureBand(): void {
    const top = byId('select').querySelector('.sel-head')!.getBoundingClientRect().bottom;
    const bottom = byId('select').querySelector('.sel-bottom')!.getBoundingClientRect().top;
    const h = window.innerHeight;
    if (!h || bottom <= top) return;
    this.band = { center: (top + bottom) / 2 / h, size: (bottom - top) / h };
    this.bandDirty = false;
  }

  /**
   * Камера держит выбранного героя в свободной полосе экрана. На широком экране она
   * лишь слегка смещается к нему, чтобы были видны все три подиума; на узком (телефон
   * в портрете) встаёт прямо напротив и отъезжает, чтобы подиум влезал по ширине.
   */
  private animate(dt: number): void {
    if (this.bandDirty) this.measureBand();
    const cam = this.camera;
    const aspect = this.scene.getEngine().getAspectRatio(cam);
    const tanHalf = Math.tan(cam.fov / 2);
    const byHeight = FRAME_H / (2 * tanHalf * FILL * this.band.size);
    const byWidth = 3.2 / (2 * tanHalf * aspect);
    const dist = Math.min(14, Math.max(5.5, byHeight, byWidth));
    const halfWidth = dist * tanHalf * aspect;
    // Крайний подиум (x 3.4, радиус 1.2) влезает в кадр при смещении на 0.35 пути к нему
    const follow = halfWidth > 3.6 ? 0.35 : 1;
    this.camX += (SLOT_X[this.index] * follow - this.camX) * damp(4, dt);
    this.camDist += (dist - this.camDist) * damp(4, dt);

    // Точка героя попадает в середину полосы: камера доворачивается вниз на нужный угол
    const look = PITCH + Math.atan((1 - 2 * this.band.center) * tanHalf);
    this.camFocusY += (0.35 + HEROES[this.index].height / 2 - this.camFocusY) * damp(4, dt);
    const sway = Math.sin(now() * 0.3) * 0.25;
    cam.position.set(this.camX + sway, this.camFocusY + Math.sin(PITCH) * this.camDist, -Math.cos(PITCH) * this.camDist);
    cam.setTarget(cam.position.add(new Vector3(-sway / this.camDist, -Math.sin(look), Math.cos(look))));
    this.grass?.update(cam.position, null, 0);
    this.forest?.update(dt);
    const lamp = this.lamp;
    lamp.position.x += (SLOT_X[this.index] - lamp.position.x) * damp(5, dt);
    lamp.intensity += ((this.biome?.crystalLights ? 1.6 : 0) - lamp.intensity) * damp(3, dt);
    this.particles?.follow(cam.position);

    this.slots.forEach((s, k) => {
      const hero = s.hero;
      if (!hero) return;
      // Выбранный герой поворачивается к камере
      const want = k === this.index ? Math.atan2(cam.position.x - SLOT_X[k], cam.position.z) : s.face;
      hero.root.rotation.y += wrapAngle(want - hero.root.rotation.y) * damp(5, dt);

      const hello = hero.anim('hello');
      const idle = hero.anim('idle');
      if (hello && s.hello) {
        s.hello += ((hello.isPlaying ? 1 : 0) - s.hello) * damp(8, dt);
        hello.weight = s.hello;
        if (idle) idle.weight = 1 - s.hello;
        if (!hello.isPlaying && s.hello < 0.02) {
          s.hello = 0;
          hello.weight = 0;
          if (idle) idle.weight = 1;
        }
      }
    });
  }
}

/**
 * Лес вокруг поляны — всегда один и тот же. Деревья редеют к краю поляны,
 * а перед подиумами растут только по краям кадра, чтобы не заслонять героев.
 */
function clearingTrees(): TreeSpot[] {
  const r = Rng.stream(777, 'select-trees');
  const trees: TreeSpot[] = [];
  const step = 2.7;
  for (let x = -42; x <= 42; x += step) {
    for (let z = -4; z <= 46; z += step) {
      const tx = x + r.range(-1, 1), tz = z + r.range(-1, 1);
      const e = Math.hypot(tx / CLEARING.rx, (tz - CIRCLE.z) / CLEARING.rz);
      if (e < 1 + r.range(0, 0.45)) continue;
      if (tz < 1 && Math.abs(tx) < 15) continue;
      trees.push({ x: tx, z: tz, s: r.range(0.85, 1.25) + Math.min(0.4, (e - 1) * 0.15), yaw: r.range(0, Math.PI * 2), tint: r.int(0, 11) });
    }
  }
  return trees;
}
