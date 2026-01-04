import { readFile, writeFile } from "node:fs/promises";
import {
  watchFile as nodeWatchFile,
  unwatchFile,
  StatsListener,
} from "node:fs";

import { Radar, Zone } from "./common/types";
import {
  catchError,
  defer,
  distinctUntilChanged,
  map,
  merge,
  Observable,
  of,
  Subject,
  switchMap,
  throttleTime,
} from "rxjs";
import { createHash } from "node:crypto";
import { shareLastValue } from "./common/util";

export type Config = {
  zones: Zone[];
  radars: Radar[];
};

const reloadConfig$ = new Subject<void>();

export async function saveConfig(configFileName: string, config: Config) {
  const content = JSON.stringify(config, undefined, 2);
  await writeFile(configFileName, content);
  reloadConfig$.next();
}

export function loadConfig(configFileName: string): Observable<Config> {
  const watchFile$ = new Observable<void>((observer) => {
    const listener: StatsListener = () => {
      observer.next();
    };
    nodeWatchFile(configFileName, listener).unref();
    observer.next();
    return () => unwatchFile(configFileName, listener);
  }).pipe(throttleTime(1000));

  return merge(watchFile$, reloadConfig$).pipe(
    switchMap(() =>
      defer(() => readFile(configFileName)).pipe(
        catchError(() => {
          const defaultConfig: Config = {
            zones: [],
            radars: [],
          };
          return of(Buffer.from(JSON.stringify(defaultConfig)));
        })
      )
    ),
    distinctUntilChanged(
      (a, b) => a === b,
      (data) => createHash("md5").update(data).digest("hex")
    ),
    map((data) => JSON.parse(data.toString()) as Config),
    shareLastValue()
  );
}
