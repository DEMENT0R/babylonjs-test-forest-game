// Материалы для норы на уровне: шишка, жёлудь, камень, сосулька, перо, ракушка.
// Висят над землёй и мягко светятся, чтобы их было видно в траве, как кристаллы.

import { Color3, Mesh, MeshBuilder, StandardMaterial, type Scene } from '@babylonjs/core';
import { materialById, type MaterialId } from './catalog';

/**
 * Меш материала: главная часть, остальные — её дети (dispose убирает всё разом).
 * materials — куда сложить созданные материалы, чтобы уровень их потом освободил.
 */
export function materialMesh(scene: Scene, id: MaterialId, materials: StandardMaterial[]): Mesh {
  const mat = (c: readonly number[], alpha = 1) => {
    const m = new StandardMaterial(`pickup-${id}`, scene);
    m.diffuseColor = new Color3(c[0], c[1], c[2]);
    m.specularColor = new Color3(0.1, 0.1, 0.1);
    m.emissiveColor = m.diffuseColor.scale(0.55);
    m.alpha = alpha;
    materials.push(m);
    return m;
  };
  const color = materialById(id)!.color;
  const main = (m: Mesh, alpha = 1) => {
    m.material = mat(color, alpha);
    m.isPickable = false;
    return m;
  };
  const part = (parent: Mesh, m: Mesh, c: readonly number[], x: number, y: number, z: number) => {
    m.parent = parent;
    m.position.set(x, y, z);
    m.material = mat(c);
    m.isPickable = false;
    return m;
  };
  switch (id) {
    case 'cone': {
      const m = main(MeshBuilder.CreateCylinder('cone', { diameterTop: 0.06, diameterBottom: 0.3, height: 0.42, tessellation: 8 }, scene));
      for (let k = 0; k < 3; k++) {
        part(m, MeshBuilder.CreateTorus('cone-scale', { diameter: 0.28 - k * 0.07, thickness: 0.05, tessellation: 10 }, scene), [0.45, 0.28, 0.16], 0, -0.12 + k * 0.11, 0);
      }
      return m;
    }
    case 'acorn': {
      const m = main(MeshBuilder.CreateSphere('acorn', { diameter: 0.26, segments: 8 }, scene));
      m.scaling.y = 1.25;
      part(m, MeshBuilder.CreateSphere('acorn-cap', { diameter: 0.29, segments: 8, slice: 0.5 }, scene), [0.42, 0.3, 0.18], 0, 0.06, 0).scaling.y = 0.6;
      part(m, MeshBuilder.CreateCylinder('acorn-stem', { diameter: 0.03, height: 0.08, tessellation: 5 }, scene), [0.42, 0.3, 0.18], 0, 0.15, 0);
      return m;
    }
    case 'pebble': {
      const m = main(MeshBuilder.CreateSphere('pebble', { diameter: 0.4, segments: 8 }, scene));
      m.scaling.set(1, 0.5, 0.75);
      return m;
    }
    case 'icicle': {
      const m = main(MeshBuilder.CreateCylinder('icicle', { diameterTop: 0.16, diameterBottom: 0, height: 0.55, tessellation: 7 }, scene), 0.85);
      part(m, MeshBuilder.CreateCylinder('icicle-2', { diameterTop: 0.09, diameterBottom: 0, height: 0.3, tessellation: 6 }, scene), color, 0.1, 0.1, 0).material = m.material;
      return m;
    }
    case 'feather': {
      const m = main(MeshBuilder.CreateSphere('feather', { diameter: 0.5, segments: 8 }, scene));
      m.scaling.set(0.32, 1, 0.05);
      m.rotation.z = 0.5;
      part(m, MeshBuilder.CreateCylinder('quill', { diameter: 0.03, height: 0.62, tessellation: 4 }, scene), [0.95, 0.93, 0.85], 0, -0.06, 0).scaling.set(1 / 0.32, 1, 1 / 0.05);
      return m;
    }
    case 'shell': {
      const m = main(MeshBuilder.CreateSphere('shell', { diameter: 0.38, segments: 10, slice: 0.5 }, scene));
      m.scaling.set(1, 0.55, 0.85);
      part(m, MeshBuilder.CreateBox('shell-hinge', { width: 0.12, height: 0.06, depth: 0.08 }, scene), [0.95, 0.65, 0.6], 0, 0.02, -0.18);
      return m;
    }
  }
}
