import {
  catchError,
  concatMap,
  defer,
  EMPTY,
  finalize,
  from,
  isObservable,
  map,
  materialize,
  Observable,
  Subscription,
} from "rxjs";
import { WebSocketServer } from "ws";
import express from "express";
import { join as pathJoin } from "node:path";
import { RadarServer } from "./radar";
import { Server } from "node:http";
import {
  ClientToServerMessage,
  ContractProvider,
  ServerToClientMessage,
} from "./common/rpc";

export function createRouter() {
  const router = express.Router();
  router.use(express.json());
  router.use(express.static(pathJoin(__dirname, "..", "static")));
  return router;
}

function createRpcObject(radar: RadarServer): ContractProvider {
  return {
    radars: {
      all: () => radar.radars$,
      radarTargets: (radarId: string) => radar.getRadarTargets(radarId),
      updateRadarTransform: (radarId, transform) =>
        radar.updateRadarTransform(radarId, transform),
      update: (radarId, changes) => radar.updateRadar(radarId, changes),
      remove: (radarId) => radar.removeRadar(radarId),
    },
    zones: {
      all: () => radar.zones$,
      activeZoneIds: () => radar.activeZones$.pipe(map((v) => v.activeZones)),
      update: (zones) => radar.updateZones(zones),
    },
    floorPlan: {
      get: () => radar.floorPlan$,
      update: (floorPlan) => radar.updateFloorPlan(floorPlan),
    },
    points: () => radar.points$,
  };
}

function parseClientMessage(data: string): ClientToServerMessage | null {
  let msg: any;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof msg?.id !== "number") {
    return null;
  }
  if (msg.type === "start") {
    return typeof msg.path === "string" && Array.isArray(msg.args) ? msg : null;
  }
  return msg.type === "stop" ? msg : null;
}

function createFactoryMap(
  provider: ContractProvider,
  prefix: string = "",
  map = new Map<string, (...args: any[]) => Observable<any>>()
) {
  for (const key of Object.keys(provider)) {
    if (typeof provider[key as keyof ContractProvider] === "function") {
      map.set(prefix + key, provider[key as keyof ContractProvider] as any);
    } else {
      createFactoryMap(
        provider[key as keyof ContractProvider] as any,
        prefix + key + ".",
        map
      );
    }
  }
  return map;
}

export function createWebSocketServer(
  server: Server,
  radar: RadarServer,
  basePath: string
) {
  const rpcMap = createFactoryMap(createRpcObject(radar));

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", function connection(ws) {
    const subscriptions = new Map<number, Subscription>();

    // `on`, not `once`: an unhandled second "error" event would throw
    ws.on("error", (err) => {
      console.log("ws-error", err);
    });

    ws.once("close", () => {
      for (const sub of subscriptions.values()) {
        sub.unsubscribe();
      }
    });

    ws.on("message", (ev) => {
      const msg = parseClientMessage(ev.toString());
      if (!msg) {
        console.warn("radar ws: ignoring malformed message");
        return;
      }

      switch (msg.type) {
        case "start": {
          subscriptions.get(msg.id)?.unsubscribe();

          const stream: Observable<any> = defer(() => {
            const method = rpcMap.get(msg.path);
            if (!method) {
              throw new Error(`unknown-method: ${msg.path}`);
            }
            const result = method(...msg.args);
            if (!isObservable(result)) {
              return from(Promise.resolve(result));
            }
            return result;
          });

          const startSubscription = stream
            .pipe(
              materialize(),
              concatMap(
                (v) =>
                  new Observable((observer) => {
                    const txMessage: ServerToClientMessage = {
                      id: msg.id,
                      type: "msg",
                      // Error objects serialize to {}, so send the message
                      payload:
                        v.kind === "E"
                          ? { ...v, error: { message: v.error?.message ?? String(v.error) } }
                          : v,
                    };
                    ws.send(JSON.stringify(txMessage), (err) => {
                      if (err) observer.error(err);
                      else observer.complete();
                    });
                  })
              ),
              catchError((err) => {
                console.error(err);
                return EMPTY;
              }),
              finalize(() => {
                if (subscriptions.get(msg.id) === startSubscription) {
                  subscriptions.delete(msg.id);
                }
              })
            )
            .subscribe();
          if (!startSubscription.closed) {
            subscriptions.set(msg.id, startSubscription);
          }
          break;
        }

        case "stop": {
          const stopSub = subscriptions.get(msg.id);
          if (stopSub) {
            subscriptions.delete(msg.id);
            stopSub.unsubscribe();
          }
          break;
        }
      }
    });
  });

  const wsPath = basePath + "/ws";
  const upgradeHandler = function upgrade(
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer
  ) {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === wsPath) {
      wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit("connection", ws, request);
      });
    }
  };

  server.on("upgrade", upgradeHandler);

  return () => {
    server.off("upgrade", upgradeHandler);
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
  };
}

export function createServer(radar: RadarServer) {
  const app = express();
  app.use(createRouter());
  const port = 4000;
  const server = app.listen(port, () => {
    console.log("started listening", server.address());
  });

  createWebSocketServer(server, radar, "");

  return () => {
    server.close();
  };
}
