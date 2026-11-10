# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A home presence-detection system built from HLK-LD2450 mmWave radars. It has three independent sub-projects, and there is no top-level build:

| Dir | What | Tooling |
|---|---|---|
| `esp-radar/` | ESP32-S3 firmware (M5Stack StampS3A) that reads an LD2450 over UART and publishes its targets to MQTT | PlatformIO, Arduino framework |
| `node-red-contrib-radar/` | Node-RED node (`@andrei-tatar/node-red-contrib-radar`). It maps each radar's relative targets onto a house plan and emits zone enter/leave events. It also serves a React editor UI | TypeScript, tsc + rollup |
| `ld2450_case/` | 3D-printable enclosure, designed in SolidCraft. **It has its own `ld2450_case/CLAUDE.md`, so read that before touching it** | SolidCraft MCP |

Data flow: LD2450 → (UART 256000 baud, RX=GPIO7/TX=GPIO9) → firmware → MQTT `esp-radar/<hostname>/state`, sending `{"targets":[{id,x,y,speed}]}` in mm → Node-RED `mqtt in` → `node-radar` input → output `msg.payload = {activeZones, activatedZones, deactivatedZones}`.

There are no tests or linters in any sub-project.

## esp-radar (firmware)

```bash
cd esp-radar
pio run                 # build
pio run -t upload       # flash over USB (USB CDC on boot)
pio run -t uploadfs     # flash data/config.json to LittleFS
pio device monitor
```

- Runtime config (hostname, WiFi, MQTT URL/credentials) comes from `data/config.json` on LittleFS, not from build flags. If the file is missing or doesn't parse, the device deep-sleeps forever. The committed file has blank passwords, so don't commit real ones.
- OTA (`upload_protocol = espota`, `upload_port = esp-radar.lan`) is commented out in `platformio.ini`. ArduinoOTA still runs in the firmware, so uncomment those lines to flash over the network.
- MQTT: a retained LWT/online flag on `esp-radar/<hostname>/online`. Target frames go to `.../state` (QoS 0, not retained) each time the LD2450 reports, and invalid targets are skipped.
- The LD2450 driver is the author's fork, `github.com/andrei-tatar/HLK-LD2450`. Its source is under `.pio/libdeps/esp32/HLK-LD2450/` after a build. Protocol PDFs are in `doc/`.

## node-red-contrib-radar

```bash
cd node-red-contrib-radar
npm run build      # clean, then tsc → build/ (+ copies src/*.html), then rollup → static/index.js
npm run dev        # rollup watch + livereload, plus `tsx watch src/local.ts` (standalone server on :4000)
npm run pub        # build + publish to npmjs
```

- `src/local.ts` is the standalone dev harness. It is **gitignored** and holds local MQTT credentials. It creates a `RadarServer` plus an express server on port 4000 and feeds it MQTT messages. Never commit it. If it's missing, `npm run dev` won't start.
- There are two TS builds with separate tsconfigs. `tsconfig.json` builds the Node side (`src/`, excluding `src/browser`) to `build/` as CommonJS-style `nodenext`. `tsconfig.rollup.json` builds `src/browser/` and bundles it as an IIFE into `static/index.js` (gitignored). `src/common/` is shared by both and must stay free of Node and DOM APIs.
- The published package ships only `build/` and `static/` (`.npmignore`).

### Architecture

- **`radar.ts` (`RadarServer`)** is the core, written as RxJS streams. Each distinct `msg.topic` is a radar ID. An unknown topic is added to the config with an identity transform the first time it is seen. Incoming targets get **x negated** (`-t.x`) to match the LD2450's orientation. They are then mapped through that radar's 2D affine transform `[a,b,c,d,e,f]` (from `transformation-matrix`) into house coordinates, in mm. Targets fall back to `[]` 5 s after the last frame. Points from all radars are merged and tested against the zone polygons (ray casting). `activeZones$` uses `scan` to diff the zones against the previous emission, which gives activated/deactivated lists.
- **`config.ts`** loads and saves the JSON config `{zones, radars}`. The path comes from the node's `configFile` setting and defaults to `./radar-config.json`, relative to the Node-RED process cwd. The file is watched with `fs.watchFile` and de-duplicated by MD5. A missing or unreadable file yields an empty config. UI edits go through `updateRadars$`/`updateZones$` and are written back, throttled to 1 s.
- **RPC over WebSocket** (`common/rpc.ts`, `web.ts`, `browser/ws.ts`). The `Contract` interface is the single definition of the API. On the server, `ContractProvider` is flattened into dotted paths (`radars.all`, `zones.update`, …). On the client, `ContractConsumer` is a `Proxy` that turns `rpc.zones.update(z)` into a `start` message. Every call is an Observable stream. The server `materialize()`s notifications, and unsubscribing sends `stop`. To add an endpoint, add it to `Contract` and then implement it in `createRpcObject` in `web.ts`. Both sides are type-checked against the contract.
- **`node-radar.ts`** is the Node-RED registration. Each node instance gets its own `RadarServer`. A single shared express router is mounted at `/radar` on `RED.httpNode` and dispatches by node ID, so the UI lives at `/radar/<nodeId>/` with its WebSocket at `/radar/<nodeId>/ws` (attached to `RED.server`'s `upgrade` event). The client derives the ws URL from `location.pathname`, so the trailing slash matters.
- **Browser UI** (`src/browser/`) is React 19 with classic JSX (`React.createElement`, set in `rollup.config.mjs`). There are two modes. The default is the editor: drag/rotate radars (`radar.tsx`), edit zone polygons (`zone.tsx`), add zones. `?embed` is read-only and shows live mapped points (e.g. for a dashboard iframe). **The house floor plan is hard-coded SVG paths in `app.tsx`**, in mm, with a fixed `viewBox`.
