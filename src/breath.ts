// Пар изо рта на морозе: облачко у морды героя на каждом выдохе; на бегу дышит чаще.
// Облачко подхватывает ветер, оно расплывается и тает.

import { Color4, ParticleSystem, Vector3, type Scene } from '@babylonjs/core';
import type { Hero } from './heroes';
import { dotTexture } from './particles';
import { settings } from './settings';
import { wind, WIND_DIR } from './wind';

/** Пауза между выдохами шагом и на бегу, с. */
const CALM = 2.4;
const PANT = 0.9;

export class Breath {
  private readonly system: ParticleSystem;
  private readonly emitter = new Vector3();
  private timer = 0;

  constructor(scene: Scene) {
    const ps = (this.system = new ParticleSystem('breath', 120, scene));
    ps.particleTexture = dotTexture(scene);
    ps.emitter = this.emitter;
    ps.minEmitBox = new Vector3(-0.03, -0.03, -0.03);
    ps.maxEmitBox = new Vector3(0.03, 0.03, 0.03);
    ps.minEmitPower = 0.25;
    ps.maxEmitPower = 0.55;
    ps.minLifeTime = 1.1;
    ps.maxLifeTime = 1.7;
    ps.emitRate = 0;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.addSizeGradient(0, 0.1);
    ps.addSizeGradient(1, 0.55);
    ps.addColorGradient(0, new Color4(1, 1, 1, 0));
    ps.addColorGradient(0.12, new Color4(0.97, 0.98, 1, 0.6));
    ps.addColorGradient(1, new Color4(0.92, 0.95, 1, 0));
    ps.start();
  }

  /** hero — герой в кадре (null — пара нет), running — бежит, frost — мороз в биоме. */
  update(dt: number, hero: Hero | null, running: boolean, frost: boolean): void {
    const ps = this.system;
    const drift = wind.strength * 0.35;
    ps.gravity.set(WIND_DIR.x * drift, 0.12, WIND_DIR.z * drift);
    if (!hero || !frost || !settings.particles) {
      this.timer = 0;
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = (running ? PANT : CALM) * (0.85 + Math.random() * 0.3);
    hero.mouthPosition(this.emitter);
    // Выдох вперёд и чуть вниз, облачко потом всплывает
    const fwd = hero.root.getDirection(Vector3.Forward());
    ps.direction1.set(fwd.x - 0.25, -0.25, fwd.z - 0.25);
    ps.direction2.set(fwd.x + 0.25, 0.05, fwd.z + 0.25);
    ps.manualEmitCount = running ? 9 : 7;
  }
}
