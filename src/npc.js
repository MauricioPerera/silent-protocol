// IA de los NPC: patrullas, visión, sospecha, investigación, combate y pánico
import { VISION, SUSPECT, CYBER, ALERT, OUTFITS, outfitAllowed, itemLegal } from './config.js';
import { dist, clamp, angleTowards, angleDiff, resolveCircle, losClear } from './mathx.js';
import { zoneAt } from './level.js';
import { pushEvent, addNoise, addFx, damagePlayer, raiseAlarm, compromise, killNPC, resetLink } from './entities.js';

const OUTFIT_ROLE = { cook: 'cook', waiter: 'waiter', guard: 'guard', scientist: 'scientist', tech: 'tech', suit: 'civilian', vip: 'vip' };
const SAFE_SPOT = { vandermeer: [17.5, -14.6], kessler: [-6.5, -14.5] };

export function createNPC(def, rng = Math.random) {
  const start = def.route[0];
  return {
    id: def.id, name: def.name, role: def.role, outfit: def.outfit, target: !!def.target,
    desc: def.desc || '', enforcerFor: def.enforcerFor || null,
    x: start[0], z: start[1], yaw: rng() * Math.PI * 2, speed: def.speed || 1.6,
    route: def.route, routeIdx: 0, dwell: start[2] || 2, act: start[3] || null, actDone: false,
    state: 'patrol', alive: true, conscious: true, awareness: 0, compromised: false,
    path: null, pathIdx: 0, goal: null, repath: 0, bodyScan: rng(), lastNoiseId: 0,
    sick: 0, panicTimer: 0, shockTimer: 0, searchTimer: 0, shootCd: 1 + rng(),
    lookTimer: 0, saidSuspicious: false, bodyId: null, crimeSeen: null, lastKnown: null,
    moving: 0, anim: rng() * 10, reportedPanic: false,
  };
}

export function setGoal(sim, npc, x, z) {
  npc.goal = { x, z };
  npc.path = sim.nav.path(npc.x, npc.z, x, z);
  npc.pathIdx = 0;
  if (!npc.path.length) {
    const free = sim.nav.nearestFree(x, z);
    npc.path = free >= 0 ? [sim.nav.center(free)] : [];
  }
}

function followPath(sim, npc, dt, speed) {
  if (!npc.path || npc.pathIdx >= npc.path.length) { npc.moving = 0; return true; }
  const t = npc.path[npc.pathIdx];
  const dx = t.x - npc.x, dz = t.z - npc.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.38) {
    npc.pathIdx++;
    if (npc.pathIdx >= npc.path.length) { npc.moving = 0; return true; }
    return false;
  }
  const step = Math.min(d, speed * dt);
  npc.x += (dx / d) * step;
  npc.z += (dz / d) * step;
  npc.yaw = angleTowards(npc.yaw, Math.atan2(dx, dz), dt * 7);
  npc.moving = speed;
  const r = resolveCircle(npc.x, npc.z, 0.34, sim.boxes);
  npc.x = r.x; npc.z = r.z;
  // anti-atasco: si no progresa (otro NPC bloquea el punto), salta el waypoint
  npc.stuckCheck = (npc.stuckCheck || 0) + dt;
  if (npc.stuckCheck > 0.5) {
    const moved = Math.hypot(npc.x - (npc.lastX ?? npc.x), npc.z - (npc.lastZ ?? npc.z));
    npc.stuckAccum = moved < 0.06 ? (npc.stuckAccum || 0) + npc.stuckCheck : 0;
    npc.lastX = npc.x; npc.lastZ = npc.z; npc.stuckCheck = 0;
    if (npc.stuckAccum > 2.2) {
      npc.stuckAccum = 0;
      npc.pathIdx++;
      if (npc.pathIdx >= npc.path.length) { npc.moving = 0; return true; }
    }
  }
  return false;
}

function separate(sim, npc) {
  for (const o of sim.npcs) {
    if (o === npc || !o.alive || !o.conscious) continue;
    const dx = npc.x - o.x, dz = npc.z - o.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.64 && d2 > 1e-6) {
      const d = Math.sqrt(d2), push = (0.8 - d) * 0.5;
      npc.x += (dx / d) * push; npc.z += (dz / d) * push;
    }
  }
}

function canSee(sim, npc, x, z, range, fov) {
  const d = dist(npc.x, npc.z, x, z);
  if (d > range) return false;
  const ang = Math.atan2(x - npc.x, z - npc.z);
  if (angleDiff(ang, npc.yaw) > fov / 2 && d > 1.7) return false;
  return losClear(npc.x, npc.z, x, z, sim.boxes);
}

function visionRange(sim, npc) {
  let r = VISION.range;
  if (sim.blackout > 0 && zoneAt(npc.x, npc.z) === 'hall') r *= 0.5;
  if (npc.state === 'combat' || npc.state === 'investigate') r *= 1.1;
  return r;
}

function perceive(sim, npc, dt) {
  const p = sim.player;
  if (sim.status !== 'playing') return;
  const d = dist(npc.x, npc.z, p.x, p.z);
  const range = visionRange(sim, npc) * (p.crouch ? VISION.rangeCrouch : 1);
  const combatAware = npc.state === 'combat';
  const sees = d < range && (combatAware || angleDiff(Math.atan2(p.x - npc.x, p.z - npc.z), npc.yaw) < VISION.fov / 2 || d < 1.7)
    && losClear(npc.x, npc.z, p.x, p.z, sim.boxes);
  npc.seesPlayer = sees;
  npc.distToPlayer = d;

  if (sees) {
    let rate = 0, reason = null;
    const zone = zoneAt(p.x, p.z);
    if (zone && !outfitAllowed(p.outfit, zone)) { rate = SUSPECT.trespass; reason = 'trespass'; }
    if (!p.holster && !itemLegal(p.outfit, p.item)) { rate = Math.max(rate, SUSPECT.illegalItem); reason = 'weapon'; }
    if (p.jackedIn) { rate = Math.max(rate, SUSPECT.jackedIn); reason = 'jacked'; }
    if (p.dragging) { rate = Math.max(rate, SUSPECT.crime); reason = 'body'; }
    if (p.channel && p.channel.crime) { rate = Math.max(rate, SUSPECT.crime); reason = p.channel.label; }
    if (npc.enforcerFor && npc.enforcerFor === p.outfit && d < 9) { rate = Math.max(rate, SUSPECT.enforcer); reason = 'enforcer'; }
    if (p.burned[p.outfit] && (npc.role === OUTFIT_ROLE[p.outfit] || npc.role === 'guard')) {
      rate = Math.max(rate, SUSPECT.burned); reason = 'burned';
    }
    if (combatAware) rate = Math.max(rate, 3);
    if (rate > 0) {
      const prox = clamp(1.7 - d / range, 0.4, 1.7);
      npc.awareness = Math.min(1.6, npc.awareness + rate * prox * dt);
      npc.suspicionReason = reason;
      npc.lastKnown = { x: p.x, z: p.z };
    } else {
      npc.awareness = Math.max(0, npc.awareness - SUSPECT.decay * dt);
    }
  } else {
    npc.awareness = Math.max(0, npc.awareness - SUSPECT.decay * dt * (combatAware ? 0.25 : 1));
  }

  if (npc.awareness >= SUSPECT.compromisedAt && !npc.compromised) compromise(sim, npc);
  else if (npc.awareness >= SUSPECT.suspiciousAt && ['patrol', 'idle', 'work'].includes(npc.state)) {
    npc.state = 'suspicious';
    npc.path = null;
    if (!npc.saidSuspicious) {
      npc.saidSuspicious = true;
      const lines = {
        trespass: '¡Eh! Esa zona está restringida.',
        weapon: '¿Por qué llevas un arma a la vista?',
        jacked: '¡Quieto! Ese sujeto está conectado a la red.',
        body: '¡Está arrastrando un cuerpo!',
        enforcer: 'Un momento... yo te conozco. Tú no trabajas aquí.',
        burned: '¡Es el impostor! ¡Seguridad!',
      };
      pushEvent(sim, 'warn', `${npc.name}: "${lines[npc.suspicionReason] || '¿Quién eres tú?'}"`);
    }
  }

  // unidad robótica controlada fuera de zona permitida o saboteando
  if (npc.role === 'guard' && sim.link && sim.link.mode === 'unit' && sim.units) {
    const u = sim.units.find((x) => x.id === sim.link.targetId);
    if (u && sim.time >= u.disabledUntil) {
      const uZone = zoneAt(u.x, u.z);
      const unauthorized = (uZone && !u.allowedZones.includes(uZone)) || (sim.time - u.lastSabotageAt < 1.5);
      if (unauthorized && canSee(sim, npc, u.x, u.z, visionRange(sim, npc), VISION.fov)) {
        u.disabledUntil = sim.time + CYBER.unitDisableDuration;
        u.moving = 0;
        resetLink(sim, 'unit_lost');
        if (sim.trace) {
          sim.trace.netHeat = Math.min(1, sim.trace.netHeat + CYBER.heat.botCompromised);
        }
        addFx(sim, 'spark', u.x, u.z, 0.5, { life: 0.8 });
        addNoise(sim, u.x, u.z, 6, 'spark');
        pushEvent(sim, 'bad', `${npc.name} ha inutilizado ${u.name}. Enlace cortado.`, 'link_lost');
        if (npc.state !== 'combat') {
          npc.state = 'investigate';
          setGoal(sim, npc, u.x, u.z);
          npc.searchTimer = 7;
        }
      }
    }
  }

  // cuerpos a la vista
  if (sim.time - npc.bodyScan > 0.5 && ['patrol', 'idle', 'work', 'investigate', 'suspicious'].includes(npc.state)) {
    npc.bodyScan = sim.time;
    for (const b of sim.bodies) {
      if (b.hidden || b.reported) continue;
      if (!canSee(sim, npc, b.x, b.z, VISION.bodyRange, VISION.fov * 1.1)) continue;
      b.reported = true;
      if (b.cause === 'accident') {
        npc.state = 'shock'; npc.shockTimer = 6; npc.path = null;
        pushEvent(sim, 'warn', `${npc.name} ha encontrado a ${b.name}. Parece un accidente.`);
      } else {
        sim.stats.bodiesFound++;
        npc.state = 'investigate';
        setGoal(sim, npc, b.x, b.z);
        npc.searchTimer = 8;
        pushEvent(sim, 'bad', `¡${npc.name} ha encontrado el cuerpo de ${b.name}!`);
        raiseAlarm(sim, sim.stats.bodiesFound >= 2 ? ALERT.COMBAT : ALERT.SEARCH, b.x, b.z,
          'Cuerpo descubierto: seguridad en estado de búsqueda.');
      }
      break;
    }
  }

  // ruidos
  for (const nz of sim.noises) {
    if (nz.id <= npc.lastNoiseId) continue;
    if (nz.targetNpcId && nz.targetNpcId !== npc.id) continue;
    const dn = dist(npc.x, npc.z, nz.x, nz.z);
    if (dn > nz.radius) continue;
    npc.lastNoiseId = nz.id;
    if (nz.kind === 'steps') {
      if (npc.awareness < 0.95) npc.awareness = Math.min(0.95, npc.awareness + 0.14);
      npc.lookAt = { x: nz.x, z: nz.z };
      npc.lookTimer = 1.6;
    } else if (
      ['patrol', 'idle', 'work', 'suspicious', 'shock'].includes(npc.state) ||
      (nz.kind === 'trace' && npc.state === 'investigate')
    ) {
      npc.state = 'investigate';
      setGoal(sim, npc, nz.x, nz.z);
      npc.searchTimer = 6;
      npc.lookAt = { x: nz.x, z: nz.z };
    }
  }
}

function doRoute(sim, npc, dt) {
  const wp = npc.route[npc.routeIdx];
  if (!npc.goal || Math.abs(npc.goal.x - wp[0]) > 0.01 || Math.abs(npc.goal.z - wp[1]) > 0.01) {
    setGoal(sim, npc, wp[0], wp[1]);
  }
  const arrived = followPath(sim, npc, dt, npc.speed);
  if (arrived) {
    npc.state = 'idle';
    npc.dwell = wp[2] || 2;
    npc.act = wp[3] || null;
    npc.actDone = false;
    if (npc.act === 'speech') npc.yaw = 0;
  }
}

function doIdle(sim, npc, dt) {
  npc.moving = 0;
  npc.dwell -= dt;
  if (npc.act && !npc.actDone) {
    npc.actDone = true;
    if (npc.act.startsWith('drink:')) {
      const id = npc.act.split(':')[1];
      const it = sim.interactables[id];
      if (it && it.poisoned) {
        it.poisoned = false;
        it.used = true;
        npc.sick = 4.5;
        npc.state = 'sick';
        pushEvent(sim, 'good', `${npc.name} ha ingerido el veneno...`, 'poison');
        addFx(sim, 'poison', npc.x, npc.z, 1.4);
        return;
      }
    }
  }
  if (npc.act === 'work' || npc.act === 'look' || npc.act === 'speech') {
    npc.yaw += Math.sin(sim.time * 0.7 + npc.anim) * dt * 0.5;
  } else {
    npc.yaw += Math.sin(sim.time * 0.35 + npc.anim) * dt * 0.9;
  }
  if (npc.dwell <= 0) {
    npc.routeIdx = (npc.routeIdx + 1) % npc.route.length;
    npc.state = 'patrol';
    npc.goal = null;
    npc.path = null;
    npc.saidSuspicious = false;
  }
}

function combat(sim, npc, dt) {
  if (sim.status !== 'playing') return;
  const p = sim.player;
  const d = dist(npc.x, npc.z, p.x, p.z);
  const los = losClear(npc.x, npc.z, p.x, p.z, sim.boxes);
  if (npc.seesPlayer && los) {
    npc.searchTimer = 10;
    npc.lastKnown = { x: p.x, z: p.z };
    npc.yaw = angleTowards(npc.yaw, Math.atan2(p.x - npc.x, p.z - npc.z), dt * 8);
    if (d > 7.5) {
      npc.repath -= dt;
      if (npc.repath <= 0) { setGoal(sim, npc, p.x, p.z); npc.repath = 0.7; }
      followPath(sim, npc, dt, npc.speed * 1.9);
    } else {
      npc.moving = 0;
      npc.path = null;
    }
    npc.shootCd -= dt;
    if (npc.shootCd <= 0 && d < 18) {
      const rand = sim.rng || Math.random;
      npc.shootCd = 1.05 + rand() * 0.6;
      const acc = clamp(0.85 - d / 30 - (p.crouch ? 0.12 : 0) - (p.moving > 4 ? 0.15 : 0), 0.2, 0.85);
      addFx(sim, 'tracer', npc.x, npc.z, 1.35, { tx: p.x, tz: p.z, life: 0.12 });
      addNoise(sim, npc.x, npc.z, 16, 'gunshot');
      if (rand() < acc) {
        const dmg = 9 + rand() * 7;
        addFx(sim, 'hit', p.x, p.z, 1.2);
        damagePlayer(sim, dmg, 'UNIDAD S-7 DESTRUIDA. Misión fallida.');
      }
    }
  } else {
    npc.searchTimer -= dt;
    const lk = npc.lastKnown || { x: npc.x, z: npc.z };
    if (!npc.goal || dist(npc.goal.x, npc.goal.z, lk.x, lk.z) > 1.5) setGoal(sim, npc, lk.x, lk.z);
    const arrived = followPath(sim, npc, dt, npc.speed * 1.6);
    if (arrived) npc.yaw += dt * 1.6;
    if (npc.searchTimer <= 0) {
      npc.state = 'patrol'; npc.goal = null; npc.path = null; npc.compromised = false; npc.awareness = 0.3;
    }
  }
}

export function updateNPC(sim, npc, dt) {
  if (!npc.alive) return;
  if (!npc.conscious) return;
  if (npc.state === 'grabbed') { npc.moving = 0; return; }
  npc.anim += dt;

  if (npc.state === 'sick') {
    npc.sick -= dt;
    npc.moving = 0.4;
    npc.yaw += dt * 1.2;
    npc.x += Math.sin(sim.time * 3) * dt * 0.35;
    npc.z += Math.cos(sim.time * 2.4) * dt * 0.35;
    const r = resolveCircle(npc.x, npc.z, 0.34, sim.boxes);
    npc.x = r.x; npc.z = r.z;
    if (npc.sick <= 0) {
      killNPC(sim, npc, 'accident', true);
      pushEvent(sim, 'info', `${npc.name} se ha desplomado. Muerte registrada como accidente.`);
      for (const o of sim.npcs) {
        if (o.alive && o.conscious && o !== npc && dist(o.x, o.z, npc.x, npc.z) < 9 &&
            losClear(o.x, o.z, npc.x, npc.z, sim.boxes)) {
          o.state = 'shock'; o.shockTimer = 5; o.path = null;
        }
      }
    }
    return;
  }

  perceive(sim, npc, dt);

  switch (npc.state) {
    case 'patrol': doRoute(sim, npc, dt); break;
    case 'idle': case 'work': doIdle(sim, npc, dt); break;
    case 'suspicious': {
      npc.moving = 0;
      const p = sim.player;
      npc.yaw = angleTowards(npc.yaw, Math.atan2(p.x - npc.x, p.z - npc.z), dt * 3.4);
      if (npc.awareness > 0.7 && npc.distToPlayer > 3) {
        npc.repath -= dt;
        if (npc.repath <= 0) { setGoal(sim, npc, p.x, p.z); npc.repath = 1.1; }
        followPath(sim, npc, dt, npc.speed * 0.75);
      }
      if (npc.awareness < 0.12) {
        npc.state = 'patrol'; npc.goal = null; npc.path = null; npc.saidSuspicious = false;
      }
      break;
    }
    case 'investigate': {
      const arrived = followPath(sim, npc, dt, npc.speed * 1.5);
      if (arrived) {
        npc.searchTimer -= dt;
        npc.yaw += dt * 1.5;
        if (npc.searchTimer <= 0) { npc.state = 'patrol'; npc.goal = null; npc.path = null; }
      }
      break;
    }
    case 'shock': {
      npc.moving = 0;
      npc.shockTimer -= dt;
      npc.yaw += Math.sin(sim.time * 2) * dt;
      if (npc.shockTimer <= 0) { npc.state = 'patrol'; npc.goal = null; npc.path = null; }
      break;
    }
    case 'combat': combat(sim, npc, dt); break;
    case 'panic': {
      npc.panicTimer -= dt;
      if (!npc.path) {
        const guards = sim.npcs.filter((g) => g.alive && g.conscious && g.role === 'guard');
        let best = null, bd = 1e9;
        for (const g of guards) { const d = dist(g.x, g.z, npc.x, npc.z); if (d < bd) { bd = d; best = g; } }
        const rand = sim.rng || Math.random;
        if (best) { setGoal(sim, npc, best.x, best.z); npc.reportTo = best.id; }
        else { setGoal(sim, npc, npc.x + (rand() - 0.5) * 6, npc.z + (rand() - 0.5) * 6); }
      }
      followPath(sim, npc, dt, npc.speed * 2.1);
      const rep = sim.npcs.find((g) => g.id === npc.reportTo);
      if (rep && !npc.reportedPanic && dist(rep.x, rep.z, npc.x, npc.z) < 3.2) {
        npc.reportedPanic = true;
        raiseAlarm(sim, ALERT.COMBAT, npc.lastKnown ? npc.lastKnown.x : sim.player.x,
          npc.lastKnown ? npc.lastKnown.z : sim.player.z, `${npc.name} ha informado a seguridad: intruso armado.`);
      }
      if (npc.panicTimer <= 0) { npc.state = 'patrol'; npc.goal = null; npc.path = null; npc.reportedPanic = false; }
      break;
    }
    case 'flee': {
      const spot = SAFE_SPOT[npc.id] || [0, -15];
      if (!npc.goal || dist(npc.goal.x, npc.goal.z, spot[0], spot[1]) > 0.5) setGoal(sim, npc, spot[0], spot[1]);
      const arrived = followPath(sim, npc, dt, npc.speed * 2);
      if (arrived) {
        npc.moving = 0;
        if (sim.alarm < ALERT.COMBAT) { npc.state = 'patrol'; npc.goal = null; npc.path = null; }
      }
      break;
    }
    default: npc.state = 'patrol';
  }

  if (npc.lookTimer > 0 && npc.lookAt && ['patrol', 'idle'].includes(npc.state)) {
    npc.lookTimer -= dt;
    npc.yaw = angleTowards(npc.yaw, Math.atan2(npc.lookAt.x - npc.x, npc.lookAt.z - npc.z), dt * 3);
  }
  separate(sim, npc);
  const resolved = resolveCircle(npc.x, npc.z, 0.34, sim.boxes);
  npc.x = resolved.x;
  npc.z = resolved.z;
}
