// ---------------------------------------------------------------------------
// Mobiliario procedural PBR, conductos VENTS, conos de luz y fusión estática
// ---------------------------------------------------------------------------
import * as THREE from '../../vendor/three.module.js';
import { COLORS } from '../config.js';

export function scaleGeometryUVs(geo, uScale, vScale) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
  }
  uv.needsUpdate = true;
  return geo;
}

export function scaleBoxUVs(geo, w, h, d, tile = 2.8) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (!pos || !nrm || !uv) return geo;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const x = pos.getX(i) + w * 0.5;
    const y = pos.getY(i) + h * 0.5;
    const z = pos.getZ(i) + d * 0.5;
    if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

export function mergeBufferGeometries(geos) {
  if (!geos.length) return null;
  const converted = [];
  let totalVerts = 0;

  for (const src of geos) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    const count = g.attributes.position.count;
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    converted.push(g);
    totalVerts += count;
  }

  const hasColor = converted.some((g) => !!g.attributes.color);
  const posOut = new Float32Array(totalVerts * 3);
  const nrmOut = new Float32Array(totalVerts * 3);
  const uvOut = new Float32Array(totalVerts * 2);
  const colOut = hasColor ? new Float32Array(totalVerts * 3) : null;
  let vOffset = 0;

  for (const g of converted) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    const c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const i3 = (vOffset + i) * 3;
      const i2 = (vOffset + i) * 2;
      posOut[i3] = p.getX(i);
      posOut[i3 + 1] = p.getY(i);
      posOut[i3 + 2] = p.getZ(i);
      nrmOut[i3] = n.getX(i);
      nrmOut[i3 + 1] = n.getY(i);
      nrmOut[i3 + 2] = n.getZ(i);
      uvOut[i2] = u.getX(i);
      uvOut[i2 + 1] = u.getY(i);
      if (colOut) {
        colOut[i3] = c ? c.getX(i) : 1;
        colOut[i3 + 1] = c ? c.getY(i) : 1;
        colOut[i3 + 2] = c ? c.getZ(i) : 1;
      }
    }
    vOffset += p.count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nrmOut, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvOut, 2));
  if (colOut) merged.setAttribute('color', new THREE.BufferAttribute(colOut, 3));
  merged.computeBoundingSphere();
  return merged;
}

function hasDynamicFlag(obj, stopAt) {
  let cur = obj;
  while (cur) {
    if (cur.userData && cur.userData.dynamic) return true;
    if (cur === stopAt) break;
    cur = cur.parent;
  }
  return false;
}

export function mergeStaticMeshes(roots) {
  const buckets = new Map();
  const toRemove = [];
  const matKeys = new Map();
  let nextMatId = 1;

  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.material) return;
      if (Array.isArray(o.material)) return;
      if (o.material.transparent) return;
      if (hasDynamicFlag(o, root)) return;

      let mid = matKeys.get(o.material);
      if (!mid) { mid = nextMatId++; matKeys.set(o.material, mid); }
      const key = `${mid}_${o.castShadow ? 1 : 0}_${o.receiveShadow ? 1 : 0}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material: o.material, castShadow: !!o.castShadow, receiveShadow: !!o.receiveShadow, geos: [] };
        buckets.set(key, bucket);
      }
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      bucket.geos.push(g);
      toRemove.push(o);
    });
  }

  for (const m of toRemove) {
    if (m.parent) m.parent.remove(m);
    m.geometry.dispose();
  }

  const mergedMeshes = [];
  for (const [, bucket] of buckets) {
    const geo = mergeBufferGeometries(bucket.geos);
    for (const g of bucket.geos) g.dispose();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mergedMeshes.push(mesh);
  }

  return {
    meshes: mergedMeshes,
    dispose() {
      for (const m of mergedMeshes) m.geometry.dispose();
    },
  };
}

const CONE_VERT = /* glsl */ `
  varying float vY;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vY = uv.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CONE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vY;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float fresnel = pow(max(0.0, abs(dot(vNormalW, vViewDir))), 1.5);
    float vert = smoothstep(0.0, 0.85, vY) * (1.0 - smoothstep(0.88, 1.0, vY));
    float a = fresnel * vert * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export function buildLightCone(light, matLib) {
  const group = new THREE.Group();
  group.position.set(light.x, light.y, light.z);

  // Luminaria de techo (candidata a fusión estática)
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.09, 14), matLib.darkMetal);
  housing.castShadow = false;
  group.add(housing);

  const bulbMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(light.color).multiplyScalar(1.6),
    toneMapped: false,
  });
  const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12), bulbMat);
  bulb.position.y = -0.04;
  bulb.userData.dynamic = true;
  group.add(bulb);

  const coneH = Math.max(1.8, light.y - 0.1);
  const coneR = Math.min(3.1, light.dist * 0.19);
  const coneGeo = new THREE.CylinderGeometry(0.16, coneR, coneH, 16, 1, true);
  const coneMat = new THREE.ShaderMaterial({
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(light.color) },
      uOpacity: { value: 0.085 },
    },
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.y = -coneH * 0.5 - 0.03;
  cone.renderOrder = 3;
  cone.userData.dynamic = true;
  group.add(cone);

  return {
    group,
    cone,
    setFactor(f) {
      cone.visible = f > 0.05;
      coneMat.uniforms.uOpacity.value = 0.085 * f;
      bulb.visible = f > 0.02;
    },
    dispose() {
      if (housing.parent) housing.geometry.dispose();
      bulb.geometry.dispose();
      bulbMat.dispose();
      coneGeo.dispose();
      coneMat.dispose();
    },
  };
}

function mBox(w, h, d, mat, x = 0, y = 0, z = 0, shadow = true) {
  const geo = scaleBoxUVs(new THREE.BoxGeometry(w, h, d), w, h, d, 2.2);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function mCyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 14, shadow = true) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function mLathe(pts, mat, x = 0, y = 0, z = 0, seg = 16, shadow = true) {
  const v2 = pts.map(([r, py]) => new THREE.Vector2(r, py));
  const m = new THREE.Mesh(new THREE.LatheGeometry(v2, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export function buildPropMesh(p, matLib, refs = {}) {
  const g = new THREE.Group();
  g.position.set(p.x, p.y || 0, p.z);
  if (p.rot) g.rotation.y = p.rot;
  const w = p.w || 1, d = p.d || 1, h = p.h || 1, r = p.r || 0.5;
  const M = matLib;

  switch (p.kind) {
    case 'rug': {
      const geo = scaleGeometryUVs(new THREE.PlaneGeometry(w, d), w / 3, d / 3);
      const m = new THREE.Mesh(geo, M.fabric);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.012;
      m.castShadow = false;
      m.receiveShadow = true;
      g.add(m);
      break;
    }
    case 'table': {
      g.add(mLathe([[0, 0], [0.46, 0], [0.42, 0.05], [0.10, 0.12], [0.08, h - 0.08], [0.35, h - 0.04], [r, h - 0.02], [r, h + 0.04], [0, h + 0.04]], M.white, 0, 0, 0, 18));
      g.add(mCyl(r + 0.015, r + 0.015, 0.03, M.gold, 0, h + 0.01, 0, 18, false));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        g.add(mCyl(0.055, 0.04, 0.16, M.glass, Math.cos(a) * r * 0.52, h + 0.12, Math.sin(a) * r * 0.52, 10, false));
      }
      g.add(mCyl(0.08, 0.11, 0.18, M.gold, 0, h + 0.13, 0, 12, false));
      break;
    }
    case 'chair': {
      g.add(mBox(0.46, 0.07, 0.46, M.leather, 0, 0.45, 0, false));
      g.add(mBox(0.44, 0.48, 0.07, M.leather, 0, 0.70, -0.20, false));
      for (const [sx, sz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
        g.add(mCyl(0.025, 0.02, 0.45, M.darkMetal, sx, 0.225, sz, 8, false));
      }
      break;
    }
    case 'bar': {
      g.add(mBox(w, h - 0.08, d, M.warmWood, 0, (h - 0.08) / 2, 0));
      g.add(mBox(w + 0.18, 0.09, d + 0.18, M.ceramic, 0, h - 0.02, 0));
      g.add(mBox(w + 0.03, 0.035, d + 0.03, M.glowAmber, 0, 0.14, 0, false));
      g.add(mCyl(0.03, 0.03, d - 0.2, M.gold, w * 0.5 + 0.12, 0.22, 0, 10, false)).rotation.x = Math.PI / 2;
      for (let i = 0; i < 6; i++) g.add(mCyl(0.055, 0.045, 0.26, M.glass, 0, h + 0.16, -d / 2 + 0.5 + i * 0.9, 10, false));
      break;
    }
    case 'barback': {
      g.add(mBox(w, h, d, M.warmWood, 0, h / 2, 0));
      for (const sy of [0.85, 1.35, 1.85]) g.add(mBox(w + 0.08, 0.04, d - 0.1, M.gold, 0.04, sy, 0, false));
      for (let i = 0; i < 8; i++) {
        const bMat = i % 2 === 0 ? M.glass : M.gold;
        g.add(mCyl(0.04, 0.055, 0.28, bMat, 0.08, 1.02 + (i % 2) * 0.5, -d / 2 + 0.45 + i * 0.7, 10, false));
      }
      break;
    }
    case 'podium': {
      g.add(mBox(w * 0.86, h - 0.08, d * 0.86, M.warmWood, 0, (h - 0.08) / 2, 0));
      const top = mBox(w + 0.08, 0.08, d + 0.12, M.wood, 0, h, 0);
      top.rotation.x = 0.14;
      g.add(top);
      g.add(mBox(w * 0.5, 0.28, 0.03, M.gold, 0, h * 0.68, d * 0.44, false));
      g.add(mCyl(0.015, 0.02, 0.38, M.brushedSteel, 0.26, h + 0.20, 0.08, 8, false));
      break;
    }
    case 'buffet': {
      g.add(mBox(w, h - 0.06, d, M.wood, 0, (h - 0.06) / 2, 0));
      g.add(mBox(w + 0.08, 0.06, d + 0.08, M.white, 0, h - 0.03, 0));
      g.add(mLathe([[0, 0], [0.22, 0], [0.34, 0.10], [0.36, 0.22], [0.30, 0.24]], M.glass, -0.65, h, 0, 16, false));
      g.add(mBox(0.75, 0.10, 0.52, M.brushedSteel, 0.6, h + 0.05, 0, false));
      break;
    }
    case 'column': {
      g.add(mBox(r * 2.3, 0.22, r * 2.3, M.ceramic, 0, 0.11, 0));
      g.add(mCyl(r * 0.92, r, h - 0.44, M.white, 0, h / 2, 0, 18));
      g.add(mBox(r * 2.3, 0.22, r * 2.3, M.ceramic, 0, h - 0.11, 0));
      g.add(mCyl(r + 0.03, r + 0.03, 0.05, M.gold, 0, 1.1, 0, 18, false));
      break;
    }
    case 'plant': {
      g.add(mLathe([[0, 0], [0.24, 0], [0.34, 0.48], [0.30, 0.52], [0.26, 0.48]], M.darkMetal, 0, 0, 0, 14));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const leaf = mBox(0.11, 1.05, 0.34, M.green, Math.cos(a) * 0.18, 0.98, Math.sin(a) * 0.18, false);
        leaf.rotation.set(0.34 * Math.sin(a), a, 0.34 * Math.cos(a));
        g.add(leaf);
      }
      break;
    }
    case 'piano': {
      g.add(mBox(w, 0.34, d, M.darkLeather, 0, 0.76, 0));
      const lid = mBox(w * 0.94, 0.05, d * 0.92, M.darkLeather, 0, 1.18, -0.08);
      lid.rotation.z = 0.24;
      g.add(lid);
      g.add(mBox(w * 0.80, 0.06, 0.26, M.white, 0, 0.92, d / 2 - 0.08, false));
      g.add(mBox(w * 0.72, 0.03, 0.14, M.darkMetal, 0, 0.96, d / 2 - 0.12, false));
      for (const [lx, lz] of [[-w * 0.4, -d * 0.36], [w * 0.4, -d * 0.36], [0, d * 0.36]]) {
        g.add(mCyl(0.06, 0.04, 0.62, M.darkMetal, lx, 0.31, lz, 10));
      }
      break;
    }
    case 'counter':
    case 'island':
    case 'bench':
    case 'desk': {
      const bodyMat = p.kind === 'bench' ? M.paintedMetal : p.kind === 'desk' ? M.warmWood : M.brushedSteel;
      const topMat = p.kind === 'desk' ? M.leather : M.ceramic;
      g.add(mBox(w, h - 0.07, d, bodyMat, 0, (h - 0.07) / 2, 0));
      g.add(mBox(w + 0.07, 0.07, d + 0.07, topMat, 0, h - 0.035, 0));
      break;
    }
    case 'stove': {
      g.add(mBox(w, h, d, M.brushedSteel, 0, h / 2, 0));
      for (const sx of [-0.42, 0.42]) {
        for (const sz of [-0.30, 0.30]) {
          g.add(mCyl(0.17, 0.17, 0.025, M.glowAmber, sx, h + 0.02, sz, 14, false));
        }
      }
      break;
    }
    case 'pot': {
      g.add(mCyl(r, r * 0.92, 0.30, M.brushedSteel, 0, 0.15, 0, 16, false));
      g.add(mCyl(r - 0.04, r - 0.04, 0.03, M.gold, 0, 0.29, 0, 14, false));
      break;
    }
    case 'pans': {
      g.add(mBox(2.2, 0.04, 0.06, M.darkMetal, 0, 0.18, 0, false));
      for (let i = 0; i < 4; i++) g.add(mCyl(0.17, 0.17, 0.045, M.brushedSteel, -0.9 + i * 0.6, 0, 0, 12, false));
      break;
    }
    case 'fridge':
    case 'freezer':
    case 'cryo': {
      const mat = p.kind === 'cryo' ? M.paintedMetal : M.brushedSteel;
      g.add(mBox(w, h, d, mat, 0, h / 2, 0));
      g.add(mBox(0.05, h * 0.52, 0.06, M.darkMetal, w / 2 - 0.14, h * 0.54, d / 2 + 0.03, false));
      g.add(mBox(w * 0.68, 0.045, 0.025, p.kind === 'cryo' ? M.glowCyan : M.glowGold, 0, h - 0.24, d / 2 + 0.02, false));
      break;
    }
    case 'sink': {
      g.add(mBox(w, h, d, M.brushedSteel, 0, h / 2, 0));
      g.add(mCyl(0.028, 0.028, 0.36, M.brushedSteel, 0, h + 0.18, -0.28, 10, false));
      break;
    }
    case 'shelf': {
      for (const sx of [-w / 2 + 0.05, w / 2 - 0.05]) {
        for (const sz of [-d / 2 + 0.05, d / 2 - 0.05]) {
          g.add(mBox(0.07, h, 0.07, M.darkMetal, sx, h / 2, sz));
        }
      }
      for (let i = 0; i < 4; i++) g.add(mBox(w, 0.05, d, M.paintedMetal, 0, 0.12 + (h - 0.2) * (i / 3), 0));
      for (let i = 0; i < 5; i++) {
        g.add(mBox(0.34, 0.28, 0.34, i % 2 ? M.wood : M.paintedMetal, 0, 0.28 + ((i % 3) * (h - 0.2)) / 3, -d / 2 + 0.42 + (i * 0.68) % Math.max(0.4, d - 0.7), false));
      }
      break;
    }
    case 'locker': {
      g.add(mBox(w, h, d, M.paintedMetal, 0, h / 2, 0));
      const n = Math.max(2, Math.round(w / 0.7));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (i + 0.5) * (w / n);
        g.add(mBox(w / n - 0.06, h - 0.16, 0.03, M.darkMetal, x, h / 2, d / 2 + 0.02, false));
        g.add(mBox(0.04, 0.14, 0.04, M.brushedSteel, x + w / n / 2 - 0.11, h / 2, d / 2 + 0.04, false));
      }
      break;
    }
    case 'crate': {
      g.add(mBox(w, h, d, M.wood, 0, h / 2, 0));
      g.add(mBox(w + 0.04, 0.08, d + 0.04, M.darkMetal, 0, h * 0.78, 0, false));
      g.add(mBox(w + 0.04, 0.08, d + 0.04, M.darkMetal, 0, h * 0.22, 0, false));
      break;
    }
    case 'winch': {
      g.add(mBox(w, h, d, M.paintedMetal, 0, h / 2, 0));
      const drum = mCyl(0.18, 0.18, 0.24, M.brushedSteel, 0, h * 0.72, d / 2 + 0.06, 14, false);
      drum.rotation.z = Math.PI / 2;
      g.add(drum);
      g.add(mBox(0.05, 0.30, 0.05, M.glowAmber, 0.24, h * 0.72, d / 2 + 0.10, false));
      break;
    }
    case 'fusebox': {
      g.add(mBox(w, h * 0.55, d, M.paintedMetal, 0, 1.30, 0, false));
      g.add(mBox(w * 0.62, 0.07, d + 0.04, M.glowGold, 0, 1.48, 0, false));
      break;
    }
    case 'toolbox': {
      g.add(mBox(w, h, d, M.leather, 0, h / 2, 0));
      g.add(mBox(w * 0.52, 0.05, 0.05, M.brushedSteel, 0, h + 0.06, 0, false));
      break;
    }
    case 'bucket': {
      g.add(mCyl(r, r * 0.82, h, M.paintedMetal, 0, h / 2, 0, 12, false));
      break;
    }
    case 'puddle': {
      g.userData.dynamic = true;
      const mat = new THREE.MeshStandardMaterial({
        color: p.color || 0x244652,
        normalMap: M.sets.plaster_wall.normalMap,
        normalScale: new THREE.Vector2(0.25, 0.25),
        roughness: 0.06,
        metalness: 0.68,
        envMapIntensity: 1.5,
        transparent: true,
        opacity: 0.78,
      });
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 26), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02;
      m.receiveShadow = true;
      g.add(m);
      if (p.x > 14) refs.puddleLab = m;
      refs.ownedMaterials = refs.ownedMaterials || [];
      refs.ownedMaterials.push(mat);
      break;
    }
    case 'monitors': {
      for (let i = 0; i < 4; i++) {
        g.add(mBox(1.4, 0.9, 0.07, M.darkMetal, -2.2 + i * 1.5, 1.25, -0.05, false));
        g.add(mBox(1.28, 0.78, 0.04, i % 2 ? M.glowCyan : M.glowAmber, -2.2 + i * 1.5, 1.25, 0.01, false));
      }
      break;
    }
    case 'rack': {
      g.add(mBox(w, h, d, M.darkMetal, 0, h / 2, 0));
      for (let i = 0; i < 4; i++) g.add(mBox(w * 0.76, 0.04, 0.03, i % 2 ? M.glowCyan : M.glowGreen, 0, 0.45 + i * 0.36, d / 2 + 0.02, false));
      break;
    }
    case 'sofa': {
      g.add(mBox(w, h * 0.48, d, M.leather, 0, h * 0.24, 0));
      g.add(mBox(w, h * 0.62, 0.26, M.leather, 0, h * 0.62, -d / 2 + 0.13));
      g.add(mBox(0.22, h * 0.55, d, M.leather, -w / 2 + 0.11, h * 0.45, 0, false));
      g.add(mBox(0.22, h * 0.55, d, M.leather, w / 2 - 0.11, h * 0.45, 0, false));
      break;
    }
    case 'closet': {
      g.add(mBox(w, h, d, M.warmWood, 0, h / 2, 0));
      g.add(mBox(0.04, h * 0.78, 0.04, M.gold, 0.08, h * 0.5, d / 2 + 0.03, false));
      g.add(mBox(0.04, h * 0.78, 0.04, M.gold, -0.08, h * 0.5, d / 2 + 0.03, false));
      break;
    }
    case 'wineglass': {
      g.add(mLathe([[0, 0], [0.04, 0], [0.01, 0.02], [0.01, 0.09], [0.055, 0.14], [0.05, 0.22]], M.glass, 0, -0.04, 0, 12, false));
      g.add(mCyl(0.044, 0.02, 0.05, M.glowRed, 0, 0.11, 0, 10, false));
      break;
    }
    case 'coffee': {
      g.add(mBox(w, h, d, M.darkMetal, 0, h / 2, 0));
      g.add(mBox(0.34, 0.22, 0.04, M.glowCyan, 0, h * 0.76, d / 2 + 0.02, false));
      g.add(mCyl(0.06, 0.05, 0.13, M.white, 0.24, 0.36, d / 2 - 0.1, 10, false));
      break;
    }
    case 'pod': {
      g.add(mCyl(r, r * 1.04, 0.22, M.darkMetal, 0, 0.11, 0, 18));
      g.add(mCyl(r - 0.08, r - 0.08, h - 0.44, M.glass, 0, h / 2, 0, 18, false));
      g.add(mCyl(r * 0.32, r * 0.32, h - 0.6, M.glowCyan, 0, h / 2, 0, 12, false));
      g.add(mCyl(r, r, 0.22, M.brushedSteel, 0, h - 0.11, 0, 18));
      break;
    }
    case 'terminal': {
      g.userData.dynamic = true;
      g.add(mBox(w, h * 0.62, d, M.darkMetal, 0, h * 0.31, 0));
      const scrMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.cyan).multiplyScalar(1.5), toneMapped: false });
      const scr = mBox(w * 0.82, h * 0.50, 0.05, scrMat, 0, h * 0.86, 0, false);
      scr.rotation.x = -0.25;
      g.add(scr);
      refs.terminalScreen = scr;
      refs.ownedMaterials = refs.ownedMaterials || [];
      refs.ownedMaterials.push(scrMat);
      break;
    }
    case 'vialrack': {
      g.add(mBox(0.62, 0.05, 0.18, M.brushedSteel, 0, 0.03, 0, false));
      for (let i = 0; i < 4; i++) g.add(mCyl(0.038, 0.038, 0.17, M.glowGreen, -0.2 + i * 0.13, 0.11, 0, 10, false));
      break;
    }
    case 'pool': {
      const poolMat = M.water.clone();
      refs.ownedMaterials = refs.ownedMaterials || [];
      refs.ownedMaterials.push(poolMat);
      const water = new THREE.Mesh(scaleGeometryUVs(new THREE.PlaneGeometry(w - 0.4, d - 0.4), 3, 2), poolMat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.09;
      water.userData.dynamic = true;
      g.add(water);
      refs.poolWater = water;
      g.add(mBox(w, 0.3, 0.32, M.ceramic, 0, 0.15, -d / 2));
      g.add(mBox(w, 0.3, 0.32, M.ceramic, 0, 0.15, d / 2));
      g.add(mBox(0.32, 0.3, d, M.ceramic, -w / 2, 0.15, 0));
      g.add(mBox(0.32, 0.3, d, M.ceramic, w / 2, 0.15, 0));
      break;
    }
    case 'hedge': {
      g.add(mBox(w, h, d, M.green, 0, h / 2, 0));
      break;
    }
    case 'fountain': {
      g.add(mLathe([[0, 0], [r, 0], [r * 1.04, 0.46], [r * 0.90, 0.50], [0.22, 0.50], [0.18, 1.35], [0.68, 1.42], [0, 1.44]], M.ceramic, 0, 0, 0, 20));
      g.add(mCyl(r - 0.18, r - 0.18, 0.06, M.water, 0, 0.48, 0, 18, false));
      break;
    }
    case 'lounge': {
      g.add(mBox(w, 0.14, d, M.white, 0, 0.34, 0));
      const back = mBox(w, 0.52, 0.12, M.white, 0, 0.58, -d / 2 + 0.22);
      back.rotation.x = -0.35;
      g.add(back);
      for (const sz of [-d / 2 + 0.22, d / 2 - 0.22]) g.add(mBox(w, 0.28, 0.07, M.darkMetal, 0, 0.14, sz, false));
      break;
    }
    case 'tree': {
      g.add(mCyl(0.16, 0.24, h * 0.52, M.warmWood, 0, h * 0.26, 0, 10));
      for (let i = 0; i < 3; i++) g.add(mCyl(0.12, 1.5 - i * 0.34, 1.15, M.green, 0, h * 0.52 + i * 0.68, 0, 10));
      break;
    }
    case 'shed': {
      g.add(mBox(w, h, d, M.wood, 0, h / 2, 0));
      g.add(mBox(w + 0.22, 0.16, d + 0.22, M.darkMetal, 0, h + 0.08, 0));
      g.add(mBox(w * 0.48, h * 0.76, 0.05, M.paintedMetal, 0, h * 0.38, d / 2 + 0.03, false));
      break;
    }
    case 'statue': {
      g.add(mBox(w, 0.62, d, M.ceramic, 0, 0.31, 0));
      g.add(mLathe([[0, 0], [0.34, 0], [0.22, 0.55], [0.28, 1.15], [0.16, 1.45], [0.22, 1.72], [0, 1.82]], M.gold, 0, 0.62, 0, 16));
      break;
    }
    case 'dock': {
      g.add(mBox(w, h, d, M.wood, 0, h / 2, 0, false));
      break;
    }
    case 'boat': {
      g.userData.dynamic = true;
      g.add(mBox(w, 0.52, d, M.paintedMetal, 0, 0.30, 0));
      g.add(mBox(w * 0.56, 0.65, d * 0.62, M.glass, -0.35, 0.84, 0, false));
      const bl = mBox(0.14, 0.12, 0.14, M.glowCyan, w / 2 - 0.22, 0.72, 0, false);
      g.add(bl);
      refs.boatLight = bl;
      break;
    }
    case 'chandelier': {
      g.userData.dynamic = true;
      // Pre-fusiona las sub-piezas rígidas en 3 mallas por material (gold, glowWarm, glass)
      const goldParts = [];
      const glowParts = [];
      const glassParts = [];

      const pushTransformed = (arr, geo, x, y, z) => {
        geo.translate(x, y, z);
        arr.push(geo);
      };
      pushTransformed(goldParts, new THREE.CylinderGeometry(r, r, 0.12, 20), 0, 0, 0);
      pushTransformed(goldParts, new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.10, 16), 0, 0.42, 0);
      pushTransformed(goldParts, new THREE.CylinderGeometry(0.035, 0.035, 3.0, 8), 0, 1.6, 0);

      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const cx = Math.cos(a) * r * 0.86, cz = Math.sin(a) * r * 0.86;
        pushTransformed(goldParts, new THREE.CylinderGeometry(0.045, 0.045, 0.28, 8), cx, 0.2, cz);
        pushTransformed(glowParts, new THREE.CylinderGeometry(0.06, 0.05, 0.12, 8), cx, 0.40, cz);
      }
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const rr = r * (0.35 + (i % 3) * 0.25);
        pushTransformed(glassParts, new THREE.CylinderGeometry(0.03, 0.015, 0.28, 6), Math.cos(a) * rr, -0.24 - (i % 3) * 0.1, Math.sin(a) * rr);
      }

      const gGold = mergeBufferGeometries(goldParts);
      const gGlow = mergeBufferGeometries(glowParts);
      const gGlass = mergeBufferGeometries(glassParts);
      for (const x of [...goldParts, ...glowParts, ...glassParts]) x.dispose();

      const mGold = new THREE.Mesh(gGold, M.gold);
      mGold.castShadow = true;
      g.add(mGold);
      g.add(new THREE.Mesh(gGlow, M.glowWarm));
      g.add(new THREE.Mesh(gGlass, M.glass));
      refs.chandelier = g;
      break;
    }
    case 'vent': {
      // Compuerta baja con lamas metálicas en ambas caras del muro (grosor 0.4 m)
      for (const side of [-0.21, 0.21]) {
        g.add(mBox(w, h, 0.04, M.brushedSteel, 0, h / 2 + 0.04, side, false));
        g.add(mBox(w - 0.12, h - 0.12, 0.05, M.darkMetal, 0, h / 2 + 0.04, side, false));
        for (let i = 0; i < 4; i++) {
          const slat = mBox(w - 0.16, 0.035, 0.06, M.paintedMetal, 0, 0.16 + i * 0.10, side, false);
          slat.rotation.x = 0.35;
          g.add(slat);
        }
        g.add(mBox(0.18, 0.04, 0.06, M.glowCyan, 0, h + 0.06, side, false));
      }
      break;
    }
    default: {
      g.add(mBox(w, h, d, M.darkMetal, 0, h / 2, 0));
    }
  }
  return g;
}
