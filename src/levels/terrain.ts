// Рельеф уровня: высота земли в любой точке. Всё, что стоит на земле, —
// герой, деревья, трава, платформы, камера — берёт высоту отсюда.

export interface Terrain {
  heightAt(x: number, z: number): number;
}

/** Плоская земля на нулевой высоте. */
export const FLAT_TERRAIN: Terrain = { heightAt: () => 0 };
