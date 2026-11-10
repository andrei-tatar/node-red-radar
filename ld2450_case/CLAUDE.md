# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A 3D-printable enclosure for an **HLK-LD2450 mmWave radar** board plus an **M5Stack StampS3A** (ESP32-S3) module, designed parametrically in **SolidCraft** (an independent CAD app driven through the `solidcraft` MCP server). There is no source code, build or test suite. The "source" is the `.scd` design files. STL exports are not kept in the repo.

Two design variants, each self-contained with its own `.scd`:

| Path | Layout | Wall attachment |
|---|---|---|
| `portrait/` | Portrait: LD2450 vertical, Stamp stacked behind it, antennas 6.2 mm off the front wall (`D_i = ld_gap − (ld_ft − ld_t) + ld_tt + 1.1 + st_t + clr`) | Ball on the back cover (8 mm) snaps into a slotted socket on the wall mount |
| `portrait_hinge/` | Same portrait shell | A clip on the back cover snaps onto a vertical hinge post on the wall mount, giving single-axis swivel instead of a ball |

`prusa-slicer.3mf` is the current print plate (Original Prusa MK3S+, 0.4 mm nozzle, Generic PETG, 0.10 mm DETAIL, supports on). It holds five objects:
- object 1: the Front Shell. The portrait and hinge shells are geometrically identical.
- objects 2–3: Back Cover and Wall Mount for the ball mount (`portrait/`).
- objects 4–5: Back Cover and Wall Mount for the hinge (`portrait_hinge/`). Their source name still says "portrait", because the hinge design's internal name was never changed.

The Front Shell has **painted support enforcers** (`slic3rpe:custom_supports="4"`) on the walls of the USB-C hole. When you swap a mesh into the 3MF, keep the build `transform`. Store the vertices relative to the volume's `source_offset_*` (the bbox centre), update `lastid` in `Metadata/Slic3r_PE_model.config`, and carry the painting over by matching triangle geometry. Replacing the mesh in the PrusaSlicer GUI (*Replace with STL*) also works. The painted region is exactly the vertical walls of the USB-C slot inside the bottom wall (z −2…0), so it can be re-selected geometrically on a new mesh: the slot is a stadium with centres x = ±3, radius 3.5, at y = `y_ci − usb_off`. A part that only moves in Y (e.g. a cover or mount after a depth change) needs no new mesh, because meshes are stored relative to their bbox centre; just shift `source_offset_y`. With the build `transform`, design Y becomes bed Z (front face down), so `tz` is half the part's depth. To check a plate, run `flatpak run --filesystem=<dir> --command=prusa-slicer com.prusa3d.PrusaSlicer --info|--export-gcode <file>`.

## Working with the designs

- Start the CAD app with `solidcraft --control 7878`; the MCP server talks to it at 127.0.0.1:7878 and the user watches the viewport. Open a `.scd` file, change it with `set_parameter` or feature commands, check the result with `inspect_design` / `measure` / `screenshot`, then `save` and `export`.
- The `solidcraft-cli mcp` bridge only lets you read and write files in the folder of the design currently open in the app, plus its own temp/recovery folders. Restarting the app with `--allow-path` does not widen this. To work on another variant, ask the user to open that design in SolidCraft (or to add `--allow-path` to the MCP server's args). Scratchpad paths are not writable through it.
- Each design has three printable bodies: **Front Shell**, **Back Cover** and **Wall Mount**. To print, export only the changed bodies (e.g. to a temp STL) and swap them into `prusa-slicer.3mf`. Don't leave STLs in the repo.
- **REF LD2450** and **REF Stamp** are hidden placeholder bodies for checking fit. Never export them.
- A `.scd` is a zip (`solidcraft-container/1`). `document.json` holds the parameter table and feature tree. `cache/` holds tessellated bodies and a thumbnail. To read a design without the app running:
  ```bash
  unzip -p portrait/ld2450_stamps3a_case_portrait.scd document.json | python3 -c "
  import json,sys; d=json.load(sys.stdin)
  [print(p['name'],'=',p['expr'],' #',p.get('comment','')) for p in d['params']]
  [print(f['id'],f['type'],f.get('operation',''),f.get('name','')) for f in d['features']]"
  ```
  Don't hand-edit the zip. Make changes through SolidCraft so the cache stays consistent.

## Design structure (common to all variants)

- **Coordinates:** X is case width, centred on 0. Y is depth: the front (radar) wall's outer face is at Y=0 and the back cover is at +Y. Z is up, with the cavity floor at Z=0. `zc = H_i/2` is the cavity's vertical centre.
- **Driving parameters:** board sizes (`ld_*`, `st_*`), `wall` (2 mm), `wall_f` (front wall / radome; 0.8 mm, see *Radome* below), `clr` (0.2 mm PCB clearance per side), `lid_clr` (0.15 mm), `reb` (cover rebate step) and `t_cov`. Derived parameters: `W_i`, `H_i`, `D_i`, `y_ci = wall_f + D_i` (cover inner face) and `D_o` (overall depth). Feature dimensions are expressions over these parameters, so change a parameter rather than a raw number.
- **Radome:** follows the cover guide in the LD2450 manual (`esp-radar/doc/HLK-LD2450 1t2r … manual v1.0.pdf`, §9). The antenna plane (PCB front) sits `ld_gap` = 6.2 mm (λ/2 in air at 24.125 GHz, ±1.2 mm) behind the front wall's inner face, and the wall `wall_f` = 0.8 mm is ≤ λ/8 in PETG (≈0.96 mm, εr ≈ 2.6). Keep the wall over the antennas flat and solid: no text, texture or holes, and no conductive, metal or carbon-fibre filament. If the wall ever gets thicker, the next good value is λ/2 in PETG, about 3.9 mm (±20%). Avoid about 1.9 mm (λ/4), which reflects the most.
- **LD2450 retention:** two floating pads (`LD pad bottom`, an extruded 45° triangle from `LD pad sketch`, and its mirror `LD pad top` about z = `zc`) hold the PCB front at the board ends, `ld_pad_w` (6 mm) wide and centred. Each hangs off the bottom or top wall: a flat face `ld_pad` long at the PCB front plane, tapering at 45° down to the end wall toward the front, so it prints without support and doesn't touch the front wall. Four side catches on the rails hold the back of the PCB at `wall_f + ld_gap + ld_t`. The rails and the four Stamp stops start at the PCB front plane (`wall_f + ld_gap`), not at the wall, so the gap in front of the antennas is open to the side walls; wide-angle (azimuth ±60°, across the board's 15 mm width) signals then cross only the side wall. The rails are `ld_t + 1.9 mm` deep. So that they print without support (front face down), each rail has a 45° taper under its front (`LD rail taper R` + mirrored `LD rail taper L`). The taper is an extruded triangle (`Rail taper sketch`, dimensioned with parameter expressions) running from the side wall at `wall_f + ld_gap − (W_i/2 + 0.1 − ld_h/2 − clr)` to the rail's inner edge at the PCB front plane. The front chip protrudes `ld_ft − ld_t` (0.82 mm) in front of the antenna plane, so `D_i` = `ld_gap − (ld_ft − ld_t) + ld_tt + 1.1 mm + st_t + clr`.
- **Sketches use fixed coordinates.** The USB-C hole, side vents, Stamp top tabs and hinge clip opening are not tied to parameters. After any change that moves geometry in Y (`wall_f`, `ld_gap`, `D_i`, …), move them by the same amount with `sketch.edit` + `sketch.move` + `sketch.finish`. Sketch1 (vents) is on the YZ plane, so world Y is its sketch x. Otherwise the clip opening drifts off the ring and Fillet5 loses its edges.
- **Clearances are tuned for PETG**, which prints holes slightly small. For example, `sock_d = ball_d` gives a snug ball socket on purpose.
- **Feature tree:** each body starts with a `new_body` box. Later features `join` or `cut` into it, in order:
  - Front Shell: shell box, then fillets, cavity cut, cover rebate, LD2450 ledges/rails with small cylinder snap catches, Stamp posts/stops and top tabs, snap grooves, pry notch, side vents (sketch + extrude cut, mirrored about YZ), and the USB-C hole.
  - Back Cover: plate, then snap bumps that match the shell's snap grooves, then the mount interface (ball + neck, or the hinge clip).
  - Wall Mount: plate, then socket body with sphere cut and cross slits (ball variants), or hinge post/base/top (hinge variant).
- **Fillets and chamfers reference edges by stored coordinates** (`edges` points plus `edge_refs` bounding boxes). A parameter change that moves geometry can break those references or silently re-target them. After a dimension change, check that every fillet still applies, using `inspect_design` or a screenshot.
- Feature IDs have gaps because the portrait variants were derived from an older landscape design (since removed) with features deleted. Don't assume IDs line up across variants.
