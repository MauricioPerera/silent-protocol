// HUD, minimapa táctico de doble foco, marcadores 3D->2D y menús
import { ZONES, OUTFITS, ITEMS, CYBER, outfitAllowed, itemLegal } from './config.js';
import { WALLS, PROPS, VENTS, zoneAt } from './level.js';
import { objectiveList, signalOrigin } from './sim.js';
import { dist } from './mathx.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(sim, view) {
    this.sim = sim;
    this.view = view;
    this.el = {
      objectives: $('objectives'), disguise: $('disguiseName'), disguiseHint: $('disguiseHint'),
      zones: $('zoneChips'), zoneNow: $('zoneNow'), integrity: $('integrityBar'), integrityTxt: $('integrityTxt'),
      instinct: $('instinctBar'), hotbar: $('hotbar'), prompt: $('prompt'), promptKey: $('promptKey'),
      promptText: $('promptText'), extras: $('extras'), log: $('log'), alert: $('alertBanner'),
      alertText: $('alertText'), linkBanner: $('linkBanner'), linkText: $('linkText'), linkWarn: $('linkWarn'),
      traceBar: $('traceBar'), traceLabel: $('traceLabel'), tracePct: $('tracePct'), traceFill: $('traceFill'),
      markers: $('markers'), minimap: $('minimap'), progress: $('channelBar'),
      progressFill: $('channelFill'), progressLabel: $('channelLabel'), suspicion: $('suspicionRing'),
      crosshair: $('crosshair'), stats: $('miniStats'), clock: $('clock'),
      tgtVandermeer: $('hudTgt-vandermeer'), tgtKessler: $('hudTgt-kessler'), s7Avatar: $('s7HudAvatar'),
    };
    this.mm = this.el.minimap.getContext('2d');
    this.markerPool = [];
    this.lastEventId = 0;
    this.logItems = [];
    this.buildHotbar();
    this.buildObjectives();
    this.el.minimap.width = 260;
    this.el.minimap.height = 300;
  }

  buildHotbar() {
    this.el.hotbar.innerHTML = '';
    this.slots = {};
    for (const it of ITEMS) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.innerHTML = `<span class="key">${it.key}</span><span class="ico">${it.icon}</span><span class="nm">${it.name}</span><span class="ammo"></span>`;
      d.onclick = () => this.onSelect && this.onSelect(it.id);
      this.el.hotbar.appendChild(d);
      this.slots[it.id] = d;
    }
  }

  buildObjectives() {
    this.el.objectives.innerHTML = objectiveList(this.sim).map((o) =>
      `<li id="obj-${o.id}" class="${o.optional ? 'opt' : ''}"><i></i><span>${o.text}</span></li>`).join('');
  }

  toast(kind, text) {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.el.log.appendChild(d);
    this.logItems.push({ el: d, t: performance.now() });
    while (this.logItems.length > 5) { const o = this.logItems.shift(); o.el.remove(); }
  }

  update(_dt) {
    const sim = this.sim, p = sim.player;
    const remoteActive = !!(sim.link && sim.link.mode !== 's7');

    // Eventos nuevos
    for (const e of sim.events) {
      if (e.id <= this.lastEventId) continue;
      this.lastEventId = e.id;
      this.toast(e.kind, e.text);
      this.onEvent && this.onEvent(e);
    }
    const now = performance.now();
    for (let i = this.logItems.length - 1; i >= 0; i--) {
      if (now - this.logItems[i].t > 9000) { this.logItems[i].el.remove(); this.logItems.splice(i, 1); }
    }

    // Objetivos y tarjetas de vigilancia de objetivos primarios
    for (const o of objectiveList(sim)) {
      const li = $('obj-' + o.id);
      if (li) li.className = (o.done ? 'done ' : '') + (o.optional ? 'opt' : '');
    }
    const syncTargetCard = (cardEl, npcId) => {
      if (!cardEl) return;
      const npc = sim.npcs.find((n) => n.id === npcId);
      const down = !!(npc && !npc.alive);
      cardEl.classList.toggle('down', down);
      const st = cardEl.querySelector('.st');
      if (st) st.textContent = down ? 'ELIMINADO' : 'OBJETIVO';
    };
    syncTargetCard(this.el.tgtVandermeer, 'vandermeer');
    syncTargetCard(this.el.tgtKessler, 'kessler');

    // Disfraz y zona del chasis S-7
    const outfit = OUTFITS[p.outfit];
    const isBurned = !!p.burned[p.outfit];
    this.el.disguise.textContent = outfit.name + (isBurned ? ' ⚠ QUEMADO' : '');
    this.el.disguise.className = isBurned ? 'burned' : '';
    if (this.el.s7Avatar) {
      this.el.s7Avatar.classList.toggle('burned', isBurned);
      this.el.s7Avatar.classList.toggle('linked', remoteActive);
    }
    this.el.disguiseHint.textContent = outfit.hint;
    const zone = zoneAt(p.x, p.z);
    const zdef = ZONES.find((z) => z.id === zone);
    const allowed = zone ? outfitAllowed(p.outfit, zone) : false;
    this.el.zoneNow.textContent = zdef ? zdef.name : 'Exterior';
    this.el.zoneNow.className = allowed ? 'ok' : 'bad';
    this.el.zones.innerHTML = ZONES.map((z) => {
      const ok = outfitAllowed(p.outfit, z.id);
      return `<span class="chip ${ok ? 'ok' : 'no'} ${z.id === zone ? 'here' : ''}">${z.name}</span>`;
    }).join('');

    // Barras de integridad e Instinto
    this.el.integrity.style.width = p.integrity + '%';
    this.el.integrity.className = 'fill ' + (p.integrity > 60 ? 'ok' : p.integrity > 30 ? 'warn' : 'bad');
    this.el.integrityTxt.textContent = Math.round(p.integrity) + '%';
    this.el.instinct.style.width = p.instinct + '%';

    // Hotbar
    for (const it of ITEMS) {
      const s = this.slots[it.id];
      s.classList.toggle('active', p.item === it.id);
      const ammo = p.ammo[it.id];
      const ammoTxt = it.id === 'pistol'
        ? `${ammo}/${p.ammo.pistolReserve ?? 0}`
        : (ammo === undefined || ammo === Infinity ? '' : String(ammo));
      s.querySelector('.ammo').textContent = ammoTxt;
      const legal = itemLegal(p.outfit, it.id);
      s.classList.toggle('illegal', !legal);
      s.classList.toggle('drawn', p.item === it.id && !p.holster && !remoteActive);
    }

    // Aviso de alerta global
    const alarm = sim.alarm;
    this.el.alert.className = 'banner ' + (alarm === 2 ? 'combat' : alarm === 1 ? 'search' : 'calm');
    this.el.alertText.textContent = alarm === 2
      ? 'ALERTA DE COMBATE · TE ESTÁN CAZANDO'
      : alarm === 1
        ? 'BÚSQUEDA ACTIVA · SEGURIDAD ALERTADA'
        : 'SIN ALERTAS · PASA DESAPERCIBIDO';

    // Banner de enlace remoto
    if (this.el.linkBanner) {
      if (remoteActive) {
        this.el.linkBanner.style.display = 'flex';
        const sig = Math.round((sim.link.signalStrength ?? 1) * 100);
        if (sim.link.mode === 'camera') {
          this.el.linkText.textContent = `CCTV ACTIVO · ${sim.link.targetId.toUpperCase()} · SEÑAL BUS 100%`;
          this.el.linkWarn.style.display = 'none';
        } else {
          const u = sim.units && sim.units.find((x) => x.id === sim.link.targetId);
          const uZone = u ? zoneAt(u.x, u.z) : null;
          const restricted = !!(u && uZone && !u.allowedZones.includes(uZone));
          const dS7 = u ? dist(p.x, p.z, u.x, u.z).toFixed(1) : '0.0';
          this.el.linkText.textContent = `UNIDAD REMOTA · ${u ? u.name.toUpperCase() : ''} · SEÑAL ${sig}% (${dS7}/${CYBER.maxLinkRange}m)`;
          this.el.linkWarn.style.display = restricted ? 'inline-block' : 'none';
        }
      } else {
        this.el.linkBanner.style.display = 'none';
      }
    }

    // Barra contextual de calor / rastreo de red
    if (this.el.traceBar && sim.trace) {
      const tr = sim.trace;
      if (tr.active || tr.netHeat > 0.01) {
        this.el.traceBar.style.display = 'block';
        this.el.traceBar.classList.toggle('shifted', remoteActive);
        this.el.traceBar.classList.toggle('active', tr.active);
        const pct = Math.round((tr.active ? tr.progress : tr.netHeat) * 100);
        this.el.traceLabel.textContent = tr.active ? '⚠ RASTREO DE SEÑAL EN CURSO' : 'ACTIVIDAD DE RED (ANOMALÍA)';
        this.el.tracePct.textContent = pct + '%';
        this.el.traceFill.style.width = pct + '%';
      } else {
        this.el.traceBar.style.display = 'none';
      }
    }

    // Anillo de sospecha / Watchdog del chasis S-7
    let maxAw = 0, watcherName = '';
    for (const n of sim.npcs) {
      if (n.alive && n.conscious && n.awareness > maxAw) { maxAw = n.awareness; watcherName = n.name; }
    }
    if (!sim.camsDisabled) {
      for (const c of sim.cams) {
        if (!c.active || sim.time < (c.loopedUntil || 0)) continue;
        if (remoteActive && sim.link.mode === 'camera' && sim.link.targetId === c.id) continue;
        const camAw = c.suspicion / 1.1;
        if (camAw > maxAw) { maxAw = camAw; watcherName = 'CÁMARA DE SEGURIDAD'; }
      }
    }
    const ring = this.el.suspicion;
    if (maxAw > 0.05 && watcherName) {
      ring.style.opacity = Math.min(1, maxAw * 1.4);
      ring.style.setProperty('--v', Math.min(1, maxAw));
      ring.className = 'suspicion ' + (maxAw >= 1 ? 'full' : maxAw > 0.35 ? 'mid' : 'low');
      ring.querySelector('.who').textContent = (remoteActive ? 'CHASIS S-7 · ' : '') + watcherName;
    } else {
      ring.style.opacity = 0;
    }

    // Prompt contextual + telemetría cibernética + extras siempre visibles
    const ctx = this.ctx;
    const cyber = ctx && ctx.cyber;
    if (ctx && ctx.primary) {
      this.el.prompt.style.display = 'flex';
      this.el.promptKey.textContent = ctx.primary.action ? 'E' : '…';
      let label = ctx.primary.label;
      if (ctx.primary.cyber && cyber) {
        const rfNote = cyber.wallCrossings > 0
          ? ` · ATENUADO (-${(cyber.wallCrossings * CYBER.wallPenalty).toFixed(1)}m)`
          : ' · EN RANGO';
        label += rfNote + (cyber.traceable ? ' · RASTREABLE' : '');
      }
      this.el.promptText.textContent = label;
      if (ctx.primary.progress !== undefined) {
        this.el.progress.style.display = 'block';
        this.el.progressFill.style.width = (ctx.primary.progress * 100) + '%';
        this.el.progressLabel.textContent = ctx.primary.label;
      } else {
        this.el.progress.style.display = 'none';
      }
    } else if (cyber && !cyber.inRange) {
      this.el.prompt.style.display = 'flex';
      this.el.promptKey.textContent = '×';
      const loss = (cyber.wallCrossings * CYBER.wallPenalty).toFixed(1);
      this.el.promptText.textContent = `${cyber.name} · FUERA DE RANGO (${cyber.distance.toFixed(1)}m > ${cyber.effectiveRange.toFixed(1)}m, -${loss}m muros)`;
      this.el.progress.style.display = 'none';
    } else if (cyber && cyber.fAction && cyber.inRange) {
      this.el.prompt.style.display = 'flex';
      this.el.promptKey.textContent = 'F';
      this.el.promptText.textContent = `${cyber.fAction.label} (-${cyber.fAction.cost}⚡) · EN RANGO · RASTREABLE`;
      this.el.progress.style.display = 'none';
    } else {
      this.el.prompt.style.display = 'none';
      this.el.progress.style.display = 'none';
    }

    const extrasList = (ctx && ctx.extras) || [];
    this.el.extras.innerHTML = extrasList.map((e) => `<span><b>${e.key}</b> ${e.label}</span>`).join('');

    // Mira
    this.el.crosshair.className = 'crosshair ' + ((p.aiming && p.item === 'pistol' && !p.holster && !remoteActive) ? 'aim' : '');

    // Estadísticas y reloj
    const mm = Math.floor(sim.time / 60), ss = Math.floor(sim.time % 60);
    this.el.clock.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    this.el.stats.innerHTML = `BAJAS <b>${sim.stats.kills}</b> · OCULTOS <b>${sim.stats.bodiesHidden}</b> · ALERTAS <b>${sim.stats.alerts}</b>`;

    this.updateMarkers();
    this.drawMinimap();
  }

  updateMarkers() {
    const sim = this.sim, view = this.view;
    const focus = signalOrigin(sim);
    const scanOn = sim.player.instinctOn || (sim.link && sim.link.mode !== 's7');
    const items = [];

    for (const n of sim.npcs) {
      if (!n.alive || !n.conscious) continue;
      const d = dist(n.x, n.z, focus.x, focus.z);
      if (d > 30) continue;
      const showName = scanOn || d < 9;
      if (!showName && n.awareness < 0.05) continue;
      items.push({ x: n.x, y: 2.15, z: n.z, npc: n, d });
    }
    for (const b of sim.bodies) {
      if (b.hidden) continue;
      const d = dist(b.x, b.z, focus.x, focus.z);
      if (d > 22) continue;
      items.push({ x: b.x, y: 0.7, z: b.z, body: b, d });
    }
    while (this.markerPool.length < items.length) {
      const el = document.createElement('div');
      el.className = 'marker';
      el.innerHTML = '<div class="bar"><i></i></div><div class="name"></div>';
      this.el.markers.appendChild(el);
      this.markerPool.push(el);
    }
    this.markerPool.forEach((el, i) => {
      const it = items[i];
      if (!it) { el.style.display = 'none'; return; }
      const pr = view.project(it.x, it.y, it.z);
      if (pr.behind || pr.x < -50 || pr.y < -50 || pr.x > innerWidth + 50 || pr.y > innerHeight + 50) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.transform = `translate(-50%,-100%) translate(${pr.x.toFixed(1)}px,${pr.y.toFixed(1)}px)`;
      const bar = el.querySelector('.bar'), name = el.querySelector('.name');
      if (it.npc) {
        const n = it.npc;
        const cls = n.state === 'combat' ? 'combat' : n.awareness > 0.4 ? 'warn' : n.target ? 'target' : 'calm';
        el.className = 'marker ' + cls + (scanOn ? ' instinct' : '');
        bar.style.opacity = n.awareness > 0.04 ? 1 : 0;
        bar.firstElementChild.style.width = Math.min(100, n.awareness * 100) + '%';
        const enf = n.enforcerFor && n.enforcerFor === sim.player.outfit;
        name.textContent = (n.target ? '◆ ' : enf ? '◉ ' : '') + n.name + (n.state === 'suspicious' ? ' ?' : n.state === 'combat' ? ' !' : '');
        name.style.opacity = scanOn || it.d < 12 || n.awareness > 0.2 ? 1 : 0;
      } else {
        el.className = 'marker body' + (scanOn ? ' instinct' : '');
        bar.style.opacity = 0;
        name.textContent = (it.body.type === 'sleep' ? '💤 ' : '✝ ') + it.body.name;
        name.style.opacity = scanOn || it.d < 10 ? 0.95 : 0;
      }
    });
  }

  drawMinimap() {
    const g = this.mm, sim = this.sim, p = sim.player;
    const focus = signalOrigin(sim);
    const remoteActive = !!(sim.link && sim.link.mode !== 's7');
    const scanOn = p.instinctOn || remoteActive;
    const W = 260, H = 300;
    const x0 = -23, x1 = 23, z0 = -19, z1 = 27;
    const sx = W / (x1 - x0), sz = H / (z1 - z0);
    const X = (x) => (x - x0) * sx, Z = (z) => (z - z0) * sz;

    g.clearRect(0, 0, W, H);
    g.fillStyle = '#070b10';
    g.fillRect(0, 0, W, H);

    for (const z of ZONES) {
      const [a, b, c, d] = z.rect;
      const ok = outfitAllowed(p.outfit, z.id);
      g.fillStyle = ok ? 'rgba(40,90,95,0.55)' : 'rgba(110,40,50,0.5)';
      g.fillRect(X(a), Z(b), (c - a) * sx, (d - b) * sz);
    }
    g.fillStyle = '#2b3644';
    for (const w of WALLS) g.fillRect(X(w.x - w.w / 2), Z(w.z - w.d / 2), Math.max(1, w.w * sx), Math.max(1, w.d * sz));

    // Conductos bajos VENTS visibles en escáner o modo unidad
    if (scanOn) {
      g.fillStyle = '#4fe3d0';
      for (const v of VENTS) {
        const vw = v.axis === 'x' ? v.span * sx : 4;
        const vd = v.axis === 'z' ? v.span * sz : 4;
        g.fillRect(X(v.x) - vw / 2, Z(v.z) - vd / 2, vw, vd);
      }
    }

    g.fillStyle = 'rgba(120,140,160,0.35)';
    for (const pr of PROPS) {
      if (!pr.solid || pr.kind === 'rug') continue;
      g.fillRect(X(pr.x - (pr.w || 1) / 2), Z(pr.z - (pr.d || 1) / 2), Math.max(1, (pr.w || 1) * sx), Math.max(1, (pr.d || 1) * sz));
    }

    // Interactuables clave
    for (const id in sim.interactables) {
      const it = sim.interactables[id];
      if (it.taken) continue;
      if (it.type === 'extract') { g.fillStyle = '#6ee7a0'; g.fillRect(X(it.x) - 3, Z(it.z) - 3, 6, 6); }
      else if (it.type === 'intel' && !sim.objectives.core) { g.fillStyle = '#ffd166'; g.fillRect(X(it.x) - 3, Z(it.z) - 3, 6, 6); }
      else if (it.type === 'container' && scanOn) { g.strokeStyle = '#4fe3d0'; g.strokeRect(X(it.x) - 2.5, Z(it.z) - 2.5, 5, 5); }
    }

    // Cuerpos
    for (const b of sim.bodies) {
      if (b.hidden) continue;
      g.fillStyle = b.reported ? '#ff4d5e' : '#c98a9a';
      g.beginPath(); g.arc(X(b.x), Z(b.z), 2.5, 0, 7); g.fill();
    }

    // Unidades robóticas
    if (sim.units) {
      for (const u of sim.units) {
        const activeU = remoteActive && sim.link.mode === 'unit' && sim.link.targetId === u.id;
        g.fillStyle = sim.time < u.disabledUntil ? '#55606a' : activeU ? '#ffd166' : '#4fe3d0';
        g.fillRect(X(u.x) - 3, Z(u.z) - 3, 6, 6);
      }
    }

    // NPCs (medidos desde el foco activo o cerca de S-7)
    for (const n of sim.npcs) {
      if (!n.alive || !n.conscious) continue;
      const dFocus = dist(n.x, n.z, focus.x, focus.z);
      const dS7 = dist(n.x, n.z, p.x, p.z);
      if (!scanOn && Math.min(dFocus, dS7) > 14) continue;
      g.fillStyle = n.target ? '#ffd166' : n.state === 'combat' ? '#ff4d5e' : n.awareness > 0.4 ? '#ffb347' : '#8fa4c8';
      g.beginPath(); g.arc(X(n.x), Z(n.z), n.target ? 3.5 : 2.5, 0, 7); g.fill();
      if (scanOn) {
        g.strokeStyle = 'rgba(143,164,200,0.35)';
        g.beginPath(); g.moveTo(X(n.x), Z(n.z));
        g.lineTo(X(n.x + Math.sin(n.yaw) * 3), Z(n.z + Math.cos(n.yaw) * 3));
        g.stroke();
      }
    }

    // Radio de enlace y línea entre chasis S-7 y unidad/cámara remota
    if (remoteActive) {
      if (sim.link.mode === 'unit') {
        g.strokeStyle = 'rgba(255,209,102,0.28)';
        g.beginPath();
        g.ellipse(X(p.x), Z(p.z), CYBER.maxLinkRange * sx, CYBER.maxLinkRange * sz, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.strokeStyle = 'rgba(79,227,208,0.75)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(X(p.x), Z(p.z));
      g.lineTo(X(focus.x), Z(focus.z));
      g.stroke();
      g.setLineDash([]);

      g.strokeStyle = '#ffd166';
      g.strokeRect(X(focus.x) - 4.5, Z(focus.z) - 4.5, 9, 9);
    }

    // Punto de origen de rastreo activo
    if (sim.trace && sim.trace.active) {
      g.strokeStyle = '#ff4d5e';
      g.beginPath();
      g.ellipse(X(sim.trace.originX), Z(sim.trace.originZ), CYBER.heat.evadeRadius * sx, CYBER.heat.evadeRadius * sz, 0, 0, Math.PI * 2);
      g.stroke();
    }

    // Chasis S-7
    g.save();
    g.translate(X(p.x), Z(p.z));
    g.rotate(-p.yaw + Math.PI);
    g.fillStyle = remoteActive ? '#ffb347' : '#4fe3d0';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath(); g.fill();
    g.restore();

    g.strokeStyle = 'rgba(79,227,208,0.25)';
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  showEnd(kind) {
    const sim = this.sim;
    const s = sim.stats;
    const r = sim.rating || { title: 'MISIÓN FALLIDA', note: 'La unidad S-7 ha sido destruida.', score: 0 };
    $('endTitle').textContent = kind === 'won' ? 'MISIÓN COMPLETADA' : 'UNIDAD DESTRUIDA';
    $('endTitle').className = kind === 'won' ? 'win' : 'lose';
    $('endRating').textContent = r.title;
    $('endNote').textContent = kind === 'won' ? r.note : 'Los guardias han neutralizado tu chasis. Reintenta con más sigilo.';
    $('endScore').textContent = kind === 'won' ? r.score : 0;
    const rows = [
      ['Tiempo de misión', `${Math.floor(s.time / 60)}m ${Math.floor(s.time % 60)}s`],
      ['Objetivos eliminados', `${(sim.objectives.vandermeer ? 1 : 0) + (sim.objectives.kessler ? 1 : 0)} / 2`],
      ['Núcleo de datos', sim.objectives.core ? 'Asegurado' : 'No obtenido'],
      ['Bajas no objetivo', s.nonTargetKills],
      ['Muertes por accidente', s.accidents],
      ['Cuerpos ocultados', s.bodiesHidden],
      ['Cuerpos descubiertos', s.bodiesFound],
      ['Veces detectado', s.spotted],
      ['Alertas generadas', s.alerts],
      ['Disfraces usados', s.disguises],
    ];
    $('endStats').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    $('endScreen').classList.add('show');
  }
}
