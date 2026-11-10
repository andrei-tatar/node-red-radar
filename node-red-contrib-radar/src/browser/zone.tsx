import type { PointerEvent as ReactPointerEvent } from "react";
import { Point, Zone } from "../common/types";
import { beginDrag, centroid, zoneColor } from "./geometry";

export type MapContext = {
  /** mm per screen pixel */
  scale: number;
  toWorld(ev: { clientX: number; clientY: number }): Point;
  /** snaps a world point to the grid unless snapping is off or Alt is held */
  snap(p: Point, ev: { altKey: boolean }): Point;
};

export function ZoneShape({
  zone,
  active,
  selected,
  editable,
  ctx,
  onSelect,
  onChange,
}: {
  zone: Zone;
  active: boolean;
  selected: boolean;
  editable: boolean;
  ctx: MapContext;
  onSelect(): void;
  onChange(points: Point[], preview: boolean): void;
}) {
  const { scale } = ctx;
  const color = zoneColor(zone);
  const exclusion = zone.type === "exclusion";
  const points = zone.points;
  const label = centroid(points);

  const startMove = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect();
    if (!editable) return;

    const start = ctx.toWorld(e);
    const base = points;
    let last = base;
    beginDrag(e, {
      move(ev) {
        const w = ctx.toWorld(ev);
        // snap the first corner so the shape stays on the grid
        const anchor = ctx.snap(
          { x: base[0].x + w.x - start.x, y: base[0].y + w.y - start.y },
          ev
        );
        const dx = anchor.x - base[0].x,
          dy = anchor.y - base[0].y;
        last = base.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        onChange(last, true);
      },
      end(_ev, moved) {
        if (moved) onChange(last, false);
      },
    });
  };

  const dragCorner = (
    e: ReactPointerEvent,
    index: number,
    base: Point[],
    inserted: boolean
  ) => {
    let last = base;
    beginDrag(e, {
      move(ev) {
        const w = ctx.snap(ctx.toWorld(ev), ev);
        last = base.map((p, i) => (i === index ? w : p));
        onChange(last, true);
      },
      end(_ev, moved) {
        if (moved || inserted) onChange(last, false);
      },
    });
  };

  const removeCorner = (index: number) => {
    if (points.length > 3) {
      onChange(
        points.filter((_, i) => i !== index),
        false
      );
    }
  };

  const pointsAttr = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <g
      className={`zone${selected ? " selected" : ""}${active ? " active" : ""}${
        exclusion ? " exclusion" : ""
      }`}
      style={{ color }}
    >
      <polygon
        className="shape zone-body"
        points={pointsAttr}
        fill={exclusion ? "url(#hatch)" : "currentColor"}
        stroke="currentColor"
        strokeWidth={(selected || active ? 2.5 : 1.5) * scale}
        strokeDasharray={exclusion ? `${6 * scale} ${4 * scale}` : undefined}
        strokeLinejoin="round"
        onPointerDown={startMove}
      />
      <text
        className="map-label"
        x={label.x}
        y={label.y}
        fontSize={12 * scale}
        strokeWidth={3 * scale}
      >
        {zone.id}
      </text>

      {selected && editable && (
        <g className="handles">
          {points.map((p, i) => {
            const q = points[(i + 1) % points.length];
            const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
            return (
              <circle
                key={`m${i}`}
                className="shape midpoint-handle"
                cx={mid.x}
                cy={mid.y}
                r={4 * scale}
                strokeWidth={1.5 * scale}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  const base = [
                    ...points.slice(0, i + 1),
                    { x: Math.round(mid.x), y: Math.round(mid.y) },
                    ...points.slice(i + 1),
                  ];
                  onChange(base, true);
                  dragCorner(e, i + 1, base, true);
                }}
              >
                <title>Drag to add a corner</title>
              </circle>
            );
          })}
          {points.map((p, i) => (
            <circle
              key={`v${i}`}
              className="shape vertex-handle"
              cx={p.x}
              cy={p.y}
              r={5.5 * scale}
              strokeWidth={2 * scale}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                dragCorner(e, i, points, false);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                removeCorner(i);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                removeCorner(i);
              }}
            >
              <title>Drag to move · double-click to remove</title>
            </circle>
          ))}
        </g>
      )}
    </g>
  );
}
