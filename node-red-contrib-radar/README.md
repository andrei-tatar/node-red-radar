# node-red-contrib-radar

A Node-RED node for room-level presence detection with HLK-LD2450 mmWave radars. Each radar reports up to three targets, with positions relative to the sensor. The node places every radar on your floor plan, turns those positions into house coordinates and tells you when the zones you've drawn become occupied or empty.

It is built for the [esp-radar](https://github.com/andrei-tatar/node-red-radar/tree/master/esp-radar) firmware, which publishes LD2450 targets to MQTT. Any source that sends the same payload works too.

```
LD2450 ──UART──▶ ESP32 (esp-radar) ──MQTT──▶ mqtt in ──▶ radar ──▶ zone events
```

## Install

From the Node-RED palette manager, or:

```bash
npm install @andrei-tatar/node-red-contrib-radar
```

## Quick start

1. Add an **mqtt in** node subscribed to `esp-radar/+/state` with JSON output, and wire it into a **radar** node.
2. Deploy. Each radar shows up in the editor the first time its topic is seen.
3. Open the node's settings and click **Open zone editor**. Import a floor plan, place the radars and draw zones. Edits are saved as you make them, so there's no need to redeploy.

## Input

| Property | Type | Description |
|---|---|---|
| `msg.topic` | string | Identifies the radar. A new topic adds a radar to the map. |
| `msg.payload` | object \| string | `{"targets": [{"x": mm, "y": mm}, ...]}`, relative to the radar. A JSON string or Buffer is parsed. Extra fields such as `id` and `speed` are ignored. |

A radar's targets are cleared 5 s after its last message. The esp-radar firmware repeats its state every 2 s, so a radar that goes offline releases its zones on its own.

## Outputs

**Output 1, zone summary.** Sent every time the set of occupied zones changes:

```json
{
  "payload": {
    "activeZones": ["kitchen", "kitchen-table"],
    "activatedZones": ["kitchen-table"],
    "deactivatedZones": ["hallway"]
  }
}
```

**Output 2, per-zone changes.** One message for each zone that changed, easy to route with a **switch** node:

```json
{ "topic": "kitchen", "payload": true }
```

`payload` is `true` when the zone becomes occupied and `false` when it empties.

The node's status shows the occupied zones.

## Zones

- A **presence** zone is active while at least one target is inside it, and inactive as soon as none is. There is no delay.
- Zones can overlap. A target inside several zones makes all of them active. Pick a priority in your flow if you need one.
- An **exclusion** zone ignores every target inside it, everywhere, for things like fans, curtains or plants.

The LD2450 can briefly lose someone who sits still. To avoid flapping, debounce in the flow, for example with a **trigger** node on output 2 that delays `false` by a few seconds and is reset by `true`.

## Zone editor

The editor lives at `/radar/<node-id>/` under `httpNodeRoot`. Keep the trailing slash.

- **Floor plan**: import an SVG, PNG or JPG, or drop one on the map. An SVG whose `viewBox` is in millimetres is placed at the right size automatically. Raster images start 10 m wide; use **Adjust on map** or the fields to move and scale them. [`examples/floor-plan.svg`](https://github.com/andrei-tatar/node-red-radar/blob/master/node-red-contrib-radar/examples/floor-plan.svg) is a sample.
- **Sensors**: drag a sensor to move it and drag its round handle to turn it, or type the position and rotation. Give sensors names to tell them apart.
- **Zones**: click **Draw zone** (or press `Z`), then click corners or drag a rectangle. Select a zone to drag it, drag its corners, drag a **+** on an edge to add a corner, or double-click a corner to remove it. Rename it and set its type in the sidebar.
- Snapping (10 cm, 5°) is on by default. Hold `Alt` to bypass it, or press `S` to toggle it. Scroll to zoom, drag the background to pan and press `F` to fit everything in view.
- **Live view**: append `?embed` for a read-only map of zones and live targets, for example in a dashboard iframe.

## Config file

The floor plan, radar placements and zones are stored in a JSON file. Set the path in the node's **Config file** field. Relative paths are resolved against Node-RED's working directory. If the field is empty, the file is `radar-config.json` in the Node-RED user directory, or a `radar-config.json` left in the working directory by older versions.

The file is watched, so you can edit it by hand while Node-RED runs. An invalid file is skipped with a warning and the last good config stays in use.

## Development

The source lives in the [node-red-radar](https://github.com/andrei-tatar/node-red-radar) repository, together with the firmware and a 3D-printable case.

```bash
npm install
npm run build   # compiles to build/ and bundles the UI into static/index.js
npm run dev     # watches the UI with live reload and runs a standalone server on :4000
```

`npm run dev` expects a local `src/local.ts`. It is gitignored, so create your own: construct a `RadarServer`, call `createServer(radar)` and pass MQTT messages to `radar.radarInput(topic, payload)`.
