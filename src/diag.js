// ---------------------------------------------------------------------------
// Arnés bajo demanda para exposición visual (?show=...) y benchmark (?bench=1)
// ---------------------------------------------------------------------------
import * as THREE from '../vendor/three.module.js';
import { COLORS } from './config.js';
import { createHumanoidRig, createBotRig } from './render/rigs.js';
import { buildPropMesh, scaleGeometryUVs } from './render/props.js';

export function runDiagnosticsMode({ params, canvas, createSim, stepSim, View, UI }) {
  const showMode = params.get('show');
  const isBench = params.has('bench');
  const quality = params.get('quality') || 'high';

  const startEl = document.getElementById('startScreen');
  const pauseEl = document.getElementById('pauseScreen');
  const hudEl = document.getElementById('hud');
  const hintEl = document.getElementById('hint');
  if (startEl) startEl.classList.remove('show');
  if (pauseEl) pauseEl.classList.remove('show');
  if (hintEl) hintEl.style.display = 'none';

  if (showMode) {
    if (hudEl) hudEl.style.display = 'none';
    return runShowcase(showMode, quality, canvas, View);
  }
  if (isBench) {
    const duration = Math.max(2, Math.min(30, parseFloat(params.get('duration') || '10') || 10));
    return runBenchmark(duration, quality, canvas, createSim, stepSim, View, UI);
  }
}

function runShowcase(mode, quality, canvas, View) {
  const view = new View(canvas, null, { showcase: true, quality });
  const scene = view.scene;
  const matLib = view.matLib;
  view.buildSky();

  scene.add(new THREE.HemisphereLight(0x4c6288, 0x101520, 0.75));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.35);
  key.position.set(7, 12, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);
  const rim = new THREE.PointLight(0x4fe3d0, 22, 20, 2);
  rim.position.set(-6, 4, -5);
  scene.add(rim);

  const floorGeo = scaleGeometryUVs(new THREE.PlaneGeometry(36, 36), 9, 9);
  const floor = new THREE.Mesh(floorGeo, matLib.ceramic);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const animatedRigs = [];
  const animatedBots = [];

  if (mode === 'mats') {
    const keys = matLib.archetypes;
    keys.forEach((k, i) => {
      const col = (i % 3) - 1;
      const row = Math.floor(i / 3) - 1;
      const s = matLib.sets[k];
      const mat = new THREE.MeshStandardMaterial({
        map: s.map,
        aoMap: s.ormMap,
        roughnessMap: s.ormMap,
        metalnessMap: s.ormMap,
        normalMap: s.normalMap,
        envMapIntensity: 1.2,
      });
      view.ownedMats.push(mat);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 24), mat);
      sphere.position.set(col * 2.2, 0.85, row * 2.2);
      sphere.castShadow = true;
      scene.add(sphere);

      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.22, 20), matLib.darkMetal);
      ped.position.set(col * 2.2, 0.11, row * 2.2);
      scene.add(ped);
    });
  } else if (mode === 'rigs') {
    const frontRow = [
      { outfit: 'suit', player: true, profile: {}, held: 'pistol', speed: 0, opts: { aiming: true } },
      { outfit: 'tech', player: true, profile: {}, held: null, speed: 0, opts: { jackedIn: true } },
      { outfit: 'vip', player: false, profile: { id: 'vandermeer', role: 'vip', target: true }, speed: 0, opts: { state: 'idle', act: 'speech' } },
      { outfit: 'scientist', player: false, profile: { id: 'kessler', role: 'scientist', target: true, female: true }, speed: 0, opts: { state: 'idle', act: 'work' } },
      { outfit: 'guard', player: false, profile: { id: 'chief', role: 'guard', enforcerFor: 'guard' }, speed: 0, opts: { state: 'combat' } },
      { outfit: 'cook', player: false, profile: { id: 'chef', role: 'cook', enforcerFor: 'cook' }, speed: 0, opts: { state: 'idle', act: 'work' } },
    ];
    frontRow.forEach((spec, idx) => {
      const rig = createHumanoidRig(spec.outfit, spec.player, matLib, spec.profile);
      rig.group.position.set((idx - 2.5) * 1.32, 0, 1.05);
      if (spec.held) rig.setHeld(spec.held, false);
      if (spec.opts.jackedIn) rig.setVisorColor(COLORS.gold);
      scene.add(rig.group);
      view.chars.set(`front_${idx}`, rig);
      animatedRigs.push({ rig, speed: spec.speed, opts: spec.opts, anim: idx * 0.7 });
    });

    const backRow = [
      { outfit: 'scientist', profile: { id: 'sci_senior', enforcerFor: 'scientist', female: true }, speed: 0, opts: { state: 'idle', act: 'drink:coffee' } },
      { outfit: 'suit', profile: { id: 'guest1', female: true }, speed: 2.1, opts: { state: 'patrol' } },
      { outfit: 'suit', profile: { id: 'guest3', female: true }, speed: 0, opts: { state: 'idle', act: 'drink:wine' } },
      { outfit: 'waiter', profile: { id: 'waiter2', female: true }, speed: 2.2, opts: { state: 'patrol' } },
      { outfit: 'guard', profile: { id: 'guard_hall' }, speed: 2.5, opts: { state: 'patrol' } },
      { outfit: 'tech', profile: { id: 'tech1' }, speed: 0, opts: { state: 'sick' } },
    ];
    backRow.forEach((spec, idx) => {
      const rig = createHumanoidRig(spec.outfit, false, matLib, spec.profile);
      rig.group.position.set((idx - 2.5) * 1.32, 0, -1.05);
      scene.add(rig.group);
      view.chars.set(`back_${idx}`, rig);
      animatedRigs.push({ rig, speed: spec.speed, opts: spec.opts, anim: idx * 1.1 });
    });
  } else if (mode === 'units') {
    const b1 = createBotRig('maint', matLib);
    b1.group.position.set(-1.3, 0, 0);
    scene.add(b1.group);
    view.unitRigs.set('b1', b1);
    animatedBots.push({ rig: b1, moving: 3.0, hijacked: false, disabled: false, anim: 0 });

    const b2 = createBotRig('sec', matLib);
    b2.group.position.set(0.2, 0, 0);
    scene.add(b2.group);
    view.unitRigs.set('b2', b2);
    animatedBots.push({ rig: b2, moving: 3.4, hijacked: true, disabled: false, anim: 1.5 });

    const b3 = createBotRig('sec', matLib);
    b3.group.position.set(1.7, 0, 0);
    scene.add(b3.group);
    view.unitRigs.set('b3', b3);
    animatedBots.push({ rig: b3, moving: 0, hijacked: false, disabled: true, anim: 0 });
  } else {
    // mode === 'props'
    const sampleProps = [
      { kind: 'piano', x: -3.5, z: -1.8, w: 2.2, d: 1.5, h: 1.1 },
      { kind: 'table', x: -0.5, z: -1.8, r: 0.95, h: 0.78 },
      { kind: 'pod', x: 2.3, z: -1.8, r: 0.75, h: 2.3 },
      { kind: 'vent', x: 4.4, z: -1.8, w: 0.9, d: 0.5, h: 0.55 },
      { kind: 'sofa', x: -3.2, z: 1.6, w: 2.2, d: 1.1, h: 0.8 },
      { kind: 'terminal', x: -0.4, z: 1.6, w: 1.5, d: 1.1, h: 1.5 },
      { kind: 'fountain', x: 2.4, z: 1.6, r: 1.2, h: 1.2 },
      { kind: 'chandelier', x: 0, y: 3.2, z: 0, r: 1.3 },
    ];
    const refs = {};
    view.propRefs = refs;
    for (const sp of sampleProps) scene.add(buildPropMesh(sp, matLib, refs));
  }

  let yaw = 0.45, pitch = 0.36, radius = mode === 'units' ? 3.8 : 7.2;
  let dragging = false;
  canvas.addEventListener('mousedown', () => { dragging = true; });
  addEventListener('mouseup', () => { dragging = false; });
  addEventListener('mousemove', (e) => {
    if (!dragging) return;
    yaw -= (e.movementX || 0) * 0.006;
    pitch = Math.max(0.08, Math.min(1.25, pitch + (e.movementY || 0) * 0.005));
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = Math.max(2.0, Math.min(16, radius + Math.sign(e.deltaY) * 0.5));
  }, { passive: false });
  addEventListener('resize', () => view.resize());

  view.postfx.compile(scene, view.camera);

  let sceneMeshes = 0;
  scene.traverse((o) => { if (o.isMesh) sceneMeshes++; });

  let t = 0, last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    if (!dragging) yaw += dt * 0.22;

    view.renderer.info.reset();
    for (const item of animatedRigs) {
      item.rig.pose({ moving: item.speed, anim: item.anim || 0 }, t, item.opts);
    }
    for (const b of animatedBots) {
      b.rig.pose({ moving: b.moving, anim: b.anim }, t, { hijacked: b.hijacked, disabled: b.disabled });
    }

    view.camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * radius,
      Math.sin(pitch) * radius + 0.8,
      Math.cos(yaw) * Math.cos(pitch) * radius
    );
    view.camera.lookAt(0, 0.85, 0);
    view.updateSky(dt);
    view.postfx.render(scene, view.camera);

    window.__showReport = {
      mode,
      sceneMeshes,
      drawCalls: view.renderer.info.render.calls,
      shaderErrors: view.shaderErrors.slice(),
    };
    document.documentElement.dataset.showReport = JSON.stringify(window.__showReport);
  }
  requestAnimationFrame(loop);
  window.__game = { view, diag: () => view.getDiagnostics() };
}

function runBenchmark(durationSec, quality, canvas, createSim, stepSim, View, UI) {
  let sim = createSim({ seed: 2026 });
  const view = new View(canvas, sim, { quality });
  const ui = new UI(sim, view);
  view.setQuality(quality);
  addEventListener('resize', () => view.resize());

  const waypoints = [
    { x: 0, z: 4, yaw: 0, instinct: false },
    { x: 0, z: 4, yaw: 1.2, instinct: true },
    { x: 17.5, z: 2.0, yaw: -0.4, instinct: true },
    { x: -3.0, z: -14.5, yaw: 0.2, instinct: false },
    { x: 0, z: 19.0, yaw: 3.14, instinct: false },
  ];

  const frameTimes = [];
  let maxDrawCalls = 0;
  let maxActiveLights = 0;
  let elapsed = 0;
  let finished = false;
  let last = performance.now();
  let warmFrames = 0;

  window.__game = {
    get sim() { return sim; },
    view,
    ui,
    diag: () => view.getDiagnostics(),
  };

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return Number(sorted[idx].toFixed(2));
  }

  function stepFrame(now) {
    const dtMs = now - last;
    last = now;
    const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));

    if (!finished) {
      warmFrames++;
      if (warmFrames > 8) {
        frameTimes.push(dtMs);
        elapsed += dt;
      }

      const segIdx = Math.min(waypoints.length - 1, Math.floor((elapsed / durationSec) * waypoints.length));
      const wp = waypoints[segIdx];
      sim.player.x = wp.x;
      sim.player.z = wp.z;
      sim.player.yaw = wp.yaw;

      const input = {
        mx: 0, mz: 0,
        camYaw: wp.yaw + Math.sin(elapsed * 0.9) * 0.5,
        camPitch: 0.38,
        run: false, crouch: false, aim: false,
        instinct: wp.instinct,
      };
      stepSim(sim, 1 / 60, input);
      view.render(sim, dt, input);
      ui.update(dt);

      const d = view.getDiagnostics();
      if (warmFrames > 8) {
        if (d.drawCalls > maxDrawCalls) maxDrawCalls = d.drawCalls;
        if (d.activeLights > maxActiveLights) maxActiveLights = d.activeLights;
      }

      if (elapsed >= durationSec) {
        finished = true;
        // Verifica ausencia de fugas de memoria GPU a través de 3 reinicios attachSim()
        sim = createSim({ seed: 2027 });
        view.attachSim(sim);
        view.render(sim, 1 / 60, { camYaw: 0, camPitch: 0.4 });
        const before = view.getDiagnostics();

        for (let i = 0; i < 3; i++) {
          sim = createSim({ seed: 2028 + i });
          view.attachSim(sim);
          ui.sim = sim;
          view.render(sim, 1 / 60, { camYaw: 0, camPitch: 0.4 });
        }
        const after = view.getDiagnostics();
        const sorted = frameTimes.slice().sort((a, b) => a - b);

        window.__benchReport = {
          done: true,
          frames: sorted.length,
          p50Ms: percentile(sorted, 0.50),
          p95Ms: percentile(sorted, 0.95),
          p99Ms: percentile(sorted, 0.99),
          maxDrawCalls,
          activeLights: maxActiveLights,
          totalPointLightsInScene: after.totalPointLightsInScene,
          postfxEnabled: after.postfxEnabled,
          shaderErrors: after.shaderErrors,
          geometriesBefore: before.geometries,
          geometriesAfter: after.geometries,
          geometriesDelta: after.geometries - before.geometries,
          texturesBefore: before.textures,
          texturesAfter: after.textures,
          texturesDelta: after.textures - before.textures,
        };
        document.documentElement.dataset.benchReport = JSON.stringify(window.__benchReport);
        return;
      }
    }
    requestAnimationFrame(stepFrame);
  }
  requestAnimationFrame(stepFrame);
}
