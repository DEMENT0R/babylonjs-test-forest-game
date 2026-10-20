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
  Scene,
  StandardMaterial,
  Vector3,
  type ArcRotateCameraPointersInput,
  type Engine,
  type Mesh,
  type Node,
} from '@babylonjs/core';
import { itemById, itemsFor, SLOTS, type ItemDef, type SlotDef } from '../den/catalog';
import { buy, canAfford, clearSlot, crystals, den, shortOf } from '../den/state';
import { DenKit, type Built } from '../den/build';
import { GrassField } from '../grass';
import { BIOMES } from '../levels/biomes';
import { Forest } from '../levels/forest';
import type { TreeSpot } from '../levels/generator';
import { FLAT_TERRAIN } from '../levels/terrain';
import { Rng } from '../rng';
import { addShadowCaster, createLightingContext, type LightingContext } from '../settings';
import { byId, clamp, damp } from '../utils';
import { say } from './hud';

/** Поляна у норы, свободная от деревьев. */
const CLEARING_R = 13;
/** Нора: центр холма; большая сосна над ним. */
const HOME_TREE = { x: 0.4, z: 8.6 };
const BASE_ALPHA = -Math.PI / 2;

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
  private readonly forest: Forest;
  private readonly grass: GrassField;
  private readonly rings = new Map<string, Mesh>();
  private readonly ringOn: StandardMaterial;
  private readonly ringOff: StandardMaterial;
  private readonly built = new Map<string, Built>();
  private readonly root = byId('den');
  private readonly cardEl = byId('den-card');
  private readonly slotsEl = byId('den-slots');
  private shell: Built;
  private slot: SlotDef = SLOTS[0];
  private active = false;
  private t = 0;
  /** Свободная полоса экрана между шапкой и панелью — туда камера ставит двор. */
  private band = { center: 0.4, size: 0.5 };
  private bandDirty = true;

  constructor(engine: Engine, private readonly actions: DenActions) {
    const scene = (this.scene = new Scene(engine));
    const b = BIOMES.meadow;
    scene.clearColor = Color4.FromColor3(b.sky, 1);
    scene.fogColor = b.sky.clone();

    const hemi = new HemisphericLight('dh', new Vector3(0, 1, 0), scene);
    hemi.intensity = b.hemi.intensity;
    hemi.groundColor = b.hemi.ground.clone();
    const sun = new DirectionalLight('ds', new Vector3(0.45, -1, 0.55), scene);
    sun.position = new Vector3(-10, 20, -12);
    sun.diffuse = b.sun.color.clone();
    sun.intensity = b.sun.intensity;

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

    this.lighting = createLightingContext({ scene, sun, camera: cam, shadowFrustum: 26, fixedMaxZ: 200, fogBase: b.fogBase });
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
    ground.material = mat('dg-gm', b.ground.clone());
    ground.receiveShadows = true;
    ground.isPickable = false;
    const yard = MeshBuilder.CreateDisc('dg-yard', { radius: 1, tessellation: 48 }, scene);
    yard.rotation.x = Math.PI / 2;
    yard.scaling.set(5.2, 4.6, 1);
    yard.position.set(0, 0.02, 0.6);
    yard.material = mat('dg-pm', b.path.clone());
    yard.receiveShadows = true;
    yard.isPickable = false;

    // Кольца мест: выбранное светится, как подиум на экране героя
    this.ringOff = mat('dg-ro', b.stone.scale(0.8));
    this.ringOn = mat('dg-ri', new Color3(1, 0.8, 0.3));
    this.ringOn.emissiveColor = new Color3(0.9, 0.6, 0.1);
    for (const s of SLOTS) {
      const ring = MeshBuilder.CreateTorus('dg-ring', { diameter: 1.7, thickness: 0.06, tessellation: 40 }, scene);
      ring.position.set(s.x, 0.04, s.z);
      ring.material = this.ringOff;
      ring.metadata = { slot: s.id };
      this.rings.set(s.id, ring);
    }

    this.shell = this.kit.shell();
    this.cast(this.shell);
    const trees = clearingTrees();
    this.forest = new Forest(scene, this.lighting, { trees, biome: b, terrain: FLAT_TERRAIN });
    this.grass = new GrassField(scene, {
      area: {
        minX: -16, maxX: 16, minZ: -8, maxZ: 16,
        circles: [
          { x: 0, z: 5.6, r: 2.8 },
          ...SLOTS.map((s) => ({ x: s.x, z: s.z, r: 0.9 })),
          ...trees.filter((t) => Math.abs(t.x) < 17 && t.z < 17).map((t) => ({ x: t.x, z: t.z, r: 0.45 * t.s })),
        ],
        coverage: (x, z) => clamp((Math.hypot(x / 5.2, (z - 0.6) / 4.6) - 0.85) * 3, 0.1, 1),
      },
      baseColor: b.grass.root,
      tipColor: b.grass.tip,
      densityScale: b.grass.density,
      glow: this.lighting.glow,
      fixedDistance: 40,
      seed: 4242,
    });
    for (const s of SLOTS) this.rebuild(s);

    scene.onPointerObservable.add((pi) => {
      if (pi.type !== PointerEventTypes.POINTERTAP || !this.active) return;
      let n: Node | null = pi.pickInfo?.pickedMesh ?? null;
      while (n && (n.metadata as { slot?: string } | null)?.slot === undefined) n = n.parent;
      const id = (n?.metadata as { slot?: string } | null)?.slot;
      const s = SLOTS.find((x) => x.id === id);
      if (s) this.choose(s);
    });
    scene.onBeforeRenderObservable.add(() => this.animate(Math.min(engine.getDeltaTime() / 1000, 0.05)));
    window.addEventListener('resize', () => (this.bandDirty = true));

    byId('den-back').addEventListener('click', () => actions.onBack());
    this.slotsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
      const s = b && SLOTS.find((x) => x.id === b.dataset.slot);
      if (s) this.choose(s);
    });
    this.cardEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.item) this.take(itemById(b.dataset.item)!);
      else if (b.dataset.clear) {
        clearSlot(this.slot.id);
        this.rebuild(this.slot);
        this.render(b.dataset.clear);
      }
    });
  }

  /** Открыть нору: камера слушает мышь и пальцы, панель — свежая. */
  open(): void {
    this.active = true;
    this.bandDirty = true;
    this.camera.attachControl(true);
    this.render();
    this.slotsEl.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }

  close(): void {
    this.active = false;
    this.camera.detachControl();
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

  cycle(delta: number): void {
    const i = SLOTS.indexOf(this.slot);
    this.choose(SLOTS[(i + delta + SLOTS.length) % SLOTS.length], true);
  }

  private choose(s: SlotDef, focus = false): void {
    this.slot = s;
    this.render();
    if (focus) this.slotsEl.querySelector<HTMLElement>(`[data-slot="${s.id}"]`)?.focus();
  }

  /** Купить или поставить вещь в выбранное место. */
  private take(item: ItemDef): void {
    const owned = den.owned.includes(item.id);
    if (!buy(item)) {
      say(`Не хватает ✦ ${shortOf(item.cost)}`);
      return;
    }
    this.rebuild(this.slot);
    if (!owned) {
      this.actions.chime();
      say(`${item.name} — теперь у норы`);
    }
    this.render(item.id);
  }

  /** Пересобрать вещь в месте s по сохранению. */
  private rebuild(s: SlotDef): void {
    this.built.get(s.id)?.root.dispose();
    this.built.delete(s.id);
    const id = den.slots[s.id];
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
    byId('den-wallet').innerHTML = `<span class="den-chip">✦ ${crystals()}</span>`;
    this.slotsEl.innerHTML = SLOTS.map((s) => {
      const item = den.slots[s.id] && itemById(den.slots[s.id]!);
      return `<button type="button" data-slot="${s.id}" aria-pressed="${s === this.slot}"><b>${s.name}</b><small>${item ? item.name : 'пусто'}</small></button>`;
    }).join('');
    for (const [id, ring] of this.rings) ring.material = id === this.slot.id ? this.ringOn : this.ringOff;

    const placed = den.slots[this.slot.id];
    const rows = itemsFor(this.slot.id).map((item) => {
      const owned = den.owned.includes(item.id);
      const here = placed === item.id;
      const state = here ? 'стоит' : owned ? 'поставить' : costText(item);
      const off = !owned && !canAfford(item.cost);
      return `<button type="button" class="den-item${here ? ' on' : ''}${off ? ' off' : ''}" data-item="${item.id}" aria-pressed="${here}">
        <span><b>${item.name}</b><small>${item.desc}</small></span><em>${state}</em></button>`;
    });
    this.cardEl.innerHTML = `<div class="den-card-head"><h3>${this.slot.name}</h3>${
      placed ? `<button type="button" class="link" data-clear="${this.slot.id}">убрать</button>` : ''
    }</div><div class="den-items">${rows.join('')}</div>`;
    if (focusId) this.root.querySelector<HTMLElement>(`[data-item="${focusId}"], [data-clear]`)?.focus();
    this.bandDirty = true;
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
    const tx = this.slot.x * 0.3, tz = 1.8 + (this.slot.z - 1.8) * 0.25;
    cam.target.x += (tx - cam.target.x) * damp(3, dt);
    cam.target.z += (tz - cam.target.z) * damp(3, dt);
    // Середина двора — в середине свободной полосы
    cam.targetScreenOffset.y = (1 - 2 * this.band.center) * tanHalf * cam.radius;

    this.forest.update(dt);
    this.grass.update(cam.position, null, 0);
    for (const b of this.built.values()) b.tick?.(this.t);
  }
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

/** «✦ 20» — цена вещи. */
export function costText(item: ItemDef): string {
  return `✦ ${item.cost.crystals}`;
}
