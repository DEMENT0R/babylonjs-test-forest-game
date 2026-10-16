// Частицы в воздухе вокруг камеры: снегопад. Частицы живут в мировых координатах,
// а источник ездит за камерой — снег не «прилипает» к экрану при повороте.

import { Color4, DynamicTexture, ParticleSystem, Vector3, type Scene } from '@babylonjs/core';
import { onSettingsApplied, settings } from './settings';
import { wind, WIND_DIR } from './wind';

export type ParticleKind = 'snow';

/** Мягкая круглая точка — текстура для всех частиц. */
function dotTexture(scene: Scene): DynamicTexture {
  const size = 64;
  const tex = new DynamicTexture('particle-dot', size, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

export class AirParticles {
  private system: ParticleSystem | null = null;
  private texture: DynamicTexture | null = null;
  private readonly origin = new Vector3();
  private readonly unsubscribe: () => void;

  constructor(private readonly scene: Scene, private readonly kind: ParticleKind) {
    this.unsubscribe = onSettingsApplied((s) => this.toggle(s.particles));
    this.toggle(settings.particles);
  }

  private toggle(on: boolean): void {
    if (on === !!this.system) return;
    if (!on) {
      this.system?.dispose();
      this.system = null;
      return;
    }
    this.texture ??= dotTexture(this.scene);
    switch (this.kind) {
      case 'snow':
        this.system = this.createSnow();
        break;
    }
    this.system.start();
  }

  private createSnow(): ParticleSystem {
    const ps = new ParticleSystem('snow', 4000, this.scene);
    ps.particleTexture = this.texture;
    ps.emitter = this.origin;
    // Слой над камерой; падая, снег проходит через весь видимый объём
    ps.minEmitBox = new Vector3(-20, 4, -20);
    ps.maxEmitBox = new Vector3(20, 10, 20);
    ps.direction1 = new Vector3(-0.2, -1, -0.2);
    ps.direction2 = new Vector3(0.2, -1, 0.2);
    ps.minEmitPower = 0.6;
    ps.maxEmitPower = 1.2;
    ps.gravity = new Vector3(0, -0.4, 0);
    ps.minLifeTime = 7;
    ps.maxLifeTime = 11;
    ps.emitRate = 450;
    ps.minSize = 0.09;
    ps.maxSize = 0.2;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    // Снежинка проявляется, летит и тает
    ps.addColorGradient(0, new Color4(1, 1, 1, 0));
    ps.addColorGradient(0.1, new Color4(1, 1, 1, 0.9));
    ps.addColorGradient(0.85, new Color4(0.93, 0.96, 1, 0.85));
    ps.addColorGradient(1, new Color4(0.93, 0.96, 1, 0));
    return ps;
  }

  /** Источник частиц едет за камерой; снег сносит по ветру. */
  follow(camera: Vector3): void {
    this.origin.copyFrom(camera);
    if (this.system) {
      const drift = wind.strength * 0.25;
      this.system.gravity.set(WIND_DIR.x * drift, -0.4, WIND_DIR.z * drift);
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.system?.dispose();
    this.texture?.dispose();
  }
}
