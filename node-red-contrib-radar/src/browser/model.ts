import { FloorPlan, Point, Zone } from "../common/types";

export type Selection =
  | { kind: "zone"; id: string }
  | { kind: "radar"; id: string }
  | { kind: "plan" }
  | null;

export type Tool = "select" | "draw";

export type Tab = "zones" | "sensors" | "plan";

export type RadarChanges = { name?: string; transform?: number[] };

/**
 * Edits go through here. `preview: true` updates only the local copy (while
 * dragging); otherwise the change is sent to the server.
 */
export interface Editor {
  updateZones(zones: Zone[], preview?: boolean): void;
  updateRadar(id: string, changes: RadarChanges, preview?: boolean): void;
  removeRadar(id: string): void;
  updateFloorPlan(floorPlan: FloorPlan | null, preview?: boolean): void;
}

export type Targets = Record<string, Point[]>;
