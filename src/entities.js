// Ciclo de vida de entidades: cuerpos, alarmas, ruido, testigos y daño
import { ALERT, VISION, OUTFITS } from './config.js';
import { dist, losClear, angleDiff } from './mathx.js';

export function pushEvent(sim, kind, text, sfx = null) {
  const id = (sim.eventSeq = (sim.eventSeq || 0) + 1);
  sim.events.push({ id, kind, text, sfx, t: sim.time });
  if (sim.events.length > 60) sim.events.shift();
}

export function addNoise(sim, x, z, radius, kind, opts = {}) {
  const id = (sim.noiseSeq = (sim.noiseSeq || 0) + 1);
  sim.noises.push({
    id, x, z, radius, kind,
    targetNpcId: opts.targetNpcId || null,
    t: sim.time,
    life: kind === 'coin' || kind === 'lure' ? 1.2 : 0.5,
  });
}

export function resetLink(sim, reason = null) {
  if (!sim.link || sim.link.mode === 's7') return false;
  sim.link.mode = 's7';
  sim.link.targetId = null;
  sim.link.signalStrength = 1;
  sim.link.camYawOffset = 0;
  sim.link.restoreView = true;
  sim.link.lastDisconnectReason = reason;
  if (sim.player) sim.player.jackedIn = false;
  return true;
}

export function addFx(sim, kind, x, z, y = 1, extra = {}) {
  const id = (sim.fxSeq = (sim.fxSeq || 0) + 1);
  sim.fx.push(Object.assign({ id, kind, x, z, y, t: sim.time, life: 0.6 }, extra));
  if (sim.fx.length > 40) sim.fx.shift();
}

export function damagePlayer(sim, amount, deathMessage = 'UNIDAD S-7 DESTRUIDA. Misión fallida.') {
  if (sim.status !== 'playing' || amount <= 0) return;
  const p = sim.player;
  p.integrity = Math.max(0, p.integrity - amount);
  p.lastDamage = sim.time;
  if (resetLink(sim, 'damage')) {
    pushEvent(sim, 'bad', 'Daño recibido en el chasis S-7: enlace remoto interrumpido.', 'link_lost');
  }
  if (p.integrity <= 0) {
    p.integrity = 0;
    p.moving = 0;
    if (p.channel && p.channel.victim) {
      const v = sim.npcs.find((n) => n.id === p.channel.victim);
      if (v && v.alive && v.conscious && v.state === 'grabbed') v.state = 'idle';
    }
    p.channel = null;
    sim.status = 'dead';
    pushEvent(sim, 'bad', deathMessage);
  }
}

export function raiseAlarm(sim, level, x, z, reason) {
  if (level > sim.alarm) {
    sim.alarm = level;
    sim.stats.alerts++;
    pushEvent(sim, 'alarm', reason || (level === ALERT.COMBAT ? '¡Alerta de combate! Intruso localizado.' : 'Algo va mal: los guardias investigan.'));
    addFx(sim, 'alarm', x, z, 2);
  }
  sim.alarmHold = sim.time + (level === ALERT.COMBAT ? 14 : 22);
  if (x !== undefined) sim.lastKnown = { x, z };
  if (level === ALERT.COMBAT) {
    if (sim.player.channel && sim.player.channel.victim) {
      const vid = sim.player.channel.victim;
      sim.player.channel = null;
      const v = sim.npcs.find((n) => n.id === vid);
      if (v && v.alive && v.conscious && v.state === 'grabbed') v.state = 'idle';
    }
    for (const n of sim.npcs) {
      if (!n.alive || !n.conscious || n.state === 'sick') continue;
      if (n.role === 'guard' && n.state !== 'combat') {
        n.state = 'combat';
        n.path = null;
        n.searchTimer = 12;
      } else if (n.target && n.state !== 'flee') {
        n.state = 'flee';
        n.path = null;
      } else if (n.role !== 'guard' && !n.target && n.state !== 'panic') {
        n.state = 'panic';
        n.panicTimer = 10;
        n.path = null;
      }
    }
  }
}

export function burnOutfit(sim, outfitId, why) {
  if (!outfitId || sim.player.burned[outfitId]) return;
  sim.player.burned[outfitId] = true;
  pushEvent(sim, 'bad', `Disfraz comprometido: ${OUTFITS[outfitId].name}. ${why || 'Te han reconocido.'}`);
}

export function spawnBody(sim, npc, type, cause, extra = {}) {
  const seq = (sim.bodySeq = (sim.bodySeq || 0) + 1);
  const body = {
    id: 'body' + seq, npcId: npc.id, name: npc.name, outfit: npc.outfit,
    x: npc.x, z: npc.z, yaw: npc.yaw, type, cause,
    hidden: false, container: null, reported: false, stripped: false,
    seenOutfit: extra.seenOutfit || null,
    wakeAt: type === 'sleep' ? sim.time + 85 : Infinity, t: sim.time,
  };
  sim.bodies.push(body);
  npc.bodyId = body.id;
  return body;
}

export function killNPC(sim, npc, cause = 'shot', silent = false) {
  if (!npc.alive) return null;
  npc.alive = false;
  npc.conscious = false;
  npc.state = 'dead';
  npc.awareness = 0;
  const body = spawnBody(sim, npc, 'dead', cause);
  sim.stats.kills++;
  if (cause === 'accident') sim.stats.accidents++;
  if (!npc.target) sim.stats.nonTargetKills++;
  if (npc.target) {
    sim.objectives[npc.id] = true;
    pushEvent(sim, 'good', `OBJETIVO ELIMINADO: ${npc.name}${cause === 'accident' ? ' (accidente)' : ''}.`, 'kill');
    addFx(sim, 'objective', npc.x, npc.z, 2);
  } else if (!silent) {
    pushEvent(sim, 'warn', `Baja no objetivo: ${npc.name}.`, 'kill');
  }
  addFx(sim, 'kill', npc.x, npc.z, 1.2, { accident: cause === 'accident' });
  return body;
}

export function subdueNPC(sim, npc, seenOutfit = null) {
  if (!npc.alive) return null;
  npc.conscious = false;
  npc.state = 'sleep';
  npc.awareness = 0;
  const body = spawnBody(sim, npc, 'sleep', 'subdued', { seenOutfit });
  pushEvent(sim, 'info', `${npc.name} sometido. Arrastra el cuerpo (E) y ocúltalo antes de que despierte.`, 'subdue');
  addFx(sim, 'subdue', npc.x, npc.z, 1.2);
  return body;
}

export function wakeBody(sim, body) {
  const npc = sim.npcs.find((n) => n.id === body.npcId);
  if (sim.player.dragging === body.id) sim.player.dragging = null;
  if (sim.player.channel && sim.player.channel.bodyId === body.id) sim.player.channel = null;
  sim.bodies = sim.bodies.filter((b) => b.id !== body.id);
  if (!npc) return;
  npc.x = body.x;
  npc.z = body.z;
  npc.yaw = body.yaw;
  npc.alive = true;
  npc.conscious = true;
  npc.state = 'panic';
  npc.panicTimer = 12;
  npc.bodyId = null;
  npc.path = null;
  npc.awareness = 1;
  if (body.seenOutfit) burnOutfit(sim, body.seenOutfit, 'El testigo despertó.');
  raiseAlarm(sim, ALERT.SEARCH, npc.x, npc.z, `${npc.name} ha despertado y ha dado la voz de alarma.`);
  pushEvent(sim, 'bad', '¡Un cuerpo ha despertado!');
}

export function hideBody(sim, body, container) {
  if (!sim.bodies.includes(body) || body.hidden || container.stored.length >= container.cap) return;
  body.hidden = true;
  body.container = container.id;
  body.wakeAt = Infinity;
  container.stored.push(body.id);
  sim.stats.bodiesHidden++;
  if (sim.player.dragging === body.id) sim.player.dragging = null;
  pushEvent(sim, 'good', `Cuerpo ocultado en ${container.name} (${container.stored.length}/${container.cap}).`);
  addFx(sim, 'hide', container.x, container.z, 1.4);
}

// ¿Quién ve este punto ahora mismo?
export function viewersOf(sim, x, z, maxDist = 16, ignoreId = null) {
  const out = [];
  for (const n of sim.npcs) {
    if (!n.alive || !n.conscious || n.id === ignoreId) continue;
    const d = dist(n.x, n.z, x, z);
    if (d > maxDist) continue;
    const ang = Math.atan2(x - n.x, z - n.z);
    if (angleDiff(ang, n.yaw) > VISION.fov * 0.62 && d > 2.2) continue;
    if (!losClear(n.x, n.z, x, z, sim.boxes)) continue;
    out.push(n);
  }
  return out;
}

// Un acto delictivo visto por alguien dispara la sospecha al máximo
export function witnessCrime(sim, x, z, kind, severity = 1) {
  const viewers = viewersOf(sim, x, z, 17, null);
  let seen = false;
  for (const n of viewers) {
    n.awareness = Math.min(1.6, n.awareness + 1.1 * severity);
    n.crimeSeen = kind;
    n.lastKnown = { x: sim.player.x, z: sim.player.z };
    seen = true;
    if (n.awareness >= 1) compromise(sim, n);
  }
  if (!sim.camsDisabled && severity >= 0.8) {
    for (const c of sim.cams) {
      if (!c.active || sim.time < (c.loopedUntil || 0)) continue;
      if (sim.link && sim.link.mode === 'camera' && sim.link.targetId === c.id) continue;
      const d = dist(c.x, c.z, x, z);
      if (d > c.range) continue;
      const ang = Math.atan2(x - c.x, z - c.z);
      const camYaw = c.currentYaw ?? c.yaw;
      if (angleDiff(ang, camYaw) > c.fov / 2) continue;
      if (!losClear(c.x, c.z, x, z, sim.boxes)) continue;
      raiseAlarm(sim, ALERT.COMBAT, sim.player.x, sim.player.z, `Cámara ${c.id}: delito registrado. Alerta general.`);
      seen = true;
    }
  }
  return seen;
}

export function compromise(sim, npc) {
  if (npc.compromised) return;
  npc.compromised = true;
  sim.stats.spotted++;
  npc.lastKnown = { x: sim.player.x, z: sim.player.z };
  burnOutfit(sim, sim.player.outfit, `${npc.name} te ha reconocido.`);
  if (npc.role === 'guard') {
    npc.state = 'combat';
    npc.path = null;
    raiseAlarm(sim, ALERT.COMBAT, sim.player.x, sim.player.z, `¡${npc.name} te ha descubierto!`);
  } else {
    npc.state = 'panic';
    npc.panicTimer = 12;
    npc.path = null;
    raiseAlarm(sim, ALERT.SEARCH, sim.player.x, sim.player.z, `¡${npc.name} ha dado la voz de alarma!`);
    pushEvent(sim, 'bad', `${npc.name} corre a avisar a seguridad.`);
  }
}
