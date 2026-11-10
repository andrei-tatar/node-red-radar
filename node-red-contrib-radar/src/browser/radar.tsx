import type { PointerEvent as ReactPointerEvent } from "react";
import { Point, Radar } from "../common/types";
import {
  beginDrag,
  normalizeAngle,
  poseToTransform,
  radarPose,
  RADAR_HALF_FOV_DEG,
  RADAR_RANGE_MM,
  round,
  SNAP_DEG,
} from "./geometry";
import { MapContext } from "./zone";

const rad = (deg: number) => (deg * Math.PI) / 180;

/** arc in radar coordinates (facing +y), from -half to +half the FOV */
function arc(r: number) {
  const sx = Math.sin(rad(RADAR_HALF_FOV_DEG)) * r;
  const sy = Math.cos(rad(RADAR_HALF_FOV_DEG)) * r;
  return { sx, sy, d: `M${-sx} ${sy} A${r} ${r} 0 0 0 ${sx} ${sy}` };
}

export function radarLabel(radar: Radar) {
  return radar.name || radar.id;
}

export function RadarShape({
  radar,
  targets,
  selected,
  editable,
  snapAngle,
  ctx,
  onSelect,
  onChange,
}: {
  radar: Radar;
  targets: Point[];
  selected: boolean;
  editable: boolean;
  snapAngle: boolean;
  ctx: MapContext;
  onSelect(): void;
  onChange(transform: number[], preview: boolean): void;
}) {
  const { scale } = ctx;
  const [a, b, c, d, e, f] = radar.transform;
  const pose = radarPose(radar.transform);
  const fov = arc(RADAR_RANGE_MM);
  const handleDistance = 64 * scale;

  const startMove = (ev: ReactPointerEvent) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    onSelect();
    if (!editable) return;

    const start = ctx.toWorld(ev);
    const offset = { x: start.x - pose.x, y: start.y - pose.y };
    let last = radar.transform;
    beginDrag(ev, {
      move(m) {
        const w = ctx.toWorld(m);
        const p = ctx.snap({ x: w.x - offset.x, y: w.y - offset.y }, m);
        last = poseToTransform(p.x, p.y, pose.angle);
        onChange(last, true);
      },
      end(_m, moved) {
        if (moved) onChange(last, false);
      },
    });
  };

  const startRotate = (ev: ReactPointerEvent) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    let last = radar.transform;
    beginDrag(ev, {
      move(m) {
        const w = ctx.toWorld(m);
        // the radar faces its local +y axis, i.e. 90° from its rotation
        const facing =
          (Math.atan2(w.y - pose.y, w.x - pose.x) * 180) / Math.PI;
        const step = snapAngle && !m.altKey ? SNAP_DEG : 0.5;
        const angle = normalizeAngle(round(facing - 90, step));
        last = poseToTransform(pose.x, pose.y, angle);
        onChange(last, true);
      },
      end(_m, moved) {
        if (moved) onChange(last, false);
      },
    });
  };

  return (
    <g className={`radar${selected ? " selected" : ""}`}>
      <g transform={`matrix(${a} ${b} ${c} ${d} ${e} ${f})`}>
        <path
          className="radar-fov"
          d={`M0 0 L${-fov.sx} ${fov.sy} A${RADAR_RANGE_MM} ${RADAR_RANGE_MM} 0 0 0 ${fov.sx} ${fov.sy} Z`}
          strokeWidth={1 * scale}
        />
        {[2000, 4000].map((r) => (
          <path
            key={r}
            className="radar-ring"
            d={arc(r).d}
            strokeWidth={1 * scale}
            strokeDasharray={`${4 * scale} ${4 * scale}`}
          />
        ))}

        {targets.map((t, i) => (
          <circle
            key={i}
            className="target"
            cx={t.x}
            cy={t.y}
            r={Math.max(170, 6 * scale)}
            strokeWidth={2 * scale}
          />
        ))}

        {selected && editable && (
          <>
            <line
              className="rotate-arm"
              x1={0}
              y1={0}
              x2={0}
              y2={handleDistance}
              strokeWidth={1.5 * scale}
            />
            <circle
              className="shape rotate-handle"
              cx={0}
              cy={handleDistance}
              r={7 * scale}
              strokeWidth={2 * scale}
              onPointerDown={startRotate}
            >
              <title>Drag to rotate · hold Alt for free rotation</title>
            </circle>
          </>
        )}

        <rect
          className="shape radar-body"
          x={-11 * scale}
          y={-7 * scale}
          width={22 * scale}
          height={14 * scale}
          rx={4 * scale}
          strokeWidth={2 * scale}
          onPointerDown={startMove}
        >
          <title>{radar.id}</title>
        </rect>
        <path
          className="radar-notch"
          d={`M${-4 * scale} ${2 * scale} L0 ${6 * scale} L${4 * scale} ${2 * scale}`}
          strokeWidth={1.5 * scale}
        />
      </g>
      <text
        className="map-label radar-label"
        x={pose.x}
        y={pose.y - 18 * scale}
        fontSize={11 * scale}
        strokeWidth={3 * scale}
      >
        {radarLabel(radar)}
      </text>
    </g>
  );
}
