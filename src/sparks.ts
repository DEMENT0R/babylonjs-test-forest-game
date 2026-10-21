// Искры серии: на длинной серии кристаллов за героем тянется след из огоньков цвета ступени.
// Частицы живут в мировых координатах, а источник едет с героем — получается след;
// по мере того как окно серии истекает, искр всё меньше.

import { Color4, ParticleSystem, Vector3, type Scene } from '@babylonjs/core';
import { dotTexture } from './particles';
import { settings } from './settings';

/** Цвет искр по ступени серии (как у счётчика в HUD): 1 — золото, 2 — сирень. */
const COLORS: Record<number, readonly [Color4, Color4]> = {
  1: [new Color4(1, 0.81, 0.35, 1), new Color4(1, 0.93, 0.62, 1)],
  2: [new Color4(0.94, 0.66, 1, 1), new Color4(0.75, 0.82, 1, 1)],
};
/** Искр в секунду на ступени, когда кристалл только что взят. */
const RATE: Record<number, number> = { 1: 36, 2: 60 };

export class Sparks {
  private readonly system: ParticleSystem;
  private readonly emitter = new Vector3();
  private tier = 0;

  constructor(scene: Scene) {
    const ps = (this.system = new ParticleSystem('combo-sparks', 200, scene));
    ps.particleTexture = dotTexture(scene);
    ps.emitter = this.emitter;
    ps.minEmitBox = new Vector3(-0.35, -0.3, -0.35);
    ps.maxEmitBox = new Vector3(0.35, 0.35, 0.35);
    ps.direction1 = new Vector3(-0.3, 0.2, -0.3);
    ps.direction2 = new Vector3(0.3, 0.6, 0.3);
    ps.minEmitPower = 0.1;
    ps.maxEmitPower = 0.4;
    // Огоньки медленно всплывают и гаснут
    ps.gravity = new Vector3(0, 0.35, 0);
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.2;
    ps.minSize = 0.08;
    ps.maxSize = 0.17;
    ps.emitRate = 0;
    // Не «add»: на светлом песке и снегу сложенный свет выгорает в белое и пропадает
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
  }

  /** center — где герой (null — героя нет), tier — ступень серии, left — доля окна серии. */
  update(center: Vector3 | null, tier: number, left: number): void {
    const ps = this.system;
    const colors = COLORS[tier];
    if (!center || !colors || !settings.particles) {
      ps.emitRate = 0;
      return;
    }
    if (tier !== this.tier) {
      this.tier = tier;
      [ps.color1, ps.color2] = colors;
      // Гаснет в прозрачность своего же цвета: при обычном смешивании уход в чёрный дал бы копоть
      ps.colorDead.set(colors[1].r, colors[1].g, colors[1].b, 0);
    }
    this.emitter.copyFrom(center);
    ps.emitRate = RATE[tier] * (0.3 + 0.7 * left);
  }
}
