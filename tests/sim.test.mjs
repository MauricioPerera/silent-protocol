import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStaticHandler } from '../server.mjs';
import { ALERT, itemLegal } from '../src/config.js';
import { NPC_DEFS, zoneAt } from '../src/level.js';
import { losClear } from '../src/mathx.js';
import { raiseAlarm } from '../src/entities.js';
import {
  createSim,
  stepSim,
  getContext,
  doAction,
  selectItem,
  toggleHolster,
  reload,
  shoot,
  takedownTarget,
  missionRating,
} from '../src/sim.js';

const IDLE_INPUT = { mx: 0, mz: 0, camYaw: Math.PI, run: false, crouch: false, aim: false, instinct: false };

function advance(sim, seconds, input = IDLE_INPUT) {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) stepSim(sim, 1 / 60, input);
}

function rawHttpRequest(port, path, method = 'GET') {
  return new Promise((resolveReq, rejectReq) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolveReq({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', rejectReq);
    req.end();
  });
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

test('navgrid walkability covers all NPC waypoints, interactable useAt points, and snaps unwalkable goals', () => {
  const sim = createSim();
  assert.equal(sim.npcs.length, 19);

  for (const def of NPC_DEFS) {
    for (const wp of def.route) {
      assert.equal(
        sim.nav.walkablePoint(wp[0], wp[1]),
        true,
        `Expected waypoint ${JSON.stringify(wp)} of ${def.id} to be walkable`
      );
    }
  }

  for (const id in sim.interactables) {
    const it = sim.interactables[id];
    const [ux, uz] = it.useAt || [it.x, it.z];
    assert.equal(sim.nav.walkablePoint(ux, uz), true, `Expected interactable ${id} useAt [${ux}, ${uz}] to be walkable`);
  }

  const snapped = sim.nav.path(0, -15, 0, -18);
  assert.ok(snapped.length >= 1);
  const end = snapped[snapped.length - 1];
  assert.equal(sim.nav.walkablePoint(end.x, end.z), true);

  for (const c of sim.cams) {
    const tx = c.x + Math.sin(c.yaw) * 4.5;
    const tz = c.z + Math.cos(c.yaw) * 4.5;
    assert.equal(zoneAt(tx, tz), c.zone, `Expected camera ${c.id} sightline to look into zone ${c.zone}`);
    assert.equal(losClear(c.x, c.z, tx, tz, sim.boxes), true, `Expected camera ${c.id} central sightline to be unobstructed`);
  }
});

test('through-wall interactions, corpse hiding, and rear takedowns are blocked across walls', () => {
  const sim = createSim();
  isolateNPCs(sim, ['kessler']);

  // Backstage (20.1, -6.5) is 1.3m from lab coffee useAt [20.1, -5.2] across solid z=-6 wall
  sim.player.x = 20.1;
  sim.player.z = -6.5;
  assert.equal(getContext(sim).primary, null);

  // Inside lab at [20.1, -5.2], coffee is reachable
  sim.player.x = 20.1;
  sim.player.z = -5.2;
  assert.equal(getContext(sim).primary?.action, 'use:coffee');

  // Through-wall takedown blocked across z=-6 wall (distance 1.1m < 1.85m, behind Kessler)
  const kessler = sim.npcs.find((n) => n.id === 'kessler');
  kessler.x = 16;
  kessler.z = -5.4;
  kessler.yaw = 0; // facing +Z, back towards -Z (player at z=-6.5)
  sim.player.x = 16;
  sim.player.z = -6.5;
  assert.equal(takedownTarget(sim), null);

  // Inside lab behind Kessler (Kessler at z=-4.3 facing +Z, player behind at z=-5.4)
  kessler.z = -4.3;
  sim.player.x = 16;
  sim.player.z = -5.4;
  selectItem(sim, 'garrote');
  assert.equal(takedownTarget(sim)?.id, 'kessler');
  doAction(sim, 'takedown');
  advance(sim, 1.6);
  assert.equal(sim.bodies.length, 1);

  // Through-wall corpse hiding blocked across x=-14 kitchen wall to fridge (-15.2, -3.4)
  sim.player.dragging = sim.bodies[0].id;
  sim.player.x = -13.5; // hall side of x=-14 wall, 1.7m from fridge (-15.2, -3.4)
  sim.player.z = -3.4;
  assert.equal(getContext(sim).primary?.action, 'drop');

  sim.player.x = -16.8; // kitchen side of wall
  sim.player.z = -3.2;
  assert.equal(getContext(sim).primary?.action, 'hide');
});

test('monotonic event and noise sequence IDs preserve startup and same-tick events and noises', () => {
  const sim = createSim();
  assert.equal(sim.events.length, 1);
  assert.equal(sim.events[0].id, 1);

  isolateNPCs(sim, ['sci1']);
  const sci = sim.npcs.find((n) => n.id === 'sci1');
  sci.x = 19.4;
  sci.z = 5;
  sci.yaw = Math.PI;
  sim.player.x = 19.4;
  sim.player.z = 1;
  sim.player.outfit = 'cook';

  advance(sim, 5);
  const ids = sim.events.map((e) => e.id);
  for (let i = 1; i < ids.length; i++) {
    assert.ok(ids[i] > ids[i - 1], 'Expected strictly increasing event IDs across same-tick compromise events');
  }
  assert.ok(sim.events.some((e) => e.kind === 'alarm'), 'Expected alarm event to be recorded alongside outfit burn');
});

test('combat alarm does not cure poisoned targets and witnessed accidents preserve Silent Assassin rating', () => {
  const sim = createSim();
  isolateNPCs(sim, ['vandermeer', 'kessler', 'guest1']);
  sim.interactables.wine.poisoned = true;
  sim.interactables.coffee.poisoned = true;

  const vandermeer = sim.npcs.find((n) => n.id === 'vandermeer');
  const kessler = sim.npcs.find((n) => n.id === 'kessler');
  const guest = sim.npcs.find((n) => n.id === 'guest1');

  vandermeer.x = 13;
  vandermeer.z = -14.9;
  vandermeer.state = 'idle';
  vandermeer.dwell = 5;
  vandermeer.act = 'drink:wine';
  vandermeer.actDone = false;

  kessler.x = 20.1;
  kessler.z = -5.2;
  kessler.state = 'idle';
  kessler.dwell = 5;
  kessler.act = 'drink:coffee';
  kessler.actDone = false;

  advance(sim, 0.2);
  assert.equal(vandermeer.state, 'sick');
  assert.equal(kessler.state, 'sick');

  // Verify raising combat alarm does NOT overwrite 'sick'
  const simAlarm = createSim();
  const v2 = simAlarm.npcs.find((n) => n.id === 'vandermeer');
  v2.state = 'sick';
  v2.sick = 3.0;
  raiseAlarm(simAlarm, ALERT.COMBAT, 0, 0, 'Test alarm');
  assert.equal(v2.state, 'sick');
  advance(simAlarm, 3.5);
  assert.equal(v2.alive, false);

  // Let Vandermeer & Kessler die of poison, then place guest1 facing Vandermeer's body to discover it
  advance(sim, 5.0);
  assert.equal(vandermeer.alive, false);
  assert.equal(kessler.alive, false);

  guest.x = 13;
  guest.z = -13;
  guest.yaw = Math.PI;
  guest.state = 'idle';
  guest.dwell = 10;
  guest.bodyScan = -10;
  advance(sim, 1.0);

  const vBody = sim.bodies.find((b) => b.npcId === 'vandermeer');
  assert.equal(vBody.reported, true);
  assert.equal(sim.stats.bodiesFound, 0, 'Accident bodies must not increment bodiesFound');
  assert.equal(sim.alarm, ALERT.CALM);

  sim.objectives.core = true;
  const rating = missionRating(sim);
  assert.equal(rating.silent, true);
  assert.equal(rating.title, 'ASESINO SILENCIOSO');
});

test('wakeBody revives dragged NPC at current body coordinates and only burns seen disguise', () => {
  const sim = createSim();
  isolateNPCs(sim, ['cook1']);
  const cook = sim.npcs.find((n) => n.id === 'cook1');
  cook.x = -18;
  cook.z = 2.6;
  cook.yaw = 0;

  sim.player.x = -18;
  sim.player.z = 1.4;
  selectItem(sim, 'hands');
  doAction(sim, 'takedown');
  advance(sim, 1.3);
  assert.equal(cook.conscious, false);
  assert.equal(sim.bodies.length, 1);

  const body = sim.bodies[0];
  body.x = -16;
  body.z = -15;
  sim.player.outfit = 'cook';

  let guard = 0;
  while (!cook.conscious && guard++ < 90 * 60) {
    stepSim(sim, 1 / 60, IDLE_INPUT);
  }
  assert.equal(cook.conscious, true);
  assert.ok(Math.hypot(cook.x - (-16), cook.z - (-15)) < 0.5, 'Woken NPC must wake at dragged body position, not teleport back');
  assert.equal(!!sim.player.burned.suit, false);
  assert.equal(!!sim.player.burned.cook, false);
});

test('chandelier lethal damage kills player and clamps integrity to zero', () => {
  const sim = createSim();
  isolateNPCs(sim, []);
  sim.player.x = 0;
  sim.player.z = 3;
  sim.player.integrity = 60;
  sim.chandelier.released = true;

  advance(sim, 1.0);
  assert.equal(sim.chandelier.landed, true);
  assert.equal(sim.player.integrity, 0);
  assert.equal(sim.status, 'dead');
});

test('finite pistol reserve reload, unarmed legality, holster rules, and muzzle ray occlusion', () => {
  const sim = createSim();
  isolateNPCs(sim, ['guard_hall']);

  assert.equal(itemLegal('suit', 'hands'), true);

  selectItem(sim, 'garrote');
  toggleHolster(sim);
  assert.equal(sim.player.holster, false);
  selectItem(sim, 'pistol');
  assert.equal(sim.player.holster, true);

  for (let i = 0; i < 4; i++) shoot(sim);
  assert.equal(sim.player.ammo.pistol, 8);
  assert.equal(sim.player.ammo.pistolReserve, 6);
  assert.ok(sim.noises.some((n) => n.kind === 'gunshot'));

  reload(sim);
  advance(sim, 1.5);
  assert.equal(sim.player.ammo.pistol, 12);
  assert.equal(sim.player.ammo.pistolReserve, 2);

  for (let i = 0; i < 5; i++) shoot(sim);
  reload(sim);
  advance(sim, 1.5);
  assert.equal(sim.player.ammo.pistol, 9);
  assert.equal(sim.player.ammo.pistolReserve, 0);
  reload(sim);
  assert.equal(sim.player.reloadT, 0);

  const guard = sim.npcs.find((n) => n.id === 'guard_hall');
  sim.player.x = 0;
  sim.player.z = 0;
  guard.x = 0;
  guard.z = 2.0;
  shoot(sim, { ox: 0, oy: 1.5, oz: 4.0, dx: 0, dy: 0, dz: -1 });
  assert.equal(guard.alive, true, 'Camera-origin ray must not hit NPC behind player');

  guard.x = 0;
  guard.z = -4.0;
  shoot(sim, { ox: 0, oy: 1.5, oz: 4.0, dx: 0, dy: 0, dz: -1 });
  assert.equal(guard.alive, false);
});

test('role-authorized sabotage and core extraction do not trigger camera combat alarms while unauthorized outfits do', () => {
  const simTech = createSim();
  isolateNPCs(simTech, []);
  simTech.player.outfit = 'tech';
  simTech.player.x = -1;
  simTech.player.z = -10.6;
  doAction(simTech, 'use:winch');
  advance(simTech, 2.2);
  assert.equal(simTech.interactables.winch.used, true);
  assert.equal(simTech.alarm, ALERT.CALM);

  const simSuit = createSim();
  isolateNPCs(simSuit, []);
  simSuit.player.outfit = 'suit';
  simSuit.player.x = -1;
  simSuit.player.z = -10.6;
  doAction(simSuit, 'use:winch');
  advance(simSuit, 2.2);
  assert.equal(simSuit.alarm, ALERT.COMBAT);

  // Unobstructed lab camera at (15.2, 8.0) facing +Z (yaw = 0) watching core useAt (15.2, 9.2)
  const simSci = createSim();
  isolateNPCs(simSci, []);
  simSci.cams.push({ id: 'cam_core_test', x: 15.2, z: 8.0, yaw: 0, currentYaw: 0, range: 10, fov: 1.2, active: true, suspicion: 0 });
  simSci.player.outfit = 'scientist';
  simSci.player.x = 15.2;
  simSci.player.z = 9.2;
  doAction(simSci, 'use:core');
  advance(simSci, 2.8);
  assert.equal(simSci.objectives.core, true);
  assert.equal(simSci.alarm, ALERT.CALM);

  const simSuitCore = createSim();
  isolateNPCs(simSuitCore, []);
  simSuitCore.cams.push({ id: 'cam_core_test', x: 15.2, z: 8.0, yaw: 0, currentYaw: 0, range: 10, fov: 1.2, active: true, suspicion: 0 });
  simSuitCore.player.outfit = 'suit';
  simSuitCore.player.x = 15.2;
  simSuitCore.player.z = 9.2;
  doAction(simSuitCore, 'use:core');
  advance(simSuitCore, 2.8);
  assert.equal(simSuitCore.alarm, ALERT.COMBAT);
});

test('server.mjs blocks sibling-prefix traversal, dotfiles, bad URIs, disallowed methods, and serves static assets', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'egm-srv-'));
  const rootDir = join(parent, 'silence');
  const siblingDir = join(parent, 'silence-secrets');
  await mkdir(join(rootDir, '.git'), { recursive: true });
  await mkdir(join(rootDir, 'emptyDir'), { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  await writeFile(join(rootDir, 'index.html'), '<!doctype html><title>ok</title>');
  await writeFile(join(rootDir, '.git', 'config'), 'secret-git-config');
  await writeFile(join(siblingDir, 'leak.txt'), 'top-secret');

  const server = createServer(createStaticHandler(rootDir));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();

  try {
    const okRes = await rawHttpRequest(port, '/');
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers['x-content-type-options'], 'nosniff');
    assert.equal(okRes.headers['access-control-allow-origin'], undefined);
    assert.match(okRes.body, /<title>ok<\/title>/);

    const headRes = await rawHttpRequest(port, '/index.html', 'HEAD');
    assert.equal(headRes.status, 200);
    assert.equal(headRes.body, '');

    const postRes = await rawHttpRequest(port, '/index.html', 'POST');
    assert.equal(postRes.status, 405);
    assert.equal(postRes.headers.allow, 'GET, HEAD');

    const badUri = await rawHttpRequest(port, '/%E0%A4%A');
    assert.equal(badUri.status, 400);

    const siblingTraversal = await rawHttpRequest(port, '/%2e%2e/silence-secrets/leak.txt');
    assert.equal(siblingTraversal.status, 403);

    const rawDotDotTraversal = await rawHttpRequest(port, '/../silence-secrets/leak.txt');
    assert.equal(rawDotDotTraversal.status, 403);

    const dotfile = await rawHttpRequest(port, '/.git/config');
    assert.equal(dotfile.status, 403);

    const winDotfile = await rawHttpRequest(port, '/%5c.git%5cconfig');
    assert.equal(winDotfile.status, 403);

    const dirNoIndex = await rawHttpRequest(port, '/emptyDir/');
    assert.equal(dirNoIndex.status, 404);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(parent, { recursive: true, force: true });
  }
});
