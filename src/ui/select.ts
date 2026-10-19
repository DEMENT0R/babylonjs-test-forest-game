// Экран выбора героя: отдельная 3D-сцена с тремя подиумами и карточки героев поверх неё.

import {
  Color3,
  Color4,
  DirectionalLight,
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
import { GrassField, MEADOW_GROUND, MEADOW_TIP } from '../grass';
import { applyCoat, chooseCoat, coatFor, COATS, HEROES, loadHero, openCoats, type Hero, type HeroDef } from '../heroes';
import { totalStars } from '../levels/progress';
import { addShadowCaster, createLightingContext, type LightingContext } from '../settings';
import { byId, damp, now, wrapAngle } from '../utils';

const SLOT_X = [-3.4, 0, 3.4];
const CAM_Z = -9;
/** Наклон камеры вниз, как на широком экране: камера на 1.4 выше героя и в 9 позади. */
const PITCH = Math.atan2(1.4, 9);
/** Высота кадра «герой на подиуме» и какую долю свободной полосы экрана он занимает.
    Общая для всех героев, чтобы камера не дёргалась вперёд-назад при выборе. */
const FRAME_H = 2;
const FILL = 0.5;
const SKY = new Color3(0.55, 0.72, 0.78);
/** Закрытый герой стоит на подиуме тёмным силуэтом. */
const SILHOUETTE = new Color3(0.03, 0.04, 0.05);

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
  private readonly grass: GrassField;
  private readonly slots: Slot[];
  private readonly ringOn: StandardMaterial;
  private readonly ringOff: StandardMaterial;
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
    scene.clearColor = Color4.FromColor3(SKY, 1);
    scene.fogColor = SKY.clone();

    const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.25, 0.3, 0.25);
    const sun = new DirectionalLight('s', new Vector3(-0.4, -1, 0.6), scene);
    sun.position = new Vector3(8, 20, -12);
    sun.intensity = 1.05;
    sun.diffuse = new Color3(1, 0.95, 0.85);

    this.camera = new UniversalCamera('sc', new Vector3(0, 2.4, CAM_Z), scene);
    this.camera.inputs.clear();
    this.camera.fov = 0.75;
    this.camera.minZ = 0.1;

    this.lighting = createLightingContext({ scene, sun, camera: this.camera, shadowFrustum: 16, fogBase: 1.2, fixedMaxZ: 200 });
    this.lighting.glow = new GlowLayer('sg', scene);
    this.lighting.glow.intensity = 0.5;

    const mat = (name: string, c: Color3) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = c;
      m.specularColor = new Color3(0, 0, 0);
      return m;
    };
    const ground = MeshBuilder.CreateDisc('g', { radius: 60, tessellation: 64 }, scene);
    ground.rotation.x = Math.PI / 2;
    ground.material = mat('gm', MEADOW_GROUND);
    ground.receiveShadows = true;
    ground.isPickable = false;

    const podStone = mat('ps', new Color3(0.62, 0.6, 0.56));
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

    // Лужайка вокруг подиумов
    this.grass = new GrassField(scene, {
      area: {
        minX: -16, maxX: 16, minZ: -2.5, maxZ: 18,
        circles: SLOT_X.map((x) => ({ x, z: 0, r: 1.3 })),
      },
      baseColor: MEADOW_GROUND.scale(0.55),
      tipColor: MEADOW_TIP,
      glow: this.lighting.glow,
      fixedDistance: 40,
      seed: 777,
    });

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
      mat?.albedoColor?.copyFrom(SILHOUETTE);
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
    this.grass.update(cam.position, null, 0);

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
