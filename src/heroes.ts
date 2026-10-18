// Герои: описания, загрузка GLB-моделей из public/models и смешивание анимаций.

import { ImportMeshAsync, TransformNode, Vector3, type AbstractMesh, type AnimationGroup, type PBRMaterial, type Skeleton } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { addShadowCaster, type LightingContext } from './settings';
import { clamp, damp } from './utils';

export type AnimKey = 'idle' | 'walk' | 'run' | 'jump' | 'hello';

export interface HeroDef {
  id: string;
  name: string;
  tag: string;
  /** Файл в public/models. */
  file: string;
  /** Высота модели в её собственных единицах (лапы на y = 0). Все модели смотрят в +Z. */
  srcH: number;
  /** Желаемая высота в игре, м. */
  height: number;
  yaw: number;
  /** Имена анимационных групп в GLB. */
  anims: Partial<Record<AnimKey, string>> & { idle: string; walk: string; run: string };
  walk: number;
  run: number;
  jump: number;
  /** Скорость проигрывания анимации прыжка. */
  jumpRatio?: number;
  /** Скорость ходьбы/бега, при которой анимация идёт с родной скоростью. */
  walkRef: number;
  runRef: number;
  /** Скорость и прыжок по пятибалльной шкале — для карточек выбора. */
  stats: [speed: number, jump: number];
  /** Откуда идёт пар на морозе: узел скелета и сколько ещё метров вперёд до кончика морды. */
  mouth: { node: string; ahead: number };
  /** Сколько звёзд нужно, чтобы герой открылся (0 — доступен сразу). */
  stars: number;
}

const AA = 'AnimalArmature|';

/** Порядок — порядок открытия: лиса доступна сразу, остальные — за звёзды. */
export const HEROES: readonly HeroDef[] = [
  {
    id: 'fox', name: 'Лиса', tag: 'Маленькая и самая быстрая.', file: 'fox.glb',
    srcH: 72, height: 1.0, yaw: 0,
    anims: { idle: 'Survey', walk: 'Walk', run: 'Run' },
    walk: 4.2, run: 12, jump: 9.5, walkRef: 2.6, runRef: 7, stats: [5, 4],
    mouth: { node: 'b_Head_05', ahead: 0.32 },
    stars: 0,
  },
  {
    id: 'wolf', name: 'Волк', tag: 'Быстрый и ловкий, прыгает в галопе.', file: 'wolf.glb',
    srcH: 2.7, height: 1.35, yaw: 0,
    anims: { idle: AA + 'Idle', walk: AA + 'Walk', run: AA + 'Gallop', jump: AA + 'Gallop_Jump', hello: AA + 'Attack' },
    walk: 4.4, run: 11.5, jump: 9, jumpRatio: 1.2, walkRef: 3.2, runRef: 9, stats: [4, 3],
    mouth: { node: 'Head_end', ahead: 0.05 },
    stars: 6,
  },
  {
    id: 'stag', name: 'Олень', tag: 'Медленнее всех, зато прыгает выше всех.', file: 'stag.glb',
    srcH: 4.2, height: 2.1, yaw: 0,
    anims: { idle: AA + 'Idle', walk: AA + 'Walk', run: AA + 'Gallop', jump: AA + 'Gallop_Jump', hello: AA + 'Attack_Headbutt' },
    walk: 4, run: 10, jump: 11, jumpRatio: 1.6, walkRef: 3, runRef: 8.5, stats: [3, 5],
    mouth: { node: 'Head_end', ahead: 0.05 },
    stars: 15,
  },
];

/** Анимации, которые смешиваются по весам (hello управляется отдельно — на экране выбора). */
type BlendKey = 'idle' | 'walk' | 'run' | 'jump';

/** Загруженный экземпляр героя в конкретной сцене. */
export class Hero {
  /** Корень героя: его двигают и поворачивают снаружи. */
  readonly root: TransformNode;
  /** Текущие веса смешиваемых анимаций. */
  readonly weights: Partial<Record<BlendKey, number>> = {};
  /** Узел скелета у морды; null — в модели его не нашлось. */
  readonly mouth: TransformNode | null;
  private readonly byName: Map<string, AnimationGroup>;

  constructor(
    readonly def: HeroDef,
    root: TransformNode,
    readonly meshes: AbstractMesh[],
    private readonly groups: AnimationGroup[],
    private readonly skeletons: Skeleton[],
  ) {
    this.root = root;
    this.byName = new Map(groups.map((g) => [g.name, g]));
    this.mouth = root.getDescendants(false, (n) => n.name === def.mouth.node)[0] as TransformNode | undefined ?? null;
  }

  /** Кончик морды в мировых координатах — сюда пар изо рта. */
  mouthPosition(out: Vector3): Vector3 {
    if (!this.mouth) return out.copyFrom(this.root.getAbsolutePosition()).addInPlaceFromFloats(0, this.def.height * 0.75, 0);
    out.copyFrom(this.mouth.getAbsolutePosition());
    const fwd = this.root.getDirection(Vector3.Forward());
    return out.addInPlace(fwd.scaleInPlace(this.def.mouth.ahead));
  }

  anim(key: AnimKey): AnimationGroup | undefined {
    const name = this.def.anims[key];
    return name ? this.byName.get(name) : undefined;
  }

  dispose(): void {
    this.groups.forEach((g) => g.dispose());
    this.skeletons.forEach((s) => s.dispose());
    this.root.dispose(false, true);
  }
}

export function modelUrl(def: HeroDef): string {
  return `${import.meta.env.BASE_URL}models/${def.file}`;
}

export async function loadHero(def: HeroDef, ctx: LightingContext): Promise<Hero> {
  const scene = ctx.scene;
  const res = await ImportMeshAsync(modelUrl(def), scene, {
    // Риги Quaternius перечисляют кости вне skin.skeleton — пусть загрузчик сам найдёт общий корень
    pluginOptions: { gltf: { alwaysComputeSkeletonRootNode: true } },
  });

  const root = new TransformNode(def.id, scene);
  const orient = new TransformNode(`${def.id}-orient`, scene);
  orient.parent = root;
  orient.rotation.y = def.yaw;
  const modelRoot = res.meshes[0];
  modelRoot.parent = orient;
  modelRoot.scaling.scaleInPlace(def.height / def.srcH);

  for (const m of res.meshes) {
    // Матовые шкуры: убираем металличность и блики
    const mat = m.material as PBRMaterial | null;
    if (mat && mat.metallic !== undefined) {
      mat.metallic = 0;
      mat.roughness = Math.max(mat.roughness ?? 0.8, 0.75);
    }
    m.alwaysSelectAsActiveMesh = true;
    if (m.getTotalVertices() > 0) {
      addShadowCaster(ctx, m);
      m.receiveShadows = true;
    }
  }

  const hero = new Hero(def, root, res.meshes, res.animationGroups, res.skeletons);
  for (const g of res.animationGroups) g.stop();
  for (const k of ['idle', 'walk', 'run'] as const) {
    const g = hero.anim(k);
    if (!g) continue;
    g.start(true);
    hero.weights[k] = k === 'idle' ? 1 : 0;
    g.weight = hero.weights[k]!;
  }
  const jump = hero.anim('jump');
  if (jump) {
    jump.weight = 0;
    hero.weights.jump = 0;
  }
  const hello = hero.anim('hello');
  if (hello) hello.weight = 0;
  return hero;
}

/**
 * Плавно смешивает idle / walk / run / jump по горизонтальной скорости
 * и подстраивает темп шагов под реальную скорость; `reverse` — шаги задом наперёд.
 */
export function blendAnims(hero: Hero, speed: number, onGround: boolean, dt: number, reverse = false): void {
  const d = hero.def;
  const jump = hero.anim('jump');
  const jumping = !onGround && !!jump?.isPlaying;
  const move = clamp(speed / 1.5, 0, 1);
  const runK = clamp((speed - d.walk * 1.03) / ((d.run - d.walk) * 0.6), 0, 1);
  const target: Record<BlendKey, number> = jumping
    ? { idle: 0, walk: 0, run: 0, jump: 1 }
    : !onGround
      ? { idle: 0, walk: 0, run: 1, jump: 0 }
      : { idle: 1 - move, walk: move * (1 - runK), run: move * runK, jump: 0 };

  for (const k of Object.keys(hero.weights) as BlendKey[]) {
    const g = hero.anim(k);
    if (!g) continue;
    const w = hero.weights[k]!;
    hero.weights[k] = w + (target[k] - w) * damp(k === 'jump' ? 16 : 9, dt);
    g.weight = hero.weights[k]!;
  }
  const walk = hero.anim('walk');
  const run = hero.anim('run');
  const sign = reverse ? -1 : 1;
  if (walk) walk.speedRatio = sign * clamp(speed / d.walkRef, 0.7, 1.6);
  if (run) run.speedRatio = sign * clamp(speed / d.runRef, 0.75, 1.4);
}
