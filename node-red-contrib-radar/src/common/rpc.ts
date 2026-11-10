import type { Observable, ObservableInput, ObservableNotification } from "rxjs";
import { FloorPlan, Point, Radar, Zone } from "./types";

export interface Contract {
  radars: {
    all: Define<Radar[]>;
    radarTargets: Define<Point[], [radarId: string]>;
    updateRadarTransform: Define<void, [radarId: string, transform: number[]]>;
    update: Define<
      void,
      [radarId: string, changes: { name?: string; transform?: number[] }]
    >;
    remove: Define<void, [radarId: string]>;
  };
  zones: {
    all: Define<Zone[]>;
    activeZoneIds: Define<string[]>;
    update: Define<void, [zones: Zone[]]>;
  };
  floorPlan: {
    get: Define<FloorPlan | null>;
    update: Define<void, [floorPlan: FloorPlan | null]>;
  };
  points: Define<Point[]>;
}

type Define<TReturn, TArgs extends any[] = []> = [TReturn, TArgs];

export type ContractConsumer<T = Contract> = {
  [P in keyof T]: T[P] extends Define<infer TReturn, infer TArgs>
    ? (...args: TArgs) => Observable<TReturn>
    : ContractConsumer<T[P]>;
};

export type ContractProvider<T = Contract> = {
  [P in keyof T]: T[P] extends Define<infer TReturn, infer TArgs>
    ? (...args: TArgs) => ObservableInput<TReturn> | TReturn
    : ContractProvider<T[P]>;
};

export type ClientToServerMessage =
  | {
      type: "start";
      id: number;
      path: string;
      args: any[];
    }
  | {
      type: "stop";
      id: number;
    };

export type ServerToClientMessage<T = any> = {
  type: "msg";
  id: number;
  payload: ObservableNotification<T>;
};
