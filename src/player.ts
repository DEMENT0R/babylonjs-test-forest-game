// Игрок: ввод (клавиатура, сенсорный стик, геймпад), движение, прыжок, коллизии с миром.

import { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Mesh } from '@babylonjs/core';
import { BTN, gamepad } from './gamepad';
import { blendAnims, type Hero } from './heroes';
import { onSettingsApplied, settings } from './settings';
import { byId, clamp, damp, wrapAngle } from './utils';
import { MAX_WADE_DEPTH } from './levels/generator';
import { MAX_WALK_SLOPE } from './levels/terrain';
import type { World } from './world';
import type { CameraModeId } from './camera';

const GRAVITY = -24;
/** На сколько тело доворачивает от камеры в сторону шага в режиме «из-за плеча». */
const MAX_STRAFE_TURN = Math.PI * 0.42;
/** Стоя на месте «из-за плеча», тело не следует за камерой, пока она не ушла в сторону дальше этого угла. */
const TURN_DEADZONE = Math.PI * 0.3;
/** Наибольшая скорость разворота на месте, рад/с. */
const TURN_IN_PLACE_SPEED = 4.5;
/** Перевод скорости разворота на месте (рад/с) в скорость шага лапами (м/с). */
const TURN_STEP = 0.5;
/** Наибольший крен в повороте, рад. */
const MAX_LEAN = 0.12;
/** «Койот-тайм»: сколько секунд после схода с края ещё можно оттолкнуться. */
const COYOTE_TIME = 0.1;
/** Буфер прыжка: нажатие чуть раньше приземления срабатывает в момент касания земли, с. */
const JUMP_BUFFER = 0.12;

// ---------- Ввод ----------

/** Нажатые клавиши по KeyboardEvent.code. */
export const keys: Record<string, boolean> = {};
/** Отклонение сенсорного стика, -1…1 (y вверх). */
const touch = { x: 0, y: 0 };
let jumpRequested = false;
let knob: HTMLElement | null = null;
let stickEl: HTMLElement | null = null;

/** Вернуть стик в покой: ручку в центр, плавающий — на место по умолчанию. */
function releaseStick(): void {
  touch.x = touch.y = 0;
  if (knob) knob.style.transform = '';
  if (stickEl) {
    stickEl.style.left = stickEl.style.top = stickEl.style.bottom = '';
    stickEl.classList.remove('held');
  }
}

export function clearInput(): void {
  for (const k in keys) keys[k] = false;
  jumpRequested = false;
  releaseStick();
}

/**
 * Экранный стик слева и кнопка прыжка справа (видны только на сенсорных экранах).
 * Стик фиксированный — ловит касания только по себе; плавающий — появляется под пальцем
 * в любом месте левой части экрана (зона #stick-zone).
 */
export function setupTouchControls(): void {
  const stick = (stickEl = byId('stick'));
  const zone = byId('stick-zone');
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
  const start = (e: PointerEvent, el: HTMLElement) => {
    if (pointerId !== null) return;
    e.preventDefault();
    pointerId = e.pointerId;
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // pointerId мог уже завершиться
    }
    if (settings.stick === 'float') {
      // Центр стика — под пальцем, но целиком на экране
      const r = stick.getBoundingClientRect();
      const half = r.width / 2;
      const x = clamp(e.clientX, half + 4, innerWidth - half - 4);
      const y = clamp(e.clientY, half + 4, innerHeight - half - 4);
      stick.style.left = `${x - half}px`;
      stick.style.top = `${y - half}px`;
      stick.style.bottom = 'auto';
    }
    stick.classList.add('held');
    move(e);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    releaseStick();
  };
  for (const el of [stick, zone]) {
    el.addEventListener('pointerdown', (e) => start(e, el));
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointerId) move(e);
    });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  onSettingsApplied((s) => {
    zone.hidden = s.stick !== 'float';
    stick.classList.toggle('floating', s.stick === 'float');
  });
  const jump = byId('jump');
  let jumpFlash = 0;
  jump.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    jumpRequested = true;
    // Отклик на нажатие: вспышка кнопки и короткая вибрация (где она есть)
    jump.classList.add('on');
    clearTimeout(jumpFlash);
    jumpFlash = window.setTimeout(() => jump.classList.remove('on'), 120);
    navigator.vibrate?.(12);
  });
}

interface MoveInput { x: number; z: number; run: boolean; jump: boolean }

function readInput(active: boolean): MoveInput {
  if (!active) return { x: 0, z: 0, run: false, jump: false };
  const pad = gamepad.move;
  let x = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touch.x + pad.x;
  let z = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touch.y - pad.y;
  const m = Math.hypot(x, z);
  if (m > 1) {
    x /= m;
    z /= m;
  }
  return {
    x,
    z,
    // Стик до упора — бег; на геймпаде ещё LB или нажатый левый стик
    run:
      !!(keys.ShiftLeft || keys.ShiftRight) ||
      Math.hypot(touch.x, touch.y) > 0.95 ||
      Math.hypot(pad.x, pad.y) > 0.95 ||
      gamepad.down(BTN.LB) ||
      gamepad.down(BTN.L3),
    jump: !!keys.Space || jumpRequested || gamepad.pressed(BTN.A),
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
  /** Текущий крен в повороте. */
  private lean = 0;
  /** Разворачивается на месте вслед за камерой, пока не встанет к ней лицом. */
  private turning = false;
  /** Сколько секунд герой в воздухе, не прыгнув; после прыжка — Infinity до приземления. */
  private airTime = 0;
  /** Сколько ещё секунд ждёт нажатый в воздухе прыжок. */
  private jumpBuffer = 0;
  onGround = true;
  /** Есть ли ввод движения в этом кадре. */
  moving = false;
  /** Оттолкнулся в прыжке в этом кадре. */
  jumped = false;
  /** Бежит в этом кадре: идёт и держит бег. */
  running = false;
  /** Ввод «вперёд/назад» в этом кадре (-1…1). */
  inputZ = 0;
  /** Множитель скорости от «ветра в спину» на серии; прыжок прибавляет вполовину меньше. */
  boost = 1;
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
    this.pos.set(spawn.x, this.world.groundAt(spawn.x, spawn.z, 100), spawn.z);
    this.vel.setAll(0);
    this.facing = 0;
    this.lean = 0;
    this.turning = false;
    this.airTime = 0;
    this.jumpBuffer = 0;
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
    this.running = this.moving && input.run;
    this.inputZ = input.z;
    const shoulder = view.modeId === 'shoulder';
    let speed = (input.run ? D.run : D.walk) * this.boost;
    // В воде идти тяжелее: чем глубже, тем медленнее
    const depth = this.world.waterDepth(this.pos.x, this.pos.z);
    const wading = this.pos.y < this.world.terrainAt(this.pos.x, this.pos.z) + 0.05 ? depth : 0;
    speed *= clamp(1 - wading * 0.7, 0.4, 1);
    if (shoulder && input.z < 0) speed *= 0.6; // пятиться медленнее
    const acc = this.onGround ? 14 : 5;
    this.vel.x += (dir.x * speed - this.vel.x) * damp(acc, dt);
    this.vel.z += (dir.z * speed - this.vel.z) * damp(acc, dt);

    // Поворот тела: из-за плеча — по камере, но с разворотом в сторону шага, чтобы зверь
    // не ехал боком (пятясь — зеркально, задом по ходу); в остальных режимах — по ходу движения
    const turnTo = (a: number) => (this.facing += wrapAngle(a - this.facing) * damp(12, dt));
    const before = this.facing;
    if (shoulder && this.moving) {
      this.turning = false;
      const back = input.z < -0.1;
      const off = Math.atan2(back ? -input.x : input.x, back ? -input.z : input.z);
      turnTo(yaw + clamp(off, -MAX_STRAFE_TURN, MAX_STRAFE_TURN));
    } else if (shoulder) {
      // Стоя — мёртвая зона: мелкие движения камеры тело не трогают, а ушла далеко —
      // зверь переступает лапами и разворачивается к ней целиком
      const diff = wrapAngle(yaw - this.facing);
      if (Math.abs(diff) > TURN_DEADZONE) this.turning = true;
      if (this.turning) {
        const lim = TURN_IN_PLACE_SPEED * dt;
        this.facing += clamp(diff * damp(8, dt), -lim, lim);
        if (Math.abs(diff) < 0.05) this.turning = false;
      }
    } else if (this.moving) turnTo(Math.atan2(dir.x, dir.z));

    // Наклон в поворот: чем быстрее бег и круче поворот, тем сильнее крен
    const turnRate = dt > 0 ? wrapAngle(this.facing - before) / dt : 0;
    const leanTo = this.onGround ? clamp(-turnRate * this.horizontalSpeed * 0.012, -MAX_LEAN, MAX_LEAN) : 0;
    this.lean += (leanTo - this.lean) * damp(8, dt);

    // Сошёл с края — ещё COYOTE_TIME можно прыгнуть, будто стоит на земле;
    // нажал чуть раньше приземления — прыжок дождётся касания земли
    if (input.jump) this.jumpBuffer = JUMP_BUFFER;
    this.jumped = this.jumpBuffer > 0 && this.airTime <= COYOTE_TIME;
    this.jumpBuffer -= dt;
    if (this.jumped) {
      this.jumpBuffer = 0;
      this.vel.y = D.jump * (1 + (this.boost - 1) / 2) * (wading > 0.3 ? 0.65 : 1);
      this.onGround = false;
      this.airTime = Infinity;
      const j = hero.anim('jump');
      if (j) {
        j.stop();
        j.start(false, D.jumpRatio ?? 1.4);
      }
    }
    this.vel.y += GRAVITY * dt;

    this.integrate(dt, D.height);
    this.airTime = this.onGround ? 0 : this.airTime + dt;

    this.root.position.copyFrom(this.pos);
    this.root.rotation.y = this.facing;
    this.root.rotation.z = this.lean;
    // Пятится — шаги проигрываются задом наперёд
    const ahead = this.vel.x * Math.sin(this.facing) + this.vel.z * Math.cos(this.facing);
    // Разворот на месте — лапы переступают, будто идёт шагом
    const step = this.moving ? 0 : Math.min(Math.abs(turnRate) * TURN_STEP, D.walkRef * 0.9);
    blendAnims(hero, Math.max(this.horizontalSpeed, step), this.onGround, dt, shoulder && ahead < -0.3);
  }

  private integrate(dt: number, height: number): void {
    const { world, pos, vel } = this;
    let nx = pos.x + vel.x * dt;
    let nz = pos.z + vel.z * dt;
    // Стенки платформ — раздельно по осям, чтобы скользить вдоль
    if (world.blockedByPlatform(nx, pos.z, pos.y)) nx = pos.x;
    if (world.blockedByPlatform(nx, nz, pos.y)) nz = pos.z;
    // Круглые препятствия выталкивают наружу; камень, над которым герой уже поднялся, — нет
    const radius = 0.25 + 0.2 * height;
    for (const o of world.obstaclesNear(nx, nz, radius + 3)) {
      if (world.overObstacle(o, nx, nz, pos.y)) continue;
      const dx = nx - o.x, dz = nz - o.z;
      const d = Math.hypot(dx, dz), m = o.r + radius;
      if (d < m && d > 0) {
        nx = o.x + (dx / d) * m;
        nz = o.z + (dz / d) * m;
      }
    }
    const lim = world.half - 1.5;
    nx = clamp(nx, -lim, lim);
    nz = clamp(nz, -lim, lim);
    // Слишком крутой подъём и глубокая вода не пускают; по каждой оси отдельно — герой скользит вдоль
    if (this.onGround) {
      const here = world.waterDepth(pos.x, pos.z);
      const tooSteep = (x: number, z: number) => {
        const d = Math.hypot(x - pos.x, z - pos.z);
        if (d <= 1e-4 || world.groundAt(x, z, pos.y) > world.terrainAt(x, z) + 0.01) return false;
        const deep = world.waterDepth(x, z);
        if (deep > MAX_WADE_DEPTH && deep > here) return true;
        return world.terrainAt(x, z) - world.terrainAt(pos.x, pos.z) > MAX_WALK_SLOPE * d + 0.0005;
      };
      // Заблокированная ось теряет скорость — иначе герой «бежит на месте» и звучат шаги
      if (tooSteep(nx, nz)) {
        if (!tooSteep(nx, pos.z)) {
          nz = pos.z;
          vel.z = 0;
        } else if (!tooSteep(pos.x, nz)) {
          nx = pos.x;
          vel.x = 0;
        } else {
          nx = pos.x;
          nz = pos.z;
          vel.x = vel.z = 0;
        }
      }
    }
    pos.x = nx;
    pos.z = nz;
    pos.y += vel.y * dt;

    const g = world.groundAt(pos.x, pos.z, pos.y);
    // Сколько земля может уйти вниз за кадр на спуске, чтобы герой не «подпрыгивал»
    const stick = 0.12 + Math.hypot(vel.x, vel.z) * dt * 1.2;
    if (pos.y <= g) {
      pos.y = g;
      vel.y = 0;
      this.onGround = true;
    } else if (this.onGround && vel.y <= 0 && pos.y - g < stick) {
      pos.y = g;
      vel.y = 0;
    } else {
      this.onGround = pos.y - g < 0.02 && vel.y <= 0;
    }

    // На крутом склоне (не на платформе) герой съезжает вниз
    if (this.onGround && g <= world.terrainAt(pos.x, pos.z) + 0.01) {
      const s = world.slopeAt(pos.x, pos.z);
      if (s.slope > MAX_WALK_SLOPE) {
        const push = (s.slope - MAX_WALK_SLOPE) * 18 * dt;
        vel.x += s.dx * push;
        vel.z += s.dz * push;
      }
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
