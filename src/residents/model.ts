// Модель жителя: статичная низкополигональная фигурка (без скелета), ожившая в коде —
// дышит, покачивается, поворачивается к герою и подпрыгивает от радости.

import { ImportMeshAsync, TransformNode, Vector3, type AbstractMesh, type PBRMaterial } from '@babylonjs/core';
import { addShadowCaster, type LightingContext } from '../settings';
import type { ResidentDef } from './catalog';

/** Ближе этого житель поворачивается к герою, м. */
const LOOK_R = 9;
/** Сколько длится радость: три прыжка, с. */
const HAPPY_TIME = 1.2;

export class ResidentModel {
  private t = Math.random() * 10;
  private happyLeft = 0;
  /** Куда житель смотрит, рад. */
  private yaw = Math.random() * Math.PI * 2;

  private constructor(
    readonly root: TransformNode,
    /** Фигурка внутри корня: на ней покачивание и прыжки, корень стоит на земле. */
    private readonly body: TransformNode,
    private readonly meshes: AbstractMesh[],
  ) {}

  /** pick — метаданные мешей, чтобы по жителю можно было кликнуть (у норы); без них он не кликается. */
  static async load(def: ResidentDef, ctx: LightingContext, pick?: object): Promise<ResidentModel> {
    const scene = ctx.scene;
    const res = await ImportMeshAsync(`${import.meta.env.BASE_URL}models/residents/${def.file}`, scene);
    const root = new TransformNode(`resident-${def.id}`, scene);
    const body = new TransformNode(`resident-${def.id}-body`, scene);
    body.parent = root;
    // fit подгоняет рост и ставит на землю, orient поворачивает модель мордой вдоль +Z
    // (а лежащую на боку — ставит на лапы)
    const fit = new TransformNode(`resident-${def.id}-fit`, scene);
    fit.parent = body;
    const orient = new TransformNode(`resident-${def.id}-orient`, scene);
    orient.parent = fit;
    orient.rotation.set(def.pitch ?? 0, def.yaw, 0);
    const model = res.meshes[0];
    model.parent = orient;
    // Модели разного масштаба и с началом координат где придётся: габариты уже повёрнутой
    // модели (корень пока в начале координат) — по ним рост, земля и середина
    const { min, max } = model.getHierarchyBoundingVectors(true);
    const k = def.height / Math.max(max.y - min.y, 1e-3);
    fit.scaling.setAll(k);
    fit.position.set((-(min.x + max.x) / 2) * k, -min.y * k, (-(min.z + max.z) / 2) * k);
    for (const m of res.meshes) {
      // Матовая шерсть и перья, как у героев
      const mat = m.material as PBRMaterial | null;
      if (mat && mat.metallic !== undefined) {
        mat.metallic = 0;
        mat.roughness = Math.max(mat.roughness ?? 0.8, 0.8);
      }
      m.isPickable = !!pick;
      if (pick) m.metadata = pick;
      if (m.getTotalVertices() > 0) {
        addShadowCaster(ctx, m);
        m.receiveShadows = true;
      }
    }
    for (const g of res.animationGroups) g.dispose();
    return new ResidentModel(root, body, res.meshes);
  }

  /** yaw — куда смотреть, пока героя рядом нет. */
  place(x: number, y: number, z: number, yaw = this.yaw): void {
    this.root.position.set(x, y, z);
    this.yaw = yaw;
  }

  /** Обрадоваться: попрыгать на месте. */
  cheer(): void {
    this.happyLeft = HAPPY_TIME;
  }

  /** talking — пока говорит, кивает чаще. */
  update(dt: number, hero: Vector3 | null, talking: boolean): void {
    this.t += dt;
    const p = this.root.position;
    // К герою поворачивается, только если он рядом; иначе изредка оглядывается
    const near = hero && Vector3.Distance(hero, p) < LOOK_R;
    const want = near ? Math.atan2(hero.x - p.x, hero.z - p.z) : this.yaw + Math.sin(this.t * 0.3) * 0.004;
    this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * Math.min(1, dt * 4);
    this.root.rotation.y = this.yaw;
    // Дыхание и лёгкое покачивание; говоря — кивает
    const b = this.body;
    b.scaling.y = 1 + Math.sin(this.t * 2.4) * 0.025;
    b.rotation.z = Math.sin(this.t * 1.1) * 0.035;
    b.rotation.x = talking ? Math.sin(this.t * 7) * 0.06 : 0;
    if (this.happyLeft > 0) {
      this.happyLeft = Math.max(0, this.happyLeft - dt);
      const u = (HAPPY_TIME - this.happyLeft) / (HAPPY_TIME / 3);
      b.position.y = Math.abs(Math.sin(u * Math.PI)) * 0.25;
    } else {
      b.position.y = 0;
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose(false, true);
    this.root.dispose();
  }
}
