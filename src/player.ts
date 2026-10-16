// Игрок: ввод (клавиатура и сенсорный стик), движение, прыжок, коллизии с миром.

import { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Mesh } from '@babylonjs/core';
import { blendAnims, type Hero } from './heroes';
import { onSettingsApplied } from './settings';
import { byId, clamp, damp, wrapAngle } from './utils';
import type { World } from './world';
import type { CameraModeId } from './camera';

const GRAVITY = -24;

// ---------- Ввод ----------

/** Нажатые клавиши по KeyboardEvent.code. */
export const keys: Record<string, boolean> = {};
/** Отклонение сенсорного стика, -1…1 (y вверх). */
const touch = { x: 0, y: 0 };
let jumpRequested = false;
let knob: HTMLElement | null = null;

export function clearInput(): void {
  for (const k in keys) keys[k] = false;
  touch.x = touch.y = 0;
  jumpRequested = false;
  if (knob) knob.style.transform = '';
}

/** Экранный стик слева и кнопка прыжка справа (видны только на сенсорных экранах). */
export function setupTouchControls(): void {
  const stick = byId('stick');
  knob = byId('knob');
  let pointerId: number | null = null;
  const max = 40;
  const move = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > max) {
      dx *= max / m;
      dy *= max / m;
    }
    knob!.style.transform = `translate(${dx}px,${dy}px)`;
    touch.x = dx / max;
    touch.y = -dy / max;
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    touch.x = touch.y = 0;
    knob!.style.transform = '';
  };
  stick.addEventListener('pointerdown', (e) => {
    pointerId = e.pointerId;
    stick.setPointerCapture(pointerId);
    move(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointerId) move(e);
  });
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
  byId('jump').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    jumpRequested = true;
  });
}

interface MoveInput { x: number; z: number; run: boolean; jump: boolean }

function readInput(active: boolean): MoveInput {
  if (!active) return { x: 0, z: 0, run: false, jump: false };
  let x = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touch.x;
  let z = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touch.y;
  const m = Math.hypot(x, z);
  if (m > 1) {
    x /= m;
    z /= m;
  }
  return {
    x,
    z,
    run: !!(keys.ShiftLeft || keys.ShiftRight) || Math.hypot(touch.x, touch.y) > 0.95,
    jump: !!keys.Space || jumpRequested,
  };
}

// ---------- Игрок ----------

/** Что камере нужно знать о положении игрока. */
export interface CameraView { yaw: number; modeId: CameraModeId }

export class Player {
  readonly root: TransformNode;
  readonly pos = new Vector3(0, 0, -2.5);
  readonly vel = Vector3.Zero();
  facing = 0;
  onGround = true;
  /** Есть ли ввод движения в этом кадре. */
  moving = false;
  /** Ввод «вперёд/назад» в этом кадре (-1…1). */
  inputZ = 0;
  hero: Hero | null = null;

  /** Круглое «пятно» тени, когда настоящие тени выключены. */
  private readonly blob: Mesh;

  constructor(private readonly world: World) {
    this.root = new TransformNode('player', world.scene);
    this.blob = MeshBuilder.CreateDisc('sh', { radius: 0.45, tessellation: 24 }, world.scene);
    this.blob.rotation.x = Math.PI / 2;
    const m = new StandardMaterial('bl', world.scene);
    m.diffuseColor = new Color3(0, 0, 0);
    m.specularColor = new Color3(0, 0, 0);
    m.alpha = 0.25;
    this.blob.material = m;
    onSettingsApplied((s) => (this.blob.isVisible = s.shadows === 'off'));
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** Точка, по которой собираются кристаллы. */
  get center(): Vector3 {
    return this.pos.add(new Vector3(0, Math.min(1, (this.hero?.def.height ?? 1) * 0.6), 0));
  }

  setHero(hero: Hero): void {
    if (this.hero && this.hero !== hero) this.hero.dispose();
    this.hero = hero;
    hero.root.parent = this.root;
  }

  /** Поставить героя в точку старта уровня. */
  reset(spawn: { x: number; z: number }): void {
    this.pos.set(spawn.x, 0, spawn.z);
    this.vel.setAll(0);
    this.facing = 0;
    this.onGround = true;
  }

  update(dt: number, view: CameraView, active: boolean): void {
    const hero = this.hero;
    if (!hero) return;
    const D = hero.def;
    const input = readInput(active);
    jumpRequested = false;

    // Скорость по направлению относительно камеры
    const yaw = view.yaw;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const dir = fwd.scale(input.z).add(right.scale(input.x));
    this.moving = dir.lengthSquared() > 0.01;
    this.inputZ = input.z;
    const shoulder = view.modeId === 'shoulder';
    let speed = input.run ? D.run : D.walk;
    if (shoulder && input.z < 0) speed *= 0.6; // пятиться медленнее
    const acc = this.onGround ? 14 : 5;
    this.vel.x += (dir.x * speed - this.vel.x) * damp(acc, dt);
    this.vel.z += (dir.z * speed - this.vel.z) * damp(acc, dt);

    // Поворот тела: из-за плеча — всегда по камере, иначе — по ходу движения
    const turnTo = (a: number) => (this.facing += wrapAngle(a - this.facing) * damp(12, dt));
    if (shoulder) turnTo(yaw);
    else if (this.moving) turnTo(Math.atan2(dir.x, dir.z));

    if (input.jump && this.onGround) {
      this.vel.y = D.jump;
      this.onGround = false;
      const j = hero.anim('jump');
      if (j) {
        j.stop();
        j.start(false, D.jumpRatio ?? 1.4);
      }
    }
    this.vel.y += GRAVITY * dt;

    this.integrate(dt, D.height);

    this.root.position.copyFrom(this.pos);
    this.root.rotation.y = this.facing;
    blendAnims(hero, this.horizontalSpeed, this.onGround, dt);
  }

  private integrate(dt: number, height: number): void {
    const { world, pos, vel } = this;
    let nx = pos.x + vel.x * dt;
    let nz = pos.z + vel.z * dt;
    // Стенки платформ — раздельно по осям, чтобы скользить вдоль
    if (world.blockedByPlatform(nx, pos.z, pos.y)) nx = pos.x;
    if (world.blockedByPlatform(nx, nz, pos.y)) nz = pos.z;
    // Круглые препятствия выталкивают наружу
    const radius = 0.25 + 0.2 * height;
    for (const o of world.obstaclesNear(nx, nz, radius + 3)) {
      const dx = nx - o.x, dz = nz - o.z;
      const d = Math.hypot(dx, dz), m = o.r + radius;
      if (d < m && d > 0) {
        nx = o.x + (dx / d) * m;
        nz = o.z + (dz / d) * m;
      }
    }
    const lim = world.half - 1.5;
    pos.x = clamp(nx, -lim, lim);
    pos.z = clamp(nz, -lim, lim);
    pos.y += vel.y * dt;

    const g = world.groundAt(pos.x, pos.z, pos.y);
    if (pos.y <= g) {
      pos.y = g;
      vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = pos.y - g < 0.02 && vel.y <= 0;
    }

    const bs = height / 2.1;
    this.blob.position.set(pos.x, g + 0.03, pos.z);
    this.blob.scaling.setAll(Math.max(0.4, 1 - (pos.y - g) * 0.15) * (0.8 + bs));
  }

  /** Анимация на месте — пока открыто меню, герой просто стоит. */
  idle(dt: number): void {
    if (this.hero) blendAnims(this.hero, 0, true, dt);
  }
}
