// ---------------------------------------------------------------------------
// Subsistema cibernético Headless: atenuación RF, bus CCTV, bots y rastreo
// ---------------------------------------------------------------------------
import { CYBER, ALERT } from './config.js';
import { dist, clamp, angleTowards, resolveCircle } from './mathx.js';
import { countWallCrossings } from './level.js';
import { pushEvent, addNoise, addFx, raiseAlarm, resetLink } from './entities.js';

export function createUnit(def, rng = Math.random) {
  const start = def.route[0];
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    x: def.x,
    z: def.z,
    yaw: rng() * Math.PI * 2,
    route: def.route,
    routeIdx: 0,
    dwell: start ? (start[2] || 3) : 3,
    path: null,
    pathIdx: 0,
    goal: null,
    moving: 0,
    allowedZones: def.allowedZones.slice(),
    disabledUntil: 0,
    lastSabotageAt: -99,
    anim: rng() * 10,
  };
}

export function createLinkState() {
  return {
    mode: 's7',
    targetId: null,
    signalStrength: 1,
    savedYaw: Math.PI,
    savedPitch: 0.40,
    camYawOffset: 0,
    camPitch: 0.22,
    restoreView: false,
    lastDisconnectReason: null,
  };
}

export function createTraceState() {
  return {
    netHeat: 0,
    active: false,
    progress: 0,
    originX: 0,
    originZ: 0,
  };
}

export function signalOrigin(sim) {
  if (sim.link && sim.link.mode === 'camera') {
    const c = sim.cams.find((x) => x.id === sim.link.targetId);
    if (c) return { x: c.x, y: 2.7, z: c.z };
  }
  if (sim.link && sim.link.mode === 'unit' && sim.units) {
    const u = sim.units.find((x) => x.id === sim.link.targetId);
    if (u) return { x: u.x, y: 0.45, z: u.z };
  }
  const p = sim.player;
  return { x: p.x, y: p.crouch ? 1.15 : 1.55, z: p.z };
}

export function effectiveHackRange(sim, tx, tz, baseRange = CYBER.hackBaseRange) {
  const o = signalOrigin(sim);
  const crossings = countWallCrossings(o.x, o.z, tx, tz);
  const eff = Math.max(0, baseRange - crossings * CYBER.wallPenalty);
  const d = dist(o.x, o.z, tx, tz);
  return {
    distance: d,
    wallCrossings: crossings,
    effectiveRange: eff,
    inRange: eff > 0 && d <= eff,
  };
}

export function applySabotageEffect(sim, it, isRemote = false) {
  it.used = true;
  if (it.sub === 'chandelier') {
    sim.chandelier.released = true;
    pushEvent(
      sim,
      'good',
      isRemote ? 'Torno sobrecalentado en remoto: lámpara cayendo.' : 'Lámpara liberada. Cayendo sobre la pista del salón.',
      isRemote ? 'overheat' : null
    );
  } else if (it.sub === 'blackout') {
    sim.blackout = 26;
    pushEvent(
      sim,
      'good',
      isRemote ? 'Cuadro sobrecalentado en remoto: apagón en el salón (26 s).' : 'Apagón en el salón: la visión de los guardias se reduce 26 s.',
      isRemote ? 'overheat' : 'spark'
    );
  } else if (it.sub === 'electro') {
    sim.electro = 32;
    pushEvent(
      sim,
      'good',
      isRemote ? 'Cuadro sobrecalentado en remoto: charco del laboratorio electrificado (32 s).' : 'Charco del laboratorio electrificado (32 s). Nadie debe pisarlo.',
      isRemote ? 'overheat' : 'spark'
    );
  }
  addFx(sim, 'spark', it.x, it.z, 1.2, { life: 0.65 });
}

function defaultAimRay(sim) {
  const o = signalOrigin(sim);
  let yaw = sim.player.yaw;
  let pitch = 0;
  if (sim.link && sim.link.mode === 'camera') {
    const c = sim.cams.find((x) => x.id === sim.link.targetId);
    if (c) {
      yaw = (c.currentYaw ?? c.yaw) + (sim.link.camYawOffset || 0);
      pitch = sim.link.camPitch ?? 0.22;
    }
  } else if (sim.link && sim.link.mode === 'unit') {
    const u = sim.units.find((x) => x.id === sim.link.targetId);
    if (u) yaw = u.yaw;
  }
  const cp = Math.cos(pitch);
  return {
    ox: o.x,
    oy: o.y,
    oz: o.z,
    dx: Math.sin(yaw) * cp,
    dy: -Math.sin(pitch),
    dz: Math.cos(yaw) * cp,
  };
}

export function getCyberPrompt(sim, aimRay = null) {
  if (!sim || sim.status !== 'playing') return null;
  const activeScan = sim.player.instinctOn || (sim.link && sim.link.mode !== 's7');
  if (!activeScan) return null;

  const ray = aimRay || defaultAimRay(sim);
  const rlen = Math.hypot(ray.dx, ray.dy, ray.dz) || 1;
  const rx = ray.dx / rlen, ry = ray.dy / rlen, rz = ray.dz / rlen;

  const candidates = [];

  if (!sim.camsDisabled) {
    for (const c of sim.cams) {
      if (!c.active) continue;
      if (sim.link.mode === 'camera' && sim.link.targetId === c.id) continue;
      const looped = sim.time < (c.loopedUntil || 0);
      candidates.push({
        nodeId: c.id,
        kind: 'camera',
        name: `Cámara ${c.id}`,
        x: c.x,
        y: 2.7,
        z: c.z,
        wiredHop: sim.link.mode === 'camera',
        eAction: looped ? null : {
          verb: 'cam_loop',
          targetId: c.id,
          label: `Bucle ciego (${CYBER.camLoopDuration}s): ${c.id}`,
          cost: CYBER.costs.cam_loop,
          heat: CYBER.heat.cam_loop,
        },
        fAction: {
          verb: 'cam_hop',
          targetId: c.id,
          label: `Puente CCTV: ${c.id}`,
          cost: CYBER.costs.cam_hop,
          heat: CYBER.heat.cam_hop,
        },
      });
    }
  }

  if (sim.units) {
    for (const u of sim.units) {
      if (sim.time < u.disabledUntil) continue;
      if (sim.link.mode === 'unit' && sim.link.targetId === u.id) continue;
      candidates.push({
        nodeId: u.id,
        kind: 'unit',
        name: u.name,
        x: u.x,
        y: 0.45,
        z: u.z,
        wiredHop: false,
        eAction: null,
        fAction: {
          verb: 'unit_hijack',
          targetId: u.id,
          label: `Control remoto: ${u.name}`,
          cost: CYBER.costs.unit_hijack,
          heat: CYBER.heat.unit_hijack,
        },
      });
    }
  }

  for (const id in sim.interactables) {
    const it = sim.interactables[id];
    if (!it.hack || it.taken) continue;
    if (it.hack === 'overheat' && it.used) continue;
    const isOverheat = it.hack === 'overheat';
    candidates.push({
      nodeId: it.id,
      kind: 'node',
      name: it.name,
      x: it.x,
      y: 1.15,
      z: it.z,
      wiredHop: false,
      eAction: {
        verb: isOverheat ? 'overheat' : 'lure_ping',
        targetId: it.id,
        label: isOverheat ? `Sobrecalentar: ${it.name}` : `Señuelo acústico: ${it.name}`,
        cost: isOverheat ? CYBER.costs.overheat : CYBER.costs.lure_ping,
        heat: isOverheat ? CYBER.heat.overheat : CYBER.heat.lure_ping,
      },
      fAction: null,
    });
  }

  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const vx = c.x - ray.ox, vy = c.y - ray.oy, vz = c.z - ray.oz;
    const d3 = Math.hypot(vx, vy, vz);
    if (d3 < 0.2 || d3 > 30) continue;
    const dot = (vx * rx + vy * ry + vz * rz) / d3;
    if (dot < CYBER.aimConeCos) continue;
    const score = dot - d3 * 0.0025;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (!best) return null;
  const rf = best.wiredHop
    ? { distance: dist(signalOrigin(sim).x, signalOrigin(sim).z, best.x, best.z), wallCrossings: 0, effectiveRange: 99, inRange: true }
    : effectiveHackRange(sim, best.x, best.z, CYBER.hackBaseRange);

  return {
    nodeId: best.nodeId,
    kind: best.kind,
    name: best.name,
    x: best.x,
    y: best.y,
    z: best.z,
    distance: rf.distance,
    wallCrossings: rf.wallCrossings,
    effectiveRange: rf.effectiveRange,
    inRange: rf.inRange,
    traceable: true,
    eAction: best.eAction,
    fAction: best.fAction,
  };
}

function chiefCanTrace(sim) {
  if (sim.camsDisabled) return false;
  const chief = sim.npcs.find((n) => n.id === 'chief');
  if (!chief || !chief.alive || !chief.conscious) return false;
  if (['sick', 'panic', 'combat', 'grabbed'].includes(chief.state)) return false;
  return true;
}

function maybeStartTrace(sim) {
  if (!sim.trace || sim.trace.active) return;
  if (!chiefCanTrace(sim)) return;
  if (sim.trace.netHeat >= CYBER.heat.traceThreshold) {
    sim.trace.active = true;
    sim.trace.progress = 0;
    sim.trace.originX = sim.player.x;
    sim.trace.originZ = sim.player.z;
    pushEvent(
      sim,
      'warn',
      'Actividad anómala detectada: seguridad rastrea el origen de tu señal. Desconéctate y aléjate.',
      'trace_warn'
    );
  }
}

export function disconnectLink(sim, reason = 'manual') {
  if (!sim.link || sim.link.mode === 's7') return false;
  resetLink(sim, reason);
  if (reason === 'manual') {
    pushEvent(sim, 'info', 'Enlace remoto cerrado. Control devuelto al chasis S-7.', 'ui');
  } else if (reason === 'threat') {
    pushEvent(sim, 'warn', 'WATCHDOG S-7: amenaza próxima al chasis. Desconexión de emergencia.', 'trace_warn');
  } else if (reason === 'energy') {
    pushEvent(sim, 'warn', 'Energía de Instinto agotada: enlace remoto finalizado.', 'link_lost');
  } else if (reason === 'range') {
    pushEvent(sim, 'warn', 'Señal fuera de rango máximo: enlace remoto perdido.', 'link_lost');
  }
  return true;
}

export function cycleCameraLink(sim, dir = 1, currentCamYaw = null, currentCamPitch = null) {
  if (!sim || sim.status !== 'playing' || sim.camsDisabled) return false;
  if (!sim.link || sim.link.mode !== 'camera') return false;
  const activeCams = sim.cams.filter((c) => c.active);
  if (!activeCams.length) {
    disconnectLink(sim, 'manual');
    return false;
  }
  const curIdx = activeCams.findIndex((c) => c.id === sim.link.targetId);
  const nextCam = activeCams[(Math.max(0, curIdx) + (dir >= 0 ? 1 : activeCams.length - 1)) % activeCams.length];
  if (nextCam.id === sim.link.targetId && activeCams.length === 1) return false;

  const cost = CYBER.costs.cam_hop;
  if (sim.player.instinct < cost) {
    pushEvent(sim, 'warn', 'Energía de Instinto insuficiente para conmutar cámara.');
    return false;
  }

  sim.player.instinct = Math.max(0, sim.player.instinct - cost);
  sim.player.instinctOn = false;
  sim.player.jackedIn = true;
  sim.player.reloadT = 0;
  sim.link.mode = 'camera';
  sim.link.targetId = nextCam.id;
  sim.link.camYawOffset = 0;
  sim.link.camPitch = 0.22;
  sim.link.signalStrength = 1;
  sim.link.restoreView = false;
  sim.trace.netHeat = clamp(sim.trace.netHeat + CYBER.heat.cam_hop, 0, 1);
  pushEvent(sim, 'info', `Visor CCTV conectado: ${nextCam.id}.`, 'cam_hop');
  maybeStartTrace(sim);
  return true;
}

export function executeCyberAction(sim, verb, targetId, currentCamYaw = null, currentCamPitch = null) {
  if (!sim || sim.status !== 'playing') return false;
  const p = sim.player;
  if (p.dragging || p.channel) {
    pushEvent(sim, 'warn', 'No puedes iniciar un hackeo mientras arrastras o canalizas.');
    return false;
  }

  const cost = CYBER.costs[verb];
  if (cost === undefined) return false;
  if (p.instinct < cost) {
    pushEvent(sim, 'warn', `Energía de Instinto insuficiente (${Math.floor(p.instinct)}/${cost}).`);
    return false;
  }

  if (verb === 'cam_hop') {
    if (sim.camsDisabled) return false;
    const cam = sim.cams.find((c) => c.id === targetId && c.active);
    if (!cam) return false;
    if (sim.link.mode !== 'camera') {
      const rf = effectiveHackRange(sim, cam.x, cam.z);
      if (!rf.inRange) {
        pushEvent(sim, 'warn', 'Cámara fuera de alcance RF efectivo (muros intermedios).');
        return false;
      }
      if (sim.link.mode === 's7') {
        sim.link.savedYaw = currentCamYaw ?? p.yaw;
        sim.link.savedPitch = currentCamPitch ?? 0.40;
      }
    }
    p.instinct = Math.max(0, p.instinct - cost);
    p.instinctOn = false;
    p.jackedIn = true;
    p.reloadT = 0;
    sim.link.mode = 'camera';
    sim.link.targetId = cam.id;
    sim.link.camYawOffset = 0;
    sim.link.camPitch = 0.22;
    sim.link.signalStrength = 1;
    sim.link.restoreView = false;
    sim.trace.netHeat = clamp(sim.trace.netHeat + CYBER.heat.cam_hop, 0, 1);
    const o = signalOrigin(sim);
    addFx(sim, 'hack', o.x, o.z, 2.2);
    pushEvent(sim, 'info', `Enlace CCTV activo: ${cam.id}. Usa A/D para saltar de cámara, Q para salir.`, 'cam_hop');
    maybeStartTrace(sim);
    return true;
  }

  if (verb === 'cam_loop') {
    if (sim.camsDisabled) return false;
    const cam = sim.cams.find((c) => c.id === targetId && c.active);
    if (!cam) return false;
    if (sim.link.mode !== 'camera') {
      const rf = effectiveHackRange(sim, cam.x, cam.z);
      if (!rf.inRange) {
        pushEvent(sim, 'warn', 'Señal insuficiente para inyectar bucle en cámara.');
        return false;
      }
    }
    p.instinct = Math.max(0, p.instinct - cost);
    cam.loopedUntil = sim.time + CYBER.camLoopDuration;
    cam.suspicion = 0;
    sim.trace.netHeat = clamp(sim.trace.netHeat + CYBER.heat.cam_loop, 0, 1);
    addFx(sim, 'hack', cam.x, cam.z, 2.5);
    pushEvent(sim, 'good', `Cámara ${cam.id} en bucle ciego durante ${CYBER.camLoopDuration} s.`, 'hack');
    maybeStartTrace(sim);
    return true;
  }

  if (verb === 'unit_hijack') {
    const unit = sim.units && sim.units.find((u) => u.id === targetId);
    if (!unit || sim.time < unit.disabledUntil) return false;
    const rf = effectiveHackRange(sim, unit.x, unit.z);
    if (!rf.inRange) {
      pushEvent(sim, 'warn', 'Unidad robótica fuera de alcance RF efectivo.');
      return false;
    }
    if (dist(p.x, p.z, unit.x, unit.z) > CYBER.maxLinkRange) {
      pushEvent(sim, 'warn', 'Unidad fuera del radio máximo de enlace directo.');
      return false;
    }
    if (sim.link.mode === 's7') {
      sim.link.savedYaw = currentCamYaw ?? p.yaw;
      sim.link.savedPitch = currentCamPitch ?? 0.40;
    }
    p.instinct = Math.max(0, p.instinct - cost);
    p.instinctOn = false;
    p.jackedIn = true;
    p.reloadT = 0;
    unit.path = null;
    unit.goal = null;
    sim.link.mode = 'unit';
    sim.link.targetId = unit.id;
    sim.link.restoreView = false;
    sim.trace.netHeat = clamp(sim.trace.netHeat + CYBER.heat.unit_hijack, 0, 1);
    addFx(sim, 'hack', unit.x, unit.z, 0.6);
    pushEvent(sim, 'info', `Controlando ${unit.name}. Atraviesa conductos bajos; Q para desconectar.`, 'hack');
    maybeStartTrace(sim);
    return true;
  }

  if (verb === 'lure_ping') {
    const it = sim.interactables[targetId];
    if (!it || it.hack !== 'lure_ping' || it.taken) return false;
    const rf = effectiveHackRange(sim, it.x, it.z);
    if (!rf.inRange) {
      pushEvent(sim, 'warn', 'Dispositivo fuera de alcance RF efectivo.');
      return false;
    }
    p.instinct = Math.max(0, p.instinct - cost);
    sim.trace.netHeat = clamp(sim.trace.netHeat + CYBER.heat.lure_ping, 0, 1);
    let bestNpc = null;
    let bestD = CYBER.lureRadius;
    for (const n of sim.npcs) {
      if (!n.alive || !n.conscious) continue;
      if (!['patrol', 'idle', 'work', 'suspicious', 'shock'].includes(n.state)) continue;
      const dn = dist(n.x, n.z, it.x, it.z);
      if (dn <= bestD) {
        bestD = dn;
        bestNpc = n;
      }
    }
    if (bestNpc) {
      addNoise(sim, it.x, it.z, CYBER.lureRadius + 1, 'lure', { targetNpcId: bestNpc.id });
    }
    addFx(sim, 'hack', it.x, it.z, 1.1);
    pushEvent(sim, 'info', `Pulso acústico emitido en ${it.name}.`, 'hack');
    maybeStartTrace(sim);
    return true;
  }

  if (verb === 'overheat') {
    const it = sim.interactables[targetId];
    if (!it || it.hack !== 'overheat' || it.used) return false;
    const rf = effectiveHackRange(sim, it.x, it.z);
    if (!rf.inRange) {
      pushEvent(sim, 'warn', 'Objetivo fuera de alcance RF efectivo para sobrecarga.');
      return false;
    }
    p.instinct = Math.max(0, p.instinct - cost);
    sim.trace.netHeat = clamp(sim.trace.netHeat + CYBER.heat.overheat, 0, 1);
    applySabotageEffect(sim, it, true);
    maybeStartTrace(sim);
    return true;
  }

  return false;
}

function stepPassiveUnit(sim, u, dt) {
  if (sim.time < u.disabledUntil) {
    u.moving = 0;
    return;
  }
  const wp = u.route[u.routeIdx];
  if (!wp) { u.moving = 0; return; }
  if (!u.path) {
    u.path = sim.unitNav.path(u.x, u.z, wp[0], wp[1]);
    u.pathIdx = 0;
  }
  if (!u.path || u.pathIdx >= u.path.length) {
    u.moving = 0;
    u.dwell -= dt;
    if (u.dwell <= 0) {
      u.routeIdx = (u.routeIdx + 1) % u.route.length;
      const nextWp = u.route[u.routeIdx];
      u.dwell = nextWp[2] || 3;
      u.path = null;
    }
    return;
  }
  const t = u.path[u.pathIdx];
  const dx = t.x - u.x, dz = t.z - u.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.32) {
    u.pathIdx++;
    return;
  }
  const speed = 1.65;
  const step = Math.min(d, speed * dt);
  u.x += (dx / d) * step;
  u.z += (dz / d) * step;
  const r = resolveCircle(u.x, u.z, CYBER.unitRadius, sim.unitBoxes);
  u.x = clamp(r.x, -21.8, 21.8);
  u.z = clamp(r.z, -17.8, 25.8);
  u.yaw = angleTowards(u.yaw, Math.atan2(dx, dz), dt * 7);
  u.moving = speed;
}

export function stepCyber(sim, dt, input = {}) {
  if (!sim || sim.status !== 'playing') return;
  const p = sim.player;

  // 1. Enlace activo (camera | unit)
  if (sim.link.mode === 'camera') {
    p.jackedIn = true;
    const cam = !sim.camsDisabled && sim.cams.find((c) => c.id === sim.link.targetId && c.active);
    if (!cam) {
      disconnectLink(sim, 'manual');
    } else {
      const targetOff = input.camYawOffset !== undefined
        ? input.camYawOffset
        : sim.link.camYawOffset;
      sim.link.camYawOffset = clamp(targetOff, -CYBER.camMaxPan, CYBER.camMaxPan);
      if (input.camPitch !== undefined) {
        sim.link.camPitch = clamp(input.camPitch, -0.15, 0.75);
      }
      sim.link.signalStrength = 1;
    }
  } else if (sim.link.mode === 'unit') {
    p.jackedIn = true;
    const u = sim.units.find((x) => x.id === sim.link.targetId);
    if (!u || sim.time < u.disabledUntil) {
      disconnectLink(sim, 'manual');
    } else {
      p.instinct = Math.max(0, p.instinct - CYBER.unitDrainPerSec * dt);
      if (p.instinct <= 0) {
        u.moving = 0;
        disconnectLink(sim, 'energy');
      } else {
        u.anim += dt;
        const yaw = input.camYaw ?? u.yaw;
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        const rx = -Math.cos(yaw), rz = Math.sin(yaw);
        let wx = fx * (input.mz || 0) + rx * (input.mx || 0);
        let wz = fz * (input.mz || 0) + rz * (input.mx || 0);
        const mag = Math.hypot(wx, wz);
        if (mag > 0.01) {
          wx /= mag; wz /= mag;
          const speed = CYBER.unitSpeed;
          const nx = u.x + wx * speed * dt;
          const nz = u.z + wz * speed * dt;
          const res = resolveCircle(nx, nz, CYBER.unitRadius, sim.unitBoxes);
          const cx = clamp(res.x, -21.8, 21.8);
          const cz = clamp(res.z, -17.8, 25.8);
          const nextD = dist(p.x, p.z, cx, cz);
          if (nextD <= CYBER.maxLinkRange) {
            u.x = cx; u.z = cz;
            u.moving = speed;
          } else {
            // Limita al borde del radio de enlace o desconecta si se fuerza más allá
            const curD = dist(p.x, p.z, u.x, u.z);
            if (nextD <= curD) {
              u.x = cx; u.z = cz;
              u.moving = speed;
            } else {
              u.moving = 0;
            }
          }
          u.yaw = angleTowards(u.yaw, Math.atan2(wx, wz), dt * 12);
        } else {
          u.moving = 0;
        }
        const linkDist = dist(p.x, p.z, u.x, u.z);
        if (linkDist > CYBER.maxLinkRange + 1.5) {
          disconnectLink(sim, 'range');
        } else {
          const walls = countWallCrossings(p.x, p.z, u.x, u.z);
          sim.link.signalStrength = clamp(1 - (linkDist / CYBER.maxLinkRange) * 0.78 - walls * 0.06, 0.08, 1);
        }
      }
    }
  } else {
    p.jackedIn = false;
  }

  // 2. Patrulla pasiva de unidades no controladas
  if (sim.units) {
    for (const u of sim.units) {
      if (sim.link.mode === 'unit' && sim.link.targetId === u.id) continue;
      u.anim += dt;
      stepPassiveUnit(sim, u, dt);
    }
  }

  // 3. Watchdog de emergencia sobre el chasis S-7
  if (sim.link.mode !== 's7') {
    let threatened = false;
    for (const n of sim.npcs) {
      if (n.alive && n.conscious && n.seesPlayer && n.awareness >= CYBER.emergencyDisconnectAt) {
        threatened = true;
        break;
      }
    }
    if (!threatened && !sim.camsDisabled) {
      for (const c of sim.cams) {
        if (!c.active || sim.time < (c.loopedUntil || 0)) continue;
        if (sim.link.mode === 'camera' && sim.link.targetId === c.id) continue;
        if (c.suspicion / 1.1 >= CYBER.emergencyDisconnectAt) {
          threatened = true;
          break;
        }
      }
    }
    if (threatened) disconnectLink(sim, 'threat');
  }

  // 4. Rastreo activo de señal (sim.trace)
  const tr = sim.trace;
  const canTrace = chiefCanTrace(sim);
  if (!canTrace) {
    if (tr.active) {
      tr.active = false;
      tr.progress = 0;
      tr.netHeat = Math.min(tr.netHeat, CYBER.heat.postTraceReset);
      pushEvent(sim, 'good', 'Rastreo de red interrumpido: nodo de seguridad fuera de línea.', 'hack');
    }
    tr.netHeat = Math.max(0, tr.netHeat - CYBER.heat.decayPerSec * 2 * dt);
    return;
  }

  maybeStartTrace(sim);

  if (tr.active) {
    if (sim.link.mode === 's7' && dist(p.x, p.z, tr.originX, tr.originZ) > CYBER.heat.evadeRadius) {
      tr.active = false;
      tr.progress = 0;
      tr.netHeat = Math.min(tr.netHeat, CYBER.heat.postTraceReset);
      pushEvent(sim, 'good', 'Rastreo evadido: abandonaste el punto de emisión a tiempo.', 'ui');
      return;
    }
    tr.progress = Math.min(1, tr.progress + dt / CYBER.heat.traceDuration);
    if (tr.progress >= 1) {
      const ox = tr.originX, oz = tr.originZ;
      tr.active = false;
      tr.progress = 0;
      tr.netHeat = CYBER.heat.postTraceReset;
      disconnectLink(sim, 'threat');
      raiseAlarm(sim, ALERT.SEARCH, ox, oz, 'Rastreo completado: seguridad investiga el origen de la señal.');
      let nearestGuard = null, bestD = Infinity;
      for (const g of sim.npcs) {
        if (!g.alive || !g.conscious || g.role !== 'guard') continue;
        if (!['patrol', 'idle', 'work', 'suspicious', 'shock', 'investigate'].includes(g.state)) continue;
        const dg = dist(g.x, g.z, ox, oz);
        if (dg < bestD) { bestD = dg; nearestGuard = g; }
      }
      if (nearestGuard) {
        addNoise(sim, ox, oz, 999, 'trace', { targetNpcId: nearestGuard.id });
      }
    }
  } else {
    tr.netHeat = Math.max(0, tr.netHeat - CYBER.heat.decayPerSec * dt);
  }
}
