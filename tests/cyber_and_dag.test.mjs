import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALERT, CYBER, PLAYER } from '../src/config.js';
import { VENTS, UNIT_DEFS, wallBlocked, countWallCrossings, zoneAt } from '../src/level.js';
import { dist, resolveCircle } from '../src/mathx.js';
import { damagePlayer, witnessCrime, killNPC } from '../src/entities.js';
import {
  createSim,
  stepSim,
  getContext,
  doAction,
  useItem,
  shoot,
  effectiveHackRange,
  executeCyberAction,
  cycleCameraLink,
  disconnectLink,
  missionRating,
} from '../src/sim.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IDLE_INPUT = { mx: 0, mz: 0, camYaw: Math.PI, run: false, crouch: false, aim: false, instinct: false };

function advance(sim, seconds, input = IDLE_INPUT) {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) stepSim(sim, 1 / 60, input);
}

function isolateNPCs(sim, keepIds = []) {
  const keep = new Set(keepIds);
  for (const n of sim.npcs) {
    if (keep.has(n.id)) continue;
    n.x = -20;
    n.z = 24;
    n.yaw = Math.PI;
    n.route = [[-20, 24, 9999]];
    n.routeIdx = 0;
    n.state = 'idle';
    n.dwell = 9999;
  }
}

test('headless modules enforce strict acyclic DAG and zero DOM/WebGL/THREE coupling', async () => {
  const headlessFiles = [
    'src/config.js',
    'src/mathx.js',
    'src/level.js',
    'src/nav.js',
    'src/entities.js',
    'src/npc.js',
    'src/cyber.js',
    'src/sim.js',
  ];

  const allSrcFiles = [
    ...headlessFiles,
    'src/render/mats_ops.js',
    'src/render/mats_worker.js',
    'src/render/mats.js',
    'src/render/props.js',
    'src/render/postfx.js',
    'src/render/rigs.js',
    'src/render.js',
    'src/diag.js',
    'src/ui.js',
    'src/audio.js',
    'src/main.js',
  ];

  const forbidden = /\b(window|document|navigator|WebGLRenderingContext|WebGL2RenderingContext|THREE|requestAnimationFrame|AudioContext)\b/;
  const externalAssetRe = /\b(https?:\/\/|fetch\s*\(|TextureLoader|GLTFLoader|AudioLoader)\b/;
  const adj = new Map();

  for (const rel of allSrcFiles) {
    const abs = resolve(ROOT, rel);
    const src = await readFile(abs, 'utf8');
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(externalAssetRe.test(codeOnly), false, `Source file ${rel} references external URLs or asset loaders`);
    const isHeadless = headlessFiles.includes(rel);
    if (isHeadless) {
      assert.equal(forbidden.test(codeOnly), false, `Headless file ${rel} contains forbidden browser/WebGL symbol`);
    }

    const deps = [];
    const importRe = /(?:import\s+(?:[\s\S]*?from\s+)?|import\s*\(\s*)['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRe.exec(codeOnly)) !== null) {
      const spec = m[1];
      if (isHeadless) {
        assert.equal(spec.includes('render') || spec.includes('vendor') || spec.includes('ui') || spec.includes('audio') || spec.includes('diag'), false,
          `Headless file ${rel} imports presentation module ${spec}`);
      }
      if (spec.startsWith('.') && !spec.includes('vendor')) {
        const targetAbs = resolve(dirname(abs), spec);
        const targetRel = targetAbs.slice(ROOT.length + 1).replace(/\\/g, '/');
        deps.push(targetRel);
      }
    }
    adj.set(rel, deps);
  }

  // Detect any cycle via DFS coloring across ALL src/ modules (0 = unvisited, 1 = visiting, 2 = visited)
  const color = new Map();
  function dfs(node, stack = []) {
    color.set(node, 1);
    for (const next of adj.get(node) || []) {
      const c = color.get(next) || 0;
      assert.notEqual(c, 1, `Circular dependency detected: ${[...stack, node, next].join(' -> ')}`);
      if (c === 0) dfs(next, [...stack, node]);
    }
    color.set(node, 2);
  }
  for (const f of allSrcFiles) {
    if (!color.get(f)) dfs(f);
  }
});

test('seeded simulation produces bit-identical state across 300 ticks including cyber actions', () => {
  const runScenario = () => {
    const sim = createSim({ seed: 1337 });
    for (let i = 0; i < 120; i++) {
      stepSim(sim, 1 / 60, { mx: 0.3, mz: 1, camYaw: 2.8, run: true, crouch: false, aim: false, instinct: i > 60 });
    }
    sim.player.x = -8;
    sim.player.z = -9;
    executeCyberAction(sim, 'cam_hop', 'cam_corr', 1.5, 0.3);
    for (let i = 0; i < 90; i++) {
      stepSim(sim, 1 / 60, { mx: 0, mz: 0, camYaw: 1.5, camYawOffset: 0.2, instinct: false });
    }
    disconnectLink(sim, 'manual');
    for (let i = 0; i < 90; i++) {
      stepSim(sim, 1 / 60, { mx: -0.5, mz: 0.5, camYaw: 1.1, run: false, crouch: true, aim: false, instinct: false });
    }
    return sim;
  };

  const simA = runScenario();
  const simB = runScenario();
  assert.deepStrictEqual(simA, simB);
});

test('RF wall attenuation, corner deduplication, CCTV bus hopping, and remote overheat accident (CUJ 1)', () => {
  const sim = createSim({ seed: 42 });
  isolateNPCs(sim, ['kessler']);

  // Low solid furniture (pool at [10, 19]) does NOT count as a wall crossing
  assert.equal(countWallCrossings(2, 19, 18, 19), 0);

  // Corner T-junction at (-10, -12) counts as 1 physical wall, not 2-3 overlapping segments
  const cornerCross = countWallCrossings(-11.2, -13.2, -8.8, -10.8);
  assert.equal(cornerCross, 1);

  // CUJ 1: S-7 in backstage (-8, -9.5) cannot directly hack labfuse (21.6, 3.2) across mansion walls
  sim.player.x = -8;
  sim.player.z = -9.5;
  const directRf = effectiveHackRange(sim, sim.interactables.labfuse.x, sim.interactables.labfuse.z);
  assert.equal(directRf.inRange, false);
  assert.equal(executeCyberAction(sim, 'overheat', 'labfuse'), false);

  // cycleCameraLink must reject direct invocation while in 's7' mode
  assert.equal(cycleCameraLink(sim, 1), false);

  // Breach cam_corr nearby via RF, hop to cam_lab via wired CCTV bus, overheat labfuse
  assert.equal(executeCyberAction(sim, 'cam_hop', 'cam_corr', 2.1, 0.35), true);
  assert.equal(sim.link.mode, 'camera');
  assert.equal(sim.link.targetId, 'cam_corr');
  assert.equal(sim.player.jackedIn, true);

  // Hop along CCTV bus until reaching cam_lab (28.2m away behind walls — succeeds on wired CCTV bus)
  let hops = 0;
  while (sim.link.targetId !== 'cam_lab' && hops++ < 5) {
    assert.equal(cycleCameraLink(sim, 1), true);
  }
  assert.equal(sim.link.targetId, 'cam_lab');

  // Injecting a camera loop across the wired CCTV bus must also bypass RF walls
  sim.player.instinct = 100;
  assert.equal(executeCyberAction(sim, 'cam_loop', 'cam_hall'), true);
  assert.ok(sim.cams.find((c) => c.id === 'cam_hall').loopedUntil > sim.time + 15);
  sim.player.instinct = 100;

  // While linked, weapon/item triggers on S-7 are blocked
  sim.player.item = 'pistol';
  useItem(sim);
  shoot(sim);
  assert.equal(sim.stats.shots, 0);

  // Overheat labfuse from cam_lab (direct LOS inside lab, 0 walls -> inRange === true)
  assert.equal(executeCyberAction(sim, 'overheat', 'labfuse'), true);
  assert.equal(sim.interactables.labfuse.used, true);
  assert.ok(sim.electro > 30);

  // Place Kessler in lab puddle -> dies as 'accident', preserving Silent Assassin
  const kessler = sim.npcs.find((n) => n.id === 'kessler');
  kessler.x = 17.8;
  kessler.z = 4.5;
  advance(sim, 0.2);
  assert.equal(kessler.alive, false);
  assert.equal(sim.stats.accidents, 1);
  assert.equal(sim.stats.spotted, 0);
  assert.equal(sim.stats.alerts, 0);

  disconnectLink(sim, 'manual');
  assert.equal(sim.link.mode, 's7');
  assert.equal(sim.player.jackedIn, false);
});

test('all 4 VENTS and UNIT_DEFS are navigable by robotic units while solid walls block humans', () => {
  const sim = createSim({ seed: 7 });
  assert.equal(sim.npcs.length, 19);
  assert.equal(sim.units.length, 2);
  assert.equal(VENTS.length, 4);

  for (const def of UNIT_DEFS) {
    assert.equal(sim.unitNav.walkablePoint(def.x, def.z), true, `Unit ${def.id} spawn must be walkable`);
    for (const wp of def.route) {
      assert.equal(sim.unitNav.walkablePoint(wp[0], wp[1]), true, `Unit ${def.id} waypoint ${JSON.stringify(wp)} must be walkable`);
    }
  }

  // Test crossing each of the 4 vents
  for (const v of VENTS) {
    const a = v.axis === 'z' ? { x: v.x - 1.1, z: v.z } : { x: v.x, z: v.z - 1.1 };
    const b = v.axis === 'z' ? { x: v.x + 1.1, z: v.z } : { x: v.x, z: v.z + 1.1 };
    assert.equal(sim.unitNav.walkablePoint(a.x, a.z), true, `Side A of ${v.id} must be walkable for units`);
    assert.equal(sim.unitNav.walkablePoint(b.x, b.z), true, `Side B of ${v.id} must be walkable for units`);
    const uPath = sim.unitNav.path(a.x, a.z, b.x, b.z);
    assert.ok(uPath.length >= 1, `Expected unitNav path across ${v.id}`);
    // Verify the unit path goes straight through the vent (< 3.5m path length, not detouring around mansion)
    let len = 0, cur = a;
    for (const pt of uPath) { len += dist(cur.x, cur.z, pt.x, pt.z); cur = pt; }
    assert.ok(len < 3.5, `Expected direct vent traversal across ${v.id}, got length ${len.toFixed(2)}m`);

    // Humans remain blocked by the wall at the vent coordinate
    assert.equal(wallBlocked(a.x, a.z, b.x, b.z), true);
    const humanPush = resolveCircle(v.x, v.z, PLAYER.radius, sim.boxes);
    const pushedDist = Math.hypot(humanPush.x - v.x, humanPush.z - v.z);
    assert.ok(pushedDist > 0.25, `Human circle at ${v.id} must be pushed out of solid wall`);
  }

  // Bot can sabotage 'cams' via botuse:cams, and Instinct does NOT recharge (+7/s) while piloting bot
  isolateNPCs(sim, []);
  sim.player.x = -13.5;
  sim.player.z = -14.7;
  assert.equal(executeCyberAction(sim, 'unit_hijack', 'bot_maint'), true);
  const instAfterHijack = sim.player.instinct;
  advance(sim, 1.0, { mx: 1, mz: 0, camYaw: Math.PI / 2, instinct: false });
  assert.ok(sim.player.instinct < instAfterHijack - 2.0, 'Instinct must drain at unitDrainPerSec without +7/s recharge');

  const bot = sim.units.find((u) => u.id === 'bot_maint');
  bot.x = -3;
  bot.z = -15.5;
  const ctx = getContext(sim);
  assert.equal(ctx.primary?.action, 'botuse:cams');
  doAction(sim, 'botuse:cams');
  assert.equal(sim.camsDisabled, true);
});

test('emergency watchdog disconnects S-7 before compromise on NPC awareness, camera suspicion, loop, and damage', () => {
  const sim = createSim({ seed: 99 });
  isolateNPCs(sim, ['guard_corr']);

  sim.player.x = -14.2;
  sim.player.z = -13.5;
  sim.player.outfit = 'guard'; // legal zone, so ONLY jackedIn triggers suspicion!
  assert.equal(executeCyberAction(sim, 'unit_hijack', 'bot_maint'), true);

  const guard = sim.npcs.find((n) => n.id === 'guard_corr');
  guard.x = -14.2;
  guard.z = -16.8;
  guard.yaw = 0; // facing +Z directly towards S-7 at z=-13.5

  let ticks = 0;
  while (sim.link.mode !== 's7' && ticks++ < 180) {
    stepSim(sim, 1 / 60, IDLE_INPUT);
  }
  assert.equal(sim.link.mode, 's7', 'Watchdog must auto-disconnect S-7 upon guard awareness threshold');
  assert.equal(sim.link.lastDisconnectReason, 'threat');
  assert.equal(guard.compromised, false, 'S-7 must recover control well before compromise = 1.0');
  assert.equal(sim.stats.spotted, 0);

  // Camera loop suppresses witnessCrime
  const simLoop = createSim({ seed: 100 });
  isolateNPCs(simLoop, []);
  simLoop.player.x = -8;
  simLoop.player.z = -9.5;
  assert.equal(executeCyberAction(simLoop, 'cam_loop', 'cam_corr'), true);
  const seenWhileLooped = witnessCrime(simLoop, -4, -11.5, 'sabotage', 1);
  assert.equal(seenWhileLooped, false);
  assert.equal(simLoop.alarm, ALERT.CALM);

  // Physical damage immediately severs remote link
  simLoop.player.instinct = 100;
  assert.equal(executeCyberAction(simLoop, 'cam_hop', 'cam_corr'), true);
  damagePlayer(simLoop, 15);
  assert.equal(simLoop.link.mode, 's7');
  assert.equal(simLoop.link.lastDisconnectReason, 'damage');
});

test('guard spotting hijacked bot in restricted zone disables bot without burning S-7 disguise or incrementing spotted', () => {
  const sim = createSim({ seed: 202 });
  isolateNPCs(sim, ['chief']);

  sim.player.x = -14.2;
  sim.player.z = -14.7;
  sim.player.outfit = 'suit';
  assert.equal(executeCyberAction(sim, 'unit_hijack', 'bot_maint'), true);

  // Move bot_maint into 'security' (not in bot_maint.allowedZones) right in front of chief
  const bot = sim.units.find((u) => u.id === 'bot_maint');
  bot.x = -5.5;
  bot.z = -14.6;
  const chief = sim.npcs.find((n) => n.id === 'chief');
  chief.x = -3.0;
  chief.z = -14.6;
  chief.yaw = -Math.PI / 2; // facing -X towards (-5.5, -14.6)

  advance(sim, 0.2);
  assert.equal(sim.link.mode, 's7');
  assert.equal(sim.link.lastDisconnectReason, 'unit_lost');
  assert.ok(bot.disabledUntil > sim.time + 25);
  assert.equal(!!sim.player.burned.suit, false, 'Destroying remote bot must not burn S-7 outfit');
  assert.equal(sim.stats.spotted, 0, 'Destroying remote bot must not increment spotted');
  assert.equal(sim.alarm, ALERT.CALM, 'Local bot disable must not trigger combat alarm');
});

test('signal trace lifecycle: activation, clean evasion with hysteresis, search dispatch without outfit burn, and chief/cams cancellation', () => {
  // 1. Clean evasion preserves Silent Assassin and applies hysteresis (no infinite re-trigger)
  const simEvade = createSim({ seed: 303 });
  isolateNPCs(simEvade, ['chief', 'kessler', 'vandermeer']);
  // Keep chief conscious and operational in security
  const chief1 = simEvade.npcs.find((n) => n.id === 'chief');
  chief1.x = -3; chief1.z = -14.6; chief1.state = 'idle'; chief1.dwell = 999;

  simEvade.player.x = 18;
  simEvade.player.z = -8;
  assert.equal(executeCyberAction(simEvade, 'unit_hijack', 'bot_sec'), true); // +0.25
  simEvade.player.instinct = 100;
  const botSec = simEvade.units.find((u) => u.id === 'bot_sec');
  botSec.x = 19.5; botSec.z = 2.5;
  assert.equal(executeCyberAction(simEvade, 'overheat', 'labfuse'), true); // +0.48 -> 0.73 >= 0.65!
  assert.equal(simEvade.trace.active, true);

  // Disconnect and move > 9m away into public gala hall (8, 0) before trace reaches 1.0
  disconnectLink(simEvade, 'manual');
  simEvade.player.x = 8;
  simEvade.player.z = 0; // 12.8m from origin (18, -8), public zone out of camera sightlines
  advance(simEvade, 0.5);
  assert.equal(simEvade.trace.active, false, 'Moving > 9m away must evade trace');
  assert.ok(simEvade.trace.netHeat <= CYBER.heat.postTraceReset, 'Hysteresis must lower netHeat below threshold');
  advance(simEvade, 1.0);
  assert.equal(simEvade.trace.active, false, 'Trace must NOT re-trigger on subsequent ticks after evasion');
  assert.equal(simEvade.stats.alerts, 0);
  assert.equal(simEvade.stats.spotted, 0);

  // 2. Trace reaching 1.0 triggers ALERT.SEARCH and dispatches nearest guard WITHOUT burning outfit
  const simFull = createSim({ seed: 404 });
  isolateNPCs(simFull, ['chief', 'guard_corr']);
  const chief2 = simFull.npcs.find((n) => n.id === 'chief');
  chief2.x = -3; chief2.z = -14.6; chief2.state = 'idle'; chief2.dwell = 999;
  const guard = simFull.npcs.find((n) => n.id === 'guard_corr');
  // Even if guard is already investigating a stale spot, trace completion must redirect them to trace origin
  guard.x = 8; guard.z = -9; guard.state = 'investigate'; guard.goal = { x: 8, z: -9 }; guard.searchTimer = 20;

  simFull.player.x = 18;
  simFull.player.z = -8;
  simFull.trace.netHeat = 0.80;
  advance(simFull, 0.1);
  assert.equal(simFull.trace.active, true);
  // Move player away ONLY AFTER keeping them inside evadeRadius until trace completes
  advance(simFull, 10.2);
  assert.equal(simFull.trace.active, false);
  assert.equal(simFull.alarm, ALERT.SEARCH);
  assert.equal(guard.state, 'investigate', 'Nearest guard must be dispatched to investigate trace origin');
  assert.equal(guard.goal.x, 18, 'Investigating guard goal must update to trace originX');
  assert.equal(guard.goal.z, -8, 'Investigating guard goal must update to trace originZ');
  assert.equal(!!simFull.player.burned[simFull.player.outfit], false, 'Trace completion must not burn S-7 outfit');

  // 3. Neutralizing chief cancels an active trace immediately
  const simKillChief = createSim({ seed: 505 });
  isolateNPCs(simKillChief, ['chief']);
  const chief3 = simKillChief.npcs.find((n) => n.id === 'chief');
  chief3.state = 'idle'; chief3.dwell = 999;
  simKillChief.trace.netHeat = 0.80;
  advance(simKillChief, 0.2);
  assert.equal(simKillChief.trace.active, true);
  killNPC(simKillChief, chief3, 'garrote', true);
  advance(simKillChief, 0.2);
  assert.equal(simKillChief.trace.active, false, 'Neutralizing security chief must abort active trace');
  assert.equal(simKillChief.alarm, ALERT.CALM);
});

test('MaterialCraft ported operators (mcLevels, HBAO, Sobel, Edge-Wear) bake valid non-black periodic PBR maps', async () => {
  const { ARCHETYPES, mcLevels, createBakeScratch, bakeArchetypeBuffers } = await import('../src/render/mats_ops.js');

  // Exact numerical parity with MaterialCraft crates/nodes/src/atomic/levels.rs unit tests
  assert.ok(Math.abs(mcLevels(0.4, 0.2, 0.5, 0.6, 0.0, 1.0) - 0.5) < 1e-5);
  assert.ok(Math.abs(mcLevels(0.25, 0.0, 0.25, 1.0, 0.0, 1.0) - 0.7578583) < 1e-5);
  assert.equal(mcLevels(0.0, 0.0, 0.25, 1.0, 0.0, 1.0), 0.0);
  assert.equal(Number.isFinite(mcLevels(Number.NaN, 0.0, 0.5, 1.0, 0.0, 1.0)), true);

  const sz = 128;
  const sc = createBakeScratch(sz);
  for (const kind of ARCHETYPES) {
    const { albedoBuf, ormBuf, normalBuf } = bakeArchetypeBuffers(kind, sz, sc);
    assert.equal(albedoBuf.length, sz * sz * 4);
    let lumSum = 0, aoMin = 255, aoMax = 0, nzMin = 255;
    const n = sz * sz;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      lumSum += albedoBuf[o] + albedoBuf[o + 1] + albedoBuf[o + 2];
      if (ormBuf[o] < aoMin) aoMin = ormBuf[o];
      if (ormBuf[o] > aoMax) aoMax = ormBuf[o];
      if (normalBuf[o + 2] < nzMin) nzMin = normalBuf[o + 2];
      assert.equal(albedoBuf[o + 3], 255);
      assert.equal(ormBuf[o + 3], 255);
      assert.equal(normalBuf[o + 3], 255);
    }
    const meanChannel = lumSum / (n * 3);
    assert.ok(meanChannel > 35 && meanChannel < 225, `Archetype ${kind} albedo mean ${meanChannel} out of realistic PBR range`);
    assert.ok(aoMin < 195 && aoMax > 240, `Archetype ${kind} HBAO range [${aoMin}, ${aoMax}] lacks cavity contrast`);
    assert.ok(nzMin >= 140, `Archetype ${kind} normal Z ${nzMin} inverted or corrupted`);
  }
});

test('rigs.js enforces shadow-caster discipline, VIP/enforcer silhouettes, and contextual FK/IK poses', async () => {
  const THREE = await import('../vendor/three.module.js');
  const { createHumanoidRig, createBotRig, solveTwoBoneIK } = await import('../src/render/rigs.js');

  const mkMat = () => new THREE.MeshStandardMaterial();
  const mockMatLib = {
    darkMetal: mkMat(),
    brushedSteel: mkMat(),
    paintedMetal: mkMat(),
    gold: mkMat(),
    white: mkMat(),
    glowCyan: new THREE.MeshBasicMaterial(),
    glowGreen: new THREE.MeshBasicMaterial(),
    makeCharacterMaterials(isAndroid = false) {
      const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
      const skin = new THREE.MeshStandardMaterial({ color: isAndroid ? 0xcfd8e2 : 0xffffff, vertexColors: !isAndroid });
      const vestMat = mkMat();
      const visor = new THREE.MeshBasicMaterial();
      const owned = [cloth, skin, vestMat, visor];
      return {
        cloth,
        accent: cloth,
        skin,
        vestMat,
        hairMat: skin,
        visor,
        dispose() { for (const m of owned) m.dispose(); },
      };
    },
  };

  function countShadowCasters(root) {
    let n = 0;
    root.traverse((o) => { if (o.isMesh && o.castShadow) n++; });
    return n;
  }

  // 1. S-7 Android rig
  const s7 = createHumanoidRig('suit', true, mockMatLib);
  assert.equal(countShadowCasters(s7.group), 3, 'Humanoid rig must keep <= 3 shadow-casting meshes');
  assert.equal(s7.parts.visor.visible, true);
  assert.equal(s7.parts.hair.visible, false);

  // 2. Marcus Vandermeer VIP rig & speech vs patrol guard
  const vandermeer = createHumanoidRig('vip', false, mockMatLib, { id: 'vandermeer', role: 'vip', target: true });
  assert.equal(countShadowCasters(vandermeer.group), 1);
  assert.equal(vandermeer.profile.hairStyle, 'executive');
  assert.equal(vandermeer.accessories.vipTailcoat.visible, true);
  assert.equal(vandermeer.accessories.vipRegalia.visible, true);

  vandermeer.pose({ moving: 0, state: 'idle', act: 'speech', anim: 0 }, 1.2, { snap: true });
  assert.ok(vandermeer.parts.armR.rotation.x < -0.45, 'Speech pose must raise orator arm');
  // When patrolling with stale npc.act, locomotion must override idle speech gesture
  vandermeer.pose({ moving: 1.5, state: 'patrol', act: 'speech', anim: 0 }, 2.0, { snap: true });
  assert.ok(Math.abs(vandermeer.parts.legL.rotation.x) > 0.01 || Math.abs(vandermeer.parts.kneeL.rotation.x) > 0.08);

  // 3. Dra. Elena Kessler AR visor, lab coat, datapad in 'work', and strip/restore lifecycle
  const kessler = createHumanoidRig('scientist', false, mockMatLib, { id: 'kessler', role: 'scientist', target: true, female: true });
  assert.equal(countShadowCasters(kessler.group), 1);
  assert.equal(kessler.profile.hairStyle, 'bun');
  assert.equal(kessler.accessories.kesslerVisor.visible, true);
  assert.equal(kessler.accessories.kesslerCollar.visible, true);
  kessler.pose({ moving: 0, state: 'idle', act: 'work', anim: 0 }, 1.0, { snap: true });
  assert.ok(kessler.parts.head.rotation.x > 0.18, 'Work pose must tilt head toward datapad');

  const origTorsoR = kessler.parts.torso.geometry.attributes.color.getX(0);
  kessler.setStripped(true);
  assert.equal(kessler.accessories.kesslerVisor.visible, false);
  assert.equal(kessler.accessories.coat.visible, false);
  const strippedTorsoR = kessler.parts.torso.geometry.attributes.color.getX(0);
  assert.notEqual(strippedTorsoR, origTorsoR, 'setStripped(true) must re-tint vertex color slice');
  kessler.setStripped(false);
  assert.equal(kessler.parts.torso.geometry.attributes.color.getX(0), origTorsoR, 'setStripped(false) must restore vertex color slice');
  assert.equal(kessler.accessories.kesslerVisor.visible, true);
  assert.equal(kessler.accessories.coat.visible, true);

  // 4. Security Chief enforcer combat sidearm, prone cleanup & resetPose snap
  const chief = createHumanoidRig('guard', false, mockMatLib, { id: 'chief', role: 'guard', enforcerFor: 'guard' });
  assert.equal(chief.accessories.enforcerTorso.visible, true);
  chief.pose({ moving: 0, state: 'combat', anim: 0 }, 1.0, { snap: true });
  assert.ok(chief.parts.armR.rotation.x < -1.25, 'Combat pose must adopt two-handed pistol aim');
  chief.pose({ moving: 0, anim: 0 }, 1.5, { sleep: true });
  assert.equal(chief.parts.hips.position.y, 0.20);
  chief.resetPose();
  chief.pose({ moving: 0, state: 'idle', anim: 0 }, 1.5 + 1 / 60);
  assert.ok(chief.parts.hips.position.y > 0.90, 'resetPose must snap resurrected NPC upright on next frame');

  // 5. Waiter tray dynamic visibility & outfitId live getter
  s7.applyOutfit('waiter', true);
  assert.equal(s7.outfitId, 'waiter');
  s7.pose({ moving: 1.5, anim: 0 }, 2.0, { snap: true });
  assert.equal(s7.accessories.tray.visible, true);
  s7.pose({ moving: 0, anim: 0 }, 2.1, { aiming: true });
  assert.equal(s7.accessories.tray.visible, false, 'Serving tray must hide while aiming/jackedIn/dragging');
  s7.pose({ moving: 0, anim: 0 }, 2.2, {});
  assert.equal(s7.accessories.tray.visible, true);
  s7.setInstinctHighlight(0x6b5210, 0x7a5c14);
  s7.setVisorColor(0xd8b45c);
  assert.equal(mockMatLib.gold.color.getHex(), 0xffffff, 'Shared matLib materials must never be mutated');
  assert.equal(mockMatLib.white.emissive.getHex(), 0x000000, 'Shared matLib materials must never be mutated');

  // 6. Quadruped bot rigs & 2-bone IK solver bounds
  const botMaint = createBotRig('maint', mockMatLib);
  const botSec = createBotRig('sec', mockMatLib);
  assert.equal(countShadowCasters(botMaint.group), 1);
  assert.equal(countShadowCasters(botSec.group), 1);
  botSec.pose({ moving: 3.2, anim: 0.4 }, 1.5, { hijacked: true, disabled: false });
  const ikOut = solveTwoBoneIK(0.22, 0.24, 0.9, 0.9);
  assert.equal(Number.isFinite(ikOut.hipRotX) && Number.isFinite(ikOut.kneeRotX), true);

  s7.dispose();
  vandermeer.dispose();
  kessler.dispose();
  chief.dispose();
  botMaint.dispose();
  botSec.dispose();
});
