// Экран норы: отдельная 3D-сцена — двор у норы под большой сосной, места для вещей
// и панель поверх неё. Двор можно повернуть мышью или пальцем; место выбирается
// кликом по нему, кнопками внизу или Q/E.

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  GlowLayer,
  HemisphericLight,
  MeshBuilder,
  PointerEventTypes,
  PointLight,
  Scene,
  StandardMaterial,
  Vector3,
  type ArcRotateCameraPointersInput,
  type Engine,
  type Mesh,
  type Node,
} from '@babylonjs/core';
import {
  amount,
  boostById,
  BOOSTS,
  CAPACITY,
  costText,
  cropById,
  CROPS,
  itemById,
  itemsFor,
  materialById,
  MATERIALS,
  powerById,
  POWERS,
  slotById,
  SLOTS,
  TIERS,
  type BoostDef,
  type Cost,
  type CropId,
  type ItemDef,
  type PowerDef,
  type SlotDef,
} from '../den/catalog';
import {
  boostCount,
  brew,
  buy,
  buyPower,
  canAfford,
  clearSlot,
  cropCap,
  cropOpen,
  cropReady,
  crystals,
  den,
  growCrops,
  harvestCrops,
  matCount,
  nextTier,
  pack,
  powerLevel,
  shortOf,
  stockOf,
  upgrade,
} from '../den/state';
import { ANNEX, DenKit, MOUND, type Built } from '../den/build';
import { ClearingDecor } from '../den/decor';
import { clearUrl, shareUrl, snapshot, type DenSnapshot } from '../den/snapshot';
import { copyText } from '../share';
import { addShade, gardenShade, growGarden, harvestGarden, journal, SHADES } from '../journal';
import { GrassField } from '../grass';
import { BIOMES, type Biome, type BiomeId } from '../levels/biomes';
import { Forest } from '../levels/forest';
import type { TreeSpot } from '../levels/generator';
import { daysPlayed } from '../levels/progress';
import { FLAT_TERRAIN } from '../levels/terrain';
import { AirParticles } from '../particles';
import { Rng } from '../rng';
import { addShadowCaster, createLightingContext, settings, type LightingContext } from '../settings';
import { byId, clamp, damp, plural } from '../utils';
import { say } from './hud';

/** Поляна у норы, свободная от деревьев. */
const CLEARING_R = 13;
/** Нора: центр холма; большая сосна над ним. */
const HOME_TREE = { x: 0.4, z: 8.6 };
const BASE_ALPHA = -Math.PI / 2;
/** Сад кристаллов: каменное кольцо слева от норы. */
const GARDEN = { x: -3.6, z: 4.2 };
/** Двор — утоптанный эллипс; деталям поляны — кольцо по его краю. */
const YARD = { z: 0.6, rx: 5.2, rz: 4.6 };

interface GardenCrystal { mesh: Mesh; baseY: number; phase: number; shade: BiomeId }

/** Остановки панели, которые не места во дворе: «Сила» — апгрейды запала, «Котелок» — усилители. */
type Page = 'power' | 'kettle';
const PAGES: readonly Page[] = ['power', 'kettle'];
/** Сколько ягод на кусте — одна горсть урожая; соты — по одной. */
const fruitsPer = (id: CropId): number => (id === 'honey' ? 1 : 3);
const isPage = (id: string | undefined): id is Page => PAGES.includes(id as Page);

export interface DenActions {
  onBack: () => void;
  /** Звонок кристалла: покупка, сбор. */
  chime: () => void;
}

export class DenScreen {
  readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly lighting: LightingContext;
  private readonly kit: DenKit;
  private readonly hemi: HemisphericLight;
  private readonly sun: DirectionalLight;
  /** Ночью двор освещён тёплым светом от норы — как кристаллы на уровне. */
  private readonly lamp: PointLight;
  private readonly groundMat: StandardMaterial;
  private readonly yardMat: StandardMaterial;
  private readonly trees = clearingTrees();
  private biome: Biome | null = null;
  private forest: Forest | null = null;
  private grass: GrassField | null = null;
  private particles: AirParticles | null = null;
  private readonly rings = new Map<string, Mesh>();
  private readonly ringOn: StandardMaterial;
  private readonly ringOff: StandardMaterial;
  private readonly built = new Map<string, Built>();
  private readonly root = byId('den');
  private readonly cardEl = byId('den-card');
  private readonly slotsEl = byId('den-slots');
  private shell: Built | null = null;
  private decor: ClearingDecor | null = null;
  private decorCount = -1;
  private garden: GardenCrystal[] = [];
  /** Кусты и улей у той норы, что сейчас во дворе. */
  private readonly crops = new Map<CropId, Built & { fruits: Mesh[] }>();
  private readonly harvestBtn = byId<HTMLButtonElement>('den-harvest');
  private readonly cropsBtn = byId<HTMLButtonElement>('den-crops');
  private readonly shareBtn = byId<HTMLButtonElement>('den-share');
  /** Что сейчас стоит во дворе: своя нора или снимок чужой. */
  private view: DenSnapshot = snapshot(daysPlayed());
  /** В гостях: всё только посмотреть. */
  private guest = false;
  /** Выбранное место; null — сама нора: карточка улучшения, или страница page. */
  private sel: SlotDef | null = null;
  private page: Page | null = null;
  private active = false;
  private t = 0;
  /** Свободная полоса экрана между шапкой и панелью — туда камера ставит двор. */
  private band = { center: 0.4, size: 0.5 };
  private bandDirty = true;

  constructor(engine: Engine, private readonly actions: DenActions) {
    const scene = (this.scene = new Scene(engine));
    this.hemi = new HemisphericLight('dh', new Vector3(0, 1, 0), scene);
    const sun = (this.sun = new DirectionalLight('ds', new Vector3(0.45, -1, 0.55), scene));
    sun.position = new Vector3(-10, 20, -12);
    this.lamp = new PointLight('dl', new Vector3(0, 2.4, 1.6), scene);
    this.lamp.diffuse = new Color3(1, 0.78, 0.4);
    this.lamp.specular = new Color3(0, 0, 0);
    this.lamp.range = 10;

    const cam = (this.camera = new ArcRotateCamera('dc', BASE_ALPHA, 1.08, 14, new Vector3(0, 0.8, 1.8), scene));
    cam.fov = 0.75;
    cam.minZ = 0.1;
    cam.lowerAlphaLimit = BASE_ALPHA - 0.9;
    cam.upperAlphaLimit = BASE_ALPHA + 0.9;
    cam.lowerBetaLimit = 0.75;
    cam.upperBetaLimit = 1.3;
    cam.panningSensibility = 0;
    cam.inputs.removeByType('ArcRotateCameraMouseWheelInput');
    cam.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    const pointers = cam.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
    if (pointers) pointers.pinchZoom = false;

    this.lighting = createLightingContext({ scene, sun, camera: cam, shadowFrustum: 26, fixedMaxZ: 200, fogBase: BIOMES.meadow.fogBase });
    this.lighting.glow = new GlowLayer('dg', scene);
    this.lighting.glow.intensity = 0.6;
    this.kit = new DenKit(scene);

    const mat = (name: string, c: Color3) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = c;
      m.specularColor = new Color3(0, 0, 0);
      return m;
    };
    const ground = MeshBuilder.CreateDisc('dg-ground', { radius: 150, tessellation: 64 }, scene);
    ground.rotation.x = Math.PI / 2;
    ground.material = this.groundMat = mat('dg-gm', new Color3());
    ground.receiveShadows = true;
    ground.isPickable = false;
    const yard = MeshBuilder.CreateDisc('dg-yard', { radius: 1, tessellation: 48 }, scene);
    yard.rotation.x = Math.PI / 2;
    yard.scaling.set(YARD.rx, YARD.rz, 1);
    yard.position.set(0, 0.02, YARD.z);
    yard.material = this.yardMat = mat('dg-pm', new Color3());
    yard.receiveShadows = true;
    yard.isPickable = false;

    // Кольца мест: выбранное светится, как подиум на экране героя
    this.ringOff = mat('dg-ro', new Color3());
    this.ringOn = mat('dg-ri', new Color3(1, 0.8, 0.3));
    this.ringOn.emissiveColor = new Color3(0.9, 0.6, 0.1);
    for (const s of SLOTS) {
      const ring = MeshBuilder.CreateTorus('dg-ring', { diameter: 1.7, thickness: 0.06, tessellation: 40 }, scene);
      ring.position.set(s.x, 0.04, s.z);
      ring.material = this.ringOff;
      ring.metadata = { slot: s.id };
      this.rings.set(s.id, ring);
    }

    this.setBiome(BIOMES.meadow);
    for (const s of SLOTS) this.rebuild(s);
    this.cast(this.kit.gardenBed(GARDEN.x, GARDEN.z));

    scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERTAP || !this.active || this.guest) return;
      const picked = pi.pickInfo?.pickedMesh;
      const g = this.garden.findIndex((c) => c.mesh === picked);
      if (g >= 0) {
        this.harvest(g);
        return;
      }
      let n: Node | null = picked ?? null;
      if ((n?.metadata as { crop?: string } | null)?.crop) {
        this.harvestCrops();
        return;
      }
      while (n && (n.metadata as { slot?: string } | null)?.slot === undefined) n = n.parent;
      const id = (n?.metadata as { slot?: string } | null)?.slot;
      if (id === 'home') this.choose(null);
      else if (id) this.choose(slotById(id) ?? null);
    });
    scene.onBeforeRenderObservable.add(() => this.animate(Math.min(engine.getDeltaTime() / 1000, 0.05)));
    window.addEventListener('resize', () => (this.bandDirty = true));

    byId('den-back').addEventListener('click', () => actions.onBack());
    this.harvestBtn.addEventListener('click', () => {
      if (this.garden.length) this.harvest(0);
    });
    this.cropsBtn.addEventListener('click', () => this.harvestCrops());
    this.shareBtn.addEventListener('click', () => void this.share());
    byId('den-own').addEventListener('click', () => this.open());
    this.slotsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      if (b) this.chooseKey(b.dataset.slot!);
    });
    this.cardEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.item) this.take(itemById(b.dataset.item)!);
      else if (b.dataset.power) this.buyPower(powerById(b.dataset.power)!);
      else if (b.dataset.brew) this.brew(boostById(b.dataset.brew)!);
      else if (b.dataset.pack !== undefined) {
        pack(boostById(b.dataset.pack)?.id ?? null);
        this.render(`pack-${b.dataset.pack}`);
      }
      else if (b.dataset.upgrade !== undefined) this.upgrade();
      else if (b.dataset.clear && this.sel) {
        clearSlot(this.sel.id);
        this.view = snapshot(daysPlayed());
        this.rebuild(this.sel);
        this.render(b.dataset.clear);
      }
    });
  }

  /**
   * Одеть двор в биом уровня: небо, свет, земля, дёрн на норе, лес, трава и частицы.
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
    this.lamp.intensity = b.crystalLights ? 1.8 : 0;
    this.groundMat.diffuseColor = b.ground.clone();
    this.yardMat.diffuseColor = b.path.clone();
    this.ringOff.diffuseColor = b.stone.scale(0.8);

    this.shell?.root.dispose();
    this.shell = this.buildShell();
    this.forest?.dispose();
    this.forest = new Forest(scene, this.lighting, { trees: this.trees, biome: b, terrain: FLAT_TERRAIN });
    this.particles?.dispose();
    this.particles = b.particles ? new AirParticles(scene, b.particles) : null;
    this.grass?.dispose();
    this.grass = new GrassField(scene, {
      area: {
        // Трава уходит и под лес вокруг поляны, в глубине редеет
        minX: -28, maxX: 28, minZ: -8, maxZ: 30,
        circles: [
          { x: MOUND.x, z: MOUND.z, r: MOUND.r + 0.1 },
          { x: ANNEX.x, z: ANNEX.z, r: ANNEX.r + 0.1 },
          { x: GARDEN.x, z: GARDEN.z, r: 1.1 },
          ...CROPS.map((c) => ({ x: c.x, z: c.z, r: 0.8 })),
          ...SLOTS.map((s) => ({ x: s.x, z: s.z, r: 1 })),
          ...this.trees.filter((t) => Math.abs(t.x) < 29 && t.z < 31).map((t) => ({ x: t.x, z: t.z, r: 0.45 * t.s })),
        ],
        coverage: (x, z) =>
          clamp((Math.hypot(x / YARD.rx, (z - YARD.z) / YARD.rz) - 1.05) * 3, 0.1, 1) *
          (1 - clamp((Math.hypot(x, z - 2) - CLEARING_R) / 16, 0, 1) * 0.6),
      },
      baseColor: b.grass.root,
      tipColor: b.grass.tip,
      densityScale: b.grass.density,
      glow: this.lighting.glow,
      fixedDistance: 40,
      seed: 4242,
    });
  }

  /**
   * Открыть свою нору или, с guest, чужую в гостях: камера слушает мышь и пальцы,
   * двор перестраивается под то, что в нём стоит.
   */
  open(guest: DenSnapshot | null = null): void {
    if (!guest) clearUrl();
    this.active = true;
    this.guest = guest !== null;
    this.root.classList.toggle('guest', this.guest);
    this.bandDirty = true;
    this.camera.attachControl(true);
    this.sel = null;
    this.page = null;
    this.show(guest ?? snapshot(daysPlayed()));
    if (!this.guest) this.grow();
    this.render();
    (this.guest ? byId('den-own') : this.slotsEl.querySelector<HTMLElement>('[aria-pressed="true"]'))?.focus();
  }

  close(): void {
    this.active = false;
    this.camera.detachControl();
    if (this.guest) clearUrl();
  }

  /** Перестроить двор под снимок: нору, вещи по местам и поляну — только то, что поменялось. */
  private show(view: DenSnapshot): void {
    const was = this.view;
    this.view = view;
    if (was.tier !== view.tier) {
      this.shell?.root.dispose();
      this.shell = this.buildShell();
    }
    this.syncCrops();
    for (const s of SLOTS) if (was.slots[s.id] !== view.slots[s.id]) this.rebuild(s);
    if (view.days !== this.decorCount) {
      this.decor?.dispose();
      this.decor = new ClearingDecor(this.scene, { x: 0, z: YARD.z, r: 4.8, free: (x, z) => this.free(x, z) }, view.days);
      this.decorCount = view.days;
    }
    // Чужой сад не собрать — в гостях грядка пустая
    for (const c of this.garden) c.mesh.setEnabled(!this.guest);
  }

  /** Ссылка на свою нору — в буфер обмена; отклик на самой кнопке. */
  private async share(): Promise<void> {
    const ok = await copyText(shareUrl(snapshot(daysPlayed())));
    this.shareBtn.textContent = ok ? 'Ссылка скопирована ✓' : 'Не удалось скопировать';
    setTimeout(() => (this.shareBtn.textContent = 'Позвать в гости ⧉'), 2500);
  }

  /** Место открыто в той норе, что сейчас во дворе. */
  private isOpen(s: SlotDef): boolean {
    return s.tier <= this.view.tier;
  }

  /** Q/E — соседнее место, Esc — в меню. */
  handleKey(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      e.preventDefault();
      this.actions.onBack();
    } else if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat) {
      this.cycle(e.code === 'KeyQ' ? -1 : 1);
    }
  }

  /** Соседняя остановка по кругу: нора, сила, потом открытые места. */
  cycle(delta: number): void {
    if (this.guest) return;
    const list = ['home', ...PAGES, ...SLOTS.filter((s) => this.isOpen(s)).map((s) => s.id)];
    const i = list.indexOf(this.key);
    this.chooseKey(list[(i + delta + list.length) % list.length], true);
  }

  /** Что выбрано: 'home', страница или id места — как data-slot у кнопок. */
  private get key(): string {
    return this.page ?? this.sel?.id ?? 'home';
  }

  private chooseKey(key: string, focus = false): void {
    if (isPage(key)) {
      this.sel = null;
      this.page = key;
      this.render();
      if (focus) this.slotsEl.querySelector<HTMLElement>(`[data-slot="${key}"]`)?.focus();
    } else {
      this.choose(slotById(key) ?? null, focus);
    }
  }

  private choose(s: SlotDef | null, focus = false): void {
    this.sel = s && this.isOpen(s) ? s : null;
    this.page = null;
    this.render();
    if (focus) this.slotsEl.querySelector<HTMLElement>(`[data-slot="${this.key}"]`)?.focus();
  }

  private buildShell(): Built {
    const g = this.biome!.ground;
    const b = this.kit.shell(this.view.tier, [g.r, g.g, g.b]);
    for (const m of b.meshes) m.metadata = { slot: 'home' };
    this.cast(b);
    return b;
  }

  /** Нора дорастает до следующего уровня: новый вид и новые места во дворе. */
  private upgrade(): void {
    const next = nextTier();
    if (!next) return;
    if (!upgrade()) {
      this.lacking(next.cost);
      return;
    }
    this.show(snapshot(daysPlayed()));
    this.actions.chime();
    const opened = SLOTS.filter((s) => s.tier === den.tier).map((s) => `«${s.name}»`);
    say(`${next.name}!${opened.length ? ` Во дворе открылось: ${opened.join(', ')}` : ''}`, 3500);
    this.render();
    this.slotsEl.querySelector<HTMLElement>('[data-slot="home"]')?.focus();
  }

  /** Подсказка, чего не хватает и где это искать: материалы лежат на уровнях своего биома. */
  private lacking(cost: Cost): void {
    const lack = shortOf(cost);
    const where = Object.entries(cost.mats ?? {})
      .map(([id, n]) => ({ m: materialById(id)!, n }))
      .filter(({ m, n }) => matCount(m.id) < n)
      .map(({ m }) => `${m.name} лежат в биоме «${BIOMES[m.biome].name}»`);
    for (const [id, n] of Object.entries(cost.crops ?? {})) {
      const c = cropById(id)!;
      if (stockOf(c.id) >= n) continue;
      where.push(cropOpen(c) ? `${c.name} растёт во дворе — собери урожай` : `${c.source} появится у норы «${TIERS[c.tier].name}»`);
    }
    say(`Не хватает: ${lack.join(', ')}${where.length ? `. ${where.join('. ')}` : ''}`, 3500);
  }

  /** Сад и урожай догоняют время: что выросло, пока игрока не было. */
  private grow(): void {
    const ready = growGarden();
    while (this.garden.length < ready) this.plant();
    this.syncHarvest();
    growCrops();
    this.syncCrops();
  }

  /**
   * Кусты и улей — по уровню норы во дворе; ягод на них столько, сколько созрело.
   * В гостях кусты видны, но пустые: чужой урожай не собрать.
   */
  private syncCrops(): void {
    let ready = 0;
    for (const c of CROPS) {
      const open = c.tier <= this.view.tier;
      let b = this.crops.get(c.id);
      if (!open) {
        b?.root.dispose();
        this.crops.delete(c.id);
        continue;
      }
      if (!b) {
        b = this.kit.crop(c.id, c.color, 4);
        b.root.position.set(c.x, 0, c.z);
        b.root.rotation.y = c.x < 0 ? 0.3 : -0.3;
        for (const m of b.meshes) m.metadata = { crop: c.id };
        this.cast(b);
        this.crops.set(c.id, b);
      }
      const n = this.guest ? 0 : cropReady(c.id);
      ready += n;
      const shown = n * fruitsPer(c.id);
      b.fruits.forEach((f, k) => f.setEnabled(k < shown));
    }
    this.cropsBtn.hidden = this.guest || ready === 0;
    this.cropsBtn.textContent = `Собрать урожай · ${ready}`;
  }

  /** Собрать весь урожай с кустов и улья. */
  private harvestCrops(): void {
    if (this.guest) return;
    const got = Object.entries(harvestCrops()).map(([id, n]) => amount(cropById(id)!, n));
    if (!got.length) {
      const growing = CROPS.filter(cropOpen).map((c) => c.source.toLowerCase());
      say(`Урожай ещё растёт: ${growing.join(', ')} — по одному за пару часов, до ${cropCap()}`, 2500);
      return;
    }
    this.actions.chime();
    say(`Урожай: ${got.join(', ')} — из него варят усилители в «Котелке»`, 3000);
    this.syncCrops();
    this.render();
  }

  /** Сварить усилитель в котелке. */
  private brew(b: BoostDef): void {
    if (!brew(b)) {
      this.lacking(b.cost);
      return;
    }
    this.actions.chime();
    say(den.packed === b.id ? `${b.name} — возьмётся с собой на следующий уровень` : `${b.name} сварен`, 2500);
    this.render(b.id);
  }

  /** Деталь поляны не встаёт на нору, сад и места вещей. */
  private free(x: number, z: number): boolean {
    return (
      Math.hypot(x - MOUND.x, z - MOUND.z) > MOUND.r + 0.3 &&
      Math.hypot(x - GARDEN.x, z - GARDEN.z) > 1.4 &&
      Math.hypot(x - ANNEX.x, z - ANNEX.z) > ANNEX.r + 0.3 &&
      CROPS.every((c) => Math.hypot(x - c.x, z - c.z) > 1.3) &&
      SLOTS.every((s) => Math.hypot(x - s.x, z - s.z) > 1.3)
    );
  }

  /** Новый кристалл в саду: оттенок — чаще из ещё не найденных. */
  private plant(): void {
    const k = this.garden.length;
    const shade = gardenShade();
    const color = new Color3(...SHADES[shade].color);
    const m = MeshBuilder.CreatePolyhedron('den-garden', { type: 1, size: 0.26 }, this.scene);
    m.scaling.set(1.15, 1.9, 1.15);
    const a = 0.6 + k * ((Math.PI * 2) / 3);
    const y = 0.85;
    m.position.set(GARDEN.x + Math.cos(a) * 0.42, y, GARDEN.z + Math.sin(a) * 0.42);
    m.material = this.kit.mat([color.r, color.g, color.b], 0.75);
    addShadowCaster(this.lighting, m);
    this.garden.push({ mesh: m, baseY: y, phase: k * 2.1, shade });
  }

  /** Кристалл из сада собран: оттенок в коллекцию «Дневника», сад пустеет на один. */
  private harvest(i: number): void {
    const [c] = this.garden.splice(i, 1);
    c.mesh.dispose();
    harvestGarden();
    const n = addShade(c.shade);
    journal.stats.crystals++;
    this.actions.chime();
    const name = SHADES[c.shade].name;
    say(n === 1 ? `Кристалл из сада — новый оттенок «${name}»!` : `Кристалл из сада: «${name}» · ×${n}`, 2500);
    this.syncHarvest();
    this.render();
  }

  private syncHarvest(): void {
    const n = this.garden.length;
    this.harvestBtn.hidden = n === 0;
    this.harvestBtn.textContent = `Собрать сад · ${n} ${plural(n, 'кристалл', 'кристалла', 'кристаллов')}`;
  }

  /** Купить или поставить вещь в выбранное место. */
  private take(item: ItemDef): void {
    const owned = den.owned.includes(item.id);
    if (!buy(item)) {
      this.lacking(item.cost);
      return;
    }
    this.view = snapshot(daysPlayed());
    this.rebuild(slotById(item.slot)!);
    if (!owned) {
      this.actions.chime();
      say(`${item.name} — теперь у норы`);
    }
    this.render(item.id);
  }

  /** Купить следующую ступень апгрейда запала. */
  private buyPower(p: PowerDef): void {
    const step = p.steps[powerLevel(p.id)];
    if (!step) return;
    if (den.tier < p.tier) {
      say(`Откроется, когда нора станет «${TIERS[p.tier].name}»`, 2500);
      return;
    }
    if (!buyPower(p)) {
      this.lacking(step.cost);
      return;
    }
    this.actions.chime();
    say(`${p.name}: ${step.desc[0].toLowerCase()}${step.desc.slice(1)}`, 2500);
    this.render(p.id);
  }

  /** Пересобрать вещь в месте s по сохранению. */
  private rebuild(s: SlotDef): void {
    this.built.get(s.id)?.root.dispose();
    this.built.delete(s.id);
    const id = this.view.slots[s.id];
    if (!id) return;
    const b = this.kit.item(id);
    b.root.position.set(s.x, 0, s.z);
    b.root.rotation.y = s.yaw;
    for (const m of b.meshes) m.metadata = { slot: s.id };
    this.cast(b);
    this.built.set(s.id, b);
  }

  private cast(b: Built): void {
    for (const m of b.meshes) addShadowCaster(this.lighting, m);
  }

  /** Шапка, места и карточка выбранного места; focusId — вернуть фокус на эту кнопку. */
  private render(focusId?: string): void {
    byId('den-wallet').innerHTML =
      `<span class="den-chip" title="Кристаллы">✦ ${crystals()}</span>` +
      MATERIALS.map((m) => {
        const n = matCount(m.id);
        const [r, g, b] = m.color.map((v) => Math.round(v * 255));
        return `<span class="den-chip${n ? '' : ' zero'}" title="${m.name} — в биоме «${BIOMES[m.biome].name}»"><i style="--c:rgb(${r} ${g} ${b})"></i>${m.name} <b>${n}</b></span>`;
      }).join('') +
      // Урожай на руках — только то, что есть: шапка норы и так в три строки
      CROPS.filter((c) => !this.guest && stockOf(c.id) > 0)
        .map((c) => {
          const n = stockOf(c.id);
          const [r, g, b] = c.color.map((v) => Math.round(v * 255));
          return `<span class="den-chip" title="${c.source} во дворе"><i style="--c:rgb(${r} ${g} ${b})"></i>${c.name} <b>${n}</b></span>`;
        })
        .join('');
    byId('den-title').textContent = TIERS[this.view.tier].name;
    byId('den-eyebrow').textContent = this.guest ? 'В гостях' : 'Нора';
    for (const [id, ring] of this.rings) {
      ring.setEnabled(!this.guest && this.isOpen(slotById(id)!));
      ring.material = id === this.sel?.id ? this.ringOn : this.ringOff;
    }
    if (this.guest) {
      this.renderGuest();
      this.bandDirty = true;
      return;
    }
    const next = nextTier();
    const open = SLOTS.filter((s) => this.isOpen(s));
    this.slotsEl.innerHTML =
      `<button type="button" data-slot="home" aria-pressed="${this.key === 'home'}"><b>Нора</b><small>${next ? 'улучшить' : 'самая большая'}</small></button>` +
      `<button type="button" data-slot="power" aria-pressed="${this.page === 'power'}"><b>Сила</b><small>запал ${CAPACITY[powerLevel('cap')]}</small></button>` +
      `<button type="button" data-slot="kettle" aria-pressed="${this.page === 'kettle'}"><b>Котелок</b><small>${
        den.packed ? `с собой: ${boostById(den.packed)!.short}` : 'усилители'
      }</small></button>` +
      open
        .map((s) => {
          const item = den.slots[s.id] && itemById(den.slots[s.id]!);
          return `<button type="button" data-slot="${s.id}" aria-pressed="${s === this.sel}"><b>${s.name}</b><small>${item ? item.name : 'пусто'}</small></button>`;
        })
        .join('');
    if (this.page === 'power') {
      this.renderPower();
      if (focusId) this.root.querySelector<HTMLElement>(`[data-power="${focusId}"]`)?.focus();
      this.bandDirty = true;
      return;
    }
    if (this.page === 'kettle') {
      this.renderKettle();
      if (focusId) this.root.querySelector<HTMLElement>(`[data-brew="${focusId}"], [data-pack="${focusId.replace('pack-', '')}"]`)?.focus();
      this.bandDirty = true;
      return;
    }
    if (!this.sel) {
      this.renderHome();
      if (focusId) this.root.querySelector<HTMLElement>('[data-upgrade]')?.focus();
      this.bandDirty = true;
      return;
    }

    const placed = den.slots[this.sel.id];
    const rows = itemsFor(this.sel.id).map((item) => {
      const owned = den.owned.includes(item.id);
      const here = placed === item.id;
      const state = here ? 'стоит' : owned ? 'поставить' : costText(item.cost);
      const off = !owned && !canAfford(item.cost);
      return `<button type="button" class="den-item${here ? ' on' : ''}${off ? ' off' : ''}" data-item="${item.id}" aria-pressed="${here}">
        <span><b>${item.name}</b><small>${item.desc}</small></span><em>${state}</em></button>`;
    });
    this.cardEl.innerHTML = `<div class="den-card-head"><h3>${this.sel.name}</h3>${
      placed ? `<button type="button" class="link" data-clear="${this.sel.id}">убрать</button>` : ''
    }</div><div class="den-items">${rows.join('')}</div>`;
    if (focusId) this.root.querySelector<HTMLElement>(`[data-item="${focusId}"], [data-clear]`)?.focus();
    this.bandDirty = true;
  }

  /** В гостях: что стоит во дворе у друга. */
  private renderGuest(): void {
    const items = SLOTS.map((s) => this.view.slots[s.id] && itemById(this.view.slots[s.id]!)?.name.toLowerCase()).filter(Boolean);
    const days = this.view.days;
    this.cardEl.innerHTML = `<div class="den-card-head"><h3>Нора друга</h3></div>
      <p>${items.length ? `Во дворе: ${items.join(', ')}.` : 'Двор пока пустой — нора только обживается.'}${
        days ? ` Поляна вокруг росла ${days} ${plural(days, 'день', 'дня', 'дней')}.` : ''
      }</p><p>Свою нору можно обустроить за кристаллы и находки с уровней.</p>`;
  }

  /** «Сила»: апгрейды запала — следующая ступень каждого и её цена. */
  private renderPower(): void {
    const rows = POWERS.map((p) => {
      const n = powerLevel(p.id);
      const step = p.steps[n];
      const steps = p.steps.length > 1 ? ` · ${n} из ${p.steps.length}` : '';
      if (!step) {
        return `<div class="den-item den-tier on"><span><b>${p.name}${steps}</b><small>${p.steps[n - 1].desc}</small></span><em>есть</em></div>`;
      }
      const locked = den.tier < p.tier;
      const off = locked || !canAfford(step.cost);
      const price = locked ? `<i>нора: «${TIERS[p.tier].name}»</i>` : priceHtml(step.cost);
      return `<button type="button" class="den-item den-tier${off ? ' off' : ''}" data-power="${p.id}"><span><b>${p.name}${steps}</b><small>${step.desc}</small></span><em>${price}</em></button>`;
    });
    this.cardEl.innerHTML = `<div class="den-card-head"><h3>Сила</h3></div>
      <p>Запал тратится на рывок и высокий прыжок. Апгрейды работают на всех уровнях, кроме Леса дня — там у всех одинаково.</p>
      <div class="den-items">${rows.join('')}</div>`;
  }

  /**
   * «Котелок»: усилители на один уровень — варятся из урожая и находок.
   * Один из сваренных берётся с собой и тратится, когда начнётся следующий уровень.
   */
  private renderKettle(): void {
    const rows = BOOSTS.map((b) => {
      const n = boostCount(b.id);
      const off = !canAfford(b.cost);
      return `<button type="button" class="den-item den-tier${off ? ' off' : ''}" data-brew="${b.id}"><span><b>${b.name}${n ? ` · ${n}` : ''}</b><small>${b.desc}</small></span><em>${priceHtml(b.cost)}</em></button>`;
    });
    const owned = BOOSTS.filter((b) => boostCount(b.id) > 0);
    const chip = (id: string, label: string, on: boolean) =>
      `<button type="button" class="den-pack${on ? ' on' : ''}" data-pack="${id}" aria-pressed="${on}">${label}</button>`;
    const packRow = owned.length
      ? `<div class="den-packs"><span>С собой на уровень:</span>${chip('', 'ничего', !den.packed)}${owned.map((b) => chip(b.id, b.name, den.packed === b.id)).join('')}</div>`
      : '';
    this.cardEl.innerHTML = `<div class="den-card-head"><h3>Котелок</h3></div>
      <p>Усилитель действует один уровень: взятый с собой тратится, когда уровень начнётся. В Лесу дня усилители не действуют.</p>
      ${packRow}<div class="den-items">${rows.join('')}</div>`;
  }

  /** Карточка самой норы: каким будет следующий уровень и что он стоит. */
  private renderHome(): void {
    const next = nextTier();
    const cur = TIERS[den.tier];
    if (!next) {
      this.cardEl.innerHTML = `<div class="den-card-head"><h3>${cur.name}</h3></div><p>${cur.desc}. Нора выросла целиком — осталось обставить двор.</p>`;
      return;
    }
    const opens = SLOTS.filter((s) => s.tier === den.tier + 1).map((s) => s.name.toLowerCase());
    const off = !canAfford(next.cost);
    this.cardEl.innerHTML = `<div class="den-card-head"><h3>Нора · ${den.tier + 1} из ${TIERS.length}</h3></div>
      <div class="den-items"><button type="button" class="den-item den-tier${off ? ' off' : ''}" data-upgrade>
        <span><b>${next.name}</b><small>${next.desc}${opens.length ? ` · новые места: ${opens.join(', ')}` : ''}</small></span><em>${priceHtml(next.cost)}</em></button></div>`;
  }

  private measureBand(): void {
    const top = this.root.querySelector('.den-head')!.getBoundingClientRect().bottom;
    const bottom = this.root.querySelector('.den-bottom')!.getBoundingClientRect().top;
    const h = window.innerHeight;
    if (!h || bottom <= top) return;
    this.band = { center: (top + bottom) / 2 / h, size: (bottom - top) / h };
    this.bandDirty = false;
  }

  /**
   * Камера держит двор в свободной полосе экрана: отъезжает, чтобы он влез по ширине
   * и высоте, и слегка тянется к выбранному месту.
   */
  private animate(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    if (this.bandDirty) this.measureBand();
    const cam = this.camera;
    const aspect = this.scene.getEngine().getAspectRatio(cam);
    const tanHalf = Math.tan(cam.fov / 2);
    const byWidth = 6.5 / (tanHalf * aspect);
    const byHeight = 4.2 / (tanHalf * Math.max(0.25, this.band.size));
    const dist = clamp(Math.max(byWidth, byHeight), 11, 34);
    cam.radius += (dist - cam.radius) * damp(4, dt);
    const focus = this.sel ?? { x: 0, z: this.page ? 4.5 : 3.5 };
    const tx = focus.x * 0.3, tz = 1.8 + (focus.z - 1.8) * 0.25;
    cam.target.x += (tx - cam.target.x) * damp(3, dt);
    cam.target.z += (tz - cam.target.z) * damp(3, dt);
    // Середина двора — в середине свободной полосы
    cam.targetScreenOffset.y = (1 - 2 * this.band.center) * tanHalf * cam.radius;

    this.forest?.update(dt);
    this.grass?.update(cam.position, null, 0);
    this.particles?.follow(cam.position);
    for (const b of this.built.values()) b.tick?.(this.t);
    this.decor?.update(dt);
    for (const c of this.garden) {
      c.phase += dt;
      c.mesh.rotation.y += dt * 1.5;
      c.mesh.position.y = c.baseY + Math.sin(c.phase * 2) * 0.1;
    }
  }
}

/** Цена столбиком: кристаллы и каждый материал — своей строкой. */
function priceHtml(cost: Cost): string {
  return costText(cost)
    .split(' · ')
    .map((p) => `<i>${p}</i>`)
    .join('');
}

/** Лес кольцом вокруг поляны и большая сосна над норой. */
function clearingTrees(): TreeSpot[] {
  const r = Rng.stream(4242, 'den-trees');
  const trees: TreeSpot[] = [{ x: HOME_TREE.x, z: HOME_TREE.z, s: 2.3, yaw: 0.6, tint: 1 }];
  const step = 2.8;
  for (let x = -40; x <= 40; x += step) {
    for (let z = -20; z <= 44; z += step) {
      const tx = x + r.range(-1, 1), tz = z + r.range(-1, 1);
      const d = Math.hypot(tx, tz - 2);
      if (d < CLEARING_R + r.range(0, 4)) continue;
      // Перед камерой леса нет, чтобы он не заслонял двор
      if (tz < -4 && Math.abs(tx) < 16) continue;
      trees.push({ x: tx, z: tz, s: r.range(0.85, 1.25) + Math.min(0.4, (d - CLEARING_R) * 0.03), yaw: r.range(0, Math.PI * 2), tint: r.int(0, 11) });
    }
  }
  return trees;
}
