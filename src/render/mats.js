// ---------------------------------------------------------------------------
// Biblioteca de Materiales PBR (Three.js r160) + PMREM + Mejora asíncrona
// Arranque inmediato a 256x256 en <150 ms y subida sin bloqueos en Web Worker
// a 1024x1024 ('high') / 512x512 ('medium') usando operadores MaterialCraft.
// ---------------------------------------------------------------------------
import * as THREE from '../../vendor/three.module.js';
import { COLORS } from '../config.js';
import { ARCHETYPES, mcLevels, createBakeScratch, bakeArchetypeBuffers } from './mats_ops.js';

export { ARCHETYPES, mcLevels, createBakeScratch, bakeArchetypeBuffers };

function targetSizeForQuality(quality) {
  if (quality === 'high') return 1024;
  if (quality === 'medium') return 512;
  return 256;
}

function buildPmremEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x0b1220);

  const disposables = [];
  const addPanel = (w, h, color, intensity, x, y, z, rx, ry) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    envScene.add(m);
    disposables.push(geo, mat);
  };

  addPanel(16, 16, 0xffd2a0, 2.25, 0, 10, 0, Math.PI / 2, 0);
  addPanel(12, 6, 0x4fe3d0, 1.95, 12, 3, -6, 0, -Math.PI / 2);
  addPanel(12, 6, 0x7aa6ff, 1.65, -12, 4, 6, 0, Math.PI / 2);
  addPanel(14, 5, 0xffb36b, 1.55, 0, 2.5, 12, 0, Math.PI);
  addPanel(20, 20, 0x101826, 0.75, 0, -9, 0, -Math.PI / 2, 0);

  const envRT = pmrem.fromScene(envScene, 0.04);
  for (const d of disposables) d.dispose();
  pmrem.dispose();
  return envRT;
}

export function createMaterialLibrary(renderer, quality = 'high') {
  let curQuality = quality;
  let curSize = 256;
  let targetSize = targetSizeForQuality(quality);
  let inFlightSize = 0;
  let disposed = false;
  let activeJobId = 0;
  let worker = null;

  const maxAniso = (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function')
    ? Math.min(8, Math.max(1, renderer.capabilities.getMaxAnisotropy()))
    : 4;

  const anisoFor = (q) => (q === 'low' ? Math.min(2, maxAniso) : q === 'medium' ? Math.min(4, maxAniso) : maxAniso);

  const sets = {};
  const allTextures = [];
  const allMaterials = [];

  const makeTex = (buf, size, srgb, aniso) => {
    const t = new THREE.DataTexture(buf, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = aniso;
    t.needsUpdate = true;
    return t;
  };

  // 1. Arranque síncrono instantáneo a 256x256 (fotograma 1 completamente texturizado)
  const bootScratch = createBakeScratch(256);
  const initAniso = anisoFor(quality);
  for (const k of ARCHETYPES) {
    const b = bakeArchetypeBuffers(k, 256, bootScratch);
    const s = {
      map: makeTex(b.albedoBuf, 256, true, initAniso),
      ormMap: makeTex(b.ormBuf, 256, false, initAniso),
      normalMap: makeTex(b.normalBuf, 256, false, initAniso),
    };
    sets[k] = s;
    allTextures.push(s.map, s.ormMap, s.normalMap);
  }

  const swapTexInPlace = (tex, uint8Buf, size, aniso) => {
    tex.dispose();
    tex.anisotropy = aniso;
    tex.source = new THREE.Source({ data: uint8Buf, width: size, height: size });
    tex.needsUpdate = true;
  };

  function scheduleWorkerBake(desiredSize, q) {
    activeJobId++;
    const jobId = activeJobId;
    inFlightSize = 0;
    const nextAniso = anisoFor(q);
    for (const t of allTextures) {
      if (t.anisotropy !== nextAniso) {
        t.anisotropy = nextAniso;
        t.needsUpdate = true;
      }
    }

    if (desiredSize === curSize) return;

    if (typeof Worker !== 'undefined') {
      try {
        if (!worker) {
          worker = new Worker(new URL('./mats_worker.js', import.meta.url), { type: 'module' });
          worker.onmessage = (ev) => {
            if (disposed) return;
            const msg = ev.data;
            if (!msg || msg.jobId !== activeJobId) return;
            if (msg.done) {
              curSize = msg.size;
              inFlightSize = 0;
              return;
            }
            const s = sets[msg.kind];
            if (!s) return;
            if (curSize !== msg.size) curSize = 0;
            const aniso = anisoFor(curQuality);
            swapTexInPlace(s.map, new Uint8Array(msg.albedo), msg.size, aniso);
            swapTexInPlace(s.ormMap, new Uint8Array(msg.orm), msg.size, aniso);
            swapTexInPlace(s.normalMap, new Uint8Array(msg.normal), msg.size, aniso);
          };
          worker.onerror = () => {
            inFlightSize = 0;
            if (worker) { worker.terminate(); worker = null; }
          };
        }
        inFlightSize = desiredSize;
        worker.postMessage({ jobId, size: desiredSize });
        return;
      } catch (_err) {
        inFlightSize = 0;
        if (worker) { worker.terminate(); worker = null; }
      }
    }

    // Fallback síncrono si el entorno no soporta Module Workers
    const sc = createBakeScratch(desiredSize);
    for (const k of ARCHETYPES) {
      const b = bakeArchetypeBuffers(k, desiredSize, sc);
      const s = sets[k];
      swapTexInPlace(s.map, b.albedoBuf, desiredSize, nextAniso);
      swapTexInPlace(s.ormMap, b.ormBuf, desiredSize, nextAniso);
      swapTexInPlace(s.normalMap, b.normalBuf, desiredSize, nextAniso);
    }
    curSize = desiredSize;
    inFlightSize = 0;
  }

  if (targetSize > curSize) {
    scheduleWorkerBake(targetSize, quality);
  }

  const envRT = buildPmremEnvironment(renderer);

  const pbr = (setKey, opts = {}) => {
    const s = sets[setKey];
    const mat = new THREE.MeshStandardMaterial(Object.assign({
      map: opts.useAlbedo === false ? null : s.map,
      aoMap: s.ormMap,
      aoMapIntensity: opts.ao ?? 0.85,
      roughnessMap: s.ormMap,
      metalnessMap: s.ormMap,
      normalMap: s.normalMap,
      normalScale: new THREE.Vector2(opts.nScale ?? 0.72, opts.nScale ?? 0.72),
      roughness: opts.roughness ?? 1.0,
      metalness: opts.metalness ?? 1.0,
      envMapIntensity: opts.env ?? 0.95,
    }, opts.extra || {}));
    allMaterials.push(mat);
    return mat;
  };

  const wallOpaque = pbr('plaster_wall', {
    nScale: 0.62,
    env: 0.7,
    extra: { color: 0xbac6d8 },
  });
  const wallXray = new THREE.MeshStandardMaterial({
    color: 0x395064,
    roughness: 0.75,
    metalness: 0.1,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  const trimOpaque = new THREE.MeshBasicMaterial({ color: 0x388994 });
  const trimXray = new THREE.MeshBasicMaterial({ color: 0x4fe3d0, transparent: true, opacity: 0.48, depthWrite: false });

  const brushedSteel = pbr('brushed_steel', { nScale: 0.55, env: 1.3, extra: { color: 0xd4dde8 } });
  const paintedMetal = pbr('painted_metal', { nScale: 0.62, env: 1.0, extra: { color: 0x7c8796 } });
  const darkMetal = pbr('painted_metal', { useAlbedo: false, nScale: 0.55, env: 0.9, extra: { color: 0x232832, roughness: 0.56, metalness: 0.72 } });
  const gold = pbr('brushed_steel', { useAlbedo: false, nScale: 0.42, env: 1.45, extra: { color: 0xe2bc64, roughness: 0.30, metalness: 0.95 } });
  const wood = pbr('wood_parquet', { nScale: 0.68, env: 0.85, extra: { color: 0xa67754 } });
  const warmWood = pbr('wood_parquet', { nScale: 0.64, env: 0.92, extra: { color: 0x724930 } });
  const ceramic = pbr('ceramic_tile', { nScale: 0.68, env: 1.1, extra: { color: 0xd8e2ea } });
  const white = pbr('ceramic_tile', { useAlbedo: false, nScale: 0.35, env: 0.88, extra: { color: 0xe4e9ef, roughness: 0.38, metalness: 0.08 } });
  const concrete = pbr('concrete_service', { nScale: 0.78, env: 0.58, extra: { color: 0x8d95a0 } });
  const leather = pbr('leather_upholstery', { nScale: 0.75, env: 0.8, extra: { color: 0x6a3c48 } });
  const darkLeather = pbr('leather_upholstery', { useAlbedo: false, nScale: 0.68, env: 0.78, extra: { color: 0x262932, roughness: 0.55, metalness: 0.08 } });
  const fabric = pbr('fabric_suit', { nScale: 0.62, env: 0.52, extra: { color: 0x6e2a3c } });
  const green = pbr('turf_garden', { nScale: 0.82, env: 0.48, extra: { color: 0x6ca272 } });

  const glass = new THREE.MeshStandardMaterial({
    color: 0xaef0ff,
    roughness: 0.08,
    metalness: 0.25,
    envMapIntensity: 1.5,
    transparent: true,
    opacity: 0.36,
  });
  const water = new THREE.MeshStandardMaterial({
    color: 0x1b7696,
    normalMap: sets.plaster_wall.normalMap,
    normalScale: new THREE.Vector2(0.38, 0.38),
    roughness: 0.08,
    metalness: 0.35,
    envMapIntensity: 1.45,
    transparent: true,
    opacity: 0.84,
  });

  const glowCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.cyan).multiplyScalar(1.6), toneMapped: false });
  const glowAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.amber).multiplyScalar(1.5), toneMapped: false });
  const glowRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.red).multiplyScalar(1.6), toneMapped: false });
  const glowGold = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.gold).multiplyScalar(1.45), toneMapped: false });
  const glowGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dffb0).multiplyScalar(1.5), toneMapped: false });
  const glowWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffdfa8).multiplyScalar(1.65), toneMapped: false });

  allMaterials.push(wallXray, trimOpaque, trimXray, glass, water, glowCyan, glowAmber, glowRed, glowGold, glowGreen, glowWarm);
  const sharedSet = new Set(allMaterials);

  function makeZoneFloorMaterial(zone) {
    const kindMap = {
      hall: 'wood_parquet',
      office: 'wood_parquet',
      kitchen: 'ceramic_tile',
      lab: 'ceramic_tile',
      security: 'ceramic_tile',
      backstage: 'concrete_service',
      storage: 'concrete_service',
      patio: 'turf_garden',
    };
    const key = kindMap[zone.id] || 'concrete_service';
    const s = sets[key];
    const tint = new THREE.Color(zone.floor).lerp(new THREE.Color(0xffffff), key === 'ceramic_tile' ? 0.45 : 0.55);
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      map: s.map,
      aoMap: s.ormMap,
      aoMapIntensity: 0.9,
      roughnessMap: s.ormMap,
      metalnessMap: s.ormMap,
      normalMap: s.normalMap,
      normalScale: new THREE.Vector2(0.82, 0.82),
      roughness: 1.0,
      metalness: 1.0,
      envMapIntensity: zone.outdoor ? 0.58 : 1.0,
    });
    allMaterials.push(mat);
    sharedSet.add(mat);
    return mat;
  }

  function makeCharacterMaterials(isAndroid = false) {
    const suitSet = sets.fabric_suit;
    const steelSet = sets.brushed_steel;
    const leatherSet = sets.leather_upholstery;

    const cloth = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: suitSet.map,
      aoMap: suitSet.ormMap,
      aoMapIntensity: 0.72,
      roughnessMap: suitSet.ormMap,
      normalMap: suitSet.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.88,
      metalness: 0.05,
      envMapIntensity: 0.68,
    });
    const accent = cloth;
    const skin = new THREE.MeshStandardMaterial({
      color: isAndroid ? 0xcfd8e2 : 0xffffff,
      vertexColors: !isAndroid,
      aoMap: isAndroid ? steelSet.ormMap : leatherSet.ormMap,
      aoMapIntensity: isAndroid ? 0.65 : 0.35,
      roughnessMap: isAndroid ? steelSet.ormMap : null,
      normalMap: isAndroid ? steelSet.normalMap : leatherSet.normalMap,
      normalScale: new THREE.Vector2(isAndroid ? 0.38 : 0.16, isAndroid ? 0.38 : 0.16),
      roughness: isAndroid ? 0.85 : 0.68,
      metalness: isAndroid ? 0.88 : 0.02,
      envMapIntensity: isAndroid ? 1.3 : 0.55,
    });
    const vestMat = new THREE.MeshStandardMaterial({
      color: 0x2b3a4a,
      aoMap: leatherSet.ormMap,
      aoMapIntensity: 0.65,
      roughnessMap: leatherSet.ormMap,
      normalMap: leatherSet.normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.85,
      metalness: 0.18,
    });
    const hairMat = skin;
    const visor = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLORS.cyan).multiplyScalar(1.8),
      toneMapped: false,
    });
    const owned = [cloth, skin, vestMat, visor];
    return {
      cloth,
      accent,
      skin,
      vestMat,
      hairMat,
      visor,
      dispose() {
        for (const m of owned) m.dispose();
      },
    };
  }

  function setQuality(nextQuality) {
    if (disposed) return;
    const nextTarget = targetSizeForQuality(nextQuality);
    const sameQuality = nextQuality === curQuality && (curSize === nextTarget || inFlightSize === nextTarget);
    curQuality = nextQuality;
    targetSize = nextTarget;
    if (sameQuality) return;
    scheduleWorkerBake(nextTarget, nextQuality);
  }

  return {
    get quality() { return curQuality; },
    get size() { return curSize; },
    get targetSize() { return targetSize; },
    archetypes: ARCHETYPES,
    sets,
    envMap: envRT.texture,
    sharedSet,
    wallOpaque,
    wallXray,
    trimOpaque,
    trimXray,
    brushedSteel,
    paintedMetal,
    darkMetal,
    gold,
    wood,
    warmWood,
    ceramic,
    white,
    concrete,
    leather,
    darkLeather,
    fabric,
    green,
    glass,
    water,
    glowCyan,
    glowAmber,
    glowRed,
    glowGold,
    glowGreen,
    glowWarm,
    makeZoneFloorMaterial,
    makeCharacterMaterials,
    setQuality,
    dispose() {
      disposed = true;
      activeJobId++;
      if (worker) {
        worker.terminate();
        worker = null;
      }
      for (const m of allMaterials) m.dispose();
      for (const t of allTextures) t.dispose();
      envRT.dispose();
    },
  };
}
