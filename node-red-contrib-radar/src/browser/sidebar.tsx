import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FloorPlan, Radar, Zone, ZoneType } from "../common/types";
import {
  areaM2,
  formatMeters,
  normalizeAngle,
  poseToTransform,
  radarPose,
  zoneColor,
} from "./geometry";
import { Icon, IconName } from "./icons";
import { Editor, Selection, Tab, Targets } from "./model";
import { radarLabel } from "./radar";

type SidebarProps = {
  tab: Tab;
  onTabChange(tab: Tab): void;
  zones: Zone[];
  radars: Radar[];
  floorPlan: FloorPlan | null;
  activeIds: string[];
  targets: Targets;
  selection: Selection;
  onSelect(selection: Selection, reveal?: boolean): void;
  editor: Editor;
  onDrawZone(): void;
  onImportFile(file: File): void;
};

export function Sidebar(props: SidebarProps) {
  const { tab, zones, radars } = props;
  const tabs: Array<{ id: Tab; label: string; icon: IconName; count?: number }> = [
    { id: "zones", label: "Zones", icon: "zones", count: zones.length },
    { id: "sensors", label: "Sensors", icon: "radar", count: radars.length },
    { id: "plan", label: "Floor plan", icon: "image" },
  ];

  return (
    <aside className="sidebar">
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? " active" : ""}`}
            onClick={() => props.onTabChange(t.id)}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-body">
        {tab === "zones" && <ZonesPanel {...props} />}
        {tab === "sensors" && <SensorsPanel {...props} />}
        {tab === "plan" && <FloorPlanPanel {...props} />}
      </div>
    </aside>
  );
}

// ---- zones -------------------------------------------------------------------

function ZonesPanel(props: SidebarProps) {
  const { zones, selection, activeIds } = props;
  const selected =
    selection?.kind === "zone" ? zones.find((z) => z.id === selection.id) : undefined;

  return (
    <>
      <div className="panel-header">
        <h2>Zones</h2>
        <button className="button primary small" onClick={props.onDrawZone}>
          <Icon name="plus" size={16} /> Draw zone
        </button>
      </div>

      {zones.length === 0 ? (
        <Empty icon="zones" title="No zones yet">
          Draw a zone on the map. Click to place corners, or drag to draw a
          rectangle.
        </Empty>
      ) : (
        <ul className="list">
          {zones.map((zone) => {
            const active = activeIds.includes(zone.id);
            return (
              <li key={zone.id}>
                <button
                  className={`list-item${selected === zone ? " selected" : ""}`}
                  onClick={() => props.onSelect({ kind: "zone", id: zone.id }, true)}
                >
                  <span className="swatch" style={{ background: zoneColor(zone) }} />
                  <span className="list-title">{zone.id}</span>
                  {zone.type === "exclusion" ? (
                    <span className="badge">Exclusion</span>
                  ) : active ? (
                    <span className="badge success">
                      <span className="pulse" /> Occupied
                    </span>
                  ) : (
                    <span className="badge muted">Empty</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && <ZoneInspector key={selected.id} zone={selected} {...props} />}
    </>
  );
}

function ZoneInspector({
  zone,
  zones,
  editor,
  onSelect,
}: SidebarProps & { zone: Zone }) {
  const update = (patch: Partial<Zone>) =>
    editor.updateZones(zones.map((z) => (z.id === zone.id ? { ...z, ...patch } : z)));
  const exclusion = zone.type === "exclusion";

  return (
    <section className="inspector">
      <h3>
        <span className="swatch" style={{ background: zoneColor(zone) }} />
        Zone settings
      </h3>

      <Field label="Name" hint="Sent to your flows as msg.topic.">
        <TextInput
          value={zone.id}
          validate={(v) =>
            !v.trim()
              ? "A name is required"
              : zones.some((z) => z !== zone && z.id === v.trim())
                ? "Another zone already has this name"
                : null
          }
          onCommit={(v) => {
            const id = v.trim();
            editor.updateZones(zones.map((z) => (z.id === zone.id ? { ...z, id } : z)));
            onSelect({ kind: "zone", id });
          }}
        />
      </Field>

      <Field label="Type">
        <Segmented<ZoneType>
          value={zone.type ?? "presence"}
          options={[
            { value: "presence", label: "Presence" },
            { value: "exclusion", label: "Exclusion" },
          ]}
          onChange={(type) => update({ type })}
        />
      </Field>
      <p className="help">
        {exclusion
          ? "Targets inside an exclusion zone are ignored everywhere, e.g. a fan, a curtain or a plant that moves."
          : "Reports when people enter or leave."}
      </p>

      <dl className="facts">
        <dt>Corners</dt>
        <dd>{zone.points.length}</dd>
        <dt>Area</dt>
        <dd>{areaM2(zone.points).toFixed(1)} m²</dd>
      </dl>

      <p className="help">
        <Icon name="info" size={14} /> Drag the zone to move it, drag a corner to
        reshape it, drag a <b>+</b> on an edge to add a corner, and double-click
        a corner to remove it.
      </p>

      <ConfirmButton
        label="Delete zone"
        onConfirm={() => {
          editor.updateZones(zones.filter((z) => z.id !== zone.id));
          onSelect(null);
        }}
      />
    </section>
  );
}

// ---- sensors -----------------------------------------------------------------

function SensorsPanel(props: SidebarProps) {
  const { radars, selection, targets } = props;
  const selected =
    selection?.kind === "radar" ? radars.find((r) => r.id === selection.id) : undefined;

  return (
    <>
      <div className="panel-header">
        <h2>Sensors</h2>
      </div>
      {radars.length === 0 ? (
        <Empty icon="radar" title="No sensors yet">
          A sensor appears here as soon as the node receives its first message.
          Its <code>msg.topic</code> identifies it.
        </Empty>
      ) : (
        <ul className="list">
          {radars.map((radar) => {
            const count = targets[radar.id]?.length ?? 0;
            return (
              <li key={radar.id}>
                <button
                  className={`list-item${selected === radar ? " selected" : ""}`}
                  onClick={() => props.onSelect({ kind: "radar", id: radar.id }, true)}
                >
                  <span className="list-icon">
                    <Icon name="radar" size={16} />
                  </span>
                  <span className="list-text">
                    <span className="list-title">{radarLabel(radar)}</span>
                    {radar.name && <span className="list-subtitle mono">{radar.id}</span>}
                  </span>
                  <span className={`badge${count ? " success" : " muted"}`}>
                    {count} {count === 1 ? "target" : "targets"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected && <RadarInspector key={selected.id} radar={selected} {...props} />}
      <p className="help">
        <Icon name="info" size={14} /> Drag a sensor to move it and drag its round
        handle to turn it. The shaded wedge is its field of view (120°, about
        6 m).
      </p>
    </>
  );
}

function RadarInspector({
  radar,
  targets,
  editor,
  onSelect,
}: SidebarProps & { radar: Radar }) {
  const pose = radarPose(radar.transform);
  const setPose = (x: number, y: number, angle: number) =>
    editor.updateRadar(radar.id, { transform: poseToTransform(x, y, angle) });
  const live = targets[radar.id] ?? [];

  return (
    <section className="inspector">
      <h3>
        <Icon name="radar" size={16} /> Sensor settings
      </h3>
      <Field label="Name">
        <TextInput
          value={radar.name ?? ""}
          placeholder={radar.id}
          onCommit={(name) => editor.updateRadar(radar.id, { name })}
        />
      </Field>
      <Field label="Topic">
        <div className="readonly mono">{radar.id}</div>
      </Field>
      <div className="field-row">
        <Field label="X">
          <NumberInput
            value={pose.x / 1000}
            step={0.05}
            unit="m"
            onCommit={(v) => setPose(v * 1000, pose.y, pose.angle)}
          />
        </Field>
        <Field label="Y">
          <NumberInput
            value={pose.y / 1000}
            step={0.05}
            unit="m"
            onCommit={(v) => setPose(pose.x, v * 1000, pose.angle)}
          />
        </Field>
      </div>
      <Field label="Rotation">
        <div className="rotation-row">
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={Math.round(pose.angle)}
            onChange={(e) =>
              editor.updateRadar(
                radar.id,
                { transform: poseToTransform(pose.x, pose.y, Number(e.target.value)) },
                true
              )
            }
            onPointerUp={(e) =>
              setPose(pose.x, pose.y, Number((e.target as HTMLInputElement).value))
            }
            onKeyUp={(e) =>
              setPose(pose.x, pose.y, Number((e.target as HTMLInputElement).value))
            }
          />
          <NumberInput
            value={Math.round(pose.angle * 10) / 10}
            step={1}
            unit="°"
            onCommit={(v) => setPose(pose.x, pose.y, normalizeAngle(v))}
          />
        </div>
      </Field>

      <Field label="Live targets">
        {live.length === 0 ? (
          <div className="readonly muted">Nobody detected</div>
        ) : (
          <ul className="target-list mono">
            {live.map((t, i) => (
              <li key={i}>
                <span className="target-dot" /> {formatMeters(t.x)} across,{" "}
                {formatMeters(t.y)} ahead
              </li>
            ))}
          </ul>
        )}
      </Field>

      <ConfirmButton
        label="Remove sensor"
        hint="It reappears if it keeps sending data."
        onConfirm={() => {
          editor.removeRadar(radar.id);
          onSelect(null);
        }}
      />
    </section>
  );
}

// ---- floor plan ---------------------------------------------------------------

function FloorPlanPanel(props: SidebarProps) {
  const { floorPlan, editor, selection } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const [lockAspect, setLockAspect] = useState(true);
  const editing = selection?.kind === "plan";

  const pick = (
    <input
      ref={fileInput}
      type="file"
      accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) props.onImportFile(file);
        e.target.value = "";
      }}
    />
  );

  if (!floorPlan) {
    return (
      <>
        <div className="panel-header">
          <h2>Floor plan</h2>
        </div>
        <button className="dropzone" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" size={28} />
          <span className="dropzone-title">Import a floor plan</span>
          <span className="help">
            SVG, PNG or JPG. You can also drop a file on the map. SVG files whose
            viewBox is in millimetres are placed at the right size automatically.
          </span>
        </button>
        {pick}
      </>
    );
  }

  const set = (patch: Partial<FloorPlan>) => editor.updateFloorPlan({ ...floorPlan, ...patch });
  const aspect = floorPlan.height / floorPlan.width;

  return (
    <>
      <div className="panel-header">
        <h2>Floor plan</h2>
        <button
          className={`button small${editing ? " primary" : ""}`}
          onClick={() => props.onSelect(editing ? null : { kind: "plan" })}
        >
          {editing ? "Done" : "Adjust on map"}
        </button>
      </div>
      <div className="plan-preview">
        <img src={floorPlan.href} alt="Floor plan preview" />
      </div>
      {editing && (
        <p className="help">
          <Icon name="info" size={14} /> Drag the plan to move it and drag its
          corner handle to resize it.
        </p>
      )}
      <section className="inspector flat">
        <div className="field-row">
          <Field label="Left">
            <NumberInput
              value={floorPlan.x / 1000}
              step={0.05}
              unit="m"
              onCommit={(v) => set({ x: Math.round(v * 1000) })}
            />
          </Field>
          <Field label="Top">
            <NumberInput
              value={floorPlan.y / 1000}
              step={0.05}
              unit="m"
              onCommit={(v) => set({ y: Math.round(v * 1000) })}
            />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Width">
            <NumberInput
              value={floorPlan.width / 1000}
              step={0.1}
              min={0.5}
              unit="m"
              onCommit={(v) => {
                const width = Math.round(v * 1000);
                set(lockAspect ? { width, height: Math.round(width * aspect) } : { width });
              }}
            />
          </Field>
          <Field label="Height">
            <NumberInput
              value={floorPlan.height / 1000}
              step={0.1}
              min={0.5}
              unit="m"
              onCommit={(v) => {
                const height = Math.round(v * 1000);
                set(lockAspect ? { height, width: Math.round(height / aspect) } : { height });
              }}
            />
          </Field>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={lockAspect}
            onChange={(e) => setLockAspect(e.target.checked)}
          />
          Keep proportions
        </label>
        <Field label={`Opacity ${Math.round((floorPlan.opacity ?? 1) * 100)}%`}>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={floorPlan.opacity ?? 1}
            onChange={(e) =>
              editor.updateFloorPlan({ ...floorPlan, opacity: Number(e.target.value) }, true)
            }
            onPointerUp={(e) =>
              set({ opacity: Number((e.target as HTMLInputElement).value) })
            }
            onKeyUp={(e) => set({ opacity: Number((e.target as HTMLInputElement).value) })}
          />
        </Field>
        <div className="button-row">
          <button className="button" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={16} /> Replace
          </button>
          <ConfirmButton
            label="Remove"
            onConfirm={() => {
              editor.updateFloorPlan(null);
              props.onSelect(null);
            }}
          />
        </div>
      </section>
      {pick}
    </>
  );
}

// ---- controls ----------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    // a div, not a label: a label forwards clicks to the first button inside
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** Commits on Enter or blur, reverts on Escape. */
function TextInput({
  value,
  placeholder,
  validate,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  validate?(v: string): string | null;
  onCommit(v: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const error = validate?.(draft) ?? null;

  const commit = () => {
    if (draft === value) return;
    if (error) {
      setDraft(value);
      return;
    }
    onCommit(draft);
  };

  return (
    <>
      <input
        className={`input${error ? " invalid" : ""}`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {error && draft !== value && <span className="field-error">{error}</span>}
    </>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  unit,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onCommit(v: number): void;
}) {
  const decimals = step && step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  const format = (v: number) => String(Number(v.toFixed(Math.max(decimals, 1))));
  const [draft, setDraft] = useState(format(value));
  useEffect(() => setDraft(format(value)), [value]);

  const commit = () => {
    let v = Number(draft.replace(",", "."));
    if (!Number.isFinite(v) || draft.trim() === "") {
      setDraft(format(value));
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setDraft(format(v));
    if (v !== value) onCommit(v);
  };

  return (
    <span className="number-input">
      <input
        className="input"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(format(value));
            (e.target as HTMLInputElement).blur();
          }
          if ((e.key === "ArrowUp" || e.key === "ArrowDown") && step) {
            e.preventDefault();
            const base = Number(draft.replace(",", "."));
            if (!Number.isFinite(base)) return;
            let v = base + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1);
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            v = Number(v.toFixed(decimals));
            setDraft(format(v));
            onCommit(v);
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(v: T): void;
}) {
  return (
    <span className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "active" : undefined}
          onClick={() => value !== o.value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** Two-step delete: the first click arms it, the second confirms. */
function ConfirmButton({
  label,
  hint,
  onConfirm,
}: {
  label: string;
  hint?: string;
  onConfirm(): void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <span className="confirm">
      <button
        type="button"
        className={`button danger${armed ? " armed" : ""}`}
        onClick={() => (armed ? onConfirm() : setArmed(true))}
      >
        <Icon name="trash" size={16} />
        {armed ? "Click again to confirm" : label}
      </button>
      {hint && <span className="field-hint">{hint}</span>}
    </span>
  );
}

function Empty({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
