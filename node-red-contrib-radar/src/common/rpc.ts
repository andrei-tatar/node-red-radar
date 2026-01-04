import type { Observable, ObservableInput, ObservableNotification } from "rxjs";
import { Point, Radar, Zone } from "./types";

export interface Contract {
  radars: {
    all: Define<Radar[]>;
    radarTargets: Define<Point[], [radarId: string]>;
    updateRadarTransform: Define<void, [radarId: string, transform: number[]]>;
  };
  zones: {
    all: Define<Zone[]>;
    activeZoneIds: Define<string[]>;
    update: Define<void, [zones: Zone[]]>;
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
