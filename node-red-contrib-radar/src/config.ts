import { readFile, rename, writeFile } from "node:fs/promises";
import {
  watchFile as nodeWatchFile,
  unwatchFile,
  StatsListener,
} from "node:fs";
import { createHash } from "node:crypto";
import { catchError, concatMap, defer, EMPTY, filter, Observable } from "rxjs";

import { FloorPlan, Radar, Zone } from "./common/types";

export type Config = {
  zones: Zone[];
  radars: Radar[];
  floorPlan?: FloorPlan;
};

export interface Logger {
  warn(msg: string): void;
}

const hash = (content: string) =>
  createHash("md5").update(content).digest("hex");

/** zone delays were removed; drop them from older config files */
function dropDelays(zone: any) {
  if (typeof zone !== "object" || zone === null) {
    return zone;
  }
  const { enterDelay: _enter, leaveDelay: _leave, ...rest } = zone;
  return rest;
}

function parseConfig(content: string): Config {
  if (!content.trim()) {
    return { zones: [], radars: [] };
  }
  const parsed = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object");
  }
  return {
    zones: Array.isArray(parsed.zones) ? parsed.zones.map(dropDelays) : [],
    radars: Array.isArray(parsed.radars) ? parsed.radars : [],
    ...(parsed.floorPlan ? { floorPlan: parsed.floorPlan } : {}),
  };
}

/**
 * A JSON config file on disk. `changes$` emits the parsed config on subscribe
 * and whenever the file changes on disk. Content this instance wrote itself is
 * not echoed back, and a file that can't be read or parsed is skipped (with a
 * warning), so the last good config stays in effect.
 */
export class ConfigFile {
  /** hash of the content last read or written successfully */
  private lastHash?: string;

  readonly changes$: Observable<Config>;

  constructor(private readonly fileName: string, private readonly log: Logger) {
    const fileChanged$ = new Observable<void>((observer) => {
      const listener: StatsListener = () => observer.next();
      nodeWatchFile(this.fileName, listener).unref();
      observer.next();
      return () => unwatchFile(this.fileName, listener);
    });

    this.changes$ = fileChanged$.pipe(
      // concatMap, not switchMap: read() records the hash it saw, so its
      // result must never be dropped
      concatMap(() =>
        defer(() => this.read()).pipe(
          catchError((err) => {
            this.log.warn(
              `radar: ignoring config file ${this.fileName}, keeping the previous config: ${err?.message ?? err}`
            );
            return EMPTY;
          })
        )
      ),
      filter((config): config is Config => config !== undefined)
    );
  }

  /** @returns the parsed config, or undefined if the content hasn't changed */
  private async read(): Promise<Config | undefined> {
    let content: string;
    try {
      content = await readFile(this.fileName, "utf8");
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
      content = "";
    }

    const contentHash = hash(content);
    if (contentHash === this.lastHash) {
      return undefined;
    }

    const config = parseConfig(content);
    this.lastHash = contentHash;
    return config;
  }

  async save(config: Config) {
    const content = JSON.stringify(config, undefined, 2);
    // set before writing so a watcher read racing the rename isn't echoed back
    this.lastHash = hash(content);
    const tmpFileName = this.fileName + ".tmp";
    await writeFile(tmpFileName, content);
    await rename(tmpFileName, this.fileName);
  }
}
