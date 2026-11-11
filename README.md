# node-red-radar

Room-level presence detection using HLK-LD2450 mmWave radar sensors. Each sensor reports up to three moving targets, giving their position relative to the sensor. A Node-RED node places every sensor on a house floor plan and turns those positions into house coordinates. When a target enters or leaves a zone you have drawn, the node emits an event.

```
LD2450 ──UART──▶ ESP32-S3 (esp-radar) ──MQTT──▶ Node-RED (node-radar) ──▶ zone events
```

## Repository layout

| Directory | Contents |
|---|---|
| [`esp-radar/`](esp-radar) | PlatformIO firmware for an M5Stack StampS3A (ESP32-S3). It reads the LD2450 and publishes its targets to MQTT. |
| [`node-red-contrib-radar/`](node-red-contrib-radar) | Node-RED node with a web UI for placing radars and drawing zones. |
| [`ld2450_case/`](ld2450_case) | 3D-printable enclosure (SolidCraft designs and a PrusaSlicer plate) for the LD2450 and the StampS3A. |

## Hardware

- HLK-LD2450 24 GHz mmWave radar
- M5Stack StampS3A (ESP32-S3)
- Wiring: LD2450 TX → GPIO7, LD2450 RX → GPIO9, plus 5 V and GND. The UART runs at 256000 baud.

Datasheets and the serial protocol are in [`esp-radar/doc/`](esp-radar/doc).

## Firmware (`esp-radar`)

1. Either edit `esp-radar/data/config.json` and flash it (step 2), or skip it and use the setup portal (below):
   ```json
   {
     "hostname": "esp-radar",
     "wifi": { "ssid": "…", "password": "…" },
     "mqtt": { "server": "mqtt://broker.lan:1883", "username": "…", "password": "…" }
   }
   ```
   If this file is missing or invalid, or lacks a hostname, SSID or MQTT server, the device opens a Wi-Fi access point called `esp-radar-setup-XXXX`. Join it and a setup page opens (or browse to `http://192.168.4.1/`). Saving the form writes `config.json` and restarts the device. A blank device flashed without `uploadfs` starts in this mode too.
2. Build and flash with PlatformIO:
   ```bash
   cd esp-radar
   pio run -t uploadfs   # writes config.json to LittleFS
   pio run -t upload     # flashes the firmware over USB
   ```
   To update over the network instead, uncomment `upload_protocol = espota` and `upload_port` in `platformio.ini`.

The firmware is tuned for latency rather than power: it runs at 240 MHz with Wi-Fi power saving off and Nagle disabled on the MQTT connection, so a new target reaches the broker within a few milliseconds of the radar reporting it. For the same reason on the broker side, set `set_tcp_nodelay true` in `mosquitto.conf`.

The device publishes to these MQTT topics:

| Topic | Payload |
|---|---|
| `esp-radar/<hostname>/online` | `true` / `false` (retained, last will) |
| `esp-radar/<hostname>/state` | `{"targets":[{"id":0,"x":-120,"y":1530,"speed":0}]}`, coordinates in mm. Sent when the targets change, and repeated every 2 s while they don't. |

## Node-RED node (`node-red-contrib-radar`)

Install it from the palette manager or with npm:

```bash
npm install @andrei-tatar/node-red-contrib-radar
```

### Usage

1. Add an **mqtt in** node subscribed to `esp-radar/+/state` (JSON output) and wire it into a **radar** node. The node uses `msg.topic` as the radar ID. A new topic appears in the UI as a new radar.
2. Optionally set the radar node's **Config file**, where the floor plan, sensor placements and zones are stored. By default it is `radar-config.json` in the Node-RED user directory. A `radar-config.json` left in the working directory by older versions is still picked up.
3. Deploy, then click **Open zone editor** in the node's settings. The editor lives at `/radar/<node-id>/` under `httpNodeRoot`; keep the trailing slash.
   - **Floor plan** tab: import an SVG, PNG or JPG, or drop it on the map. An SVG whose `viewBox` is in millimetres is placed at the right size automatically. Raster images start 10 m wide; use **Adjust on map** or the fields to move and scale them. [`examples/floor-plan.svg`](node-red-contrib-radar/examples/floor-plan.svg) is the plan that used to be built in.
   - **Sensors**: drag a sensor to move it and drag its round handle to turn it, or type the position and rotation. Name sensors to tell them apart.
   - **Zones**: click **Draw zone** (or press `Z`), then click corners or drag a rectangle. Select a zone to drag it, drag its corners, drag a **+** on an edge to add a corner, or double-click a corner to remove it. In the sidebar, rename it and set its type.
   - Snapping (10 cm, 5°) is on by default. Hold `Alt` to bypass it, or press `S` to toggle it. Scroll to zoom, drag the background to pan, and press `F` to fit everything in view.
   - **Live view** (`?embed`) is a read-only map of zones and targets, for example to embed in a dashboard.
4. Zone options:
   - A zone is active while a target is inside it, with no delay. Overlapping zones are all active at once. Debounce and prioritise in the flow (e.g. a `trigger` node); the LD2450 can briefly lose someone who sits still, so a few seconds of off-delay avoids flapping.
   - **Exclusion** zones ignore every target inside them, for things like fans, curtains or plants.
5. Outputs:
   - **Output 1**, every time the set of occupied zones changes:
     ```json
     { "payload": { "activeZones": ["kitchen"], "activatedZones": ["kitchen"], "deactivatedZones": ["hallway"] } }
     ```
   - **Output 2**, one message per change: `{ "topic": "kitchen", "payload": true }` when a zone becomes occupied and `false` when it empties. This is easy to route with a switch node.

   The node's status shows the occupied zones. A radar's targets are cleared 5 s after its last message.

### Development

```bash
cd node-red-contrib-radar
npm install
npm run build   # compiles to build/ and bundles the UI into static/index.js
npm run dev     # watches the UI with live reload and runs a standalone server on :4000
```

`npm run dev` expects a local `src/local.ts`. This file is gitignored, so you need to create your own. It should construct a `RadarServer`, call `createServer(radar)`, and pass MQTT messages to `radar.radarInput(topic, payload)`.

## Enclosure (`ld2450_case`)

There are two variants: portrait with a ball mount, and portrait with a hinge mount. The LD2450 sits 6.2 mm behind a 0.8 mm front wall, following the cover guidelines in its manual. Each one has a front shell, a back cover and a wall mount. They are designed for PETG on a Prusa MK3S+. The designs are SolidCraft `.scd` files, and `prusa-slicer.3mf` holds the current print plate. See [`ld2450_case/CLAUDE.md`](ld2450_case/CLAUDE.md) for details on the designs.
