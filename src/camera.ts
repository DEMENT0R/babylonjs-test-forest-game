// Камера от третьего лица: три режима, мышь/свайп/правый стик, захват курсора, колесо,
// отъезд от препятствий и медленный облёт поляны за главным меню.

import { Vector3 } from '@babylonjs/core';
import { BTN, gamepad } from './gamepad';
import type { Player } from './player';
import { onSettingsApplied, settings } from './settings';
import { clamp, damp, now, wrapAngle } from './utils';
import type { World } from './world';

export type CameraModeId = 'shoulder' | 'chase' | 'orbit';

export interface CameraMode {
  id: CameraModeId;
  name: string;
  /** Дистанция по умолчанию, м. */
  dist: number;
}

export const CAMERA_MODES: readonly CameraMode[] = [
  { id: 'shoulder', name: 'Из-за плеча', dist: 3.2 },
  { id: 'chase', name: 'За спиной', dist: 6.5 },
  { id: 'orbit', name: 'Свободная', dist: 7 },
];

const PITCH_MIN = -0.4;
const PITCH_MAX = 1.2;
const DIST_MIN = 2.2;
const DIST_MAX = 14;

export interface CameraRigOptions {
  /** Принимает ли камера ввод прямо сейчас (идёт игра и не открыты настройки). */
  isActive: () => boolean;
  /** Курсор освобождён не нами (например, браузер по Esc) — пора показать меню. */
  onPointerLockLost: () => void;
  onModeChange: (mode: CameraMode) => void;
}

export class CameraRig {
  yaw = 0;
  pitch = 0.28;
  private modeIndex = 0;
  private dist = CAMERA_MODES[0].dist;
  private curDist = this.dist;
  private lastLook = -9;
  private dragging: { id: number; x: number; y: number } | null = null;
  private ownRelease = false;
  private smoothTarget = new Vector3(0, 1.2, -2);
  private menuAngle = 0;

  constructor(
    private readonly world: World,
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: CameraRigOptions,
  ) {
    onSettingsApplied((s) => (world.camera.fov = (s.fov * Math.PI) / 180));
    this.bindInput();
  }

  get mode(): CameraMode {
    return CAMERA_MODES[this.modeIndex];
  }

  setMode(i: number): void {
    this.modeIndex = (i + CAMERA_MODES.length) % CAMERA_MODES.length;
    this.dist = this.mode.dist;
    if (this.mode.id !== 'shoulder') this.releaseLock();
    this.opts.onModeChange(this.mode);
  }

  cycleMode(): void {
    this.setMode(this.modeIndex + 1);
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 0.28;
  }

  /** Освободить курсор по своей инициативе (меню, настройки, смена режима). */
  releaseLock(): void {
    if (document.pointerLockElement) {
      this.ownRelease = true;
      document.exitPointerLock();
    }
  }

  cancelDrag(): void {
    this.dragging = null;
  }

  private look(dx: number, dy: number, k: number, sens = settings.sens): void {
    k *= sens;
    this.yaw += dx * k;
    this.pitch = clamp(this.pitch + (settings.invertY ? -dy : dy) * k, PITCH_MIN, PITCH_MAX);
    this.lastLook = now();
  }

  private bindInput(): void {
    const { canvas, opts } = this;
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) {
        if (!this.ownRelease) opts.onPointerLockLost();
        this.ownRelease = false;
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!opts.isActive()) return;
      canvas.focus();
      if (this.mode.id === 'shoulder' && e.pointerType === 'mouse' && document.pointerLockElement !== canvas) {
        try {
          // В части браузеров requestPointerLock возвращает промис, в части — undefined
          const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
          p?.catch?.(() => {});
        } catch {
          // Захват курсора недоступен (iframe без allow) — остаётся перетаскивание
        }
      }
      this.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // pointerId мог уже завершиться
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!opts.isActive()) return;
      if (document.pointerLockElement === canvas) {
        this.look(e.movementX, e.movementY, 0.0024);
        return;
      }
      const d = this.dragging;
      if (d && e.pointerId === d.id) {
        this.look(e.clientX - d.x, e.clientY - d.y, 0.006);
        d.x = e.clientX;
        d.y = e.clientY;
      }
    });
    const endDrag = (e: PointerEvent) => {
      if (this.dragging && e.pointerId === this.dragging.id) this.dragging = null;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!opts.isActive()) return;
        e.preventDefault();
        this.dist = clamp(this.dist + e.deltaY * 0.01, DIST_MIN, DIST_MAX);
      },
      { passive: false },
    );
  }

  /** Камера следует за игроком. Вызывать после player.update. */
  update(dt: number, player: Player): void {
    const hero = player.hero;
    if (!hero) return;
    const D = hero.def;
    const id = this.mode.id;

    // Правый стик крутит камеру, крестовина вверх/вниз приближает и отдаляет
    if (this.opts.isActive()) {
      const { x, y } = gamepad.look;
      if (x || y) this.look(x * dt, y * dt, 2.6, settings.padSens);
      const zoom = (gamepad.down(BTN.DOWN) ? 1 : 0) - (gamepad.down(BTN.UP) ? 1 : 0);
      if (zoom) this.dist = clamp(this.dist + zoom * 6 * dt, DIST_MIN, DIST_MAX);
    }

    // «За спиной»: пока игрок бежит вперёд и не крутит мышью, камера сама заходит ему за спину
    if (id === 'chase' && player.moving && player.inputZ > -0.3 && now() - this.lastLook > 0.8) {
      const d = wrapAngle(player.facing - this.yaw);
      this.yaw += d * damp(2.2, dt * Math.min(1, player.horizontalSpeed / 4));
    }

    const bs = D.height / 2.1;
    const camH = D.height * 0.82 + 0.1;
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const shoulder = id === 'shoulder' ? 0.3 + 0.35 * bs : 0;
    const target = player.pos.add(new Vector3(0, id === 'shoulder' ? camH + 0.1 : camH, 0)).add(right.scale(shoulder));
    this.smoothTarget = Vector3.Lerp(this.smoothTarget, target, damp(14, dt));

    const lookDir = new Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    let want = this.dist * (0.6 + 0.4 * bs);
    // Деревья и камни между камерой и героем — подъезжаем ближе
    const hit = this.world.cameraHit(this.smoothTarget, lookDir.scale(-1), want);
    if (hit !== null) want = Math.max(0.9, hit - 0.3);
    // Приближаемся мгновенно, отъезжаем плавно
    this.curDist = want < this.curDist ? want : this.curDist + (want - this.curDist) * damp(3, dt);

    const cam = this.world.camera;
    const cp = this.smoothTarget.subtract(lookDir.scale(this.curDist));
    cp.y = Math.max(cp.y, this.world.floorAt(cp.x, cp.z) + 0.35);
    cam.position.copyFrom(cp);
    cam.setTarget(cp.add(lookDir));
  }

  /** Запомнить текущий угол камеры вокруг центра, чтобы облёт продолжился без рывка. */
  beginMenuOrbit(center: Vector3): void {
    const p = this.world.camera.position;
    this.menuAngle = Math.atan2(p.z - center.z, p.x - center.x);
  }

  /** Медленный кинематографичный облёт поляны за главным меню. */
  updateMenuOrbit(dt: number, center: Vector3): void {
    this.menuAngle += dt * 0.05;
    const c = new Vector3(center.x, center.y + 1.2, center.z);
    const cam = this.world.camera;
    const x = c.x + Math.cos(this.menuAngle) * 15, z = c.z + Math.sin(this.menuAngle) * 15;
    cam.position.set(x, Math.max(c.y + 6.5, this.world.terrainAt(x, z) + 3), z);
    cam.setTarget(c.add(new Vector3(0, 0.8, 0)));
  }
}
