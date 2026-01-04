import { RadarServer } from "./radar";
import { createRouter, createWebSocketServer } from "./web";
import { Router, Application } from "express";

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

module.exports = function (RED: any) {
  RED.nodes.registerType(
    "node-radar",
    function (this: NodeInterface, config: any) {
      RED.nodes.createNode(this, config);

      const configFileName = config.configFile || "./radar-config.json";
      const radar = new RadarServer(configFileName);

      const app: Application = RED.httpNode ?? RED.httpAdmin;
      const server = RED.server;

      if (!registered) {
        app.use("/radar", baseRouter);
        registered = true;
      }

      const cleanupWs = createWebSocketServer(
        server,
        radar,
        "/radar/" + config.id
      );
      routerMap.set(config.id, createRouter());

      this.on("input", async (msg) => {
        if (typeof msg.topic === "string") {
          await radar.radarInput(msg.topic, msg.payload);
        }
      });

      const subscription = radar.activeZones$.subscribe((zones) => {
        this.send({
          payload: zones,
        });
      });

      this.on("close", () => {
        subscription.unsubscribe();
        routerMap.delete(config.id);
        cleanupWs();
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
  on(type: "close", callback: () => void): void;

  send(msg: any): void;

  log(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;

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
