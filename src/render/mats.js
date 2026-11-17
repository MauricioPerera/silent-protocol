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

export const SKY_U_OFFSET = 0.106; // Alinea el claro lunar (u=0.5) con moon.position (-28, 40, 22)

function makeSeamlessPanoCanvas(img) {
  const outW = 2048;
  const outH = 1024;
  const blendW = 192;
  const srcW = outW + blendW;

  const tmp = document.createElement('canvas');
  tmp.width = srcW;
  tmp.height = outH;
  const tg = tmp.getContext('2d', { willReadFrequently: true });
  tg.drawImage(img, 0, 0, srcW, outH);
  const src = tg.getImageData(0, 0, srcW, outH).data;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const og = out.getContext('2d');
  const outImg = og.createImageData(outW, outH);
  const dst = outImg.data;

  const keepW = outW - blendW;
  for (let y = 0; y < outH; y++) {
    const rowSrc = y * srcW * 4;
    const rowDst = y * outW * 4;
    for (let x = 0; x < keepW; x++) {
      const si = rowSrc + (x + blendW) * 4;
      const di = rowDst + x * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = 255;
    }
    for (let k = 0; k < blendW; k++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * k) / blendW);
      const siA = rowSrc + (outW + k) * 4;
      const siB = rowSrc + k * 4;
      const di = rowDst + (keepW + k) * 4;
      dst[di] = Math.round(src[siA] * (1 - w) + src[siB] * w);
      dst[di + 1] = Math.round(src[siA + 1] * (1 - w) + src[siB + 1] * w);
      dst[di + 2] = Math.round(src[siA + 2] * (1 - w) + src[siB + 2] * w);
      dst[di + 3] = 255;
    }
  }

  // Estabilización polar en cenit (y=0) y nadir (y=outH-1) para evitar pellizco esférico
  const avgRow = (ry) => {
    let r = 0, g = 0, b = 0;
    const base = ry * outW * 4;
    for (let x = 0; x < outW; x++) {
      const o = base + x * 4;
      r += dst[o]; g += dst[o + 1]; b += dst[o + 2];
    }
    return [r / outW, g / outW, b / outW];
  };
  const [zr, zg, zb] = avgRow(3);
  const zenithSpan = 34;
  for (let y = 0; y < zenithSpan; y++) {
    const t = Math.pow(1 - y / zenithSpan, 2);
    const base = y * outW * 4;
    for (let x = 0; x < outW; x++) {
      const o = base + x * 4;
      dst[o] = Math.round(dst[o] * (1 - t) + zr * t);
      dst[o + 1] = Math.round(dst[o + 1] * (1 - t) + zg * t);
      dst[o + 2] = Math.round(dst[o + 2] * (1 - t) + zb * t);
    }
  }
  const [nr, ng, nb] = avgRow(outH - 4);
  const nadirSpan = 46;
  for (let y = outH - nadirSpan; y < outH; y++) {
    const t = Math.pow((y - (outH - nadirSpan)) / (nadirSpan - 1), 2);
    const base = y * outW * 4;
    for (let x = 0; x < outW; x++) {
      const o = base + x * 4;
      dst[o] = Math.round(dst[o] * (1 - t) + nr * t);
      dst[o + 1] = Math.round(dst[o + 1] * (1 - t) + ng * t);
      dst[o + 2] = Math.round(dst[o + 2] * (1 - t) + nb * t);
    }
  }

  og.putImageData(outImg, 0, 0);
  return out;
}

function buildPmremEnvironment(renderer, panoTex = null, panoReady = false) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x09111e);

  const disposables = [];
  if (panoReady && panoTex) {
    const skyGeo = new THREE.SphereGeometry(28, 40, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uPano: { value: panoTex },
        uOffset: { value: SKY_U_OFFSET },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPano;
        uniform float uOffset;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float u = fract(atan(d.z, d.x) * 0.15915494 + uOffset);
          float v = clamp(asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5, 0.002, 0.998);
          vec3 c = texture2D(uPano, vec2(u, v)).rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float hdrBoost = 1.15 + pow(smoothstep(0.26, 0.92, lum), 2.0) * 5.2;
          gl_FragColor = vec4(c * hdrBoost, 1.0);
        }
      `,
    });
    envScene.add(new THREE.Mesh(skyGeo, skyMat));
    disposables.push(skyGeo, skyMat);
  }

  const panelScale = panoReady ? 0.52 : 1.0;
  const addPanel = (w, h, color, intensity, x, y, z, rx, ry) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity * panelScale),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    envScene.add(m);
    disposables.push(geo, mat);
  };

  if (!panoReady) {
    addPanel(16, 16, 0xffd2a0, 2.25, 0, 10, 0, Math.PI / 2, 0);
    addPanel(12, 6, 0x4fe3d0, 1.95, 12, 3, -6, 0, -Math.PI / 2);
    addPanel(12, 6, 0x7aa6ff, 1.65, -12, 4, 6, 0, Math.PI / 2);
    addPanel(14, 5, 0xffb36b, 1.55, 0, 2.5, 12, 0, Math.PI);
    addPanel(20, 20, 0x101826, 0.75, 0, -9, 0, -Math.PI / 2, 0);
  }

  const envRT = pmrem.fromScene(envScene, panoReady ? 0.015 : 0.04);
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
    for (const k of ARCHETYPES) {
      const s = sets[k];
      for (const t of [s.map, s.ormMap, s.normalMap]) {
        if (t.anisotropy !== nextAniso) {
          t.anisotropy = nextAniso;
          t.needsUpdate = true;
        }
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

  let hasPano = false;
  let skyTex;
  if (typeof document !== 'undefined') {
    const bootSky = document.createElement('canvas');
    bootSky.width = 4;
    bootSky.height = 2;
    const bg = bootSky.getContext('2d');
    bg.fillStyle = '#091324'; bg.fillRect(0, 0, 4, 1);
    bg.fillStyle = '#070f1c'; bg.fillRect(0, 1, 4, 1);
    skyTex = new THREE.CanvasTexture(bootSky);
  } else {
    skyTex = new THREE.DataTexture(new Uint8Array([9, 19, 36, 255, 7, 15, 28, 255]), 1, 2, THREE.RGBAFormat);
    skyTex.needsUpdate = true;
  }
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.wrapS = THREE.RepeatWrapping;
  skyTex.wrapT = THREE.ClampToEdgeWrapping;
  skyTex.minFilter = THREE.LinearFilter;
  skyTex.magFilter = THREE.LinearFilter;
  allTextures.push(skyTex);

  let envRT = buildPmremEnvironment(renderer, skyTex, false);
  let curEnvTex = envRT.texture;
  const envListeners = [];

  if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
    const panoImg = new Image();
    panoImg.decoding = 'async';
    panoImg.onload = () => {
      if (disposed) return;
      try {
        const seamless = makeSeamlessPanoCanvas(panoImg);
        skyTex.dispose();
        skyTex.source = new THREE.Source(seamless);
        skyTex.needsUpdate = true;
        hasPano = true;

        const nextEnvRT = buildPmremEnvironment(renderer, skyTex, true);
        const prevEnvRT = envRT;
        envRT = nextEnvRT;
        curEnvTex = nextEnvRT.texture;
        prevEnvRT.dispose();
        for (const fn of envListeners) fn(curEnvTex);
      } catch (_err) {
        // Mantiene entorno procedural si falla el canvas 2D
      }
    };
    panoImg.src = new URL('../../assets/sky/aurora_night_pano.jpg', import.meta.url).href;
  }

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

  const brushedSteel = pbr('brushed_steel', { nScale: 0.55, env: 1.62, extra: { color: 0xd4dde8 } });
  const paintedMetal = pbr('painted_metal', { nScale: 0.62, env: 1.18, extra: { color: 0x7c8796 } });
  const darkMetal = pbr('painted_metal', { useAlbedo: false, nScale: 0.55, env: 1.15, extra: { color: 0x232832, roughness: 0.52, metalness: 0.76 } });
  const gold = pbr('brushed_steel', { useAlbedo: false, nScale: 0.42, env: 1.72, extra: { color: 0xe2bc64, roughness: 0.27, metalness: 0.96 } });
  const wood = pbr('wood_parquet', { nScale: 0.68, env: 0.95, extra: { color: 0xa67754 } });
  const warmWood = pbr('wood_parquet', { nScale: 0.64, env: 1.02, extra: { color: 0x724930 } });
  const ceramic = pbr('ceramic_tile', { nScale: 0.68, env: 1.32, extra: { color: 0xd8e2ea } });
  const white = pbr('ceramic_tile', { useAlbedo: false, nScale: 0.35, env: 0.98, extra: { color: 0xe4e9ef, roughness: 0.36, metalness: 0.08 } });
  const concrete = pbr('concrete_service', { nScale: 0.78, env: 0.65, extra: { color: 0x8d95a0 } });
  const leather = pbr('leather_upholstery', { nScale: 0.75, env: 0.88, extra: { color: 0x6a3c48 } });
  const darkLeather = pbr('leather_upholstery', { useAlbedo: false, nScale: 0.68, env: 0.86, extra: { color: 0x262932, roughness: 0.55, metalness: 0.08 } });
  const fabric = pbr('fabric_suit', { nScale: 0.62, env: 0.56, extra: { color: 0x6e2a3c } });
  const green = pbr('turf_garden', { nScale: 0.82, env: 0.52, extra: { color: 0x6ca272 } });

  const glass = new THREE.MeshStandardMaterial({
    color: 0xaef0ff,
    roughness: 0.06,
    metalness: 0.30,
    envMapIntensity: 1.85,
    transparent: true,
    opacity: 0.36,
  });
  const water = new THREE.MeshStandardMaterial({
    color: 0x1b7696,
    normalMap: sets.plaster_wall.normalMap,
    normalScale: new THREE.Vector2(0.38, 0.38),
    roughness: 0.07,
    metalness: 0.42,
    envMapIntensity: 1.80,
    transparent: true,
    opacity: 0.84,
  });
  const ocean = new THREE.MeshStandardMaterial({
    color: 0x050f1c,
    normalMap: sets.plaster_wall.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.22,
    metalness: 0.82,
    envMapIntensity: 1.55,
  });

  const glowCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.cyan).multiplyScalar(1.6), toneMapped: false });
  const glowAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.amber).multiplyScalar(1.5), toneMapped: false });
  const glowRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.red).multiplyScalar(1.6), toneMapped: false });
  const glowGold = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.gold).multiplyScalar(1.45), toneMapped: false });
  const glowGreen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dffb0).multiplyScalar(1.5), toneMapped: false });
  const glowWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffdfa8).multiplyScalar(1.65), toneMapped: false });

  allMaterials.push(wallXray, trimOpaque, trimXray, glass, water, ocean, glowCyan, glowAmber, glowRed, glowGold, glowGreen, glowWarm);
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
    get envMap() { return curEnvTex; },
    get hasPano() { return hasPano; },
    skyTex,
    skyUOffset: SKY_U_OFFSET,
    onEnvUpdate(fn) {
      if (typeof fn === 'function') envListeners.push(fn);
    },
    archetypes: ARCHETYPES,
    sets,
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
    ocean,
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
