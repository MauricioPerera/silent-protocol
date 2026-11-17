// Simulación del juego: jugador, acciones, mundo, objetivos y reglas de sigilo
import { PLAYER, ITEMS, OUTFITS, ALERT, VISION, SUSPECT, CYBER, COLORS, outfitAllowed, itemLegal, ZONES } from './config.js';
import {
  WALLS, PROPS, VENTS, INTERACTABLES, CAMERAS, NPC_DEFS, UNIT_DEFS, PLAYER_SPAWN,
  solidBoxes, solidBoxesForUnits, wallBlocked, countWallCrossings, zoneAt,
} from './level.js';
import { Nav } from './nav.js';
import { dist, clamp, angleTowards, angleDiff, resolveCircle, losClear, rayHitDistance } from './mathx.js';
import { createNPC, updateNPC } from './npc.js';
import {
  pushEvent, addNoise, addFx, damagePlayer, raiseAlarm, killNPC, subdueNPC, hideBody, wakeBody,
  witnessCrime, viewersOf,
} from './entities.js';
import {
  createUnit, createLinkState, createTraceState, signalOrigin, effectiveHackRange,
  applySabotageEffect, getCyberPrompt, cycleCameraLink, executeCyberAction, disconnectLink, stepCyber,
} from './cyber.js';

export function createSim(opts = {}) {
  const seed = opts.seed !== undefined ? opts.seed : Date.now();
  const boxes = solidBoxes();
  const unitBoxes = solidBoxesForUnits();
  const nav = new Nav(boxes);
  const unitNav = new Nav(unitBoxes, CYBER.unitRadius);
  const interactables = {};
  for (const it of INTERACTABLES) {
    interactables[it.id] = Object.assign({ stored: [], poisoned: false, used: false, taken: false }, it);
  }
  const sim = {
    time: 0,
    rngState: (Number(seed) >>> 0) || 0x517cc1b7,
    boxes, unitBoxes, nav, unitNav,
    eventSeq: 0, noiseSeq: 0, fxSeq: 0, bodySeq: 0,
    npcs: [],
    units: [],
    cams: CAMERAS.map((c) => Object.assign({ active: true, suspicion: 0, currentYaw: c.yaw, loopedUntil: 0 }, c)),
    link: createLinkState(),
    trace: createTraceState(),
    interactables,
    bodies: [], traps: [], coins: [], noises: [], fx: [], events: [],
    player: {
      x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, yaw: PLAYER_SPAWN.yaw,
      crouch: false, aiming: false, moving: 0, run: false,
      outfit: 'suit', burned: {}, item: 'hands', holster: true,
      ammo: { pistol: 12, pistolReserve: 6, poison: 2, trap: 2, coin: 3 },
      integrity: PLAYER.integrityMax, lastDamage: -99,
      instinct: PLAYER.instinctMax, instinctOn: false, jackedIn: false,
      dragging: null, channel: null, reloadT: 0,
    },
    alarm: ALERT.CALM, alarmHold: 0, lastKnown: { x: 0, z: 0 },
    blackout: 0, electro: 0, chandelier: { released: false, y: 4.2, landed: false },
    camsDisabled: false,
    objectives: { vandermeer: false, kessler: false, core: false, extract: false },
    stats: { kills: 0, nonTargetKills: 0, accidents: 0, alerts: 0, spotted: 0, bodiesHidden: 0, bodiesFound: 0, disguises: 0, shots: 0, time: 0 },
    status: 'playing',
    rating: null,
  };
  Object.defineProperty(sim, 'rng', {
    value() {
      sim.rngState = ((sim.rngState + 0x6d2b79f5) | 0) >>> 0;
      let t = Math.imul(sim.rngState ^ (sim.rngState >>> 15), 1 | sim.rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    enumerable: false,
  });
  sim.npcs = NPC_DEFS.map((d) => createNPC(d, sim.rng));
  sim.units = UNIT_DEFS.map((d) => createUnit(d, sim.rng));
  pushEvent(sim, 'info', 'Unidad S-7 en posición. Disfraz: traje de gala. Objetivos marcados en el instinto (V).');
  return sim;
}

// ---------------------------------------------------------------------------
// Contexto de interacción (lo que se muestra en pantalla)
// ---------------------------------------------------------------------------
function nearestBody(sim, maxD = PLAYER.grabRange) {
  let best = null, bd = maxD;
  for (const b of sim.bodies) {
    if (b.hidden) continue;
    const d = dist(sim.player.x, sim.player.z, b.x, b.z);
    if (d >= bd) continue;
    if (wallBlocked(sim.player.x, sim.player.z, b.x, b.z)) continue;
    bd = d; best = b;
  }
  return best;
}
function nearestContainer(sim, maxD = 2.6) {
  let best = null, bd = maxD;
  for (const id in sim.interactables) {
    const it = sim.interactables[id];
    if (it.type !== 'container' || it.stored.length >= it.cap) continue;
    const d = dist(sim.player.x, sim.player.z, it.x, it.z);
    if (d >= bd) continue;
    if (wallBlocked(sim.player.x, sim.player.z, it.x, it.z)) continue;
    bd = d; best = it;
  }
  return best;
}
function nearestInteractable(sim, maxD = PLAYER.interactRange) {
  let best = null, bd = maxD;
  for (const id in sim.interactables) {
    const it = sim.interactables[id];
    if (it.type === 'container' || it.type === 'lure') continue;
    if (it.taken) continue;
    const px = it.useAt ? it.useAt[0] : it.x, pz = it.useAt ? it.useAt[1] : it.z;
    const d = Math.min(dist(sim.player.x, sim.player.z, px, pz), dist(sim.player.x, sim.player.z, it.x, it.z) + 0.6);
    if (d >= bd) continue;
    if (wallBlocked(sim.player.x, sim.player.z, px, pz) && wallBlocked(sim.player.x, sim.player.z, it.x, it.z)) continue;
    bd = d; best = it;
  }
  return best;
}

function nearestBotInteractable(sim, unit, maxD = CYBER.botInteractRange) {
  let best = null, bd = maxD;
  for (const id in sim.interactables) {
    const it = sim.interactables[id];
    if (it.type === 'sabotage' && it.used) continue;
    if (it.type === 'cameras' && sim.camsDisabled) continue;
    if (it.type !== 'sabotage' && it.type !== 'cameras') continue;
    const px = it.useAt ? it.useAt[0] : it.x, pz = it.useAt ? it.useAt[1] : it.z;
    const d = Math.min(dist(unit.x, unit.z, px, pz), dist(unit.x, unit.z, it.x, it.z));
    if (d >= bd) continue;
    if (wallBlocked(unit.x, unit.z, px, pz) && wallBlocked(unit.x, unit.z, it.x, it.z)) continue;
    bd = d; best = it;
  }
  return best;
}
export function takedownTarget(sim) {
  const p = sim.player;
  let best = null, bd = PLAYER.takedownRange;
  for (const n of sim.npcs) {
    if (!n.alive || !n.conscious || n.state === 'combat' || n.state === 'panic') continue;
    const d = dist(p.x, p.z, n.x, n.z);
    if (d > bd) continue;
    const angToPlayer = Math.atan2(p.x - n.x, p.z - n.z);
    if (angleDiff(angToPlayer, n.yaw) < 1.75) continue; // debe estar de espaldas
    if (wallBlocked(p.x, p.z, n.x, n.z)) continue;
    bd = d; best = n;
  }
  return best;
}

export function getContext(sim, aimRay = null) {
  const p = sim.player;
  const out = { primary: null, extras: [], cyber: null };

  if (sim.link && sim.link.mode === 'camera') {
    const cyber = getCyberPrompt(sim, aimRay);
    out.cyber = cyber;
    if (cyber && cyber.eAction && cyber.inRange) {
      out.primary = {
        label: `${cyber.eAction.label} (-${cyber.eAction.cost}⚡)`,
        action: `cyber:${cyber.eAction.verb}:${cyber.eAction.targetId}`,
        cyber: true,
      };
    }
    if (cyber && cyber.fAction && cyber.inRange) {
      out.extras.push({
        key: 'F',
        label: `${cyber.fAction.label} (-${cyber.fAction.cost}⚡)`,
        action: `cyber:${cyber.fAction.verb}:${cyber.fAction.targetId}`,
      });
    } else {
      out.extras.push({ key: 'F', label: `Siguiente cámara CCTV (-${CYBER.costs.cam_hop}⚡)`, action: 'cam_next' });
    }
    out.extras.push({ key: 'A/D', label: 'Cambiar cámara CCTV', action: 'cam_next' });
    out.extras.push({ key: 'Q', label: 'Desconectar visor', action: 'disconnect' });
    return out;
  }

  if (sim.link && sim.link.mode === 'unit') {
    const unit = sim.units && sim.units.find((u) => u.id === sim.link.targetId);
    if (unit && sim.time >= unit.disabledUntil) {
      const bit = nearestBotInteractable(sim, unit);
      if (bit) {
        out.primary = {
          label: bit.type === 'cameras' ? 'Sabotear consola CCTV (Unidad)' : `Sabotear: ${bit.name} (Unidad)`,
          action: 'botuse:' + bit.id,
          target: bit.id,
        };
      }
    }
    const cyber = getCyberPrompt(sim, aimRay);
    out.cyber = cyber;
    if (!out.primary && cyber && cyber.eAction && cyber.inRange) {
      out.primary = {
        label: `${cyber.eAction.label} (-${cyber.eAction.cost}⚡)`,
        action: `cyber:${cyber.eAction.verb}:${cyber.eAction.targetId}`,
        cyber: true,
      };
    }
    if (cyber && cyber.fAction && cyber.inRange) {
      out.extras.push({
        key: 'F',
        label: `${cyber.fAction.label} (-${cyber.fAction.cost}⚡)`,
        action: `cyber:${cyber.fAction.verb}:${cyber.fAction.targetId}`,
      });
    }
    out.extras.push({ key: 'Q', label: 'Desconectar unidad', action: 'disconnect' });
    return out;
  }

  if (p.channel) return { primary: { label: p.channel.label + '...', action: null, progress: p.channel.t / p.channel.dur }, extras: [], cyber: null };

  if (p.dragging) {
    const c = nearestContainer(sim);
    if (c) out.primary = { label: `Ocultar cuerpo en ${c.name}`, action: 'hide' };
    else out.primary = { label: 'Soltar cuerpo', action: 'drop' };
    return out;
  }
  const td = takedownTarget(sim);
  if (td) {
    const lethal = p.item === 'garrote';
    out.primary = { label: lethal ? `Eliminar silenciosamente a ${td.name}` : `Someter a ${td.name}`, action: 'takedown', target: td.id };
  }
  const body = nearestBody(sim);
  if (body) {
    if (!out.primary) out.primary = { label: `Arrastrar cuerpo de ${body.name}`, action: 'grab', target: body.id };
    if (!body.stripped) out.extras.push({ key: 'F', label: `Tomar disfraz: ${OUTFITS[body.outfit].name}`, action: 'disguise' });
    const c = nearestContainer(sim);
    if (c) out.extras.push({ key: 'Q', label: `Ocultar en ${c.name}`, action: 'hideNear' });
  }
  const it = nearestInteractable(sim);
  if (it && !out.primary) {
    const label = {
      poison: it.poisoned ? `${it.name} (envenenado)` : `Envenenar ${it.name}`,
      sabotage: `Sabotear: ${it.name}`,
      cameras: 'Desactivar cámaras de seguridad',
      intel: 'Robar el núcleo de datos',
      extract: 'Extraer en la lancha',
      pickup: `Recoger ${it.name}`,
    }[it.type] || it.name;
    out.primary = { label, action: 'use:' + it.id, target: it.id };
  } else if (it && out.primary && it.type === 'extract') {
    out.extras.push({ key: 'Q', label: 'Extraer', action: 'use:boat' });
  }

  if (p.instinctOn) {
    const cyber = getCyberPrompt(sim, aimRay);
    out.cyber = cyber;
    if (cyber && cyber.eAction && cyber.inRange && !out.primary) {
      out.primary = {
        label: `${cyber.eAction.label} (-${cyber.eAction.cost}⚡)`,
        action: `cyber:${cyber.eAction.verb}:${cyber.eAction.targetId}`,
        cyber: true,
      };
    }
    if (cyber && cyber.fAction && cyber.inRange && !out.extras.some((x) => x.key === 'F')) {
      out.extras.push({
        key: 'F',
        label: `${cyber.fAction.label} (-${cyber.fAction.cost}⚡)`,
        action: `cyber:${cyber.fAction.verb}:${cyber.fAction.targetId}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------
function startChannel(sim, dur, label, crime, onDone, extra = {}) {
  sim.player.reloadT = 0;
  sim.player.channel = {
    dur, t: 0, label, crime, onDone,
    victim: extra.victim || null,
    bodyId: extra.bodyId || null,
  };
}

export function doAction(sim, action, opts = {}) {
  if (sim.status !== 'playing' || !action) return;
  const p = sim.player;

  if (action === 'disconnect') {
    disconnectLink(sim, 'manual');
    return;
  }
  if (action === 'cam_prev') {
    cycleCameraLink(sim, -1, opts.camYaw, opts.camPitch);
    return;
  }
  if (action === 'cam_next') {
    cycleCameraLink(sim, 1, opts.camYaw, opts.camPitch);
    return;
  }
  if (action.startsWith('cyber:')) {
    const parts = action.split(':');
    executeCyberAction(sim, parts[1], parts[2], opts.camYaw, opts.camPitch);
    return;
  }
  if (action.startsWith('botuse:')) {
    if (!sim.link || sim.link.mode !== 'unit') return;
    const unit = sim.units && sim.units.find((u) => u.id === sim.link.targetId);
    const it = sim.interactables[action.slice(7)];
    if (!unit || !it || sim.time < unit.disabledUntil) return;
    const px = it.useAt ? it.useAt[0] : it.x, pz = it.useAt ? it.useAt[1] : it.z;
    const d = Math.min(dist(unit.x, unit.z, px, pz), dist(unit.x, unit.z, it.x, it.z));
    if (d > CYBER.botInteractRange + 0.4) return;
    if (wallBlocked(unit.x, unit.z, px, pz) && wallBlocked(unit.x, unit.z, it.x, it.z)) return;
    if (it.type === 'sabotage' && !it.used) {
      unit.lastSabotageAt = sim.time;
      applySabotageEffect(sim, it, false);
    } else if (it.type === 'cameras' && !sim.camsDisabled) {
      unit.lastSabotageAt = sim.time;
      sim.camsDisabled = true;
      for (const c of sim.cams) { c.active = false; c.suspicion = 0; }
      addFx(sim, 'spark', it.x, it.z, 1.2);
      pushEvent(sim, 'good', 'Circuito cerrado desactivado por unidad remota.', 'hack');
    }
    return;
  }

  if (sim.link && sim.link.mode !== 's7') return;
  if (p.channel) return;

  if (action === 'drop') {
    const b = sim.bodies.find((x) => x.id === p.dragging);
    p.dragging = null;
    if (b) { addNoise(sim, b.x, b.z, 4, 'thud'); pushEvent(sim, 'info', 'Cuerpo soltado.'); }
    return;
  }
  if (action === 'grab') {
    const b = nearestBody(sim);
    if (b) {
      p.dragging = b.id;
      p.holster = true;
      p.reloadT = 0;
      pushEvent(sim, 'warn', `Arrastrando a ${b.name}. Muévete despacio: es muy visible.`);
      witnessCrime(sim, p.x, p.z, 'body', 0.85);
    }
    return;
  }
  if (action === 'hide' || action === 'hideNear') {
    const c = nearestContainer(sim);
    const b = p.dragging ? sim.bodies.find((x) => x.id === p.dragging) : nearestBody(sim);
    if (!c || !b) return;
    startChannel(sim, 1.3, 'Ocultando cuerpo', true, () => hideBody(sim, b, c), { bodyId: b.id });
    return;
  }
  if (action === 'disguise') {
    const b = nearestBody(sim, 2.1);
    if (!b || b.stripped) return;
    startChannel(sim, 1.4, 'Cambiando de ropa', true, () => {
      if (!sim.bodies.includes(b) || b.stripped) return;
      p.outfit = b.outfit;
      b.stripped = true;
      sim.stats.disguises++;
      pushEvent(sim, 'good', `Disfraz obtenido: ${OUTFITS[b.outfit].name}. ${OUTFITS[b.outfit].hint}`);
      addFx(sim, 'disguise', p.x, p.z, 1.5);
      if (p.burned[b.outfit]) pushEvent(sim, 'bad', 'Cuidado: este disfraz ya está comprometido.');
      p.holster = true;
    }, { bodyId: b.id });
    return;
  }
  if (action === 'takedown') {
    const n = takedownTarget(sim);
    if (!n) return;
    const lethal = p.item === 'garrote';
    if (!lethal) p.holster = true;
    const victimSaw = !!(n.seesPlayer || n.awareness >= SUSPECT.suspiciousAt);
    const seenOutfit = victimSaw ? p.outfit : null;
    const seen = viewersOf(sim, n.x, n.z, 17, n.id).length > 0;
    n.state = 'grabbed'; n.moving = 0; n.path = null; n.goal = null;
    startChannel(sim, lethal ? 1.5 : 1.1, lethal ? 'Estrangulando' : 'Sometiendo', true, () => {
      const target = sim.npcs.find((x) => x.id === n.id);
      if (!target || !target.alive || !target.conscious) return;
      if (lethal) {
        killNPC(sim, target, 'garrote', !seen);
        pushEvent(sim, seen ? 'bad' : 'good', seen ? 'Eliminación presenciada: te han visto.' : 'Eliminación silenciosa. Nadie lo ha visto.', 'kill');
      } else {
        subdueNPC(sim, target, seenOutfit);
      }
      witnessCrime(sim, target.x, target.z, 'takedown', 1);
      addNoise(sim, target.x, target.z, 3.5, 'thud');
    }, { victim: n.id });
    return;
  }
  if (action.startsWith('use:')) {
    const it = sim.interactables[action.slice(4)];
    if (!it) return;
    useInteractable(sim, it);
  }
}

function useInteractable(sim, it) {
  const p = sim.player;
  if (it.type === 'poison') {
    if (it.poisoned) { pushEvent(sim, 'info', 'Ya está envenenado. Espera a que lo consuma.'); return; }
    if (p.ammo.poison <= 0) { pushEvent(sim, 'bad', 'Sin veneno. Busca viales en el laboratorio.'); return; }
    startChannel(sim, 1.2, 'Envenenando', true, () => {
      p.ammo.poison--;
      it.poisoned = true;
      pushEvent(sim, 'good', `${it.name} envenenado. Alguien lo consumirá pronto.`, 'poison');
      addFx(sim, 'poison', it.x, it.z, 1.2);
      witnessCrime(sim, p.x, p.z, 'poison', 0.9);
    });
    return;
  }
  if (it.type === 'sabotage') {
    if (it.used) { pushEvent(sim, 'info', 'Ya saboteado.'); return; }
    const required = it.needs || 'tech';
    const legal = p.outfit === required || p.outfit === 'guard';
    startChannel(sim, 2.0, 'Saboteando', !legal, () => {
      applySabotageEffect(sim, it, false);
      if (!legal) witnessCrime(sim, p.x, p.z, 'sabotage', 1);
    });
    return;
  }
  if (it.type === 'cameras') {
    if (sim.camsDisabled) { pushEvent(sim, 'info', 'Las cámaras ya están desactivadas.'); return; }
    const legal = p.outfit === 'guard';
    startChannel(sim, 2.2, 'Hackeando cámaras', !legal, () => {
      sim.camsDisabled = true;
      for (const c of sim.cams) { c.active = false; c.suspicion = 0; }
      pushEvent(sim, 'good', 'Circuito cerrado desactivado. Las cámaras ya no te vigilan.', 'hack');
      if (!legal) witnessCrime(sim, p.x, p.z, 'hack', 1);
    });
    return;
  }
  if (it.type === 'intel') {
    const legal = p.outfit === 'scientist';
    startChannel(sim, 2.6, 'Extrayendo núcleo de datos', !legal, () => {
      sim.objectives.core = true;
      it.taken = true;
      pushEvent(sim, 'good', 'OBJETIVO COMPLETADO: núcleo de datos Aurora asegurado.');
      addFx(sim, 'objective', it.x, it.z, 1.6);
      if (!legal) witnessCrime(sim, p.x, p.z, 'steal', 1);
    });
    return;
  }
  if (it.type === 'pickup') {
    if (it.gives === 'pistol') {
      p.ammo.pistolReserve = (p.ammo.pistolReserve || 0) + it.amount;
    } else {
      p.ammo[it.gives] = (p.ammo[it.gives] || 0) + it.amount;
    }
    it.taken = true;
    const nm = ITEMS.find((i) => i.id === it.gives);
    pushEvent(sim, 'good', `+${it.amount} ${nm ? nm.name : it.gives}.`);
    return;
  }
  if (it.type === 'extract') {
    const o = sim.objectives;
    if (!o.vandermeer || !o.kessler || !o.core) {
      const falta = [];
      if (!o.vandermeer) falta.push('Vandermeer');
      if (!o.kessler) falta.push('Kessler');
      if (!o.core) falta.push('núcleo de datos');
      pushEvent(sim, 'warn', 'Extracción denegada. Falta: ' + falta.join(', ') + '.');
      return;
    }
    startChannel(sim, 1.6, 'Abordando lancha', false, () => {
      sim.objectives.extract = true;
      sim.status = 'won';
      sim.stats.time = sim.time;
      sim.rating = missionRating(sim);
      pushEvent(sim, 'good', 'EXTRACCIÓN COMPLETA. Misión finalizada.');
    });
    return;
  }
}

export function selectItem(sim, id) {
  if (sim.link && sim.link.mode !== 's7') return;
  const p = sim.player;
  const it = ITEMS.find((i) => i.id === id);
  if (!it) return;
  if (p.item !== id) {
    p.item = id;
    p.holster = true;
    p.reloadT = 0;
  }
  pushEvent(sim, 'info', `${it.name}: ${it.desc}`);
}

export function toggleHolster(sim) {
  if (sim.link && sim.link.mode !== 's7') return;
  const p = sim.player;
  if (p.item !== 'pistol' && p.item !== 'garrote' && p.item !== 'trap') {
    pushEvent(sim, 'info', 'No llevas nada que guardar.');
    return;
  }
  if (p.item === 'trap' && p.holster && p.ammo.trap <= 0) {
    pushEvent(sim, 'info', 'No te quedan trampas para empuñar.');
    return;
  }
  p.holster = !p.holster;
  if (p.holster) p.reloadT = 0;
  pushEvent(sim, p.holster ? 'good' : 'warn', p.holster ? 'Objeto oculto: ya no es visible.' : 'Objeto a la vista: puede ser ilegal según tu disfraz.');
}

export function reload(sim) {
  if (sim.link && sim.link.mode !== 's7') return;
  const p = sim.player;
  if (p.item !== 'pistol' || p.reloadT > 0 || p.channel || p.dragging) return;
  if (p.ammo.pistol >= 12) { pushEvent(sim, 'info', 'Cargador lleno.'); return; }
  if ((p.ammo.pistolReserve || 0) <= 0) { pushEvent(sim, 'warn', 'Sin munición de reserva. Busca munición en seguridad.'); return; }
  p.reloadT = 1.4;
  pushEvent(sim, 'info', 'Recargando...');
}

export function useItem(sim, aimRay) {
  if (sim.link && sim.link.mode !== 's7') return;
  const p = sim.player;
  if (sim.status !== 'playing' || p.channel) return;
  if (p.dragging) { pushEvent(sim, 'warn', 'Suelta el cuerpo (E) antes de usar objetos.'); return; }
  switch (p.item) {
    case 'hands': pushEvent(sim, 'info', 'Acércate por la espalda a un NPC y pulsa E para someterlo.'); break;
    case 'garrote': pushEvent(sim, 'info', 'Cable de fibra: por la espalda y pulsa E. Silencioso y letal.'); break;
    case 'poison': pushEvent(sim, 'info', 'Busca una bebida o comida y pulsa E para envenenarla.'); break;
    case 'pistol': shoot(sim, aimRay); break;
    case 'trap': placeTrap(sim); break;
    case 'coin': throwCoin(sim, aimRay); break;
  }
}

function placeTrap(sim) {
  const p = sim.player;
  if (p.ammo.trap <= 0) { pushEvent(sim, 'bad', 'Sin trampas. Hay una carga en el pasillo de servicio.'); return; }
  const x = p.x + Math.sin(p.yaw) * 0.9, z = p.z + Math.cos(p.yaw) * 0.9;
  if (!sim.nav.walkablePoint(x, z) || wallBlocked(p.x, p.z, x, z)) {
    pushEvent(sim, 'bad', 'No hay sitio para colocar la trampa aquí.');
    return;
  }
  p.ammo.trap--;
  p.holster = p.ammo.trap <= 0;
  sim.traps.push({ id: 'trap' + sim.traps.length + '_' + sim.time.toFixed(2), x, z, t: sim.time, armed: true });
  pushEvent(sim, 'good', 'Trampa eléctrica colocada. Se activa al pisarla.', 'spark');
  witnessCrime(sim, p.x, p.z, 'trap', 1);
}

function throwCoin(sim, aimRay) {
  const p = sim.player;
  if (p.ammo.coin <= 0) { pushEvent(sim, 'bad', 'Sin monedas. Hay más en la barra del salón.'); return; }
  p.ammo.coin--;
  const dx = aimRay ? aimRay.dx : Math.sin(p.yaw), dz = aimRay ? aimRay.dz : Math.cos(p.yaw);
  const n = Math.hypot(dx, dz) || 1;
  sim.coins.push({ x: p.x, z: p.z, y: 1.3, vx: (dx / n) * 9, vz: (dz / n) * 9, vy: 3.2, landed: false, t: sim.time });
  pushEvent(sim, 'info', 'Moneda lanzada.', 'coin');
}

export function shoot(sim, aimRay) {
  if (sim.link && sim.link.mode !== 's7') return;
  const p = sim.player;
  if (sim.status !== 'playing' || p.channel || p.dragging || p.reloadT > 0) return;
  if (p.ammo.pistol <= 0) { pushEvent(sim, 'bad', 'Cargador vacío. Recarga (R) o busca munición en seguridad.'); return; }
  p.ammo.pistol--;
  p.holster = false;
  sim.stats.shots++;

  let ray;
  if (!aimRay) {
    ray = { ox: p.x, oy: 1.35, oz: p.z, dx: Math.sin(p.yaw), dy: 0, dz: Math.cos(p.yaw) };
  } else if (Math.hypot(aimRay.ox - p.x, aimRay.oz - p.z) < 0.05) {
    ray = aimRay;
    p.yaw = Math.atan2(ray.dx, ray.dz);
  } else {
    const camToPlayer = (p.x - aimRay.ox) * aimRay.dx + (p.z - aimRay.oz) * aimRay.dz;
    const minCamT = Math.max(0.2, camToPlayer + 0.15);
    let targetT = Math.max(minCamT + 1, rayHitDistance(aimRay.ox, aimRay.oz, aimRay.dx, aimRay.dz, 60, sim.boxes));
    for (const n of sim.npcs) {
      if (!n.alive || !n.conscious) continue;
      for (const s of [{ y: 1.62, r: 0.27 }, { y: 1.05, r: 0.44 }, { y: 0.5, r: 0.36 }]) {
        const cx = n.x - aimRay.ox, cy = s.y - aimRay.oy, cz = n.z - aimRay.oz;
        const t = cx * aimRay.dx + cy * aimRay.dy + cz * aimRay.dz;
        if (t < minCamT || t > targetT) continue;
        const px = aimRay.ox + aimRay.dx * t - n.x, py = aimRay.oy + aimRay.dy * t - s.y, pz = aimRay.oz + aimRay.dz * t - n.z;
        if (px * px + py * py + pz * pz <= s.r * s.r) targetT = t;
      }
    }
    const tx = aimRay.ox + aimRay.dx * targetT;
    const ty = aimRay.oy + aimRay.dy * targetT;
    const tz = aimRay.oz + aimRay.dz * targetT;
    const vx = tx - p.x, vy = ty - 1.35, vz = tz - p.z;
    const vlen = Math.hypot(vx, vy, vz) || 1;
    ray = { ox: p.x, oy: 1.35, oz: p.z, dx: vx / vlen, dy: vy / vlen, dz: vz / vlen };
    p.yaw = Math.atan2(ray.dx, ray.dz);
  }

  addFx(sim, 'muzzle', p.x + Math.sin(p.yaw) * 0.5, p.z + Math.cos(p.yaw) * 0.5, 1.3, { life: 0.12 });
  addNoise(sim, p.x, p.z, VISION.hearGun, 'gunshot');

  let hit = null, bestT = 60;
  for (const n of sim.npcs) {
    if (!n.alive || !n.conscious) continue;
    for (const s of [{ y: 1.62, r: 0.27 }, { y: 1.05, r: 0.44 }, { y: 0.5, r: 0.36 }]) {
      const cx = n.x - ray.ox, cy = s.y - ray.oy, cz = n.z - ray.oz;
      const t = cx * ray.dx + cy * ray.dy + cz * ray.dz;
      if (t < 0.6 || t > bestT) continue;
      const px = ray.ox + ray.dx * t - n.x, py = ray.oy + ray.dy * t - s.y, pz = ray.oz + ray.dz * t - n.z;
      if (px * px + py * py + pz * pz > s.r * s.r) continue;
      bestT = t; hit = n;
    }
  }
  if (hit) {
    const wallD = rayHitDistance(ray.ox, ray.oz, ray.dx, ray.dz, bestT, sim.boxes);
    if (wallD < bestT - 0.35) hit = null;
  }
  if (hit) {
    const unaware = hit.awareness < 0.4 && hit.state !== 'combat';
    killNPC(sim, hit, 'shot', unaware);
    pushEvent(sim, unaware ? 'good' : 'warn', unaware ? `${hit.name} abatido sin testigos directos.` : `${hit.name} abatido.`, 'kill');
    addFx(sim, 'tracer', p.x, p.z, 1.35, { tx: hit.x, tz: hit.z, life: 0.1 });
  } else {
    const missD = Math.min(25, rayHitDistance(ray.ox, ray.oz, ray.dx, ray.dz, 25, sim.boxes));
    addFx(sim, 'tracer', p.x, p.z, 1.35, { tx: ray.ox + ray.dx * missD, tz: ray.oz + ray.dz * missD, life: 0.1 });
  }
  witnessCrime(sim, p.x, p.z, 'shot', 1);
}

// ---------------------------------------------------------------------------
// Paso de simulación
// ---------------------------------------------------------------------------
export function stepSim(sim, dt, input = {}) {
  if (sim.status !== 'playing') { sim.stats.time = sim.time; return; }
  sim.time += dt;
  const p = sim.player;
  const remoteActive = sim.link && sim.link.mode !== 's7';

  if (remoteActive) {
    p.moving = 0;
    p.run = false;
    p.aiming = false;
    p.instinctOn = false;
    p.jackedIn = true;
  } else {
    p.jackedIn = false;
    // --- canalización de acciones ---
    if (p.channel) {
      const moving = Math.hypot(input.mx || 0, input.mz || 0) > 0.15;
      if (moving) {
        const victimId = p.channel.victim;
        p.channel = null;
        pushEvent(sim, 'warn', 'Acción cancelada al moverte.');
        if (victimId) {
          const v = sim.npcs.find((x) => x.id === victimId);
          if (v && v.alive && v.conscious) {
            v.state = 'panic'; v.panicTimer = 10; v.awareness = 0.95; v.path = null;
            pushEvent(sim, 'bad', `${v.name} se ha liberado y pide auxilio.`);
          }
        }
      } else {
        p.channel.t += dt;
        if (p.channel.t >= p.channel.dur) {
          const done = p.channel.onDone;
          p.channel = null;
          done();
        }
      }
    }

    // --- movimiento del jugador ---
    const yaw = input.camYaw || 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    let wx = fx * (input.mz || 0) + rx * (input.mx || 0);
    let wz = fz * (input.mz || 0) + rz * (input.mx || 0);
    const mag = Math.hypot(wx, wz);
    p.crouch = !!input.crouch;
    p.aiming = !!input.aim;
    if (p.aiming && p.item === 'pistol' && p.holster && !p.dragging && !p.channel) p.holster = false;
    p.run = !!input.run && !p.crouch && !p.dragging;
    let speed = p.crouch ? PLAYER.speedCrouch : p.run ? PLAYER.speedRun : PLAYER.speedWalk;
    if (p.dragging) speed = PLAYER.speedDrag;
    if (p.channel) speed = 0;
    if (p.aiming) speed *= 0.6;
    if (mag > 0.01 && speed > 0) {
      wx /= mag; wz /= mag;
      const nx = p.x + wx * speed * dt, nz = p.z + wz * speed * dt;
      const r = resolveCircle(nx, nz, PLAYER.radius, sim.boxes);
      p.x = clamp(r.x, -22, 22);
      p.z = clamp(r.z, -18, 26);
      p.moving = speed;
      if (!p.aiming) p.yaw = angleTowards(p.yaw, Math.atan2(wx, wz), dt * 12);
      if (p.run && sim.time - (p.lastStepNoise || 0) > 0.42) {
        p.lastStepNoise = sim.time;
        addNoise(sim, p.x, p.z, VISION.hearRun, 'steps');
      }
    } else p.moving = 0;
    if (p.aiming) p.yaw = angleTowards(p.yaw, yaw, dt * 14);

    // cuerpo arrastrado
    if (p.dragging) {
      const b = sim.bodies.find((x) => x.id === p.dragging);
      if (!b) p.dragging = null;
      else {
        const tx = p.x - Math.sin(p.yaw) * 1.05, tz = p.z - Math.cos(p.yaw) * 1.05;
        b.x += (tx - b.x) * Math.min(1, dt * 9);
        b.z += (tz - b.z) * Math.min(1, dt * 9);
        const br = resolveCircle(b.x, b.z, 0.34, sim.boxes);
        b.x = clamp(br.x, -22, 22);
        b.z = clamp(br.z, -18, 26);
        b.yaw = p.yaw;
      }
    }

    // --- instinto ---
    if (input.instinct && p.instinct > 0) {
      p.instinctOn = true;
      p.instinct = Math.max(0, p.instinct - PLAYER.instinctDrain * dt);
      if (p.instinct <= 0) p.instinctOn = false;
    } else {
      p.instinctOn = false;
      p.instinct = Math.min(PLAYER.instinctMax, p.instinct + PLAYER.instinctRecharge * dt);
    }
  }

  // --- reparación ---
  if (sim.time - p.lastDamage > PLAYER.regenDelay && p.integrity < PLAYER.integrityMax) {
    p.integrity = Math.min(PLAYER.integrityMax, p.integrity + PLAYER.regenRate * dt);
  }
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      p.reloadT = 0;
      const need = Math.min(12 - p.ammo.pistol, p.ammo.pistolReserve || 0);
      p.ammo.pistol += need;
      p.ammo.pistolReserve = (p.ammo.pistolReserve || 0) - need;
      pushEvent(sim, 'info', 'Cargador listo.');
    }
  }

  // --- NPC ---
  for (const n of sim.npcs) updateNPC(sim, n, dt);

  // --- cámaras ---
  if (!sim.camsDisabled) {
    for (const c of sim.cams) {
      if (!c.active || sim.time < (c.loopedUntil || 0)) { c.suspicion = 0; continue; }
      if (sim.link && sim.link.mode === 'camera' && sim.link.targetId === c.id) {
        c.suspicion = 0;
        c.currentYaw = c.yaw + (sim.link.camYawOffset || 0);
        continue;
      }
      c.currentYaw = c.yaw + Math.sin(sim.time * 0.4) * 0.25;
      const d = dist(c.x, c.z, p.x, p.z);
      let illegal = false;
      const zone = zoneAt(p.x, p.z);
      if (zone && !outfitAllowed(p.outfit, zone)) illegal = true;
      if (!p.holster && !itemLegal(p.outfit, p.item)) illegal = true;
      if (p.dragging || (p.channel && p.channel.crime) || p.jackedIn) illegal = true;
      if (d < c.range && illegal &&
          angleDiff(Math.atan2(p.x - c.x, p.z - c.z), c.currentYaw) < c.fov / 2 &&
          losClear(c.x, c.z, p.x, p.z, sim.boxes)) {
        c.suspicion += dt;
        if (c.suspicion > 1.1) {
          c.suspicion = 0;
          raiseAlarm(sim, ALERT.COMBAT, p.x, p.z, 'Cámara de seguridad: intruso detectado.');
        }
      } else c.suspicion = Math.max(0, c.suspicion - dt * 0.5);
    }
  }

  // --- subsistema cibernético (unidades, watchdog de chasis y rastreo) ---
  stepCyber(sim, dt, input);

  // --- trampas ---
  for (const tr of sim.traps) {
    if (!tr.armed) continue;
    for (const n of sim.npcs) {
      if (!n.alive || !n.conscious) continue;
      if (dist(n.x, n.z, tr.x, tr.z) < 1.15) {
        tr.armed = false;
        killNPC(sim, n, 'accident', true);
        addFx(sim, 'spark', tr.x, tr.z, 0.6, { life: 0.7 });
        addNoise(sim, tr.x, tr.z, VISION.hearTrap, 'trap');
        pushEvent(sim, 'good', `Descarga eléctrica: ${n.name} eliminado (accidente).`, 'spark');
        break;
      }
    }
  }
  sim.traps = sim.traps.filter((t) => t.armed);

  // --- monedas ---
  for (const c of sim.coins) {
    if (c.landed) continue;
    c.vy -= 9.8 * dt;
    c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt;
    if (!sim.nav.walkablePoint(c.x, c.z)) { c.vx *= -0.3; c.vz *= -0.3; }
    if (c.y <= 0.05) {
      c.y = 0.05; c.landed = true;
      addNoise(sim, c.x, c.z, VISION.hearCoin, 'coin');
      addFx(sim, 'coin', c.x, c.z, 0.1, { life: 1.4 });
    }
  }
  sim.coins = sim.coins.filter((c) => sim.time - c.t < 25);

  // --- lámpara ---
  if (sim.chandelier.released && !sim.chandelier.landed) {
    sim.chandelier.y -= dt * 9;
    if (sim.chandelier.y <= 0.6) {
      sim.chandelier.y = 0.6;
      sim.chandelier.landed = true;
      addFx(sim, 'crash', 0, 3, 0.6, { life: 1.2 });
      addNoise(sim, 0, 3, 18, 'crash');
      let victims = 0;
      for (const n of sim.npcs) {
        if (!n.alive || !n.conscious) continue;
        if (dist(n.x, n.z, 0, 3) < 2.6) { killNPC(sim, n, 'accident', true); victims++; }
      }
      pushEvent(sim, victims ? 'good' : 'warn', victims ? `La lámpara ha aplastado a ${victims} persona(s). Accidente perfecto.` : 'La lámpara se ha estrellado sin víctimas.', 'crash');
      if (dist(p.x, p.z, 0, 3) < 2.6) damagePlayer(sim, 70, 'UNIDAD S-7 APLASTADA. Misión fallida.');
    }
  }

  // --- apagón / electrificación ---
  if (sim.blackout > 0) sim.blackout -= dt;
  if (sim.electro > 0) {
    sim.electro -= dt;
    for (const n of sim.npcs) {
      if (!n.alive || !n.conscious) continue;
      if (dist(n.x, n.z, 17.8, 4.5) < 1.9) {
        killNPC(sim, n, 'accident', true);
        addFx(sim, 'spark', n.x, n.z, 0.6, { life: 0.7 });
        pushEvent(sim, 'good', `${n.name} electrocutado en el charco. Accidente.`, 'spark');
      }
    }
    if (dist(p.x, p.z, 17.8, 4.5) < 1.9) {
      damagePlayer(sim, 45 * dt, 'UNIDAD S-7 CORTOCIRCUITADA.');
    }
  }

  // --- cuerpos ---
  for (const b of sim.bodies.slice()) {
    if (!b.hidden && b.type === 'sleep' && sim.time > b.wakeAt) wakeBody(sim, b);
  }

  // --- limpieza ---
  sim.noises = sim.noises.filter((n) => sim.time - n.t < n.life);
  sim.fx = sim.fx.filter((f) => sim.time - f.t < f.life);

  // --- decaimiento de alerta ---
  if (sim.alarm > ALERT.CALM && sim.time > sim.alarmHold) {
    const anyCombat = sim.npcs.some((n) => n.alive && n.conscious && n.state === 'combat');
    if (!anyCombat) {
      sim.alarm--;
      sim.alarmHold = sim.time + 18;
      pushEvent(sim, 'info', sim.alarm === ALERT.CALM ? 'La seguridad se ha calmado. Vuelven a sus rutinas.' : 'La alerta baja a estado de búsqueda.');
      if (sim.alarm === ALERT.CALM) {
        for (const n of sim.npcs) {
          if (!n.alive || !n.conscious) continue;
          n.compromised = false;
          if (['combat', 'panic', 'investigate', 'shock', 'flee'].includes(n.state)) {
            n.state = 'patrol'; n.path = null; n.goal = null; n.awareness = 0.2; n.reportedPanic = false;
          }
        }
      }
    } else sim.alarmHold = sim.time + 6;
  }

  sim.stats.time = sim.time;
}

export function missionRating(sim) {
  const s = sim.stats;
  const silent = s.spotted === 0 && s.alerts === 0 && s.nonTargetKills === 0 && s.bodiesFound === 0;
  let title, note;
  if (silent && s.accidents >= 2) { title = 'ASESINO SILENCIOSO'; note = 'Dos accidentes perfectos: nadie sospecha nada. Obra maestra.'; }
  else if (silent) { title = 'ASESINO SILENCIOSO'; note = 'Nadie te vio, nadie encontró nada. Ejecución impecable.'; }
  else if (s.spotted === 0 && s.nonTargetKills === 0) { title = 'PROFESIONAL'; note = 'Hubo incidentes, pero mantuviste el control y no hubo bajas innecesarias.'; }
  else if (s.nonTargetKills <= 2 && s.alerts <= 2) { title = 'OPERATIVO'; note = 'Misión cumplida con daños colaterales. La agencia tomará nota.'; }
  else { title = 'CARNICERO'; note = 'Objetivos cumplidos, pero dejó un rastro imposible de ocultar.'; }
  return { title, note, silent, score: Math.max(0, 10000 - s.nonTargetKills * 900 - s.alerts * 500 - s.spotted * 700 - s.bodiesFound * 400 + s.accidents * 600 + s.bodiesHidden * 150) };
}

export function objectiveList(sim) {
  const o = sim.objectives;
  return [
    { id: 'vandermeer', text: 'Eliminar a Marcus Vandermeer', done: o.vandermeer, optional: false },
    { id: 'kessler', text: 'Eliminar a la Dra. Elena Kessler', done: o.kessler, optional: false },
    { id: 'core', text: 'Robar el núcleo de datos Aurora', done: o.core, optional: false },
    { id: 'extract', text: 'Extraer por la lancha (jardín sur)', done: o.extract, optional: false },
    { id: 'silent', text: 'Opcional: sin alertas ni testigos', done: sim.stats.alerts === 0 && sim.stats.spotted === 0, optional: true },
    { id: 'clean', text: 'Opcional: ninguna baja no objetivo', done: sim.stats.nonTargetKills === 0, optional: true },
  ];
}

export {
  zoneAt, OUTFITS, ITEMS, ZONES, COLORS, WALLS, PROPS, VENTS,
  signalOrigin, effectiveHackRange, countWallCrossings,
  getCyberPrompt, executeCyberAction, cycleCameraLink, disconnectLink,
};
