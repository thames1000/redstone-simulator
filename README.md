# Redstone Simulator 3D

A browser-based 3D redstone sandbox. Build circuits block-by-block, wire up
inputs and outputs, and watch the signal propagate live. Inspired by
Minecraft redstone — includes dust, torches, repeaters, comparators, observers,
levers, buttons, redstone blocks, and lamps.

## Running

No build step. Because it uses ES modules, open it through a local server
(opening the file directly via `file://` is blocked by the browser):

```bash
cd redstone-simulator
python3 -m http.server 8000
# then open http://localhost:8000
```

Three.js is loaded from a CDN (unpkg), so you need an internet connection the
first time. Any static file server works (`npx serve`, VS Code Live Server, etc.).

## Controls

| Action | Control |
| --- | --- |
| Orbit / zoom | drag / scroll |
| Place selected block | left-click a face (or the ground) |
| Remove block | right-click, or hover + `X` |
| Rotate a component | hover it + `R` |
| Run / pause the simulation | `▶ Run` button or `Space` |
| Single tick | `⏭ Step` or `.` |
| Interact (toggle inputs / edit) | pick the **✋ Interact** tool |

With the **Interact** tool selected:
- click a **lever** to toggle it on/off,
- click a **button** to fire a short pulse,
- click a **repeater** to cycle its delay (1–4 ticks),
- click a **comparator** to switch compare ↔ subtract mode,
- click a **crop** to bone-meal it up one growth stage.

Builds can be saved to / loaded from JSON with the toolbar buttons, and the
**Examples…** dropdown loads ready-made scenes.

## Examples

- **Wires, repeater & torch** — the basics: a lever driving a dust line into a
  lamp, a repeater extending the run, and a torch powering a lamp.
- **Slime piston door** — a lever pulses sticky pistons that shove a slime
  pillar aside and pull it back, demonstrating block movement + slime adhesion.
- **Crop farm + dispenser** — a comparator reads a growing wheat crop's stage
  and lights a lamp when it's ripe; a button-fired dispenser bone-meals the crop,
  and an observer pulses on every growth stage.
- **Auto harvester (shears)** — a fully self-running farm: an observer facing the
  crop pulses each time it grows, firing a shears dispenser. Because shears only
  cut a ripe crop, it harvests and replants exactly at full growth, then the
  cycle repeats on its own. A comparator + lamp show the current growth level.

## Blocks

- **Block / Glass** — structural. Blocks conduct power; glass insulates.
- **Slime Block** — sticks to adjacent blocks so a piston moves the whole clump.
- **Redstone Dust** — carries a 0–15 signal, dropping 1 per block.
- **Redstone Torch** — inverter; on unless the block it's mounted on is powered.
- **Redstone Block** — constant power source.
- **Lever / Button** — manual inputs (toggle / momentary).
- **Repeater** — one-way, restores signal to 15, adjustable delay, side-lockable.
- **Comparator** — compare / subtract logic; also reads a crop's growth.
- **Observer** — pulses from its back when the block it faces changes.
- **Piston / Sticky Piston** — push up to 12 blocks when powered; the sticky
  variant pulls the front block back on retract. Slime blocks drag their
  neighbours along.
- **Dispenser** — on a rising power edge, acts on the block in front. Click it
  in Interact mode to swap its loaded item:
  - **Bone Meal** (default) — grows the crop in front a stage, or plants a new
    crop on soil;
  - **Shears** (a *harvester*) — cuts a fully-grown crop and replants it back to
    stage 0. Wired to a trigger, this makes a self-running farm.
- **Wheat Crop** — grows through stages 0–7 over time; a comparator behind it
  reads the stage, and an observer facing it pulses on each growth step.
- **Redstone Lamp** — lights while powered (your output indicator).

## How the simulation works

Each **tick**, the engine:
1. computes the instantaneous power field — dust levels via a bucketed
   max-relaxation (Dijkstra on the 0–15 lattice), plus block conduction;
2. reads the inputs of delayed components (torches, repeaters, comparators,
   observers) from that field and schedules their next state;
3. applies the new states, so feedback loops (clocks) oscillate rather than
   deadlock.

### Accuracy note

This is an **approximate** model, tuned to behave correctly for common circuits
(wire runs, torch logic gates, clocks, repeater lines, comparator subtractors,
observer pulses). It is **not** a bit-exact reimplementation of Minecraft. Known
simplifications:

- the strong/weak power distinction is collapsed into a single conduction rule;
- dust connects to horizontal neighbours plus one-block vertical "climbs";
- pistons move blocks but pistons/dispensers themselves are treated as immovable,
  and non-solid components (dust, torches, repeaters…) pop off when pushed;
- comparators read wheat crops but not container fill (chests, etc.);
- crop growth is a simple per-tick random chance, not MC's exact random-tick model;
- support requirements are relaxed — components may float.

## Project layout

```
index.html      # shell + Three.js import map
styles.css      # UI styling
src/blocks.js   # directions, coords, block-type metadata
src/engine.js   # the redstone simulation (framework-free, unit-tested)
src/scene.js    # Three.js rendering + picking
src/main.js     # palette UI, input handling, tick loop
```

The engine has no rendering dependency, so its logic is testable in plain Node.
