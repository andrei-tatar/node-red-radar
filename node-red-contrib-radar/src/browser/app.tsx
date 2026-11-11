import { useEffect, useMemo, useRef, useState } from "react";
import { Observable } from "rxjs";
import { FloorPlan, Point, Radar, Zone } from "../common/types";
import { retryRpc, rpc, wsStatus$ } from "./ws";
import { useObservable } from "./util";
import { MapView } from "./map";
import { Sidebar } from "./sidebar";
import { Icon } from "./icons";
import { Editor, RadarChanges, Selection, Tab, Targets, Tool } from "./model";
import { contentBounds, uniqueZoneName } from "./geometry";

const NO_ZONES: Zone[] = [];
const NO_RADARS: Radar[] = [];

export function App({ readonly }: { readonly: boolean }) {
  return readonly ? <EmbedView /> : <EditorView />;
}

/** Read-only live view, for embedding in a dashboard (`?embed`). */
function EmbedView() {
  const zones = useObservable(rpc.zones.all);
  const radars = useObservable(rpc.radars.all);
  const floorPlan = useObservable(rpc.floorPlan.get);
  const activeIds = useObservable(rpc.zones.activeZoneIds);
  const points = useObservable(rpc.points);

  return (
    <MapView
      readonly
      loaded={zones !== undefined && floorPlan !== undefined}
      zones={zones ?? NO_ZONES}
      radars={radars ?? NO_RADARS}
      floorPlan={floorPlan ?? null}
      activeIds={activeIds ?? []}
      targets={{}}
      points={points ?? []}
      selection={null}
      onSelect={() => {}}
      tool="select"
      onToolChange={() => {}}
      snap={false}
      onSnapChange={() => {}}
      editor={NOOP_EDITOR}
      onZoneDrawn={() => {}}
      revealNonce={0}
    />
  );
}

const NOOP_EDITOR: Editor = {
  updateZones() {},
  updateRadar() {},
  removeRadar() {},
  updateFloorPlan() {},
};

function EditorView() {
  const serverZones = useObservable(rpc.zones.all);
  const serverRadars = useObservable(rpc.radars.all);
  const serverPlan = useObservable(rpc.floorPlan.get);
  const activeIds = useObservable(rpc.zones.activeZoneIds) ?? [];
  const status = useObservable(wsStatus$);

  // Local copies: edits show up immediately, and while something is being
  // dragged, server updates for that collection are held back.
  const [zones, setZones] = useState<Zone[]>([]);
  const [radars, setRadars] = useState<Radar[]>([]);
  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const server = useRef({ zones: NO_ZONES, radars: NO_RADARS, plan: null as FloorPlan | null });
  const previewing = useRef({ zones: false, radars: false, plan: false });

  useEffect(() => {
    if (!serverZones) return;
    server.current.zones = serverZones;
    if (!previewing.current.zones) setZones(serverZones);
  }, [serverZones]);
  useEffect(() => {
    if (!serverRadars) return;
    server.current.radars = serverRadars;
    if (!previewing.current.radars) setRadars(serverRadars);
  }, [serverRadars]);
  useEffect(() => {
    if (serverPlan === undefined) return;
    server.current.plan = serverPlan;
    if (!previewing.current.plan) setFloorPlan(serverPlan);
  }, [serverPlan]);

  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const notify = (text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  };

  const editor: Editor = useMemo(() => {
    const send = (call: Observable<unknown>, revert: () => void) =>
      call.subscribe({
        error: (err) => {
          notify(`Couldn't save: ${err?.message ?? err}`);
          revert();
        },
      });

    return {
      updateZones(next, preview = false) {
        previewing.current.zones = preview;
        setZones(next);
        if (!preview) send(rpc.zones.update(next), () => setZones(server.current.zones));
      },
      updateRadar(id, changes: RadarChanges, preview = false) {
        previewing.current.radars = preview;
        setRadars((rs) =>
          rs.map((r) =>
            r.id !== id
              ? r
              : {
                  ...r,
                  ...(changes.transform ? { transform: changes.transform } : {}),
                  ...(changes.name !== undefined ? { name: changes.name || undefined } : {}),
                }
          )
        );
        if (!preview) {
          send(rpc.radars.update(id, changes), () => setRadars(server.current.radars));
        }
      },
      removeRadar(id) {
        setRadars((rs) => rs.filter((r) => r.id !== id));
        send(rpc.radars.remove(id), () => setRadars(server.current.radars));
      },
      updateFloorPlan(plan, preview = false) {
        previewing.current.plan = preview;
        setFloorPlan(plan);
        if (!preview) {
          send(rpc.floorPlan.update(plan), () => setFloorPlan(server.current.plan));
        }
      },
    };
  }, []);

  const [selection, setSelection] = useState<Selection>(null);
  const [revealNonce, setRevealNonce] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [tab, setTab] = useState<Tab>("zones");
  const [snap, setSnap] = useState(() => loadSetting("snap", true));
  useEffect(() => saveSetting("snap", snap), [snap]);

  const select = (sel: Selection, reveal = false) => {
    setSelection(sel);
    if (sel?.kind === "zone") setTab("zones");
    if (sel?.kind === "radar") setTab("sensors");
    if (sel?.kind === "plan") setTab("plan");
    if (reveal) setRevealNonce((n) => n + 1);
  };

  // drop the selection when its object disappears
  useEffect(() => {
    if (
      (selection?.kind === "zone" && !zones.some((z) => z.id === selection.id)) ||
      (selection?.kind === "radar" && !radars.some((r) => r.id === selection.id)) ||
      (selection?.kind === "plan" && !floorPlan)
    ) {
      setSelection(null);
    }
  }, [zones, radars, floorPlan]);

  const targets = useRadarTargets(radars.map((r) => r.id));

  const onZoneDrawn = (points: Point[]) => {
    const zone: Zone = {
      id: uniqueZoneName(zones),
      points,
      type: "presence",
    };
    editor.updateZones([...zones, zone]);
    setTool("select");
    select({ kind: "zone", id: zone.id });
  };

  const importFloorPlan = async (file: File, center?: Point) => {
    try {
      const b = contentBounds(zones, radars, null);
      const plan = await readFloorPlan(
        file,
        center ?? (b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 })
      );
      editor.updateFloorPlan(plan);
      select({ kind: "plan" });
    } catch (err: any) {
      notify(err?.message ?? String(err));
    }
  };

  const loaded =
    serverZones !== undefined && serverRadars !== undefined && serverPlan !== undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="radar" size={18} />
          </span>
          <span>
            <strong>Radar zones</strong>
            <span className="brand-sub">
              {zones.length} zones · {radars.length} sensors
            </span>
          </span>
        </div>
        <div className="topbar-actions">
          <ConnectionPill status={status} />
          <a className="button ghost small" href="?embed" target="_blank" rel="noreferrer">
            <Icon name="external" size={16} /> Live view
          </a>
        </div>
      </header>

      <main className="workspace">
        <MapView
          readonly={false}
          loaded={loaded}
          zones={zones}
          radars={radars}
          floorPlan={floorPlan}
          activeIds={activeIds}
          targets={targets}
          selection={selection}
          onSelect={select}
          tool={tool}
          onToolChange={setTool}
          snap={snap}
          onSnapChange={setSnap}
          editor={editor}
          onZoneDrawn={onZoneDrawn}
          onFileDropped={importFloorPlan}
          revealNonce={revealNonce}
        />
        <Sidebar
          tab={tab}
          onTabChange={setTab}
          zones={zones}
          radars={radars}
          floorPlan={floorPlan}
          activeIds={activeIds}
          targets={targets}
          selection={selection}
          onSelect={select}
          editor={editor}
          onDrawZone={() => {
            setTool("draw");
            setSelection(null);
          }}
          onImportFile={(file) => importFloorPlan(file)}
        />
      </main>

      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
            <button
              className="icon-button"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              aria-label="Dismiss"
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectionPill({ status }: { status?: string }) {
  const label =
    status === "connected" ? "Live" : status === "connecting" ? "Connecting…" : "Offline";
  return (
    <span className={`pill ${status ?? "disconnected"}`} title="Connection to Node-RED">
      <span className="pill-dot" />
      {label}
    </span>
  );
}

/** Live targets of every radar, in radar coordinates. */
function useRadarTargets(ids: string[]): Targets {
  const [targets, setTargets] = useState<Targets>({});
  const key = ids.join("\n");
  useEffect(() => {
    const subs = ids.map((id) =>
      rpc.radars
        .radarTargets(id)
        .pipe(retryRpc())
        .subscribe({
          next: (points) => setTargets((t) => ({ ...t, [id]: points })),
          error: () => {},
        })
    );
    return () => subs.forEach((s) => s.unsubscribe());
  }, [key]);
  return targets;
}

const MAX_PLAN_BYTES = 8 * 1024 * 1024;

async function readFloorPlan(file: File, center: Point): Promise<FloorPlan> {
  if (!/^image\/(svg\+xml|png|jpeg|webp|gif)$/.test(file.type)) {
    throw new Error("Use an SVG, PNG, JPG, WebP or GIF image for the floor plan.");
  }
  if (file.size > MAX_PLAN_BYTES) {
    throw new Error("The floor plan image is larger than 8 MB.");
  }

  const href = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const centered = (width: number, height: number): FloorPlan => ({
    href,
    x: Math.round(center.x - width / 2),
    y: Math.round(center.y - height / 2),
    width: Math.round(width),
    height: Math.round(height),
  });

  if (file.type === "image/svg+xml") {
    const svg = new DOMParser().parseFromString(await file.text(), "image/svg+xml")
      .documentElement;
    const vb = svg
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    // a viewBox is assumed to be in millimetres, like the map
    if (vb?.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
      return { href, x: vb[0], y: vb[1], width: vb[2], height: vb[3] };
    }
    const w = lengthToMm(svg.getAttribute("width")),
      h = lengthToMm(svg.getAttribute("height"));
    if (w && h) {
      return centered(w, h);
    }
  }

  const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = href;
  });
  // a raster image has no scale: start at 10 m wide, then adjust
  const width = 10000;
  return centered(width, (width * size.h) / size.w);
}

function lengthToMm(value: string | null) {
  const m = value?.trim().match(/^([\d.]+)\s*(mm|cm|m)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const factor = m[2] === "m" ? 1000 : m[2] === "cm" ? 10 : 1;
  return Number.isFinite(n) && n > 0 ? n * factor : null;
}

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`radar.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function saveSetting(key: string, value: unknown) {
  try {
    localStorage.setItem(`radar.${key}`, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
}
