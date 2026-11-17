// ---------------------------------------------------------------------------
// Síntesis determinista de materiales PBR (Albedo, ORM, Normal) + PMREM (r160)
// ---------------------------------------------------------------------------
import * as THREE from '../../vendor/three.module.js';
import { COLORS } from '../config.js';

function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoiseTile(u, v, period, seed) {
  const x = u * period, y = v * period;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const ix0 = ((x0 % period) + period) % period;
  const iy0 = ((y0 % period) + period) % period;
  const ix1 = (ix0 + 1) % period;
  const iy1 = (iy0 + 1) % period;
  const n00 = hash2(ix0, iy0, seed);
  const n10 = hash2(ix1, iy0, seed);
  const n01 = hash2(ix0, iy1, seed);
  const n11 = hash2(ix1, iy1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function fbmTile(u, v, basePeriod, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0, p = basePeriod;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoiseTile(u, v, p, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

function voronoiTile(u, v, cells, seed) {
  const gx = u * cells, gy = v * cells;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  let minD = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ((ix + dx) % cells + cells) % cells;
      const cy = ((iy + dy) % cells + cells) % cells;
      const px = ix + dx + hash2(cx, cy, seed) * 0.8 + 0.1;
      const py = iy + dy + hash2(cx, cy, seed + 31) * 0.8 + 0.1;
      const d = Math.hypot(gx - px, gy - py);
      if (d < minD) minD = d;
    }
  }
  return Math.min(1, minD);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function buildPbrMaps(kind, size) {
  const nPx = size * size;
  const albedo = new Uint8Array(nPx * 4);
  const orm = new Uint8Array(nPx * 4);
  const normal = new Uint8Array(nPx * 4);
  const height = new Float32Array(nPx);
  let normalStrength = 2.4;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      let r = 0.5, g = 0.5, b = 0.5;
      let ao = 1.0, rough = 0.6, metal = 0.0, h = 0.5;

      if (kind === 'wood_parquet') {
        normalStrength = 2.8;
        const planksY = 6;
        const row = Math.floor(v * planksY);
        const uShift = (u + (row % 2) * 0.5) % 1;
        const planksX = 2;
        const lu = (uShift * planksX) % 1;
        const lv = (v * planksY) % 1;
        const seam = Math.min(lu, 1 - lu) * planksX < 0.025 || Math.min(lv, 1 - lv) < 0.04;
        const grain = fbmTile(uShift * 0.5, v * 8, 8, 3, 11 + row * 7);
        const ring = Math.sin((uShift * 14 + grain * 3.5) * Math.PI * 2) * 0.5 + 0.5;
        const plankTone = 0.86 + hash2(row, Math.floor(uShift * planksX), 53) * 0.24;
        const tone = (0.30 + grain * 0.12 + ring * 0.06) * plankTone;
        r = tone * 1.18; g = tone * 0.78; b = tone * 0.52;
        if (seam) {
          r *= 0.35; g *= 0.35; b *= 0.35;
          ao = 0.42; rough = 0.86; h = 0.12;
        } else {
          ao = 0.92 + grain * 0.08;
          rough = 0.34 + (1 - ring) * 0.16;
          h = 0.55 + ring * 0.12 + grain * 0.1;
        }
      } else if (kind === 'ceramic_tile') {
        normalStrength = 3.0;
        const tiles = 4;
        const lu = (u * tiles) % 1;
        const lv = (v * tiles) % 1;
        const edge = Math.min(lu, 1 - lu, lv, 1 - lv);
        const grout = edge < 0.032;
        const bevel = edge < 0.065 ? (edge - 0.032) / 0.033 : 1;
        const vein = fbmTile(u, v, 6, 4, 101);
        const streak = Math.pow(Math.abs(Math.sin((u + v * 0.7 + vein * 0.55) * Math.PI * 3)), 6);
        if (grout) {
          r = 0.13; g = 0.15; b = 0.18;
          ao = 0.38; rough = 0.92; metal = 0.0; h = 0.08;
        } else {
          const base = 0.24 + vein * 0.08 + streak * 0.12;
          r = base * 0.92; g = base * 1.02; b = base * 1.10;
          ao = 0.78 + 0.22 * bevel;
          rough = 0.18 + vein * 0.14;
          metal = 0.06;
          h = 0.45 + 0.45 * bevel + vein * 0.05;
        }
      } else if (kind === 'concrete_service') {
        normalStrength = 2.6;
        const n1 = fbmTile(u, v, 8, 4, 211);
        const pits = valueNoiseTile(u, v, 32, 223);
        const joint = Math.min(u, 1 - u, v, 1 - v) < 0.014;
        const base = 0.22 + n1 * 0.12 - (pits > 0.82 ? 0.06 : 0);
        r = base * 0.96; g = base * 1.0; b = base * 1.08;
        ao = joint ? 0.45 : (0.82 + n1 * 0.18 - (pits > 0.82 ? 0.2 : 0));
        rough = joint ? 0.95 : (0.74 + (1 - n1) * 0.18);
        metal = 0.03;
        h = joint ? 0.15 : (0.45 + n1 * 0.35 - (pits > 0.82 ? 0.2 : 0));
      } else if (kind === 'plaster_wall') {
        normalStrength = 1.9;
        const n1 = fbmTile(u, v, 10, 3, 307);
        const micro = valueNoiseTile(u, v, 48, 313);
        const panel = Math.min((u * 2) % 1, 1 - ((u * 2) % 1)) < 0.012;
        const base = 0.30 + n1 * 0.07 + micro * 0.03;
        r = base * 0.90; g = base * 0.98; b = base * 1.12;
        ao = panel ? 0.62 : (0.90 + n1 * 0.1);
        rough = 0.68 + (1 - n1) * 0.16;
        metal = 0.04;
        h = panel ? 0.28 : (0.5 + n1 * 0.22 + micro * 0.12);
      } else if (kind === 'brushed_steel') {
        normalStrength = 1.8;
        const brush = valueNoiseTile(u * 0.25, v, 64, 401) * 0.7 + valueNoiseTile(u, v, 16, 409) * 0.3;
        const base = 0.62 + brush * 0.18;
        r = base * 0.95; g = base * 0.99; b = base * 1.05;
        ao = 0.92 + brush * 0.08;
        rough = 0.22 + (1 - brush) * 0.16;
        metal = 0.90;
        h = 0.45 + brush * 0.3;
      } else if (kind === 'painted_metal') {
        normalStrength = 1.7;
        const peel = fbmTile(u, v, 20, 3, 503);
        const rivet = Math.min((u * 4) % 1, 1 - ((u * 4) % 1)) < 0.02;
        const base = 0.28 + peel * 0.08;
        r = base * 0.94; g = base * 1.0; b = base * 1.08;
        ao = rivet ? 0.58 : 0.94;
        rough = 0.34 + peel * 0.18;
        metal = 0.58;
        h = rivet ? 0.25 : (0.5 + peel * 0.22);
      } else if (kind === 'fabric_suit') {
        normalStrength = 2.2;
        const wx = (x + y) & 3;
        const wy = (x - y + size) & 3;
        const twill = ((wx < 2 ? 1 : 0) ^ (wy < 1 ? 1 : 0)) ? 0.06 : -0.04;
        const fold = fbmTile(u, v, 6, 3, 601);
        const base = 0.74 + fold * 0.14 + twill;
        r = base; g = base; b = base * 1.02;
        ao = 0.84 + twill * 1.2 + fold * 0.1;
        rough = 0.76 - twill * 0.4;
        metal = 0.02;
        h = 0.5 + twill * 2.2 + fold * 0.2;
      } else if (kind === 'leather_upholstery') {
        normalStrength = 2.5;
        const cell = voronoiTile(u, v, 22, 701);
        const macro = fbmTile(u, v, 6, 2, 709);
        const dome = clamp01(1 - cell * 0.95);
        const base = 0.52 + dome * 0.18 + macro * 0.08;
        r = base * 1.05; g = base * 0.92; b = base * 0.90;
        ao = 0.70 + dome * 0.30;
        rough = 0.40 + (1 - dome) * 0.24;
        metal = 0.05;
        h = 0.35 + dome * 0.45 + macro * 0.1;
      } else if (kind === 'turf_garden') {
        normalStrength = 3.2;
        const blades = valueNoiseTile(u, v, 48, 809);
        const patch = fbmTile(u, v, 6, 3, 821);
        r = 0.12 + patch * 0.07 + blades * 0.05;
        g = 0.24 + patch * 0.13 + blades * 0.10;
        b = 0.16 + patch * 0.06 + blades * 0.04;
        ao = 0.62 + blades * 0.36;
        rough = 0.82 + (1 - blades) * 0.14;
        metal = 0.0;
        h = 0.25 + blades * 0.65 + patch * 0.1;
      }

      const o4 = idx * 4;
      albedo[o4] = Math.round(clamp01(r) * 255);
      albedo[o4 + 1] = Math.round(clamp01(g) * 255);
      albedo[o4 + 2] = Math.round(clamp01(b) * 255);
      albedo[o4 + 3] = 255;

      orm[o4] = Math.round(clamp01(ao) * 255);
      orm[o4 + 1] = Math.round(clamp01(rough) * 255);
      orm[o4 + 2] = Math.round(clamp01(metal) * 255);
      orm[o4 + 3] = 255;

      height[idx] = h;
    }
  }

  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1) & mask) * size;
    const yp = ((y + 1) & mask) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1) & mask;
      const xp = (x + 1) & mask;
      const dx = (height[yc + xp] - height[yc + xm]) * normalStrength;
      const dy = (height[yp + x] - height[ym + x]) * normalStrength;
      const nx = -dx, ny = -dy, nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const o4 = (yc + x) * 4;
      normal[o4] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      normal[o4 + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      normal[o4 + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      normal[o4 + 3] = 255;
    }
  }

  const makeTex = (buf, srgb) => {
    const t = new THREE.DataTexture(buf, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };

  return {
    map: makeTex(albedo, true),
    ormMap: makeTex(orm, false),
    normalMap: makeTex(normal, false),
  };
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

  // Cielo nocturno + paneles cálidos de salón + acento cian de laboratorio
  addPanel(16, 16, 0xffd2a0, 2.2, 0, 10, 0, Math.PI / 2, 0);
  addPanel(12, 6, 0x4fe3d0, 1.9, 12, 3, -6, 0, -Math.PI / 2);
  addPanel(12, 6, 0x7aa6ff, 1.6, -12, 4, 6, 0, Math.PI / 2);
  addPanel(14, 5, 0xffb36b, 1.5, 0, 2.5, 12, 0, Math.PI);
  addPanel(20, 20, 0x101826, 0.7, 0, -9, 0, -Math.PI / 2, 0);

  const envRT = pmrem.fromScene(envScene, 0.04);
  for (const d of disposables) d.dispose();
  pmrem.dispose();
  return envRT;
}

export const ARCHETYPES = [
  'wood_parquet',
  'ceramic_tile',
  'concrete_service',
  'plaster_wall',
  'brushed_steel',
  'painted_metal',
  'fabric_suit',
  'leather_upholstery',
  'turf_garden',
];

export function createMaterialLibrary(renderer, quality = 'high') {
  const size = quality === 'low' ? 256 : 512;
  const sets = {};
  const allTextures = [];
  const allMaterials = [];

  for (const k of ARCHETYPES) {
    const s = buildPbrMaps(k, size);
    sets[k] = s;
    allTextures.push(s.map, s.ormMap, s.normalMap);
  }

  const envRT = buildPmremEnvironment(renderer);

  const pbr = (setKey, opts = {}) => {
    const s = sets[setKey];
    const mat = new THREE.MeshStandardMaterial(Object.assign({
      map: opts.useAlbedo === false ? null : s.map,
      aoMap: s.ormMap,
      aoMapIntensity: opts.ao ?? 0.75,
      roughnessMap: s.ormMap,
      metalnessMap: s.ormMap,
      normalMap: s.normalMap,
      normalScale: new THREE.Vector2(opts.nScale ?? 0.65, opts.nScale ?? 0.65),
      roughness: opts.roughness ?? 1.0,
      metalness: opts.metalness ?? 1.0,
      envMapIntensity: opts.env ?? 0.9,
    }, opts.extra || {}));
    allMaterials.push(mat);
    return mat;
  };

  const wallOpaque = pbr('plaster_wall', {
    nScale: 0.55,
    env: 0.65,
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

  const brushedSteel = pbr('brushed_steel', { nScale: 0.45, env: 1.25, extra: { color: 0xd4dde8 } });
  const paintedMetal = pbr('painted_metal', { nScale: 0.5, env: 0.95, extra: { color: 0x7c8796 } });
  const darkMetal = pbr('painted_metal', { useAlbedo: false, nScale: 0.45, env: 0.85, extra: { color: 0x232832, roughness: 0.52, metalness: 0.65 } });
  const gold = pbr('brushed_steel', { useAlbedo: false, nScale: 0.35, env: 1.4, extra: { color: 0xe2bc64, roughness: 0.28, metalness: 0.94 } });
  const wood = pbr('wood_parquet', { nScale: 0.6, env: 0.8, extra: { color: 0x9c6e4c } });
  const warmWood = pbr('wood_parquet', { nScale: 0.55, env: 0.9, extra: { color: 0x69422b } });
  const ceramic = pbr('ceramic_tile', { nScale: 0.6, env: 1.05, extra: { color: 0xd8e2ea } });
  const white = pbr('ceramic_tile', { useAlbedo: false, nScale: 0.3, env: 0.85, extra: { color: 0xe4e9ef, roughness: 0.38, metalness: 0.08 } });
  const concrete = pbr('concrete_service', { nScale: 0.7, env: 0.55, extra: { color: 0x8d95a0 } });
  const leather = pbr('leather_upholstery', { nScale: 0.7, env: 0.75, extra: { color: 0x6a3c48 } });
  const darkLeather = pbr('leather_upholstery', { useAlbedo: false, nScale: 0.65, env: 0.75, extra: { color: 0x262932, roughness: 0.52, metalness: 0.08 } });
  const fabric = pbr('fabric_suit', { nScale: 0.55, env: 0.5, extra: { color: 0x6e2a3c } });
  const green = pbr('turf_garden', { nScale: 0.75, env: 0.45, extra: { color: 0x689e6e } });

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
    normalScale: new THREE.Vector2(0.35, 0.35),
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
    const tint = new THREE.Color(zone.floor).lerp(new THREE.Color(0xffffff), key === 'ceramic_tile' ? 0.42 : 0.52);
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      map: s.map,
      aoMap: s.ormMap,
      aoMapIntensity: 0.85,
      roughnessMap: s.ormMap,
      metalnessMap: s.ormMap,
      normalMap: s.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 1.0,
      metalness: 1.0,
      envMapIntensity: zone.outdoor ? 0.55 : 0.95,
    });
    allMaterials.push(mat);
    return mat;
  }

  // Instancias ligeras por personaje respaldadas por las DataTexture compartidas
  function makeCharacterMaterials(isAndroid = false) {
    const suitSet = sets.fabric_suit;
    const steelSet = sets.brushed_steel;
    const leatherSet = sets.leather_upholstery;

    const cloth = new THREE.MeshStandardMaterial({
      color: 0x222833,
      map: suitSet.map,
      aoMap: suitSet.ormMap,
      aoMapIntensity: 0.65,
      roughnessMap: suitSet.ormMap,
      normalMap: suitSet.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.88,
      metalness: 0.05,
      envMapIntensity: 0.65,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x8899aa,
      map: suitSet.map,
      normalMap: suitSet.normalMap,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.58,
      metalness: 0.16,
      envMapIntensity: 0.8,
    });
    const skin = new THREE.MeshStandardMaterial({
      color: isAndroid ? 0xcfd8e2 : 0xd7b49a,
      normalMap: isAndroid ? steelSet.normalMap : leatherSet.normalMap,
      normalScale: new THREE.Vector2(isAndroid ? 0.3 : 0.15, isAndroid ? 0.3 : 0.15),
      roughness: isAndroid ? 0.28 : 0.68,
      metalness: isAndroid ? 0.86 : 0.02,
      envMapIntensity: isAndroid ? 1.25 : 0.55,
    });
    const vestMat = new THREE.MeshStandardMaterial({
      color: 0x2b3a4a,
      normalMap: leatherSet.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.55,
      metalness: 0.18,
    });
    const visor = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLORS.cyan).multiplyScalar(1.8),
      toneMapped: false,
    });
    const owned = [cloth, accent, skin, vestMat, visor];
    return {
      cloth,
      accent,
      skin,
      vestMat,
      visor,
      dispose() {
        for (const m of owned) m.dispose();
      },
    };
  }

  const sharedSet = new Set(allMaterials);

  return {
    quality,
    size,
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
    dispose() {
      for (const m of allMaterials) m.dispose();
      for (const t of allTextures) t.dispose();
      envRT.dispose();
    },
  };
}
