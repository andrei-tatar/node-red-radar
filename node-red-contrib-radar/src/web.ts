import {
  catchError,
  concatMap,
  defer,
  EMPTY,
  finalize,
  isObservable,
  map,
  materialize,
  Observable,
  of,
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
    },
    zones: {
      all: () => radar.zones$,
      activeZoneIds: () => radar.activeZones$.pipe(map((v) => v.activeZones)),
      update: (zones) => radar.updateZones(zones),
    },
    points: () => radar.points$,
  };
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

    ws.once("error", (err) => {
      console.log("ws-error", err);
    });

    ws.once("close", () => {
      for (const sub of subscriptions.values()) {
        sub.unsubscribe();
      }
    });

    ws.on("message", (ev) => {
      const msg = JSON.parse(ev.toString()) as ClientToServerMessage;

      switch (msg.type) {
        case "start":
          const stream: Observable<any> = defer(() => {
            const result = rpcMap.get(msg.path)?.(...msg.args);
            if (!isObservable(result)) {
              return of(result);
            }
            return result;
          });

          const startSubscription = stream
            .pipe(
              finalize(() => {
                subscriptions.delete(msg.id);
              }),
              materialize(),
              concatMap(
                (v) =>
                  new Observable((observer) => {
                    const txMessage: ServerToClientMessage = {
                      id: msg.id,
                      type: "msg",
                      payload: v,
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
              })
            )
            .subscribe();
          subscriptions.set(msg.id, startSubscription);
          break;

        case "stop":
          const stopSub = subscriptions.get(msg.id);
          if (stopSub) {
            subscriptions.delete(msg.id);
            stopSub.unsubscribe();
          }
          break;
      }
    });
  });

  const upgradeHandler = function upgrade(
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer
  ) {
    if (request.url === basePath + "/ws") {
      wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit("connection", ws, request);
      });
    }
  };

  server.on("upgrade", upgradeHandler);

  return () => server.off("upgrade", upgradeHandler);
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
