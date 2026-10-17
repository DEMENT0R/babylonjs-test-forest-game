// Метки заданий: столб света над поляной или озером, куда задание зовёт игрока.
// Столб видно поверх леса издалека; когда цель достигнута, метка гаснет.

import { Color3, MeshBuilder, StandardMaterial, type Mesh, type Scene } from '@babylonjs/core';
import type { LightingContext } from '../settings';

/** Высота столба, м — выше самых высоких деревьев. */
const BEAM_H = 16;
/** За сколько секунд гаснет метка достигнутой цели. */
const FADE = 0.8;
const BEAM_ALPHA = 0.45;

export interface MarkerSpot { id: number; x: number; y: number; z: number }

interface Marker { id: number; beam: Mesh; ring: Mesh; fade: number }

export class QuestMarkers {
  private readonly markers: Marker[] = [];
  private readonly beamM: StandardMaterial;
  private readonly ringM: StandardMaterial;
  private t = 0;

  constructor(
    scene: Scene,
    private readonly lighting: LightingContext,
    spots: readonly MarkerSpot[],
    color: Color3,
  ) {
    // Освещение на метку не действует: светится собственным цветом и днём, и ночью
    this.beamM = new StandardMaterial('marker-beam', scene);
    this.beamM.disableLighting = true;
    this.beamM.emissiveColor = color;
    this.beamM.alpha = BEAM_ALPHA;
    this.beamM.backFaceCulling = false;
    this.ringM = new StandardMaterial('marker-ring', scene);
    this.ringM.disableLighting = true;
    this.ringM.emissiveColor = color;

    for (const s of spots) {
      const beam = MeshBuilder.CreateCylinder('marker-beam', { height: BEAM_H, diameterTop: 0.6, diameterBottom: 1.4, tessellation: 12 }, scene);
      beam.position.set(s.x, s.y + BEAM_H / 2, s.z);
      beam.material = this.beamM;
      beam.isPickable = false;
      // Полупрозрачный столб в слое свечения расплывается в белое пятно — светится только кольцо
      lighting.glow?.addExcludedMesh(beam);
      const ring = MeshBuilder.CreateTorus('marker-ring', { diameter: 2.4, thickness: 0.12, tessellation: 32 }, scene);
      ring.position.set(s.x, s.y + 0.15, s.z);
      ring.material = this.ringM;
      ring.isPickable = false;
      this.markers.push({ id: s.id, beam, ring, fade: 1 });
    }
  }

  /** reached — достигнута ли цель с этим номером; такие метки плавно гаснут. */
  update(dt: number, reached: (id: number) => boolean): void {
    this.t += dt;
    this.beamM.alpha = BEAM_ALPHA * (0.8 + Math.sin(this.t * 2) * 0.2);
    for (const m of this.markers) {
      if (m.fade <= 0 || !reached(m.id)) continue;
      m.fade = Math.max(0, m.fade - dt / FADE);
      m.beam.scaling.set(m.fade, 1, m.fade);
      m.ring.scaling.setAll(1 + (1 - m.fade) * 1.5);
      m.ring.visibility = m.fade;
      if (m.fade === 0) {
        m.beam.setEnabled(false);
        m.ring.setEnabled(false);
      }
    }
  }

  dispose(): void {
    for (const m of this.markers) {
      this.lighting.glow?.removeExcludedMesh(m.beam);
      m.beam.dispose();
      m.ring.dispose();
    }
    this.beamM.dispose();
    this.ringM.dispose();
  }
}
