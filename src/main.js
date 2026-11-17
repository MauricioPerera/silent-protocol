// Arranque, entrada de usuario, modos de diagnóstico bajo demanda y bucle 60 Hz
import { createSim, stepSim, getContext, doAction, selectItem, useItem, toggleHolster, reload } from './sim.js';
import { ITEMS, CYBER } from './config.js';
import { View } from './render.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';

const canvas = document.getElementById('scene');
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

if (params.has('show') || params.has('bench')) {
  const { runDiagnosticsMode } = await import('./diag.js');
  runDiagnosticsMode({ params, canvas, createSim, stepSim, View, UI });
} else {
  bootGame();
}

function bootGame() {
  let sim = createSim();
  const initialQuality = $('qualitySel') ? $('qualitySel').value : 'high';
  const view = new View(canvas, sim, { quality: initialQuality });
  const ui = new UI(sim, view);
  const audio = new Audio();

  const input = { mx: 0, mz: 0, camYaw: Math.PI, camPitch: 0.40, run: false, crouch: false, aim: false, instinct: false };
  const keys = new Set();
  let started = false, paused = false, ended = false, crouchToggle = false, instinctToggle = false;
  let sens = 1.4, locked = false, dragging = false, lastIntegrity = 100;
  let acc = 0, last = performance.now(), fpsT = 0, fpsN = 0;
  let playedShotFx = new WeakSet();

  const GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'KeyE', 'KeyF', 'KeyQ', 'KeyX', 'KeyR', 'KeyV', 'KeyC', 'KeyH', 'KeyM',
    'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
  ]);

  addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code) && started) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (!started) {
      if (e.code === 'Enter' || e.code === 'Space') start();
      return;
    }
    if (e.code === 'Escape') {
      if (sim.link && sim.link.mode !== 's7' && !paused && !ended) {
        doAction(sim, 'disconnect', { camYaw: input.camYaw, camPitch: input.camPitch });
        return;
      }
      togglePause();
      return;
    }
    if (e.code === 'KeyH') { togglePause(); return; }
    if (paused || ended) return;

    const actionOpts = { camYaw: input.camYaw, camPitch: input.camPitch };
    switch (e.code) {
      case 'KeyE': {
        const c = getContext(sim, view.aimRay());
        if (c.primary && c.primary.action) {
          doAction(sim, c.primary.action, actionOpts);
          if (!c.primary.cyber) audio.play('ui');
        }
        break;
      }
      case 'KeyF': {
        const c = getContext(sim, view.aimRay());
        const ex = c.extras && c.extras.find((x) => x.key === 'F');
        if (ex) {
          doAction(sim, ex.action, actionOpts);
          if (ex.action === 'disguise') audio.play('ui');
          if (sim.link.mode !== 's7') instinctToggle = false;
        }
        break;
      }
      case 'KeyQ': {
        const c = getContext(sim, view.aimRay());
        const ex = c.extras && c.extras.find((x) => x.key === 'Q');
        if (ex) {
          doAction(sim, ex.action, actionOpts);
          if (ex.action !== 'disconnect') audio.play('ui');
        }
        break;
      }
      case 'KeyA': {
        if (sim.link && sim.link.mode === 'camera') doAction(sim, 'cam_prev', actionOpts);
        break;
      }
      case 'KeyD': {
        if (sim.link && sim.link.mode === 'camera') doAction(sim, 'cam_next', actionOpts);
        break;
      }
      case 'KeyX': toggleHolster(sim); audio.play('ui'); break;
      case 'KeyR': reload(sim); break;
      case 'KeyC': crouchToggle = !crouchToggle; break;
      case 'Tab':
        if (sim.link.mode === 's7') { instinctToggle = !instinctToggle; audio.play('instinct'); }
        break;
      case 'KeyV':
        if (sim.link.mode === 's7') audio.play('instinct');
        break;
      case 'KeyM': audio.setMuted(!audio.muted); ui.toast('info', audio.muted ? 'Audio silenciado' : 'Audio activado'); break;
      default:
        if (e.code.startsWith('Digit') && sim.link.mode === 's7') {
          const it = ITEMS.find((i) => i.key === e.code.slice(5));
          if (it) { selectItem(sim, it.id); audio.play('ui'); }
        }
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); if (started && !paused && !ended) togglePause(true); });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (!started || paused || ended) return;
    if (e.button === 0) {
      if (!locked) requestLock();
      dragging = true;
      if (sim.link.mode === 's7') useItem(sim, view.aimRay());
    } else if (e.button === 2) {
      if (sim.link.mode === 's7') input.aim = true;
      dragging = true;
      if (!locked) requestLock();
    }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 2) input.aim = false;
    if (e.button === 0 || e.button === 2) dragging = false;
  });
  addEventListener('mousemove', (e) => {
    if (!started || paused || ended) return;
    if (!locked && !dragging) return;
    const dx = e.movementX || 0, dy = e.movementY || 0;
    if (sim.link && sim.link.mode === 'camera') {
      sim.link.camYawOffset = Math.max(-CYBER.camMaxPan, Math.min(CYBER.camMaxPan, (sim.link.camYawOffset || 0) - dx * 0.0020 * sens));
      sim.link.camPitch = Math.max(-0.15, Math.min(0.75, (sim.link.camPitch ?? 0.22) + dy * 0.0016 * sens));
    } else {
      input.camYaw -= dx * 0.0022 * sens;
      input.camPitch = Math.max(-0.3, Math.min(1.1, input.camPitch + dy * 0.0018 * sens));
    }
  });
  canvas.addEventListener('wheel', (e) => {
    if (!started) return;
    e.preventDefault();
    input.camPitch = Math.max(-0.3, Math.min(1.1, input.camPitch + Math.sign(e.deltaY) * 0.06));
  }, { passive: false });

  function requestLock() {
    try {
      const r = canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => { locked = false; });
    } catch (_err) { locked = false; }
  }
  document.addEventListener('pointerlockchange', () => {
    const wasLocked = locked;
    locked = document.pointerLockElement === canvas;
    $('hint').style.display = locked ? 'none' : 'block';
    if (wasLocked && !locked && started && !paused && !ended) togglePause(true);
  });
  document.addEventListener('pointerlockerror', () => { locked = false; });

  function start() {
    if (started) return;
    started = true;
    audio.init();
    $('startScreen').classList.remove('show');
    view.setQuality($('qualitySel').value);
    sens = parseFloat($('sensSel').value);
    requestLock();
    last = performance.now();
  }
  function togglePause(force) {
    if (!started || ended) return;
    paused = force === true ? true : !paused;
    $('pauseScreen').classList.toggle('show', paused);
    $('qualitySel2').value = view.quality;
    $('sensSel2').value = sens;
    if (paused) { if (document.pointerLockElement) document.exitPointerLock(); }
    else { requestLock(); last = performance.now(); }
  }
  function restart() {
    sim = createSim();
    view.attachSim(sim);
    ui.sim = sim;
    ui.lastEventId = 0;
    ui.logItems.forEach((l) => l.el.remove());
    ui.logItems = [];
    ui.buildObjectives();
    ended = false; paused = false;
    acc = 0; dragging = false;
    playedShotFx = new WeakSet();
    lastIntegrity = 100;
    input.camYaw = Math.PI; input.camPitch = 0.40; input.aim = false;
    crouchToggle = false; instinctToggle = false;
    $('endScreen').classList.remove('show');
    $('pauseScreen').classList.remove('show');
    $('damage').style.opacity = 0;
    requestLock();
    last = performance.now();
  }

  $('startBtn').onclick = start;
  $('resumeBtn').onclick = () => togglePause(false);
  $('restartBtn').onclick = restart;
  $('againBtn').onclick = restart;
  ui.onSelect = (id) => { if (sim.link.mode === 's7') { selectItem(sim, id); audio.play('ui'); } };
  $('qualitySel').onchange = (e) => view.setQuality(e.target.value);
  $('qualitySel2').onchange = (e) => { view.setQuality(e.target.value); $('qualitySel').value = e.target.value; };
  $('sensSel').oninput = (e) => { sens = parseFloat(e.target.value); $('sensSel2').value = sens; };
  $('sensSel2').oninput = (e) => { sens = parseFloat(e.target.value); $('sensSel').value = sens; };

  ui.onEvent = (e) => {
    const baseMap = { alarm: 'alarm', good: 'good', bad: 'bad', warn: 'warn', info: null };
    const baseSfx = baseMap[e.kind];
    if (baseSfx && baseSfx !== e.sfx) audio.play(baseSfx);
    if (e.sfx) audio.play(e.sfx);
  };

  addEventListener('resize', () => view.resize());

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;

    fpsN++; fpsT += dt;
    if (fpsT > 0.5) { $('fps').textContent = Math.round(fpsN / fpsT) + ' FPS'; fpsN = 0; fpsT = 0; }

    if (started && !paused && !ended) {
      const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      input.mz = f; input.mx = s;
      input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
      input.crouch = crouchToggle || keys.has('ControlLeft') || keys.has('ControlRight');
      input.instinct = instinctToggle || keys.has('KeyV');

      if (sim.link && sim.link.restoreView) {
        input.camYaw = sim.link.savedYaw;
        input.camPitch = sim.link.savedPitch;
        sim.link.restoreView = false;
      }

      if (sim.link.mode === 'camera') {
        if (keys.has('ArrowLeft')) sim.link.camYawOffset = Math.min(CYBER.camMaxPan, (sim.link.camYawOffset || 0) + dt * 1.4);
        if (keys.has('ArrowRight')) sim.link.camYawOffset = Math.max(-CYBER.camMaxPan, (sim.link.camYawOffset || 0) - dt * 1.4);
        if (keys.has('ArrowUp')) sim.link.camPitch = Math.max(-0.15, (sim.link.camPitch ?? 0.22) - dt * 0.9);
        if (keys.has('ArrowDown')) sim.link.camPitch = Math.min(0.75, (sim.link.camPitch ?? 0.22) + dt * 0.9);
      } else {
        if (keys.has('ArrowLeft')) input.camYaw += dt * 1.9;
        if (keys.has('ArrowRight')) input.camYaw -= dt * 1.9;
        if (keys.has('ArrowUp')) input.camPitch = Math.min(1.1, input.camPitch + dt * 1.1);
        if (keys.has('ArrowDown')) input.camPitch = Math.max(-0.3, input.camPitch - dt * 1.1);
      }

      acc += dt;
      let steps = 0;
      while (acc >= 1 / 60 && steps < 6) { stepSim(sim, 1 / 60, input); acc -= 1 / 60; steps++; }
      if (acc > 0.5) acc = 0;

      if (sim.link && sim.link.restoreView) {
        input.camYaw = sim.link.savedYaw;
        input.camPitch = sim.link.savedPitch;
        sim.link.restoreView = false;
      }

      for (const fFx of sim.fx) {
        if (fFx.kind === 'tracer' && !playedShotFx.has(fFx)) {
          playedShotFx.add(fFx);
          audio.play('shot');
        }
      }

      if (sim.player.integrity < lastIntegrity - 0.5) {
        $('damage').style.opacity = Math.min(0.9, (lastIntegrity - sim.player.integrity) / 25);
        setTimeout(() => { $('damage').style.opacity = 0; }, 180);
        audio.play('bad');
      }
      lastIntegrity = sim.player.integrity;

      if (sim.status !== 'playing' && !ended) {
        ended = true;
        ui.showEnd(sim.status);
        audio.play(sim.status === 'won' ? 'win' : 'lose');
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }

    const scanTint = sim.player.instinctOn || (sim.link && sim.link.mode !== 's7');
    $('instinctTint').classList.toggle('on', scanTint);
    view.render(sim, started && !paused && !ended ? dt : 0.0001, input);
    ui.ctx = getContext(sim, view.aimRay());
    ui.update(dt);
  }
  requestAnimationFrame(frame);

  window.__game = {
    get sim() { return sim; },
    view,
    ui,
    input,
    audio,
    restart,
    diag: () => view.getDiagnostics(),
  };
}
