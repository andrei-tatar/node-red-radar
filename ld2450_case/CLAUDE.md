# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A 3D-printable enclosure for an **HLK-LD2450 mmWave radar** board plus an **M5Stack StampS3A** (ESP32-S3) module, designed parametrically in **SolidCraft** (an independent CAD app driven through the `solidcraft` MCP server). There is no source code, build or test suite. The "source" is the `.scd` design files. STL exports are not kept in the repo.

Three design variants, each self-contained with its own `.scd`:

| Path | Layout | Wall attachment |
|---|---|---|
| `ld2450_stamps3a_case.scd` (root) | Landscape: LD2450 lies horizontally, Stamp beside it, shallow case (`D_i = 14 mm`) | Ball on back cover snaps into a slotted socket on the wall mount |
| `portrait/` | Portrait: LD2450 vertical, Stamp stacked behind it (`D_i = ld_tt + 1.1 + st_t + clr`) | Ball joint (smaller ball, 8 mm) |
| `portrait_hinge/` | Same portrait shell | A clip on the back cover snaps onto a vertical hinge post on the wall mount, giving single-axis swivel instead of a ball |

`prusa-slicer.3mf` is the current print plate (Original Prusa MK3S+, 0.4 mm nozzle, Generic PETG, 0.10 mm DETAIL, supports on). It holds five objects:
- object 1: the Front Shell. The portrait and hinge shells are geometrically identical.
- objects 2–3: Back Cover and Wall Mount for the ball mount (`portrait/`).
- objects 4–5: Back Cover and Wall Mount for the hinge (`portrait_hinge/`). Their source name still says "portrait", because the hinge design's internal name was never changed.

The Front Shell has **painted support enforcers** (`slic3rpe:custom_supports="4"`) on the walls of the USB-C hole. When you swap a mesh into the 3MF, keep the build `transform`. Store the vertices relative to the volume's `source_offset_*` (the bbox centre), update `lastid` in `Metadata/Slic3r_PE_model.config`, and carry the painting over by matching triangle geometry. Replacing the mesh in the PrusaSlicer GUI (*Replace with STL*) also works.

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
- **Driving parameters:** board sizes (`ld_*`, `st_*`), `wall` (2 mm), `wall_f` (1.6 mm, a thin front wall so the radar can see through it), `clr` (0.2 mm PCB clearance per side), `lid_clr` (0.15 mm), `reb` (cover rebate step) and `t_cov`. Derived parameters: `W_i`, `H_i`, `D_i`, `y_ci = wall_f + D_i` (cover inner face) and `D_o` (overall depth). Feature dimensions are expressions over these parameters, so change a parameter rather than a raw number.
- **LD2450 retention (portrait variants):** the board's front chip rests flush on the front wall. Four side catches on the rails hold the back of the PCB at `ld_ft` (2.1 mm, chip face to PCB back) from the wall. Two pads (`LD pad top/bottom`, `ld_pad` long, `ld_ft − ld_t` tall) support the board ends, because the chip is near the middle. `ld_t` (1.28 mm) is used only by these pads. The landscape root design still uses the older `ld_t + 0.6 mm` catch formula with no chip allowance.
- **Clearances are tuned for PETG**, which prints holes slightly small. For example, `sock_d = ball_d` gives a snug ball socket on purpose.
- **Feature tree:** each body starts with a `new_body` box. Later features `join` or `cut` into it, in order:
  - Front Shell: shell box, then fillets, cavity cut, cover rebate, LD2450 ledges/rails with small cylinder snap catches, Stamp posts/stops (and top tabs in the portrait variants), snap grooves, pry notch, side vents (sketch + extrude cut, mirrored about YZ), and the USB-C hole.
  - Back Cover: plate, then snap bumps that match the shell's snap grooves, then the mount interface (ball + neck, or the hinge clip).
  - Wall Mount: plate, then socket body with sphere cut and cross slits (ball variants), or hinge post/base/top (hinge variant).
- **Fillets and chamfers reference edges by stored coordinates** (`edges` points plus `edge_refs` bounding boxes). A parameter change that moves geometry can break those references or silently re-target them. After a dimension change, check that every fillet still applies, using `inspect_design` or a screenshot.
- Feature IDs have gaps in the portrait variants because they were derived from the landscape design with features deleted. Don't assume IDs line up across variants.
