# src

## Overview

Core client-side game engine for **SILENT PROTOCOL** (Unidad S-7), a 3D social-stealth and cyber-infiltration simulation set in Mansion Aurora. This package separates fixed-timestep (`60` Hz) 2D XZ-plane stealth + cyber simulation, dual-radius grid A* navigation, seeded PRNG (`mulberry32`), and NPC/robotic state machines from browser-bound Three.js WebGL2 PBR rendering (`./render/`), DOM HUD overlays, and WebAudio synthesis. Headless modules (`config.js`, `mathx.js`, `level.js`, `nav.js`, `entities.js`, `npc.js`, `cyber.js`, `sim.js`) run under Node.js without a DOM or Three.js dependency, while `main.js`, `render.js`, `diag.js`, `ui.js`, `audio.js`, and `./render/*` bind to browser APIs.

Domain mechanics implemented across `src`:
- **Disguises, Burned Outfits & Enforcers**: Wearing an `OUTFITS` disguise grants access to its `zones` and legal visible `carry` items. If an NPC reaches `awareness >= 1`, `compromise()` marks the player's current outfit as **burned** (`player.burned[outfitId] = true`), causing guards and same-role NPCs to detect the player rapidly (`SUSPECT.burned = 1.1`/s). Certain supervisor NPCs define `enforcerFor` (`chief` for `'guard'`, `chef` for `'cook'`, `sci_senior` for `'scientist'`) and recognize impostors wearing that outfit within `9` m (`SUSPECT.enforcer = 0.7`/s).
- **Scanner / Instinct & Cyber Infiltration (`src/cyber.js`)**: Holding `V` or toggling `Tab` activates `player.instinctOn` (draining `player.instinct` at `13`/s and recharging at `7`/s in `'s7'` mode), switching walls to translucent X-ray materials, revealing vision cones, and unlocking aim-assisted remote hacking (`getCyberPrompt`):
  - **RF Wall Attenuation & Wired CCTV Bus**: Wireless hacks attenuate across walls (`effectiveRange = max(0, 11.5 - wallCrossings * 3.5)` m). Breaching a camera (`KeyF`, `cam_hop`) transitions `sim.link.mode` to `'camera'`; once inside the wired CCTV bus, hopping (`KeyA`/`KeyD` or aiming + `KeyF`) and injecting camera loops (`KeyE`, `cam_loop`) across active cameras bypass RF range limits, while wireless hacks emitted from that camera toward ground/room nodes measure range/wall crossings from the active camera (`signalOrigin(sim)`).
  - **Robotic Units & Low Vents**: Two quadruped units (`bot_maint`, `bot_sec`, radius `0.28` m) navigate `sim.unitNav` across **4** low `VENTS` (`span: 1.5` m) impassable to humans (`0.36` m radius). Guards spotting a player-controlled bot outside its `allowedZones` or within `1.5` s of sabotaging (`sim.time - u.lastSabotageAt < 1.5`) disable the bot for `30` s without burning S-7's disguise or incrementing `sim.stats.spotted`.
  - **Stationary Vulnerability & Signal Tracing**: While linked (`player.jackedIn === true`), S-7's chassis remains stationary (`SUSPECT.jackedIn = 1.35`/s) protected by an emergency watchdog that auto-disconnects at `>= 0.45` NPC awareness / normalized camera suspicion or upon taking damage. Accumulating `trace.netHeat >= 0.65` while `chief` and `cams` are operational triggers a `10` s signal trace toward `(originX, originZ)`; disconnecting and moving `> 9` m away evades the trace cleanly (`netHeat` capped to `0.22`), whereas letting `trace.progress` reach `1.0` dispatches `ALERT.SEARCH` + the nearest guard to `(originX, originZ)` without burning S-7's disguise.
- **Accidents & Sabotage**: Poisoned consumables (`4.5` s `sick` delay), electric floor traps (`1.15` m radius), the sabotaged hall chandelier at `(0, 3)` (`2.6` m radius), and the electrified lab puddle at `(17.8, 4.5)` (`1.9` m radius for `32` s) — triggered physically or via remote `overheat` — kill NPCs with `cause = 'accident'` (preserving Silent Assassin ratings).

## Subdirectories

- render: [./render/README.md](./render/README.md) - Procedural CPU `DataTexture` PBR materials + `PMREM` environment, articulated FK/IK character and bot rigs, beveled/lathed Mansion Aurora props + static mesh batching, and `HalfFloatType` MSAA `4x` Bloom + `AgX` post-processing.

## Interface

- **Configuration & Rules (`./config.js`)**:
  - `[src/config.js:TICK]` — Fixed simulation timestep constant (`1 / 60` s).
  - `[src/config.js:PLAYER]`, `[src/config.js:ZONES]`, `[src/config.js:OUTFITS]`, `[src/config.js:ITEMS]`, `[src/config.js:ALERT]`, `[src/config.js:VISION]`, `[src/config.js:SUSPECT]`, `[src/config.js:COLORS]` — Core stealth, disguise, inventory, perception (`SUSPECT.jackedIn: 1.35`), and palette constants.
  - `[src/config.js:CYBER]` — Cyber constants (`hackBaseRange: 11.5`, `wallPenalty: 3.5`, `maxLinkRange: 26`, `aimConeCos: 0.94`, `camMaxPan: 0.65`, `unitDrainPerSec: 2.5`, `camLoopDuration: 18`, `unitDisableDuration: 30`, `lureRadius: 11`, `botInteractRange: 2.1`, `emergencyDisconnectAt: 0.45`, `unitRadius: 0.28`, `unitSpeed: 3.4`, `costs`, and `heat` thresholds/hysteresis with `traceThreshold: 0.65`, `traceDuration: 10`, `evadeRadius: 9`, `postTraceReset: 0.22`).
  - `[src/config.js:outfitAllowed]` & `[src/config.js:itemLegal]` — Zone and visible-item legality predicates.
- **2D XZ Geometry, Collision & Seeded PRNG (`./mathx.js`)**:
  - `[src/mathx.js:clamp]`, `[src/mathx.js:lerp]`, `[src/mathx.js:dist]`, `[src/mathx.js:dist2]`, `[src/mathx.js:normAngle]`, `[src/mathx.js:angleTowards]`, `[src/mathx.js:angleDiff]` — Scalar, Euclidean, and angular helpers.
  - `[src/mathx.js:pointInBox]`, `[src/mathx.js:resolveCircle]`, `[src/mathx.js:segBox]`, `[src/mathx.js:losClear]`, `[src/mathx.js:rayHitDistance]` — AABB push-out and 2D slab raycasting.
  - `[src/mathx.js:createRng]`, `[src/mathx.js:rngRange]`, `[src/mathx.js:rngInt]` — Deterministic `mulberry32` PRNG helpers.
- **Procedural Level Data & Vents (`./level.js`)**:
  - `[src/level.js:WALLS]`, `[src/level.js:VENTS]`, `[src/level.js:DOORS]`, `[src/level.js:PROPS]`, `[src/level.js:INTERACTABLES]`, `[src/level.js:CAMERAS]`, `[src/level.js:NPC_DEFS]`, `[src/level.js:UNIT_DEFS]`, `[src/level.js:PLAYER_SPAWN]`, `[src/level.js:LIGHTS]` — Mansion Aurora architecture, **4** low robotic vents (`vent_sec`, `vent_off`, `vent_hall`, `vent_lab`), **23** interactables (with `hack: 'overheat' | 'lure_ping'` metadata where applicable), 4 CCTV cameras, 19 NPCs, 2 robotic units, and 16 light fixtures.
  - `[src/level.js:zoneAt]`, `[src/level.js:solidBoxes]`, `[src/level.js:solidBoxesForUnits]`, `[src/level.js:wallBlocked]`, `[src/level.js:countWallCrossings]` — Zone lookup, human vs. unit solid obstacle builders (`solidBoxesForUnits` carves `v.span = 1.5` m pass-through gaps at `VENTS`, while `PROPS` renders `0.9` m decorative grilles), wall occlusion, and corner-deduplicated RF wall-crossing counter (merging hits separated by `< 0.45` m world distance).
- **Grid Pathfinding (`./nav.js`)**:
  - `[src/nav.js:Nav]` — Parameterized 2D grid A* pathfinder (`new Nav(boxes, agentRadius = 0.36)`) used for both humans (`sim.nav`, `0.36` m) and robotic units (`sim.unitNav`, `0.28` m).
- **Entity Lifecycle, Damage & Alarms (`./entities.js`)**:
  - `[src/entities.js:pushEvent]`, `[src/entities.js:addNoise]`, `[src/entities.js:addFx]` — Event (`{ id, t, kind, text, sfx }`), acoustic (`opts.targetNpcId` optional filter), and FX emitters.
  - `[src/entities.js:resetLink]` — Pure headless helper resetting `sim.link` to `'s7'`, `sim.link.restoreView = true`, and `player.jackedIn = false` without circular imports.
  - `[src/entities.js:damagePlayer]`, `[src/entities.js:raiseAlarm]`, `[src/entities.js:burnOutfit]`, `[src/entities.js:compromise]`, `[src/entities.js:viewersOf]`, `[src/entities.js:witnessCrime]`, `[src/entities.js:spawnBody]`, `[src/entities.js:killNPC]`, `[src/entities.js:subdueNPC]`, `[src/entities.js:wakeBody]`, `[src/entities.js:hideBody]` — Damage (severing active remote links via `resetLink`), witness propagation (ignoring looped cameras `sim.time < c.loopedUntil`), disguise compromise, and body lifecycle.
- **NPC Perception & State Machine (`./npc.js`)**:
  - `[src/npc.js:createNPC]`, `[src/npc.js:setGoal]`, `[src/npc.js:updateNPC]` — Steps NPCs using `sim.rng`, detecting `player.jackedIn` (`SUSPECT.jackedIn`), disabling hijacked units spotted outside `u.allowedZones` or within `1.5` s of `u.lastSabotageAt`, and honoring `nz.targetNpcId` (including redirecting investigating guards on `nz.kind === 'trace'`).
- **Cyber Infiltration Subsystem (`./cyber.js`)**:
  - `[src/cyber.js:createUnit]`, `[src/cyber.js:createLinkState]`, `[src/cyber.js:createTraceState]` — State factories for robotic units, `sim.link`, and `sim.trace`.
  - `[src/cyber.js:signalOrigin]`, `[src/cyber.js:effectiveHackRange]`, `[src/cyber.js:applySabotageEffect]`, `[src/cyber.js:getCyberPrompt]`, `[src/cyber.js:executeCyberAction]`, `[src/cyber.js:cycleCameraLink]`, `[src/cyber.js:disconnectLink]`, `[src/cyber.js:stepCyber]` — RF range computation, unified physical/remote sabotage helper, 3D aim-cone node selection, CCTV cycling/wired loop injection, emergency chassis watchdog, unit kinematics, and signal trace state machine.
- **Simulation Facade (`./sim.js`)**:
  - `[src/sim.js:createSim]`, `[src/sim.js:stepSim]`, `[src/sim.js:getContext]`, `[src/sim.js:doAction]`, `[src/sim.js:takedownTarget]`, `[src/sim.js:selectItem]`, `[src/sim.js:toggleHolster]`, `[src/sim.js:reload]`, `[src/sim.js:useItem]`, `[src/sim.js:shoot]`, `[src/sim.js:missionRating]`, `[src/sim.js:objectiveList]` — Full game state factory (`createSim({ seed })` with enumerable uint32 `sim.rngState` and non-enumerable `sim.rng`), dual-locus `getContext(sim, aimRay)` and `doAction(sim, action, opts = {})` (`{ camYaw, camPitch }`), weapon lock while `sim.link.mode !== 's7'`, and mission scoring. Re-exports `zoneAt`, `OUTFITS`, `ITEMS`, `ZONES`, `COLORS`, `WALLS`, `PROPS`, `VENTS`, `signalOrigin`, `effectiveHackRange`, `countWallCrossings`, `getCyberPrompt`, `executeCyberAction`, `cycleCameraLink`, `disconnectLink`.
- **Browser Presentation, Diagnostics & Entry Point (`./main.js`, `./render.js`, `./diag.js`, `./ui.js`, `./audio.js`)**:
  - `[src/main.js:window.__game]` — Browser `60` Hz loop, cyber input routing (`KeyE`, `KeyF`, `KeyA`/`KeyD` in CCTV, `KeyQ`/`Escape` disconnect), structured `e.sfx` playback, dynamic `import('./diag.js')` for `?show` / `?bench`, and `{ get sim(), view, ui, input, audio, restart, diag }`.
  - `[src/render.js:View]` — Three.js WebGL2 orchestrator (`attachSim`, `setQuality`, `resize`, `updateCamera`, `aimRay`, `project`, `render`, `updateFx`, `getDiagnostics`, `dispose`). Manages merged `wallMesh`/`trimMesh` material swaps, static prop batching, fixed `7 + 1` `PointLight` pool (`visible = true`, muted via `intensity = 0`), `'s7' | 'camera' | 'unit'` camera modes, and `renderer.debug.onShaderError` capture.
  - `[src/diag.js:runDiagnosticsMode]` — On-demand orbital showcase (`?show=mats|rigs|props|units` -> `window.__showReport`) and automated waypoint + 3x `attachSim()` leak benchmark (`?bench=1` -> `window.__benchReport`).
  - `[src/ui.js:UI]` — Dual-locus HUD (`#linkBanner` with `#linkText`/`#linkWarn`, `#traceBar` with `#traceLabel`/`#tracePct`/`#traceFill`, `#suspicionRing` chassis prefix, always-visible `#extras`), `signalOrigin`-based 3D markers, and tactical minimap with `VENTS`, `sim.units`, and `26` m link tether.
  - `[src/audio.js:Audio]` — Procedural WebAudio synthesizer including `'hack'`, `'overheat'`, `'cam_hop'`, `'trace_warn'`, and `'link_lost'` patches.

## Invariants

- **Strict Headless & Presentation DAG**: All 17 modules under `src/` form a strict acyclic import graph; headless modules (`config.js`, `mathx.js`, `level.js`, `nav.js`, `entities.js`, `npc.js`, `cyber.js`, `sim.js`) never reference `window`, `document`, `THREE`, or `./render/*`.
- **Seeded Determinism**: Passing `{ seed }` to `createSim({ seed })` routes all simulation randomness through `sim.rng` backed by enumerable `sim.rngState`, producing `assert.deepStrictEqual`-identical state graphs across runs.
- **GPU Draw-Call & Shader Stability**: `View` sets `renderer.info.autoReset = false` (resetting once per frame), batches static opaque geometry via `mergeStaticMeshes`, keeps all `8` `PointLight` instances `visible = true` (avoiding `NUM_POINT_LIGHTS` shader recompilations), precompiles `wallOpaque`/`wallXray` against `postfx.compile()`, and maintains `maxDrawCalls <= 350` with `0` shader errors and `0` geometry/texture leaks across `attachSim()` restarts.

## Side Effects

- `[src/level.js:WALLS]` & `[src/level.js:PROPS]` — Populates exported level arrays at module import time.
- `[src/sim.js:stepSim]` & `[src/sim.js:doAction]` — Mutates `sim` state graph and advances `sim.rngState` in place.
- `[src/render.js:View]` & `[src/diag.js:runDiagnosticsMode]` — Allocates WebGL2 resources, registers `renderer.debug.onShaderError`, renders via `postfx`, and publishes `window.__showReport` / `window.__benchReport` in diagnostic modes.
- `[src/ui.js:UI]`, `[src/audio.js:Audio]`, `[src/main.js:window.__game]` — Mutates DOM/CSS/Canvas2D state, synthesizes WebAudio nodes, manages Pointer Lock, and exposes `window.__game`.

## Verification

- Run: `npm test` (`node --test tests/sim.test.mjs tests/cyber_and_dag.test.mjs`)
