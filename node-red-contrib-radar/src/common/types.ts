export type Radar = {
  /** the MQTT topic the radar publishes on */
  id: string;
  /** display name; defaults to the id */
  name?: string;
  /** affine transform [a, b, c, d, e, f] from radar to house coordinates (mm) */
  transform: number[];
};

/**
 * "presence" zones report enter/leave events. Targets inside an "exclusion"
 * zone are ignored everywhere (fans, curtains, plants, ...).
 */
export type ZoneType = "presence" | "exclusion";

export type Zone = {
  id: string;
  points: Point[];
  /** defaults to "presence" */
  type?: ZoneType;
  /** seconds a target must stay inside before the zone activates (default 0) */
  enterDelay?: number;
  /** seconds the zone stays active after the last target left (default 0) */
  leaveDelay?: number;
};

/** An image (SVG or raster, usually a data: URL) placed on the map, in mm. */
export type FloorPlan = {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1, default 1 */
  opacity?: number;
};

export type Point = {
  x: number;
  y: number;
};

export function isPointInsidePolygon(point: Point, polygonPoints: Point[]) {
  let inside = false;
  const { x, y } = point;

  for (
    let i = 0, j = polygonPoints.length - 1;
    i < polygonPoints.length;
    j = i++
  ) {
    const xi = polygonPoints[i].x,
      yi = polygonPoints[i].y;
    const xj = polygonPoints[j].x,
      yj = polygonPoints[j].y;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}
