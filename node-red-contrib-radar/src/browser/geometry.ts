import { FloorPlan, Point, Radar, Zone } from "../common/types";

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** grid snapping step, mm */
export const SNAP_MM = 100;
/** rotation snapping step, degrees */
export const SNAP_DEG = 5;

/** LD2450 field of view: ±60° and about 6 m */
export const RADAR_HALF_FOV_DEG = 60;
export const RADAR_RANGE_MM = 6000;

export const round = (v: number, step: number) =>
  step > 0 ? Math.round(v / step) * step : Math.round(v);

export function snapPoint(p: Point, step: number): Point {
  return { x: round(p.x, step), y: round(p.y, step) };
}

export function centroid(points: Point[]): Point {
  // area-weighted centroid; falls back to the vertex average
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-6) {
    const n = points.length || 1;
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** polygon area in m² */
export function areaM2(points: Point[]) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2 / 1e6;
}

export function boundsOfPoints(points: Point[]): Bounds | null {
  if (!points.length) {
    return null;
  }
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

export function contentBounds(
  zones: Zone[],
  radars: Radar[],
  floorPlan: FloorPlan | null
): Bounds | null {
  const points: Point[] = zones.flatMap((z) => z.points);
  for (const r of radars) {
    const { x, y } = radarPose(r.transform);
    points.push({ x: x - 1500, y: y - 1500 }, { x: x + 1500, y: y + 1500 });
  }
  if (floorPlan) {
    points.push(
      { x: floorPlan.x, y: floorPlan.y },
      { x: floorPlan.x + floorPlan.width, y: floorPlan.y + floorPlan.height }
    );
  }
  return boundsOfPoints(points);
}

/** Position (mm) and rotation (degrees) of a radar transform. */
export function radarPose(t: number[]) {
  const [a, b, , , e, f] = t;
  return { x: e, y: f, angle: (Math.atan2(b, a) * 180) / Math.PI };
}

export function poseToTransform(x: number, y: number, angleDeg: number) {
  const r = (angleDeg * Math.PI) / 180;
  const c = Math.cos(r),
    s = Math.sin(r);
  const n = (v: number) => Math.round(v * 1e6) / 1e6;
  return [n(c), n(s), n(-s), n(c), Math.round(x), Math.round(y)];
}

/** normalizes to (-180, 180] */
export function normalizeAngle(deg: number) {
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return a;
}

const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
];

export const EXCLUSION_COLOR = "#ef4444";

export function zoneColor(zone: Zone) {
  if (zone.type === "exclusion") {
    return EXCLUSION_COLOR;
  }
  let h = 0;
  for (const ch of zone.id) {
    h = (h * 31 + ch.charCodeAt(0)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function uniqueZoneName(zones: Zone[], base = "Zone") {
  for (let i = zones.length + 1; ; i++) {
    const name = `${base} ${i}`;
    if (!zones.some((z) => z.id === name)) {
      return name;
    }
  }
}

/** drops consecutive points closer than `minDist` */
export function dedupePoints(points: Point[], minDist: number) {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) {
      out.push(p);
    }
  }
  if (
    out.length > 1 &&
    Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <
      minDist
  ) {
    out.pop();
  }
  return out;
}

export function formatMeters(mm: number) {
  return `${(mm / 1000).toFixed(2)} m`;
}

/**
 * Tracks a pointer drag with window listeners (so it survives re-renders).
 * `move` only starts once the pointer moved a few pixels; `end` reports
 * whether it did.
 */
export function beginDrag(
  start: { clientX: number; clientY: number },
  handlers: {
    move: (ev: PointerEvent) => void;
    end?: (ev: PointerEvent, moved: boolean) => void;
  }
) {
  let moved = false;
  const onMove = (ev: PointerEvent) => {
    if (
      !moved &&
      Math.hypot(ev.clientX - start.clientX, ev.clientY - start.clientY) < 3
    ) {
      return;
    }
    moved = true;
    handlers.move(ev);
  };
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    handlers.end?.(ev, moved);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}
