import { RadarServer } from "./radar";
import { createRouter, createWebSocketServer } from "./web";
import { Router, Application } from "express";
import { existsSync } from "node:fs";
import { join as pathJoin } from "node:path";

const routerMap = new Map<string, Router>();
const baseRouter = Router();
baseRouter.use((req, res, next) => {
  const [, nodeId, ...rest] = req.url.split("/");
  const specific = routerMap.get(nodeId);
  if (specific) {
    req.url = "/" + rest.join("/");
    specific(req, res, next);
  } else {
    next();
  }
});
let registered = false;

/** Joins URL path segments, collapsing duplicate slashes; no trailing slash. */
function joinUrlPath(...parts: string[]) {
  return ("/" + parts.join("/")).replace(/\/{2,}/g, "/").replace(/\/$/, "");
}

/**
 * An empty setting means radar-config.json in the Node-RED user directory.
 * Older versions defaulted to the process's working directory, so an existing
 * file there is still used.
 */
function resolveConfigFile(
  RED: any,
  configFile: string | undefined,
  log: (msg: string) => void
) {
  if (configFile) {
    return configFile;
  }
  const legacy = "./radar-config.json";
  if (existsSync(legacy)) {
    log(
      `using ${legacy} from the working directory; set "Config file" to make this explicit`
    );
    return legacy;
  }
  return pathJoin(RED.settings.userDir ?? ".", "radar-config.json");
}

module.exports = function (RED: any) {
  // RED.httpNode is mounted at settings.httpNodeRoot (false disables it), and
  // RED.httpAdmin at settings.httpAdminRoot. The WebSocket upgrade bypasses
  // express, so its path has to include that root.
  const useHttpNode = !!RED.httpNode && RED.settings.httpNodeRoot !== false;
  const app: Application = useHttpNode ? RED.httpNode : RED.httpAdmin;
  const httpRoot: string =
    (useHttpNode ? RED.settings.httpNodeRoot : RED.settings.httpAdminRoot) ||
    "/";

  RED.nodes.registerType(
    "node-radar",
    function (this: NodeInterface, config: any) {
      RED.nodes.createNode(this, config);

      const configFileName = resolveConfigFile(RED, config.configFile, (m) =>
        this.log(m)
      );
      const radar = new RadarServer(configFileName, {
        warn: (msg) => this.warn(msg),
      });

      if (!registered) {
        app.use("/radar", baseRouter);
        registered = true;
      }

      const cleanupWs = createWebSocketServer(
        RED.server,
        radar,
        joinUrlPath(httpRoot, "radar", config.id)
      );
      routerMap.set(config.id, createRouter());

      this.on("input", (msg, _send, done) => {
        try {
          if (typeof msg.topic !== "string" || !msg.topic) {
            throw new Error("msg.topic must be the radar id (a string)");
          }
          radar.radarInput(msg.topic, msg.payload);
          done?.();
        } catch (err) {
          if (done) {
            done(err);
          } else {
            this.error(err, msg);
          }
        }
      });

      const subscription = radar.activeZones$.subscribe({
        next: (zones) => {
          // output 1: the summary; output 2: one message per zone change
          const perZone: NodeMessage[] = [
            ...zones.activatedZones.map((id) => ({ topic: id, payload: true })),
            ...zones.deactivatedZones.map((id) => ({
              topic: id,
              payload: false,
            })),
          ];
          this.send([{ payload: zones }, perZone]);
          this.status(
            zones.activeZones.length
              ? {
                  fill: "green",
                  shape: "dot",
                  text: zones.activeZones.join(", "),
                }
              : { fill: "grey", shape: "ring", text: "no presence" }
          );
        },
        error: (err) => this.error(err),
      });

      this.on("close", (done) => {
        subscription.unsubscribe();
        routerMap.delete(config.id);
        cleanupWs();
        radar.dispose().finally(done);
      });
    }
  );
};

export interface NodeMessage {
  payload: any;
  topic?: string;
}

export interface NodeInterface {
  credentials: { [key: string]: string };

  on(
    type: "input",
    callback: (
      msg: NodeMessage,
      send?: (msg: NodeMessage) => void,
      done?: (err?: any) => void
    ) => void
  ): void;
  on(type: "close", callback: (done: () => void) => void): void;

  send(msg: NodeMessage | Array<NodeMessage | NodeMessage[] | null>): void;

  log(msg: string): void;
  warn(msg: string): void;
  error(err: unknown, msg?: NodeMessage): void;

  status(
    params:
      | {
          fill: "red" | "green" | "yellow" | "blue" | "grey";
          text: string;
          shape: "ring" | "dot";
        }
      | {}
  ): void;

  context(): {
    get<T>(key: string): T;
    set<T>(key: string, value: T): void;
    keys(): string[];
  };
}
