import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { FloorPlan, Point, Radar, Zone } from "../common/types";
import {
  beginDrag,
  Bounds,
  boundsOfPoints,
  contentBounds,
  dedupePoints,
  EXCLUSION_COLOR,
  radarPose,
  RADAR_RANGE_MM,
  SNAP_MM,
  snapPoint,
} from "./geometry";
import { Icon } from "./icons";
import { Editor, Selection, Targets, Tool } from "./model";
import { RadarShape } from "./radar";
import { MapContext, ZoneShape } from "./zone";
import { FloorPlanShape } from "./floorplan";

/** center (mm) and zoom (mm per screen pixel) */
type View = { cx: number; cy: number; scale: number };

const MIN_SCALE = 0.5;
const MAX_SCALE = 200;
const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const DEFAULT_BOUNDS: Bounds = { minX: -5000, minY: -1000, maxX: 5000, maxY: 7000 };

function fitView(bounds: Bounds | null, w: number, h: number): View {
  const b = bounds ?? DEFAULT_BOUNDS;
  const bw = Math.max(b.maxX - b.minX, 2000);
  const bh = Math.max(b.maxY - b.minY, 2000);
  return {
    cx: (b.minX + b.maxX) / 2,
    cy: (b.minY + b.maxY) / 2,
    scale: clamp(Math.max(bw / w, bh / h) * 1.12, MIN_SCALE, MAX_SCALE),
  };
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

export type MapViewProps = {
  readonly: boolean;
  loaded: boolean;
  zones: Zone[];
  radars: Radar[];
  floorPlan: FloorPlan | null;
  activeIds: string[];
  /** per radar, in radar coordinates (editor) */
  targets: Targets;
  /** in house coordinates (embed view) */
  points?: Point[];
  selection: Selection;
  onSelect(selection: Selection): void;
  tool: Tool;
  onToolChange(tool: Tool): void;
  snap: boolean;
  onSnapChange(snap: boolean): void;
  editor: Editor;
  onZoneDrawn(points: Point[]): void;
  onFileDropped?(file: File, center: Point): void;
  /** bump to pan the selection into view */
  revealNonce: number;
};

export function MapView(props: MapViewProps) {
  const {
    readonly,
    zones,
    radars,
    floorPlan,
    selection,
    tool,
    snap,
    editor,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const [cursor, setCursor] = useState<Point | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [rectDraft, setRectDraft] = useState<[Point, Point] | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(
    () => contentBounds(zones, radars, floorPlan),
    [zones, radars, floorPlan]
  );

  const fit = useCallback(() => {
    if (size.w > 0 && size.h > 0) {
      setView(fitView(bounds, size.w, size.h));
    }
  }, [bounds, size]);

  // fit once the data arrived; the embed view always fits
  const fitted = useRef(false);
  useEffect(() => {
    if (!size.w || !props.loaded) return;
    if (readonly || !fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [size, props.loaded, readonly, readonly ? bounds : null]);

  const scale = view?.scale ?? 10;

  const ctx: MapContext = useMemo(
    () => ({
      scale,
      toWorld(ev) {
        const v = viewRef.current;
        const rect = svgRef.current!.getBoundingClientRect();
        if (!v) return { x: 0, y: 0 };
        return {
          x: v.cx + (ev.clientX - rect.left - rect.width / 2) * v.scale,
          y: v.cy + (ev.clientY - rect.top - rect.height / 2) * v.scale,
        };
      },
      snap(p, ev) {
        return snapPoint(p, snap && !ev.altKey ? SNAP_MM : 0);
      },
    }),
    [scale, snap]
  );

  const zoomBy = (factor: number, around?: { px: number; py: number }) =>
    setView((v) => {
      if (!v) return v;
      const s = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const px = around?.px ?? 0,
        py = around?.py ?? 0;
      const wx = v.cx + px * v.scale,
        wy = v.cy + py * v.scale;
      return { scale: s, cx: wx - px * s, cy: wy - py * s };
    });

  // wheel zoom around the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      zoomBy(Math.exp(delta * 0.0015), {
        px: ev.clientX - rect.left - rect.width / 2,
        py: ev.clientY - rect.top - rect.height / 2,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // pan the selection into view when asked to
  useEffect(() => {
    if (!props.revealNonce || !view || !selection) return;
    let b: Bounds | null = null;
    if (selection.kind === "zone") {
      b = boundsOfPoints(zones.find((z) => z.id === selection.id)?.points ?? []);
    } else if (selection.kind === "radar") {
      const r = radars.find((r) => r.id === selection.id);
      if (r) {
        const { x, y } = radarPose(r.transform);
        b = { minX: x, minY: y, maxX: x, maxY: y };
      }
    }
    if (!b) return;
    const halfW = (size.w / 2) * view.scale,
      halfH = (size.h / 2) * view.scale;
    const visible =
      b.minX > view.cx - halfW &&
      b.maxX < view.cx + halfW &&
      b.minY > view.cy - halfH &&
      b.maxY < view.cy + halfH;
    if (!visible) {
      setView({
        ...view,
        cx: (b.minX + b.maxX) / 2,
        cy: (b.minY + b.maxY) / 2,
      });
    }
  }, [props.revealNonce]);

  // ---- drawing -----------------------------------------------------------

  const finishDraft = (points: Point[]) => {
    const clean = dedupePoints(points, 4 * scale);
    setDraft([]);
    setRectDraft(null);
    if (clean.length >= 3) {
      props.onZoneDrawn(clean);
    }
  };

  const onDrawPointerDown = (e: ReactPointerEvent) => {
    const p = ctx.snap(ctx.toWorld(e), e);
    if (draft.length >= 3) {
      const first = draft[0];
      if (Math.hypot(p.x - first.x, p.y - first.y) < 10 * scale) {
        finishDraft(draft);
        return;
      }
    }
    if (draft.length > 0) {
      setDraft([...draft, p]);
      return;
    }
    // first click: either a corner, or the start of a rectangle drag
    let corner = p;
    beginDrag(e, {
      move(ev) {
        corner = ctx.snap(ctx.toWorld(ev), ev);
        setRectDraft([p, corner]);
      },
      end(_ev, moved) {
        if (!moved) {
          setDraft([p]);
          return;
        }
        setRectDraft(null);
        if (Math.abs(corner.x - p.x) > 50 && Math.abs(corner.y - p.y) > 50) {
          finishDraft([
            p,
            { x: corner.x, y: p.y },
            corner,
            { x: p.x, y: corner.y },
          ]);
        }
      },
    });
  };

  useEffect(() => {
    if (tool !== "draw") {
      setDraft([]);
      setRectDraft(null);
    }
  }, [tool]);

  // ---- background: pan / deselect / draw --------------------------------

  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    if (e.button === 0 && tool === "draw" && !readonly) {
      onDrawPointerDown(e);
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    const start = viewRef.current;
    if (!start) return;
    beginDrag(e, {
      move(ev) {
        setView({
          ...start,
          cx: start.cx - (ev.clientX - e.clientX) * start.scale,
          cy: start.cy - (ev.clientY - e.clientY) * start.scale,
        });
      },
      end(_ev, moved) {
        if (!moved && !readonly && tool === "select") props.onSelect(null);
      },
    });
  };

  // ---- keyboard ------------------------------------------------------------

  useEffect(() => {
    if (readonly) return;
    const onKey = (ev: KeyboardEvent) => {
      if (isTyping(ev.target) || ev.ctrlKey || ev.metaKey) return;
      const key = ev.key.toLowerCase();
      if (key === "v") props.onToolChange("select");
      else if (key === "z") props.onToolChange("draw");
      else if (key === "f") fit();
      else if (key === "s") props.onSnapChange(!snap);
      else if (key === "+" || key === "=") zoomBy(1 / 1.25);
      else if (key === "-") zoomBy(1.25);
      else if (key === "escape") {
        if (draft.length) setDraft([]);
        else if (tool === "draw") props.onToolChange("select");
        else props.onSelect(null);
      } else if (key === "enter" && tool === "draw") finishDraft(draft);
      else if (key === "backspace" && tool === "draw" && draft.length) {
        ev.preventDefault();
        setDraft(draft.slice(0, -1));
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- render --------------------------------------------------------------

  const viewBox = view
    ? [
        view.cx - (size.w / 2) * view.scale,
        view.cy - (size.h / 2) * view.scale,
        size.w * view.scale,
        size.h * view.scale,
      ]
    : [0, 0, 1, 1];

  const selectedZoneId = selection?.kind === "zone" ? selection.id : null;
  // draw the selected zone last so its handles are on top
  const orderedZones = [
    ...zones.filter((z) => z.id !== selectedZoneId),
    ...zones.filter((z) => z.id === selectedZoneId),
  ];

  const minorGrid = scale < 12;
  const draftPreview =
    tool === "draw" && draft.length
      ? [...draft, ...(cursor ? [ctx.snap(cursor, { altKey: false })] : [])]
      : null;

  const onDrop = (e: DragEvent) => {
    const file = e.dataTransfer.files?.[0];
    if (!file || !props.onFileDropped) return;
    e.preventDefault();
    props.onFileDropped(file, ctx.toWorld(e));
  };

  return (
    <div
      className={`map tool-${tool}${readonly ? " readonly" : ""}`}
      ref={containerRef}
      onDragOver={(e) => props.onFileDropped && e.preventDefault()}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        className="map-svg"
        viewBox={viewBox.join(" ")}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={(e) => !readonly && setCursor(ctx.toWorld(e))}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={() => tool === "draw" && finishDraft(draft)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern
            id="grid-minor"
            width={100}
            height={100}
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M100 0H0V100"
              fill="none"
              className="grid-minor"
              strokeWidth={scale}
            />
          </pattern>
          <pattern
            id="grid-major"
            width={1000}
            height={1000}
            patternUnits="userSpaceOnUse"
          >
            {minorGrid && <rect width={1000} height={1000} fill="url(#grid-minor)" />}
            <path
              d="M1000 0H0V1000"
              fill="none"
              className="grid-major"
              strokeWidth={scale}
            />
          </pattern>
          <pattern
            id="hatch"
            width={10 * scale}
            height={10 * scale}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={10 * scale} height={10 * scale} fill={EXCLUSION_COLOR} fillOpacity={0.08} />
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={10 * scale}
              stroke={EXCLUSION_COLOR}
              strokeOpacity={0.45}
              strokeWidth={2 * scale}
            />
          </pattern>
          <radialGradient id="fov" cx={0} cy={0} r={RADAR_RANGE_MM} gradientUnits="userSpaceOnUse">
            <stop offset="0" className="fov-stop-a" />
            <stop offset="1" className="fov-stop-b" />
          </radialGradient>
        </defs>

        {!readonly && (
          <rect
            className="grid"
            x={viewBox[0]}
            y={viewBox[1]}
            width={viewBox[2]}
            height={viewBox[3]}
            fill="url(#grid-major)"
          />
        )}

        {floorPlan && (
          <FloorPlanShape
            plan={floorPlan}
            selected={selection?.kind === "plan"}
            editable={!readonly}
            ctx={ctx}
            onChange={(plan, preview) => editor.updateFloorPlan(plan, preview)}
          />
        )}

        <g className="zones">
          {orderedZones.map((zone) => (
            <ZoneShape
              key={zone.id}
              zone={zone}
              active={props.activeIds.includes(zone.id)}
              selected={zone.id === selectedZoneId}
              editable={!readonly}
              ctx={ctx}
              onSelect={() => props.onSelect({ kind: "zone", id: zone.id })}
              onChange={(points, preview) =>
                editor.updateZones(
                  zones.map((z) => (z.id === zone.id ? { ...z, points } : z)),
                  preview
                )
              }
            />
          ))}
        </g>

        {!readonly &&
          radars.map((radar) => (
            <RadarShape
              key={radar.id}
              radar={radar}
              targets={props.targets[radar.id] ?? []}
              selected={selection?.kind === "radar" && selection.id === radar.id}
              editable
              snapAngle={snap}
              ctx={ctx}
              onSelect={() => props.onSelect({ kind: "radar", id: radar.id })}
              onChange={(transform, preview) =>
                editor.updateRadar(radar.id, { transform }, preview)
              }
            />
          ))}

        {props.points?.map((p, i) => (
          <circle
            key={i}
            className="target"
            cx={p.x}
            cy={p.y}
            r={Math.max(170, 6 * scale)}
            strokeWidth={2 * scale}
          />
        ))}

        {draftPreview && (
          <g className="draft">
            <polyline
              points={draftPreview.map((p) => `${p.x},${p.y}`).join(" ")}
              strokeWidth={2 * scale}
              strokeDasharray={`${6 * scale} ${4 * scale}`}
            />
            {draft.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={(i === 0 && draft.length >= 3 ? 7 : 4.5) * scale}
                strokeWidth={2 * scale}
                className={i === 0 ? "draft-first" : undefined}
              />
            ))}
          </g>
        )}
        {rectDraft && (
          <g className="draft">
            <rect
              x={Math.min(rectDraft[0].x, rectDraft[1].x)}
              y={Math.min(rectDraft[0].y, rectDraft[1].y)}
              width={Math.abs(rectDraft[1].x - rectDraft[0].x)}
              height={Math.abs(rectDraft[1].y - rectDraft[0].y)}
              strokeWidth={2 * scale}
              strokeDasharray={`${6 * scale} ${4 * scale}`}
            />
          </g>
        )}
      </svg>

      {!readonly && (
        <>
          <div className="map-toolbar floating">
            <button
              className={`tool-button${tool === "select" ? " active" : ""}`}
              onClick={() => props.onToolChange("select")}
              title="Select and move (V)"
            >
              <Icon name="select" />
            </button>
            <button
              className={`tool-button${tool === "draw" ? " active" : ""}`}
              onClick={() => props.onToolChange("draw")}
              title="Draw a zone (Z)"
            >
              <Icon name="draw" />
              <span>Draw zone</span>
            </button>
            <span className="toolbar-sep" />
            <button
              className={`tool-button${snap ? " active" : ""}`}
              onClick={() => props.onSnapChange(!snap)}
              title="Snap to a 10 cm grid and 5° steps (S). Hold Alt to bypass."
            >
              <Icon name="magnet" />
              <span>Snap</span>
            </button>
          </div>

          {tool === "draw" && (
            <div className="map-hint floating">
              {draft.length === 0
                ? "Click to place corners, or drag to draw a rectangle"
                : draft.length < 3
                  ? "Keep clicking to add corners · Backspace undoes · Esc cancels"
                  : "Click the first corner, double-click or press Enter to finish"}
            </div>
          )}

          <div className="map-zoom floating">
            <button className="tool-button" onClick={() => zoomBy(1 / 1.25)} title="Zoom in (+)">
              <Icon name="plus" />
            </button>
            <button className="tool-button" onClick={() => zoomBy(1.25)} title="Zoom out (−)">
              <Icon name="minus" />
            </button>
            <button className="tool-button" onClick={fit} title="Fit everything (F)">
              <Icon name="fit" />
            </button>
          </div>

          <div className="map-status floating">
            <ScaleBar scale={scale} />
            {cursor && (
              <span className="mono">
                {(cursor.x / 1000).toFixed(2)}, {(cursor.y / 1000).toFixed(2)} m
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ScaleBar({ scale }: { scale: number }) {
  // pick a round length close to 90 px
  const target = 90 * scale;
  const steps = [100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const mm = steps.find((s) => s >= target) ?? steps[steps.length - 1];
  return (
    <span className="scale-bar">
      <span className="scale-bar-line" style={{ width: mm / scale }} />
      {mm >= 1000 ? `${mm / 1000} m` : `${mm / 10} cm`}
    </span>
  );
}
