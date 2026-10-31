// Житель на уровне: стоит на поляне, а когда герой подходит — говорит. Просьба принимается
// сама: подошёл — услышал, что нужно. Материалы и урожай житель забирает при встрече, если
// они есть в норе; остальное делается на уровнях (найти вещь, пройти задание, собрать серию,
// раскрыть тайник), а потом надо прийти к жителю и рассказать.

import { Color3, Color4, MeshBuilder, ParticleSystem, StandardMaterial, TransformNode, Vector3, type DynamicTexture, type Mesh, type Scene } from '@babylonjs/core';
import { amount, cropById, materialById, type Cost, type CropId, type MaterialId } from '../den/catalog';
import { canAfford, give, matCount, stockOf } from '../den/state';
import { BIOMES, type BiomeId } from '../levels/biomes';
import type { SecretKind } from '../levels/generator';
import { dotTexture } from '../particles';
import { RESIDENTS, type LostItem, type RequestStep, type ResidentDef } from './catalog';
import type { ResidentModel } from './model';
import { advance, currentStep, markReady, meet, stateOf } from './state';

/** Ближе этого житель заговаривает, м; дальше этого — замолкает. */
const TALK_R = 3;
const QUIET_R = 6;
/** Подобрать потерянную вещь, м. */
const PICK_R = 1.4;

/** Тайник в просьбе — винительный падеж. */
const SECRET_NAMES: Record<SecretKind, string> = {
  tree: 'мерцающее дерево',
  stone: 'тайник под камнем',
  ring: 'грибной круг',
  ledge: 'гнездо на уступе',
  pearl: 'жемчужину',
};

/** Что житель просит принести: материалы и урожай одной ценой. */
const bringCost = (step: Extract<RequestStep, { kind: 'bring' }>): Cost => ({ crystals: 0, mats: step.mats, crops: step.crops });

/** Строка просьбы в HUD; null — просьбы нет (не знакомы или всё выполнено). */
export function requestLine(def: ResidentDef): string | null {
  const st = stateOf(def);
  const step = currentStep(def);
  if (!st.met || !step) return null;
  return `${def.icon} ${def.name}: ${stepText(def, step, st.ready)}`;
}

/** Что сделать для просьбы; когда всё готово — к кому и куда прийти (житель живёт в своём биоме). */
function stepText(def: ResidentDef, step: RequestStep, ready: boolean): string {
  const where = BIOMES[def.biome].name;
  const back = `загляни к нему · ${where}`;
  const biome = (b: BiomeId) => BIOMES[b].name;
  switch (step.kind) {
    case 'bring': {
      const items = [
        ...Object.entries(step.mats ?? {}).map(([id, n]) => ({ name: amount(materialById(id)!, n!), have: matCount(id as MaterialId), n: n! })),
        ...Object.entries(step.crops ?? {}).map(([id, n]) => ({ name: amount(cropById(id)!, n!), have: stockOf(id as CropId), n: n! })),
      ];
      const list = items.map((i) => i.name).join(', ');
      if (canAfford(bringCost(step))) return `отнеси ${list} · ${where}`;
      return `${step.crops ? 'угости' : 'принеси'}: ${list} (есть ${items.map((i) => `${Math.min(i.have, i.n)}/${i.n}`).join(', ')})`;
    }
    case 'find':
      return ready ? `отнеси ${step.item.name} · ${where}` : `найди ${step.item.name} на вершине · ${biome(step.biome)}`;
    case 'quest':
      return ready ? back : `выполни задание уровня · ${biome(step.biome)}`;
    case 'combo':
      return ready ? back : `собери серию ×${step.n}`;
    case 'secret':
      return ready ? back : `найди ${SECRET_NAMES[step.secret]} · ${biome(step.biome)}`;
  }
}

/** Что случилось на уровне — может выполнить чью-то просьбу. */
export type RequestEvent = { kind: 'quest'; biome: BiomeId } | { kind: 'combo'; n: number } | { kind: 'secret'; biome: BiomeId; secret: SecretKind };

/** Отметить просьбы, которые это событие выполнило; возвращает жителей, к которым теперь прийти. */
export function progressRequests(ev: RequestEvent): ResidentDef[] {
  const done: ResidentDef[] = [];
  for (const def of RESIDENTS) {
    const step = currentStep(def);
    if (!step || !stateOf(def).met || stateOf(def).ready || step.kind !== ev.kind) continue;
    const hit =
      (step.kind === 'quest' && ev.kind === 'quest' && step.biome === ev.biome) ||
      (step.kind === 'combo' && ev.kind === 'combo' && ev.n >= step.n) ||
      (step.kind === 'secret' && ev.kind === 'secret' && step.biome === ev.biome && step.secret === ev.secret);
    if (!hit) continue;
    markReady(def);
    done.push(def);
  }
  return done;
}

/** Что случилось при разговоре — для звука и надписей. */
export type TalkResult = 'met' | 'thanks' | null;

export class ResidentVisit {
  private talking = false;
  private text: string | null = null;
  private model: ResidentModel | null = null;

  constructor(
    readonly def: ResidentDef,
    readonly at: Vector3,
  ) {}

  /** Модель грузится асинхронно — уровень начинается, не дожидаясь её. */
  attach(model: ResidentModel): void {
    this.model = model;
    model.place(this.at.x, this.at.y, this.at.z);
  }

  /** Над головой — для облачка с репликой. */
  get head(): Vector3 {
    return this.at.add(new Vector3(0, this.def.height + 0.35, 0));
  }

  /** Реплика в облачке; null — житель молчит. */
  get bubble(): string | null {
    return this.model ? this.text : null;
  }

  /** Ждёт ли житель героя — над ним тогда значок. */
  get waiting(): boolean {
    return !stateOf(this.def).met || currentStep(this.def) !== null;
  }

  update(dt: number, feet: Vector3): TalkResult {
    if (!this.model) return null;
    const d = Math.hypot(feet.x - this.at.x, feet.z - this.at.z);
    let result: TalkResult = null;
    if (d < TALK_R && !this.talking) {
      this.talking = true;
      result = this.talk();
    } else if (d > QUIET_R && this.talking) {
      this.talking = false;
      this.text = null;
    }
    this.model.update(dt, feet, this.talking);
    return result;
  }

  /** Разговор: знакомство, выполненная просьба и следующая — всё в одной реплике. */
  private talk(): TalkResult {
    const def = this.def;
    const lines: string[] = [];
    let result: TalkResult = null;
    if (!stateOf(def).met) {
      meet(def);
      lines.push(def.hello);
      result = 'met';
    }
    const step = currentStep(def);
    const fulfilled = step && (step.kind === 'bring' ? give(bringCost(step)) : stateOf(def).ready);
    if (step && fulfilled) {
      advance(def);
      lines.push(step.thanks);
      this.model?.cheer();
      result = 'thanks';
    }
    // Следующая просьба — или та же, если её ещё не выполнили: напомнить
    const next = currentStep(def);
    lines.push(next ? next.ask : def.done);
    this.text = lines.join(' ');
    return result;
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }
}

/** Потерянная вещь на уровне: блестит, пока её не подберут. */
export class LostItemSpot {
  private readonly root: TransformNode;
  private readonly mats: StandardMaterial[] = [];
  private readonly tex: DynamicTexture;
  private readonly glint: ParticleSystem;
  private t = 0;
  private taken = false;

  constructor(
    scene: Scene,
    readonly def: ResidentDef,
    readonly item: LostItem,
    readonly at: Vector3,
  ) {
    this.root = new TransformNode('lost-item', scene);
    this.root.position.copyFrom(at);
    const mat = (c: [number, number, number]) => {
      const m = new StandardMaterial('lost', scene);
      m.diffuseColor = new Color3(...c);
      m.emissiveColor = new Color3(...c).scale(0.25);
      this.mats.push(m);
      return m;
    };
    const add = (m: Mesh, c: [number, number, number], x: number, y: number, z: number) => {
      m.material = mat(c);
      m.parent = this.root;
      m.position.set(x, y, z);
      m.isPickable = false;
      return m;
    };
    if (item.look === 'apple') {
      add(MeshBuilder.CreateSphere('apple', { diameter: 0.34, segments: 10 }, scene), [0.85, 0.12, 0.1], 0, 0.2, 0).scaling.y = 0.9;
      add(MeshBuilder.CreateCylinder('apple-stem', { diameter: 0.025, height: 0.1, tessellation: 5 }, scene), [0.4, 0.26, 0.12], 0, 0.39, 0);
      const leaf = add(MeshBuilder.CreateSphere('apple-leaf', { diameter: 0.12, segments: 4 }, scene), [0.3, 0.65, 0.25], 0.05, 0.4, 0);
      leaf.scaling.set(1, 0.25, 0.5);
    } else if (item.look === 'acorn') {
      add(MeshBuilder.CreateSphere('acorn', { diameter: 0.22, segments: 8 }, scene), [0.78, 0.52, 0.22], 0, 0.16, 0).scaling.y = 1.3;
      add(MeshBuilder.CreateSphere('acorn-cap', { diameter: 0.24, segments: 8, slice: 0.5 }, scene), [0.45, 0.32, 0.18], 0, 0.24, 0);
    } else {
      add(MeshBuilder.CreateCylinder('button', { diameter: 0.28, height: 0.06, tessellation: 16 }, scene), [0.9, 0.75, 0.3], 0, 0.15, 0).rotation.x = Math.PI / 2;
    }
    this.tex = dotTexture(scene);
    const ps = (this.glint = new ParticleSystem('lost-glint', 40, scene));
    ps.particleTexture = this.tex;
    ps.emitter = at.add(new Vector3(0, 0.25, 0));
    ps.createSphereEmitter(0.4, 0);
    ps.minEmitPower = 0.05;
    ps.maxEmitPower = 0.2;
    ps.gravity = new Vector3(0, 0.4, 0);
    ps.minLifeTime = 0.7;
    ps.maxLifeTime = 1.2;
    ps.minSize = 0.15;
    ps.maxSize = 0.28;
    ps.color1 = new Color4(1, 0.86, 0.45, 1);
    ps.color2 = new Color4(1, 0.95, 0.7, 1);
    ps.colorDead = new Color4(1, 0.8, 0.3, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 14;
    ps.start();
  }

  /** Вещь лежит и медленно крутится; true — герой её только что подобрал. */
  update(dt: number, center: Vector3): boolean {
    if (this.taken) return false;
    this.t += dt;
    this.root.rotation.y = this.t * 0.8;
    if (Vector3.Distance(center, this.at.add(new Vector3(0, 0.25, 0))) > PICK_R) return false;
    this.taken = true;
    this.root.setEnabled(false);
    this.glint.emitRate = 0;
    markReady(this.def);
    return true;
  }

  dispose(): void {
    this.glint.dispose(false);
    this.root.dispose(false, true);
    for (const m of this.mats) m.dispose();
    this.tex.dispose();
  }
}
