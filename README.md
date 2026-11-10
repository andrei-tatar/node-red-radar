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

1. Edit `esp-radar/data/config.json`:
   ```json
   {
     "hostname": "esp-radar",
     "wifi": { "ssid": "…", "password": "…" },
     "mqtt": { "server": "mqtt://broker.lan:1883", "username": "…", "password": "…" }
   }
   ```
   If this file is missing or invalid, the device goes into deep sleep and stays there.
2. Build and flash with PlatformIO:
   ```bash
   cd esp-radar
   pio run -t uploadfs   # writes config.json to LittleFS
   pio run -t upload     # flashes the firmware over USB
   ```
   To update over the network instead, uncomment `upload_protocol = espota` and `upload_port` in `platformio.ini`.

The device publishes to these MQTT topics:

| Topic | Payload |
|---|---|
| `esp-radar/<hostname>/online` | `true` / `false` (retained, last will) |
| `esp-radar/<hostname>/state` | `{"targets":[{"id":0,"x":-120,"y":1530,"speed":0}]}`, coordinates in mm, sent every time the radar reports |

## Node-RED node (`node-red-contrib-radar`)

Install it from the palette manager or with npm:

```bash
npm install @andrei-tatar/node-red-contrib-radar
```

### Usage

1. Add an **mqtt in** node subscribed to `esp-radar/+/state` (JSON output) and wire it into a **radar** node. The node uses `msg.topic` as the radar ID. A new topic appears in the UI as a new radar.
2. In the radar node's settings, set the **Config File** where radar placements and zones are stored. The default is `./radar-config.json`, relative to the Node-RED working directory.
3. Open `http://<node-red-host>:1880/radar/<node-id>/`. Keep the trailing slash: the page builds its WebSocket address from the URL, so it can't connect without it.
   - Drag and rotate each radar to its real position on the floor plan.
   - Click **Add zone** and drag the zone's corners into place. Zones turn green while they are occupied.
   - Add `?embed` to the URL for a read-only view that shows the live targets, for example to embed in a dashboard.
4. Every time the set of occupied zones changes, the node outputs:
   ```json
   {
     "payload": {
       "activeZones": ["kitchen"],
       "activatedZones": ["kitchen"],
       "deactivatedZones": ["hallway"]
     }
   }
   ```
   A radar's targets are cleared 5 s after its last message.

> The house floor plan is currently hard-coded as SVG paths in `src/browser/app.tsx`. Replace them with your own plan, in millimetres.

### Development

```bash
cd node-red-contrib-radar
npm install
npm run build   # compiles to build/ and bundles the UI into static/index.js
npm run dev     # watches the UI with live reload and runs a standalone server on :4000
```

`npm run dev` expects a local `src/local.ts`. This file is gitignored, so you need to create your own. It should construct a `RadarServer`, call `createServer(radar)`, and pass MQTT messages to `radar.radarInput(topic, payload)`.

## Enclosure (`ld2450_case`)

There are three variants: landscape with a ball mount, portrait with a ball mount, and portrait with a hinge mount. Each one has a front shell, a back cover and a wall mount. They are designed for PETG on a Prusa MK3S+. The designs are SolidCraft `.scd` files, and `prusa-slicer.3mf` holds the current print plate. See [`ld2450_case/CLAUDE.md`](ld2450_case/CLAUDE.md) for details on the designs.
