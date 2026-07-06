/**
 * Shared lat/lon -> tactical-map projection.
 *
 * The tactical map charts use 0-100 percentage coordinates. All hooks that
 * place real geographic positions on those charts must use the same mapping:
 * x derives from longitude (west -> east), y from latitude inverted (north at
 * the top, i.e. a ((latMax - lat) / span) * 100 mapping). Positions are scaled
 * into the displayed operating region so Bering Sea vessels do not cluster in
 * a corner of a world-scale projection.
 */

export interface MapRegion {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/** Bering Sea operating area shown on the fleet map. */
export const DEFAULT_MAP_REGION: MapRegion = { latMin: 50, latMax: 70, lonMin: -170, lonMax: -130 };

/** Convert a [[lonMin, latMin], [lonMax, latMax]] bounding box into a MapRegion. */
export function boundingBoxToRegion(box: [[number, number], [number, number]]): MapRegion {
  const [[lonMin, latMin], [lonMax, latMax]] = box;
  return { latMin, latMax, lonMin, lonMax };
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

/** Project a latitude/longitude pair into clamped 0-100 map coordinates. */
export function projectToMap(
  lat: number,
  lon: number,
  region: MapRegion = DEFAULT_MAP_REGION
): { x: number; y: number } {
  const lonSpan = region.lonMax - region.lonMin || 1;
  const latSpan = region.latMax - region.latMin || 1;
  return {
    x: clampPercent(((lon - region.lonMin) / lonSpan) * 100),
    y: clampPercent(((region.latMax - lat) / latSpan) * 100)
  };
}
