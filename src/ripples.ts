// Круги на воде вокруг героя, идущего вброд: мелкие на ходу и крупный — когда он
// заходит в воду или плюхается в неё с прыжка. Небольшой пул плоских колец на сцене.

import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, type Mesh, type Scene, type Vector3 } from '@babylonjs/core';

interface Ring { mesh: Mesh; t: number; life: number; r0: number; r1: number; alpha: number }

const POOL = 16;
/** Через сколько метров пути по воде расходится новый круг. */
const STEP = 0.7;
/** Мельче этого вода у ног — просто мокрая трава, кругов нет, м. */
const MIN_DEPTH = 0.05;

/** Светлое кольцо с мягкими краями. */
function ringTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture('ripple-ring', size, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.72, 'rgba(255,255,255,0)');
  g.addColorStop(0.86, 'rgba(255,255,255,1)');
  g.addColorStop(0.93, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

export class Ripples {
  private readonly rings: Ring[] = [];
  private next = 0;
  /** Путь по воде с последнего круга, м. */
  private walked = 0;
  private wasWet = false;
  private lastX = 0;
  private lastZ = 0;

  constructor(scene: Scene) {
    const m = new StandardMaterial('ripple', scene);
    m.diffuseTexture = ringTexture(scene);
    m.useAlphaFromDiffuseTexture = true;
    m.emissiveColor = new Color3(0.85, 0.92, 1);
    m.disableLighting = true;
    m.backFaceCulling = false;
    for (let i = 0; i < POOL; i++) {
      const mesh = MeshBuilder.CreateGround(`ripple-${i}`, { width: 2, height: 2 }, scene);
      mesh.material = m;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.rings.push({ mesh, t: 0, life: 1, r0: 0, r1: 0, alpha: 0 });
    }
  }

  /**
   * feet — ноги героя (null — героя нет), waterLevel — поверхность воды на уровне,
   * depth — глубина под героем, fallSpeed — скорость падения (для всплеска с прыжка).
   */
  update(dt: number, feet: Vector3 | null, waterLevel: number | null, depth: number, fallSpeed: number): void {
    for (const r of this.rings) {
      if (!r.mesh.isEnabled()) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.mesh.setEnabled(false);
        continue;
      }
      // Круг быстро разбегается и замедляется, к концу тает
      const s = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      r.mesh.scaling.set(s, 1, s);
      r.mesh.visibility = r.alpha * (1 - k);
    }

    const wet = feet !== null && waterLevel !== null && feet.y < waterLevel && depth > MIN_DEPTH;
    if (!wet) {
      this.wasWet = false;
      return;
    }
    const x = feet.x, z = feet.z, y = waterLevel;
    if (!this.wasWet) {
      // Вход в воду: с прыжка — всплеск крупнее
      const big = Math.min(1, fallSpeed / 8);
      this.spawn(x, y, z, 0.3, 1.6 + big * 1.4, 1.3 + big * 0.5, 0.55 + big * 0.35);
      if (big > 0.3) this.spawn(x, y, z, 0.2, 1 + big, 1.1, 0.5);
      this.walked = 0;
    } else {
      this.walked += Math.hypot(x - this.lastX, z - this.lastZ);
      if (this.walked > STEP) {
        this.walked = 0;
        this.spawn(x, y, z, 0.35, 1.2, 1.2, 0.3);
      }
    }
    this.wasWet = true;
    this.lastX = x;
    this.lastZ = z;
  }

  private spawn(x: number, y: number, z: number, r0: number, r1: number, life: number, alpha: number): void {
    const r = this.rings[this.next];
    this.next = (this.next + 1) % POOL;
    // Чуть выше воды, и каждый следующий выше прежнего — кольца не мерцают, перекрываясь
    r.mesh.position.set(x, y + 0.012 + this.next * 0.0008, z);
    r.mesh.scaling.set(r0, 1, r0);
    r.mesh.visibility = alpha;
    r.mesh.setEnabled(true);
    Object.assign(r, { t: 0, life, r0, r1, alpha });
  }

  /** Убрать все круги (смена уровня). */
  clear(): void {
    for (const r of this.rings) r.mesh.setEnabled(false);
    this.wasWet = false;
  }
}
