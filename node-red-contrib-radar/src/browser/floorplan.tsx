import type { PointerEvent as ReactPointerEvent } from "react";
import { FloorPlan } from "../common/types";
import { beginDrag } from "./geometry";
import { MapContext } from "./zone";

export function FloorPlanShape({
  plan,
  selected,
  editable,
  ctx,
  onChange,
}: {
  plan: FloorPlan;
  selected: boolean;
  editable: boolean;
  ctx: MapContext;
  onChange(plan: FloorPlan, preview: boolean): void;
}) {
  const { scale } = ctx;
  const active = selected && editable;

  const startMove = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = ctx.toWorld(e);
    let last = plan;
    beginDrag(e, {
      move(ev) {
        const w = ctx.toWorld(ev);
        const p = ctx.snap(
          { x: plan.x + w.x - start.x, y: plan.y + w.y - start.y },
          ev
        );
        last = { ...plan, x: p.x, y: p.y };
        onChange(last, true);
      },
      end(_ev, moved) {
        if (moved) onChange(last, false);
      },
    });
  };

  const startResize = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const aspect = plan.height / plan.width;
    let last = plan;
    beginDrag(e, {
      move(ev) {
        const w = ctx.toWorld(ev);
        const width = Math.max(500, Math.round(w.x - plan.x));
        last = { ...plan, width, height: Math.round(width * aspect) };
        onChange(last, true);
      },
      end(_ev, moved) {
        if (moved) onChange(last, false);
      },
    });
  };

  return (
    <g className={`floor-plan${active ? " selected" : ""}`}>
      <image
        href={plan.href}
        x={plan.x}
        y={plan.y}
        width={plan.width}
        height={plan.height}
        opacity={plan.opacity ?? 1}
        preserveAspectRatio="none"
        className={active ? "shape" : undefined}
        style={{ pointerEvents: active ? "auto" : "none" }}
        onPointerDown={active ? startMove : undefined}
      />
      {active && (
        <>
          <rect
            className="plan-outline"
            x={plan.x}
            y={plan.y}
            width={plan.width}
            height={plan.height}
            strokeWidth={1.5 * scale}
            strokeDasharray={`${6 * scale} ${4 * scale}`}
          />
          <rect
            className="shape resize-handle"
            x={plan.x + plan.width - 6 * scale}
            y={plan.y + plan.height - 6 * scale}
            width={12 * scale}
            height={12 * scale}
            strokeWidth={2 * scale}
            onPointerDown={startResize}
          >
            <title>Drag to resize</title>
          </rect>
        </>
      )}
    </g>
  );
}
