import {
  BehaviorSubject,
  MonoTypeOperatorFunction,
  Observable,
  defer,
  dematerialize,
  filter,
  finalize,
  first,
  ignoreElements,
  map,
  merge,
  retry,
  share,
  switchMap,
  tap,
  timer,
} from "rxjs";

import type {
  ClientToServerMessage,
  ContractConsumer,
  ServerToClientMessage,
} from "../common/rpc";
import { shareLastValue } from "../common/util";

let streamIdHelper = 0;
const wsStatus = new BehaviorSubject<
  "connecting" | "connected" | "disconnected"
>("disconnected");

export const wsStatus$ = wsStatus.asObservable();

/** the currently open socket, if any */
let openWs: WebSocket | undefined;

const proxyCache = new Map<string, object>();

function getProxy(path = ""): object {
  return new Proxy(function () {}, {
    apply: function (_target, _this, args) {
      return rpcExecute(path, args);
    },
    get: function (_target, subPath: string) {
      const newPath = path ? path + "." + subPath : subPath;
      let cached = proxyCache.get(newPath);
      if (!cached) {
        cached = getProxy(newPath);
        proxyCache.set(newPath, cached);
      }
      return cached;
    },
  });
}

export const rpc = getProxy() as ContractConsumer;

function rpcExecute(path: string, args: any[]): Observable<any> {
  return defer(() => {
    const streamId = streamIdHelper++;
    let ended = false;
    return merge(
      send({ type: "start", path, id: streamId, args }),
      rx$.pipe(
        filter((v) => v.type === "msg" && v.id === streamId),
        map((v) => v.payload),
        dematerialize()
      )
    ).pipe(
      tap({
        error: () => (ended = true),
        complete: () => (ended = true),
      }),
      finalize(() => {
        // only tell the server when we cancel a live stream; sending on a
        // dead socket would just open a new connection
        if (!ended && openWs?.readyState === WebSocket.OPEN) {
          openWs.send(
            JSON.stringify({
              type: "stop",
              id: streamId,
            } satisfies ClientToServerMessage)
          );
        }
      })
    );
  });
}

export function retryRpc<T>(): MonoTypeOperatorFunction<T> {
  return (src) =>
    src.pipe(
      retry({
        delay: (err) => {
          if (!(err instanceof WsError)) {
            throw err;
          }
          console.info(`retrying ws in 3 sec`);
          return timer(3000);
        },
      })
    );
}

const ws$ = new Observable<WebSocket>((observer) => {
  wsStatus.next("connecting");
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const addr = `${protocol}//${location.host}${location.pathname}ws`;
  console.info(`ws: opening at ${addr}`);
  const ws = new WebSocket(addr);

  ws.addEventListener("open", () => {
    console.info(`ws: opened`);
    openWs = ws;
    observer.next(ws);
    wsStatus.next("connected");
  });

  ws.addEventListener("close", (ev) => {
    observer.error(new WsError(ev));
  });

  ws.addEventListener("error", (err) => {
    observer.error(new WsError(err));
  });

  return () => {
    if (openWs === ws) {
      openWs = undefined;
    }
    wsStatus.next("disconnected");
    ws.close();
  };
}).pipe(
  shareLastValue({
    resetOnRefCountZero: () => timer(60000),
  })
);

const rx$ = ws$.pipe(
  switchMap(
    (ws) =>
      new Observable<string>((observer) => {
        const handler = (ev: MessageEvent) => {
          observer.next(ev.data);
        };
        ws.addEventListener("message", handler);
        return () => ws.removeEventListener("message", handler);
      })
  ),
  map((v) => JSON.parse(v) as ServerToClientMessage),
  share()
);

function send(msg: ClientToServerMessage) {
  return ws$.pipe(
    tap({
      next: (ws) => {
        ws.send(JSON.stringify(msg));
      },
    }),
    first(),
    ignoreElements()
  );
}

class WsError extends Error {
  constructor(err: Event) {
    super(`${err}`);
  }
}
