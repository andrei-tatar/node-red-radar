import {
  combineLatest,
  concat,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  groupBy,
  ignoreElements,
  map,
  merge,
  Observable,
  of,
  ReplaySubject,
  scan,
  shareReplay,
  startWith,
  Subject,
  Subscription,
  switchMap,
  tap,
  timer,
  withLatestFrom,
} from "rxjs";
import { Point, Radar, Zone } from "./common/types";
import { applyToPoint, identity, Matrix } from "transformation-matrix";
import { Config, ConfigFile, Logger } from "./config";
import { shareLastValue } from "./common/util";

type ConfigReducer = (config: Config) => Config;
type ConfigState = { config: Config; dirty: boolean };

export type ActiveZones = {
  /** active zones */
  activeZones: string[];
  /** zones that just activated */
  activatedZones: string[];
  /** zones that just deactivated */
  deactivatedZones: string[];
};

const SAVE_DEBOUNCE_MS = 500;

export class RadarServer {
  private readonly modifyConfig$ = new Subject<ConfigReducer>();
  private readonly configFile: ConfigFile;
  private readonly subscription = new Subscription();
  /** config changed in memory but not yet written to disk */
  private pendingSave?: Config;
  private saving = Promise.resolve();

  readonly radars$: Observable<Radar[]>;
  readonly zones$: Observable<Zone[]>;
  readonly points$: Observable<Point[]>;
  readonly activeZones$: Observable<ActiveZones>;

  private readonly updateTargets$ = new Subject<{
    id: string;
    targets: Observable<Point[]>;
  }>();
  private readonly radarTargets$ = this.updateTargets$.pipe(
    groupBy((v) => v.id, {
      connector: () => new ReplaySubject(1),
    }),
    shareReplay()
  );

  constructor(
    configFileName: string,
    private readonly log: Logger = console
  ) {
    this.configFile = new ConfigFile(configFileName, log);

    // The in-memory config. A change on disk replaces it; edits (from the UI
    // or from new radars showing up) are applied on top and saved back.
    const config$ = merge(
      this.configFile.changes$.pipe(
        map(
          (config) => (): ConfigState => ({ config, dirty: false })
        )
      ),
      this.modifyConfig$.pipe(
        map((reducer) => (state: ConfigState | null) => {
          if (!state) {
            // not loaded yet
            return state;
          }
          const config = reducer(state.config);
          return config === state.config ? state : { config, dirty: true };
        })
      )
    ).pipe(
      scan(
        (state, apply) => apply(state),
        null as ConfigState | null
      ),
      filter((state): state is ConfigState => state !== null),
      distinctUntilChanged(),
      shareLastValue()
    );

    this.subscription.add(
      config$
        .pipe(
          tap((state) => {
            // an external edit of the file wins over unsaved changes
            this.pendingSave = state.dirty ? state.config : undefined;
          }),
          filter((state) => state.dirty),
          debounceTime(SAVE_DEBOUNCE_MS),
          concatMap(() => this.flush())
        )
        .subscribe()
    );

    this.radars$ = config$.pipe(
      map((state) => state.config.radars),
      distinctUntilChanged(),
      shareLastValue()
    );

    this.zones$ = config$.pipe(
      map((state) => state.config.zones),
      distinctUntilChanged(),
      shareLastValue()
    );

    this.points$ = this.radarTargets$.pipe(
      map((radarTargets$) => {
        const transform$ = this.radars$.pipe(
          map(
            (radars) =>
              radars.find((r) => r.id === radarTargets$.key)?.transform
          ),
          filter((v) => !!v),
          distinctUntilChanged(
            (a, b) =>
              a.length === b.length &&
              a.every((aValue, aIndex) => aValue === b[aIndex])
          ),
          map(([a, b, c, d, e, f]) => ({ a, b, c, d, e, f } as Matrix))
        );

        return radarTargets$.pipe(
          switchMap((r) => r.targets),
          withLatestFrom(transform$),
          map(([radarTargets, transform]) =>
            radarTargets.map((point): Point => applyToPoint(transform, point))
          ),
          shareLastValue({
            resetOnRefCountZero: () => timer(500),
          })
        );
      }),
      scan(
        (ctx, newItem) => ctx.concat([newItem]),
        [] as Array<Observable<Point[]>>
      ),
      switchMap((v) => combineLatest(v)),
      map((values) => values.flat()),
      startWith([] as Point[]),
      shareLastValue()
    );

    this.activeZones$ = combineLatest([this.points$, this.zones$]).pipe(
      map(([points, zones]) =>
        zones
          .filter((z) =>
            points.some((p) => this.isPointInsidePolygon(p, z.points))
          )
          .map((z) => z.id)
          .toSorted()
      ),
      distinctUntilChanged(
        (a, b) =>
          a.length === b.length &&
          a.every((aValue, aIndex) => b[aIndex] === aValue)
      ),
      scan(
        (previous, activeZones): ActiveZones => ({
          activeZones,
          activatedZones: activeZones.filter(
            (id) => !previous.activeZones.includes(id)
          ),
          deactivatedZones: previous.activeZones.filter(
            (id) => !activeZones.includes(id)
          ),
        }),
        {
          activeZones: [],
          activatedZones: [],
          deactivatedZones: [],
        } as ActiveZones
      ),
      shareLastValue()
    );
  }

  /** Stops watching the config file and writes any unsaved changes. */
  dispose(): Promise<void> {
    this.subscription.unsubscribe();
    return this.flush();
  }

  private flush(): Promise<void> {
    this.saving = this.saving.then(async () => {
      const config = this.pendingSave;
      if (!config) {
        return;
      }
      this.pendingSave = undefined;
      try {
        await this.configFile.save(config);
      } catch (err: any) {
        this.log.warn(`radar: failed to save config: ${err?.message ?? err}`);
      }
    });
    return this.saving;
  }

  /**
   * Feeds a radar frame. `payload` is `{targets: [{x, y}, ...]}` (in mm,
   * relative to the radar), either as an object or as a JSON string/Buffer.
   * @throws if the payload is not in that shape
   */
  radarInput(radarId: string, payload: unknown) {
    const newTargets = parseTargets(payload);

    this.modifyConfig$.next((config) => {
      if (config.radars.some((r) => r.id === radarId)) {
        return config;
      }
      const t = identity();
      return {
        ...config,
        radars: config.radars.concat([
          { id: radarId, transform: [t.a, t.b, t.c, t.d, t.e, t.f] },
        ]),
      };
    });

    this.updateTargets$.next({
      id: radarId,
      targets: concat(
        of(newTargets),
        timer(5000).pipe(ignoreElements()),
        of([]) //reset to empty after timeout
      ),
    });
  }

  getRadarTargets(radarId: string) {
    return this.radarTargets$.pipe(
      filter((v) => v.key === radarId),
      switchMap((v) => v),
      switchMap((v) => v.targets),
      startWith([] as Point[]),
      distinctUntilChanged((a, b) => a.length === 0 && b.length === 0)
    );
  }

  async updateRadarTransform(radarId: string, transform: number[]) {
    if (
      !Array.isArray(transform) ||
      transform.length !== 6 ||
      !transform.every(Number.isFinite)
    ) {
      throw new Error("invalid-transform");
    }

    const radars = await firstValueFrom(this.radars$);
    if (!radars.some((v) => v.id === radarId)) {
      throw new Error("radar-not-found");
    }

    this.modifyConfig$.next((config) => ({
      ...config,
      radars: config.radars.map((r) =>
        r.id === radarId ? { ...r, transform: [...transform] } : r
      ),
    }));
  }

  updateZones(zones: Zone[]) {
    if (!Array.isArray(zones) || !zones.every(isZone)) {
      throw new Error("invalid-zones");
    }
    this.modifyConfig$.next((config) => ({ ...config, zones }));
  }

  private isPointInsidePolygon(point: Point, polygonPoints: Point[]) {
    let inside = false;
    const { x, y } = point;

    for (
      let i = 0, j = polygonPoints.length - 1;
      i < polygonPoints.length;
      j = i++
    ) {
      const xi = polygonPoints[i].x,
        yi = polygonPoints[i].y;
      const xj = polygonPoints[j].x,
        yj = polygonPoints[j].y;

      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }

    return inside;
  }
}

function isPoint(p: any): p is Point {
  return Number.isFinite(p?.x) && Number.isFinite(p?.y);
}

function isZone(z: any): z is Zone {
  return (
    typeof z?.id === "string" &&
    Array.isArray(z.points) &&
    z.points.every(isPoint)
  );
}

function parseTargets(payload: unknown): Point[] {
  const data: any =
    typeof payload === "string" || Buffer.isBuffer(payload)
      ? JSON.parse(payload.toString())
      : payload;

  if (!Array.isArray(data?.targets)) {
    throw new Error("expected msg.payload to be {targets: [{x, y}, ...]}");
  }

  // the LD2450's x axis is mirrored relative to the house plan
  return data.targets.filter(isPoint).map((t: Point) => ({ x: -t.x, y: t.y }));
}
