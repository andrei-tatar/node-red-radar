import {
  combineLatest,
  concat,
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
  share,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  throttleTime,
  timer,
  withLatestFrom,
} from "rxjs";
import { Point, Radar, Zone } from "./common/types";
import { applyToPoint, identity, Matrix } from "transformation-matrix";
import { loadConfig, saveConfig } from "./config";
import { shareLastValue } from "./common/util";

export class RadarServer {
  private updateRadars$ = new Subject<Radar[]>();
  private updateZones$ = new Subject<Zone[]>();

  constructor(configFileName: string) {
    const config$ = loadConfig(configFileName);

    this.saveConfigUpdates$ = combineLatest([
      config$,
      this.updateRadars$.pipe(startWith(null)),
      this.updateZones$.pipe(startWith(null)),
    ]).pipe(
      throttleTime(1000),
      switchMap(async ([config, updateRadars, updateZones]) => {
        const updated = { ...config };
        if (updateRadars) {
          updated.radars = updateRadars;
        }

        if (updateZones) {
          updated.zones = updateZones;
        }

        await saveConfig(configFileName, updated);
      }),
      ignoreElements(),
      share({ resetOnRefCountZero: true })
    );

    this.radars$ = merge(
      config$.pipe(map((cfg) => cfg.radars)),
      this.saveConfigUpdates$
    ).pipe(shareLastValue());

    this.zones$ = merge(
      config$.pipe(map((cfg) => cfg.zones)),
      this.saveConfigUpdates$
    ).pipe(shareLastValue());

    this.activeZones$ = combineLatest([this.points$, this.zones$]).pipe(
      map(([points, zones]) => {
        const activeZonesIds = zones
          .filter((z) =>
            points.length
              ? points.some((p) => this.isPointInsidePolygon(p, z.points))
              : false
          )
          .map((z) => z.id)
          .toSorted();

        return activeZonesIds;
      }),
      distinctUntilChanged(
        (a, b) =>
          a.length === b.length &&
          a.every((aValue, aIndex) => b[aIndex] === aValue)
      ),
      scan(
        (ctx, activeZones) => {
          const previouslyActiveZones = ctx.activeZones;
          const activatedZones = activeZones.filter(
            (id) => !previouslyActiveZones.includes(id)
          );
          const deactivatedZones = previouslyActiveZones.filter(
            (id) => !activeZones.includes(id)
          );

          ctx.activeZones = activeZones;
          ctx.activatedZones = activatedZones;
          ctx.deactivatedZones = deactivatedZones;

          return ctx;
        },
        {
          /** active zones */
          activeZones: [] as string[],
          /** zones that just activated */
          activatedZones: [] as string[],
          /** zones that just deactivated */
          deactivatedZones: [] as string[],
        }
      ),
      shareLastValue()
    );
  }

  private saveConfigUpdates$;
  readonly radars$;
  readonly zones$;
  readonly activeZones$;

  private updateTargets$ = new Subject<{
    id: string;
    targets: Observable<Point[]>;
  }>();
  private radarTargets$ = this.updateTargets$.pipe(
    groupBy((v) => v.id, {
      connector: () => new ReplaySubject(1),
    }),
    shareReplay()
  );

  points$ = this.radarTargets$.pipe(
    map((radarTargets$) => {
      const transform$ = this.radars$.pipe(
        map(
          (radars) => radars.find((r) => r.id === radarTargets$.key)?.transform
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
        map(([radarTargets, transform]) => {
          const targetPoints = radarTargets.map((point) => {
            const translatedPoint: Point = applyToPoint(transform, point);
            return translatedPoint;
          });
          return targetPoints;
        }),
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

  async radarInput(radarId: string, payload: { targets: Point[] }) {
    const radars = await firstValueFrom(this.radars$);
    const radar = radars.find((v) => v.id === radarId);
    if (!radar) {
      const transform = identity();
      this.updateRadars$.next(
        radars.concat([
          {
            id: radarId,
            transform: [
              transform.a,
              transform.b,
              transform.c,
              transform.d,
              transform.e,
              transform.f,
            ],
          },
        ])
      );
    }

    const newTargets = payload.targets.map((t) => ({ x: -t.x, y: t.y }));
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
    const radars = await firstValueFrom(this.radars$);
    const existing = radars.find((v) => v.id === radarId);
    if (!existing) {
      throw new Error("radar-not-found");
    }

    existing.transform = transform;
    this.updateRadars$.next(
      radars.filter((v) => v.id !== existing.id).concat([existing])
    );
  }

  updateZones(zones: Zone[]) {
    this.updateZones$.next(zones);
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
