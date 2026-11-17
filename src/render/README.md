# src/render

## Overview

Zero-asset procedural WebGL2 rendering subsystem for **SILENT PROTOCOL** (`Three.js r160`). This directory encapsulates deterministic CPU-synthesized PBR material libraries (`Albedo`, `ORM`, `Normal`) + `PMREM` reflections, articulated Forward Kinematics (`FK`) humanoid rigs and analytical 2-bone Inverse Kinematics (`IK`) robotic rigs, procedural beveled/lathed Mansion Aurora furniture and static geometry batching, and linear `HalfFloatType` MSAA `4x` HDR Bloom + `AgXToneMapping` post-processing.

Modules in `src/render/` depend only on `../../vendor/three.module.js`, pure configuration/math exports (`../config.js`, `../mathx.js`), and internal helper `rigs.js -> ./props.js` (`mergeBufferGeometries`), and are consumed by `../render.js` and `../diag.js`.

## Interface

- **Procedural PBR Material Library (`./mats.js`)**:
  - `[src/render/mats.js:ARCHETYPES]` — 9 tileable surface archetypes (`wood_parquet`, `ceramic_tile`, `plaster_wall`, `brushed_steel`, `painted_metal`, `fabric_suit`, `leather_upholstery`, `concrete_service`, `turf_garden`).
  - `[src/render/mats.js:createMaterialLibrary]` — `createMaterialLibrary(renderer, quality = 'high')`: synthesizes deterministic `DataTexture` triplets (`map` in `SRGBColorSpace`, `ormMap` with `R=AO, G=Roughness, B=Metalness` in `NoColorSpace`, and tangent-space `normalMap` in `NoColorSpace` at `512x512` for `high`/`medium` and `256x256` for `low`), generates an indoor/night `PMREMGenerator` environment cubemap (`envMap`), and returns shared `MeshStandardMaterial` / HDR `MeshBasicMaterial` instances (`wallOpaque`, `wallXray`, `trimOpaque`, `trimXray`, `brushedSteel`, `paintedMetal`, `darkMetal`, `gold`, `wood`, `warmWood`, `ceramic`, `white`, `concrete`, `leather`, `darkLeather`, `fabric`, `green`, `glass`, `water`, `glowCyan`, `glowAmber`, `glowRed`, `glowGold`, `glowGreen`, `glowWarm`), `makeZoneFloorMaterial(zone)`, `makeCharacterMaterials(isPlayer)`, and `dispose()`.
- **Articulated FK & IK Rigs (`./rigs.js`)**:
  - `[src/render/rigs.js:solveTwoBoneIK]` — `solveTwoBoneIK(l1, l2, targetZ, targetYDown) => { hipRotX, kneeRotX }`: analytical law-of-cosines 2-bone IK solver clamping target reach to `[|l1 - l2| + 1e-4, l1 + l2 - 1e-4]`.
  - `[src/render/rigs.js:createHumanoidRig]` — `createHumanoidRig(outfitId, isPlayer, matLib) => { group, parts, accessories, held, outfitId, _stripped, applyOutfit, setHeld, setVisorColor, setInstinctHighlight, setStripped, pose, dispose }`: builds articulated human/S-7 hierarchies (`hips -> torso, chest, head, shoulderL/R -> elbowL/R, thighL/R -> kneeL/R`) using per-character material instances backed by shared `DataTexture` maps, pre-merging internal rigid sub-parts and supporting `{ crouch, jackedIn, dragging, aiming, channel, dead, sleep }` pose flags.
  - `[src/render/rigs.js:createBotRig]` — `createBotRig(kind, matLib) => { group, chassis, gimbal, pose, dispose }`: builds quadruped maintenance (`maint`) and security (`sec`) robotic units driven by `solveTwoBoneIK` across 4 articulated legs (`femur -> tibia`), reflecting `hijacked` and `disabled` states on the sensor gimbal.
- **Procedural Props, Vents & Static Batching (`./props.js`)**:
  - `[src/render/props.js:scaleGeometryUVs]` & `[src/render/props.js:scaleBoxUVs]` — World-space UV scaling helpers preventing texture stretching across variable-sized floors, walls, and furniture boxes.
  - `[src/render/props.js:mergeBufferGeometries]` — `mergeBufferGeometries(geos) => THREE.BufferGeometry | null`: normalizes indexed/non-indexed geometries to `{ position, normal, uv }` attributes and concatenates them into a single `BufferGeometry`.
  - `[src/render/props.js:mergeStaticMeshes]` — `mergeStaticMeshes(roots) => { meshes, dispose }`: traverses static scene roots, skips `userData.dynamic` hierarchies and `material.transparent === true` meshes, transforms static geometries into world space, merges them by `(material, castShadow, receiveShadow)`, removes/disposes source meshes, and returns batched meshes.
  - `[src/render/props.js:buildLightCone]` — `buildLightCone(light, matLib) => { group, cone, setFactor, dispose }`: builds ceiling housing + bulb + soft additive volumetric light cone (`depthWrite: false`, `toneMapped: false`) with custom Fresnel edge fade.
  - `[src/render/props.js:buildPropMesh]` — `buildPropMesh(prop, matLib, refs) => THREE.Group`: constructs Mansion Aurora furniture, lab equipment, pre-merged 3-mesh `chandelier` (`userData.dynamic = true`), and double-sided low `'vent'` grilles, populating dynamic handles on `refs` (`puddleLab`, `terminalScreen`, `poolWater`, `chandelier`, `boatLight`, `ownedMaterials`).
- **HDR MSAA + Bloom + AgX Post-Processing (`./postfx.js`)**:
  - `[src/render/postfx.js:supportsHdrPostFX]` — `supportsHdrPostFX(renderer) => boolean`: verifies `EXT_color_buffer_float` or `EXT_color_buffer_half_float` on WebGL2 (or `EXT_color_buffer_half_float` on WebGL1).
  - `[src/render/postfx.js:createPostFX]` — `createPostFX(renderer, width, height, quality) => { enabled, resize, setQuality, compile, render, dispose }`: renders the linear scene into a `HalfFloatType` `WebGLRenderTarget` (`samples: 4` in `high`, `2` in `medium`), precompiles shaders against `sceneRT` via `compile(scene, camera)`, runs a soft-threshold prefilter + mipmap downsample/tent-upsample Bloom pyramid (`toneMapped: false`), and composites to screen using Three.js native `#include <tonemapping_fragment>` (`AgXToneMapping`) and `#include <colorspace_fragment>`. Falls back cleanly to direct `<canvas>` rendering in `low` quality or when float FBO extensions are absent.

## Invariants

- **Shared Immutable Textures, Isolated Mutable Materials**: Shared `DataTexture` maps in `matLib.sets` are immutable after creation; `createHumanoidRig` and `createBotRig` allocate per-entity material instances (`makeCharacterMaterials`, `eyeMat`) so outfit swaps (`applyOutfit`, `setStripped`, `setInstinctHighlight`, `setVisorColor`) and state tints never mutate materials shared across other NPCs or props.
- **Shadow Caster Discipline**: On humanoid rigs, `castShadow = true` is restricted to `torso` and `thighL`/`thighR`; `buildLightCone` and `'vent'` slats never cast shadows.
- **Single Tone-Mapping & Color-Space Conversion**: Intermediate Bloom shaders set `toneMapped: false`, while `renderer.toneMapping` stays `THREE.AgXToneMapping`; Three.js `r160` automatically suppresses tone-mapping when rendering to offscreen `WebGLRenderTarget`s and applies `AgXToneMapping` + `SRGBColorSpace` encoding exactly once on the final screen pass (`setRenderTarget(null)`).
- **Zero-Leak Lifecycle**: `mergeStaticMeshes`, `mergeBufferGeometries` callers, `rig.dispose()`, `postfx.dispose()`, and `matLib.dispose()` release owned `BufferGeometry`, `Material`, `DataTexture`, and `WebGLRenderTarget` allocations.

## Verification

- Syntax check: `node --check src/render/mats.js && node --check src/render/rigs.js && node --check src/render/props.js && node --check src/render/postfx.js`
- Browser visual showcases: `http://127.0.0.1:8080/?show=mats`, `?show=rigs`, `?show=props`, `?show=units` (`window.__showReport.shaderErrors.length === 0`)
- Browser GPU/leak benchmark: `http://127.0.0.1:8080/?bench=1&duration=10` (`window.__benchReport.maxDrawCalls <= 350`, `geometriesDelta === 0`, `texturesDelta === 0`)
