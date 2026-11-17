// ---------------------------------------------------------------------------
// Rigs articulados procedurales: Humanos/S-7 (FK) y Unidades Robóticas (IK)
// ---------------------------------------------------------------------------
import * as THREE from '../../vendor/three.module.js';
import { OUTFITS, COLORS } from '../config.js';
import { clamp } from '../mathx.js';
import { mergeBufferGeometries } from './props.js';

// Solver analítico de 2 huesos en el plano local (targetZ hacia +Z, targetYDown hacia -Y)
export function solveTwoBoneIK(l1, l2, targetZ, targetYDown) {
  const minD = Math.abs(l1 - l2) + 1e-4;
  const maxD = l1 + l2 - 1e-4;
  const rawD = Math.hypot(targetZ, targetYDown);
  const d = clamp(rawD, minD, maxD);

  const cosKnee = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
  const alpha = Math.acos(cosKnee);
  const cosHip = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const beta = Math.acos(cosHip);
  const gamma = Math.atan2(targetZ, targetYDown);

  // En coordenadas Three.js (Y arriba, Z adelante), rotar -phi en X desplaza (0, -L, 0) hacia +Z
  const hipRotX = -(gamma + beta);
  const kneeRotX = Math.PI - alpha;
  return { hipRotX, kneeRotX };
}

const tmpColor = new THREE.Color();

function mergedVertCount(geos) {
  let n = 0;
  for (const g of geos) n += g.index ? g.index.count : g.attributes.position.count;
  return n;
}

function ensureColorAttr(geo) {
  let attr = geo.attributes.color;
  if (!attr) {
    const arr = new Float32Array(geo.attributes.position.count * 3);
    arr.fill(1);
    attr = new THREE.BufferAttribute(arr, 3);
    geo.setAttribute('color', attr);
  }
  return attr;
}

function paintSlice(geo, start, end, hex) {
  const attr = ensureColorAttr(geo);
  const arr = attr.array;
  tmpColor.setHex(hex);
  const r = tmpColor.r, g = tmpColor.g, b = tmpColor.b;
  for (let i = start; i < end; i++) {
    const o = i * 3;
    arr[o] = r;
    arr[o + 1] = g;
    arr[o + 2] = b;
  }
  attr.needsUpdate = true;
}

function scaled(geo, sx = 1, sy = 1, sz = 1) {
  geo.scale(sx, sy, sz);
  return geo;
}

function xform(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  if (x || y || z) geo.translate(x, y, z);
  return geo;
}

function mergeOwned(geos, ownedGeos) {
  const merged = mergeBufferGeometries(geos);
  for (const g of geos) g.dispose();
  ownedGeos.push(merged);
  return merged;
}

function hashId(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function resolveProfile(outfitId, isPlayer, profile = {}) {
  const id = profile.id || '';
  const female = !isPlayer && (!!profile.female || ['kessler', 'sci_senior', 'waiter2', 'guest1', 'guest3'].includes(id));
  const isVandermeer = !isPlayer && id === 'vandermeer';
  const isKessler = !isPlayer && id === 'kessler';
  const enforcerFor = isPlayer ? null : (profile.enforcerFor || null);
  const h = hashId(id || outfitId || 'npc');

  let hairStyle = female ? 'bob' : (['cropped', 'parted', 'slick'][h % 3]);
  const maleHairPalette = [0x1d1815, 0x382518, 0x4b3422, 0x252831, 0x58422f];
  let hairHex = maleHairPalette[h % maleHairPalette.length];

  if (isVandermeer) {
    hairStyle = 'executive';
    hairHex = 0xd4dae4;
  } else if (isKessler) {
    hairStyle = 'bun';
    hairHex = 0x2b1614;
  } else if (id === 'sci_senior') {
    hairStyle = 'bob';
    hairHex = 0x56505c;
  } else if (id === 'guest1') {
    hairStyle = 'bob';
    hairHex = 0x3c2216;
  } else if (id === 'guest3') {
    hairStyle = 'bun';
    hairHex = 0xc6964c;
  } else if (id === 'waiter2') {
    hairStyle = 'ponytail';
    hairHex = 0x1c1719;
  }

  let clothOverride = null;
  let accentOverride = null;
  let hasGown = false;
  if (!isPlayer && id === 'guest1') {
    clothOverride = 0x153940;
    accentOverride = 0xd8b45c;
    hasGown = true;
  } else if (!isPlayer && id === 'guest2') {
    clothOverride = 0x1b2438;
    accentOverride = 0xdce3ee;
  } else if (!isPlayer && id === 'guest3') {
    clothOverride = 0x3b1834;
    accentOverride = 0xe2c275;
    hasGown = true;
  } else if (!isPlayer && id === 'guest4') {
    clothOverride = 0xd8d1c2;
    accentOverride = 0x222630;
  }

  return {
    id,
    female,
    isVandermeer,
    isKessler,
    enforcerFor,
    hairStyle,
    hairHex,
    clothOverride,
    accentOverride,
    hasGown,
  };
}

function buildHairGeometry(style, ownedGeos) {
  const parts = [];
  const cap = scaled(new THREE.SphereGeometry(0.132, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), 0.99, 1.03, 1.09);
  parts.push(xform(cap, 0, 0.072, -0.008));

  if (style === 'executive') {
    // Cabello peinado hacia atrás + patillas + perilla imperial de Vandermeer
    parts.push(xform(new THREE.BoxGeometry(0.21, 0.052, 0.19), 0, 0.178, -0.005, -0.14));
    parts.push(xform(new THREE.BoxGeometry(0.22, 0.115, 0.09), 0, 0.048, -0.105, 0.12));
    parts.push(xform(new THREE.BoxGeometry(0.024, 0.085, 0.048), -0.114, 0.028, 0.02));
    parts.push(xform(new THREE.BoxGeometry(0.024, 0.085, 0.048), 0.114, 0.028, 0.02));
    parts.push(xform(new THREE.BoxGeometry(0.056, 0.048, 0.032), 0, -0.068, 0.116));
    parts.push(xform(new THREE.BoxGeometry(0.078, 0.018, 0.026), 0, -0.032, 0.120));
  } else if (style === 'bun') {
    parts.push(xform(new THREE.SphereGeometry(0.066, 12, 10), 0, 0.122, -0.142));
    parts.push(xform(new THREE.BoxGeometry(0.19, 0.042, 0.09), 0, 0.135, 0.078, 0.28));
    parts.push(xform(new THREE.BoxGeometry(0.036, 0.095, 0.058), -0.112, 0.03, 0.035, 0.18));
    parts.push(xform(new THREE.BoxGeometry(0.036, 0.095, 0.058), 0.112, 0.03, 0.035, 0.18));
  } else if (style === 'bob') {
    parts.push(xform(new THREE.BoxGeometry(0.19, 0.042, 0.085), 0, 0.132, 0.082, 0.25));
    parts.push(xform(new THREE.BoxGeometry(0.044, 0.16, 0.155), -0.108, 0.012, -0.008, 0, 0, 0.08));
    parts.push(xform(new THREE.BoxGeometry(0.044, 0.16, 0.155), 0.108, 0.012, -0.008, 0, 0, -0.08));
    parts.push(xform(new THREE.BoxGeometry(0.22, 0.16, 0.058), 0, 0.012, -0.108, 0.08));
  } else if (style === 'ponytail') {
    parts.push(xform(new THREE.BoxGeometry(0.185, 0.04, 0.08), 0, 0.132, 0.08, 0.24));
    parts.push(xform(new THREE.CylinderGeometry(0.038, 0.020, 0.19, 8), 0, 0.018, -0.158, 0.42));
  } else if (style === 'parted') {
    parts.push(xform(new THREE.BoxGeometry(0.19, 0.046, 0.16), 0.016, 0.175, 0.018, -0.06, 0, -0.08));
  } else if (style === 'slick') {
    parts.push(xform(new THREE.BoxGeometry(0.20, 0.048, 0.175), 0, 0.174, 0.005, -0.10));
  } else {
    parts.push(xform(new THREE.BoxGeometry(0.185, 0.038, 0.12), 0, 0.145, 0.055, 0.18));
  }
  return mergeOwned(parts, ownedGeos);
}

function makeWallQuads(verts, uvs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// Faldón sastrero curvo abierto al frente con espesor real (sin cajas sueltas ni clipping)
function buildOpenCoatGeometry(yTop, height, waistR, flare, ownedGeos) {
  const segs = 18;
  const a0 = 0.42;
  const a1 = Math.PI * 2 - 0.42;
  const yBot = yTop - height;
  const rTopOut = waistR;
  const rBotOut = waistR + height * flare * 1.45;
  const thick = 0.022;
  const sx = 1.07;
  const sz = 0.78;

  const outV = [], outU = [];
  const inV = [], inU = [];
  const rimV = [], rimU = [];

  const pt = (r, y, a) => [r * sx * Math.sin(a), y, r * sz * Math.cos(a)];
  const pushQuad = (arrV, arrU, p0, p1, p2, p3, u0, u1, v0, v1) => {
    arrV.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    arrU.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  };

  for (let i = 0; i < segs; i++) {
    const f0 = i / segs;
    const f1 = (i + 1) / segs;
    const ang0 = a0 + (a1 - a0) * f0;
    const ang1 = a0 + (a1 - a0) * f1;

    const bo0 = pt(rBotOut, yBot, ang0);
    const bo1 = pt(rBotOut, yBot, ang1);
    const to1 = pt(rTopOut, yTop, ang1);
    const to0 = pt(rTopOut, yTop, ang0);

    const bi0 = pt(rBotOut - thick, yBot, ang0);
    const bi1 = pt(rBotOut - thick, yBot, ang1);
    const ti1 = pt(rTopOut - thick, yTop, ang1);
    const ti0 = pt(rTopOut - thick, yTop, ang0);

    pushQuad(outV, outU, bo0, bo1, to1, to0, f0 * 2, f1 * 2, 0, 1);
    pushQuad(inV, inU, bi1, bi0, ti0, ti1, f1 * 2, f0 * 2, 0, 1);
    pushQuad(rimV, rimU, to0, to1, ti1, ti0, f0, f1, 0, 0.1);
    pushQuad(rimV, rimU, bi0, bi1, bo1, bo0, f0, f1, 0, 0.1);

    if (i === 0) pushQuad(rimV, rimU, bi0, bo0, to0, ti0, 0, 0.1, 0, 1);
    if (i === segs - 1) pushQuad(rimV, rimU, bo1, bi1, ti1, to1, 0, 0.1, 0, 1);
  }

  const parts = [
    makeWallQuads(outV, outU),
    makeWallQuads(inV, inU),
    makeWallQuads(rimV, rimU),
    // Solapas superiores y cuello sastrero
    xform(new THREE.CylinderGeometry(0.125, 0.14, 0.075, 12, 1, false, Math.PI * 0.22, Math.PI * 1.56), 0, yTop + 0.44, -0.008),
    xform(new THREE.BoxGeometry(0.052, 0.26, 0.028), -0.108, yTop + 0.28, 0.145, -0.04, 0.14, -0.14),
    xform(new THREE.BoxGeometry(0.052, 0.26, 0.028), 0.108, yTop + 0.28, 0.145, -0.04, -0.14, 0.14),
  ];
  return mergeOwned(parts, ownedGeos);
}

export function createHumanoidRig(outfitId, isPlayer, matLib, profile = {}) {
  const g = new THREE.Group();
  const prof = resolveProfile(outfitId, isPlayer, profile);
  const charMats = matLib.makeCharacterMaterials(isPlayer);
  const { cloth, skin, vestMat, visor: visorMat } = charMats;
  const ownedGeos = [];
  const colorSlices = [];
  const track = (mesh) => { ownedGeos.push(mesh.geometry); return mesh; };
  const trackSlice = (geo, role, start = 0, end = geo.attributes.position.count) => {
    ensureColorAttr(geo);
    colorSlices.push({ geo, start, end, role });
    return geo;
  };

  const hips = new THREE.Group();
  hips.position.y = 0.94;
  g.add(hips);

  // 1. Torso anatómico + pechera sastrera + solapas + cinturón fusionados en 1 malla por color de vértice
  const shW = prof.female ? 0.215 : 0.242;
  const waistW = prof.female ? 0.146 : 0.164;
  const hipW = prof.female ? 0.192 : 0.184;
  const torsoPts = [
    [0.0, -0.07], [hipW * 0.9, -0.05], [hipW, 0.07], [waistW, 0.24],
    [shW * 0.92, 0.46], [shW, 0.59], [0.155, 0.66], [0.0, 0.67],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torsoSubParts = [
    scaled(new THREE.LatheGeometry(torsoPts, 16), 1.08, 1.0, prof.female ? 0.66 : 0.69),
    xform(scaled(new THREE.SphereGeometry(0.072, 10, 8), 1.12, 0.68, 0.95), -(shW + 0.02), 0.575, 0),
    xform(scaled(new THREE.SphereGeometry(0.072, 10, 8), 1.12, 0.68, 0.95), shW + 0.02, 0.575, 0),
    xform(new THREE.CylinderGeometry(0.115, 0.13, 0.065, 12, 1, false, Math.PI * 0.25, Math.PI * 1.5), 0, 0.665, -0.005),
  ];
  const chestParts = [
    xform(new THREE.BoxGeometry(prof.female ? 0.22 : 0.25, 0.24, 0.045), 0, 0.49, 0.132, -0.05),
    xform(new THREE.BoxGeometry(0.055, 0.25, 0.035), -0.095, 0.48, 0.145, -0.04, 0.12, -0.18),
    xform(new THREE.BoxGeometry(0.055, 0.25, 0.035), 0.095, 0.48, 0.145, -0.04, -0.12, 0.18),
    xform(scaled(new THREE.CylinderGeometry(waistW * 1.11, waistW * 1.13, 0.045, 14), 1.06, 1.0, 0.71), 0, 0.18, 0),
  ];
  const bakeNpcVest = !isPlayer && (outfitId === 'guard' || outfitId === 'tech' || outfitId === 'waiter');
  const bakeNpcTie = !isPlayer && (outfitId === 'vip' || outfitId === 'waiter');
  const bakedVestParts = bakeNpcVest ? [
    xform(new THREE.BoxGeometry(0.46, 0.34, 0.26), 0, 0.42, 0),
    xform(new THREE.BoxGeometry(0.085, 0.14, 0.25), -0.155, 0.58, 0),
    xform(new THREE.BoxGeometry(0.085, 0.14, 0.25), 0.155, 0.58, 0),
    xform(new THREE.BoxGeometry(0.09, 0.10, 0.045), -0.11, 0.34, 0.145),
    xform(new THREE.BoxGeometry(0.09, 0.10, 0.045), 0.11, 0.34, 0.145),
  ] : [];
  const bakedTieParts = bakeNpcTie ? [
    xform(new THREE.BoxGeometry(0.052, 0.048, 0.028), 0, 0.56, 0.156),
    xform(new THREE.BoxGeometry(0.056, 0.25, 0.022), 0, 0.41, 0.158, -0.03),
  ] : [];
  const vTorso = mergedVertCount(torsoSubParts);
  const vChestEnd = vTorso + mergedVertCount(chestParts);
  const vVestEnd = vChestEnd + mergedVertCount(bakedVestParts);
  const torsoGeo = mergeOwned([...torsoSubParts, ...chestParts, ...bakedVestParts, ...bakedTieParts], ownedGeos);
  trackSlice(torsoGeo, 'cloth', 0, vTorso);
  trackSlice(torsoGeo, 'accent', vTorso, vChestEnd);
  if (bakeNpcVest) trackSlice(torsoGeo, 'vest', vChestEnd, vVestEnd);
  if (bakeNpcTie) trackSlice(torsoGeo, 'tie', vVestEnd, torsoGeo.attributes.position.count);
  const torso = new THREE.Mesh(torsoGeo, cloth);
  torso.castShadow = true;
  torso.receiveShadow = true;
  hips.add(torso);
  const chest = torso;

  // Chasis cibernético de S-7 visible en cuello, esternón y columna (solo isPlayer)
  let s7Chassis = null;
  let s7CoreGlow = null;
  if (isPlayer) {
    const chParts = [
      xform(new THREE.CylinderGeometry(0.088, 0.102, 0.055, 12), 0, 0.68, 0),
      xform(new THREE.BoxGeometry(0.12, 0.11, 0.04), 0, 0.51, 0.148),
      xform(new THREE.BoxGeometry(0.055, 0.34, 0.035), 0, 0.44, -0.145),
    ];
    s7Chassis = new THREE.Mesh(mergeOwned(chParts, ownedGeos), matLib.darkMetal);
    hips.add(s7Chassis);

    const coreParts = [
      xform(new THREE.BoxGeometry(0.068, 0.022, 0.018), 0, 0.52, 0.166),
      xform(new THREE.BoxGeometry(0.022, 0.18, 0.015), 0, 0.45, -0.160),
    ];
    s7CoreGlow = new THREE.Mesh(mergeOwned(coreParts, ownedGeos), visorMat);
    hips.add(s7CoreGlow);
  }

  // 3. Cabeza esculpida + mandíbula + puente nasal + orejas (1 malla)
  const head = new THREE.Group();
  head.position.y = 0.78;
  hips.add(head);

  const craniumPts = [
    [0.0, -0.095], [0.078, -0.085], [0.112, -0.025], [0.122, 0.058],
    [0.116, 0.138], [0.078, 0.188], [0.0, 0.198],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const craniumG = new THREE.LatheGeometry(craniumPts, 16);
  craniumG.scale(prof.female ? 0.93 : 0.96, 1.0, 1.06);

  const headParts = [
    xform(new THREE.CylinderGeometry(0.058, 0.072, 0.14, 12), 0, -0.085, -0.008),
    craniumG,
    // Mandíbula / mentón esculpido y puente nasal hacia +Z
    xform(new THREE.BoxGeometry(prof.female ? 0.115 : 0.132, 0.075, 0.10), 0, -0.042, 0.048, 0.10),
    xform(new THREE.BoxGeometry(0.028, 0.058, 0.042), 0, 0.026, 0.116, -0.22),
    xform(new THREE.BoxGeometry(0.15, 0.026, 0.035), 0, 0.062, 0.102),
    // Orejas o módulos temporales en S-7
    xform(new THREE.BoxGeometry(0.024, 0.056, 0.038), -0.116, 0.025, -0.005),
    xform(new THREE.BoxGeometry(0.024, 0.056, 0.038), 0.116, 0.025, -0.005),
  ];
  if (isPlayer) {
    headParts.push(xform(new THREE.CylinderGeometry(0.068, 0.074, 0.022, 12), 0, -0.06, -0.008));
    headParts.push(xform(new THREE.CylinderGeometry(0.032, 0.032, 0.026, 10), -0.12, 0.04, 0.0, 0, 0, Math.PI / 2));
    headParts.push(xform(new THREE.CylinderGeometry(0.032, 0.032, 0.026, 10), 0.12, 0.04, 0.0, 0, 0, Math.PI / 2));
  }
  const wearsFullHatInit = outfitId === 'cook' || outfitId === 'tech' || (outfitId === 'guard' && prof.enforcerFor !== 'guard');
  const mergeHairStatic = !isPlayer && !wearsFullHatInit;
  let skull;
  let hair;
  if (mergeHairStatic) {
    const vSkull = mergedVertCount(headParts);
    const hairTmp = buildHairGeometry(prof.hairStyle, []);
    const skullGeo = mergeOwned([...headParts, hairTmp], ownedGeos);
    trackSlice(skullGeo, 'skin', 0, vSkull);
    trackSlice(skullGeo, 'hair', vSkull, skullGeo.attributes.position.count);
    skull = new THREE.Mesh(skullGeo, skin);
    skull.receiveShadow = true;
    head.add(skull);
    hair = new THREE.Object3D();
    hair.visible = true;
  } else {
    const skullGeo = mergeOwned(headParts, ownedGeos);
    if (!isPlayer) trackSlice(skullGeo, 'skin');
    skull = new THREE.Mesh(skullGeo, skin);
    skull.receiveShadow = true;
    head.add(skull);
    if (isPlayer) {
      hair = new THREE.Object3D();
      hair.visible = false;
    } else {
      const hairGeo = trackSlice(buildHairGeometry(prof.hairStyle, ownedGeos), 'hair');
      hair = new THREE.Mesh(hairGeo, skin);
      head.add(hair);
    }
  }

  const visorParts = [
    xform(new THREE.CylinderGeometry(0.125, 0.123, 0.044, 16, 1, false, -0.92, 1.84), 0, 0.044, 0.012),
    xform(new THREE.BoxGeometry(0.016, 0.018, 0.05), -0.125, 0.044, 0.01),
    xform(new THREE.BoxGeometry(0.016, 0.018, 0.05), 0.125, 0.044, 0.01),
  ];
  const visor = new THREE.Mesh(mergeOwned(visorParts, ownedGeos), visorMat);
  visor.visible = !!isPlayer;
  head.add(visor);

  // 4. Brazos articulados (hombro -> codo -> antebrazo + palma + pulgar + dedos)
  function buildArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (shW + 0.045), 0.57, 0);
    hips.add(shoulder);

    const upperParts = [
      xform(new THREE.CapsuleGeometry(prof.female ? 0.055 : 0.062, 0.185, 6, 10), 0, -0.13, 0),
      xform(new THREE.CylinderGeometry(0.060, 0.058, 0.035, 10), 0, -0.225, 0),
    ];
    const upper = new THREE.Mesh(trackSlice(mergeOwned(upperParts, ownedGeos), 'cloth'), cloth);
    upper.receiveShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.27, 0);
    shoulder.add(elbow);

    const foreParts = [
      xform(new THREE.CapsuleGeometry(prof.female ? 0.046 : 0.051, 0.175, 6, 10), 0, -0.115, 0),
      // Palma esculpida + bloque de dedos curvados + pulgar
      xform(new THREE.BoxGeometry(0.042, 0.068, 0.066), 0, -0.245, 0.008),
      xform(new THREE.BoxGeometry(0.038, 0.052, 0.058), 0, -0.288, 0.018, 0.25),
      xform(new THREE.BoxGeometry(0.024, 0.048, 0.028), -side * 0.024, -0.248, 0.042, -0.35),
    ];
    const foreGeo = mergeOwned(foreParts, ownedGeos);
    if (!isPlayer) trackSlice(foreGeo, 'skin');
    const fore = new THREE.Mesh(foreGeo, skin);
    fore.receiveShadow = true;
    elbow.add(fore);

    if (isPlayer && side === -1) {
      const linkPort = track(new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.095, 0.026), visorMat));
      linkPort.position.set(-0.048, -0.12, 0.018);
      elbow.add(linkPort);
    }

    return { shoulder, elbow, upper, fore };
  }

  const armL = buildArm(-1);
  const armR = buildArm(1);

  // 5. Piernas articuladas (cadera -> muslo con sombra -> rodilla -> espinilla + bota con suela y tacón)
  function buildLeg(side) {
    const thighGrp = new THREE.Group();
    thighGrp.position.set(side * 0.122, -0.02, 0);
    hips.add(thighGrp);

    const thighGeo = trackSlice(new THREE.CapsuleGeometry(prof.female ? 0.073 : 0.079, 0.28, 6, 12), 'cloth');
    ownedGeos.push(thighGeo);
    const thigh = new THREE.Mesh(thighGeo, cloth);
    thigh.position.set(0, -0.20, 0);
    thigh.castShadow = !!isPlayer;
    thigh.receiveShadow = true;
    thighGrp.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, -0.42, 0);
    thighGrp.add(knee);

    const shinParts = [
      xform(new THREE.CapsuleGeometry(prof.female ? 0.058 : 0.064, 0.27, 6, 10), 0, -0.195, 0),
      xform(new THREE.CylinderGeometry(0.068, 0.072, 0.055, 10), 0, -0.37, 0.005),
      xform(new THREE.BoxGeometry(0.132, 0.078, 0.21), 0, -0.435, 0.042, 0.08),
      xform(new THREE.BoxGeometry(0.140, 0.032, 0.255), 0, -0.482, 0.046),
      xform(new THREE.BoxGeometry(0.136, 0.045, 0.078), 0, -0.472, -0.042),
    ];
    const shin = new THREE.Mesh(mergeOwned(shinParts, ownedGeos), matLib.darkMetal);
    shin.receiveShadow = true;
    knee.add(shin);

    return { thighGrp, knee, thigh, shin };
  }

  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // 6. Accesorios de los 7 disfraces + siluetas VIP y Enforcers
  const isChefEnforcer = prof.enforcerFor === 'cook';
  const chefH = isChefEnforcer ? 1.32 : 1.0;
  const chefPts = [
    [0, 0], [0.13, 0], [0.134, 0.11 * chefH], [0.168, 0.20 * chefH], [0.145, 0.27 * chefH], [0, 0.28 * chefH],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const hatChef = track(new THREE.Mesh(new THREE.LatheGeometry(chefPts, 16), matLib.white));
  hatChef.position.set(0, 0.135, 0);
  head.add(hatChef);

  // Gorra de seguridad estándar o boina táctica de mando para el jefe de seguridad (chief)
  let capGeo;
  if (prof.enforcerFor === 'guard') {
    const beretCrown = xform(scaled(new THREE.SphereGeometry(0.146, 14, 10), 1.06, 0.50, 1.08), 0.022, 0.162, -0.004, 0.06, 0, -0.22);
    const beretBand = xform(new THREE.CylinderGeometry(0.134, 0.132, 0.036, 14), 0, 0.128, 0);
    capGeo = mergeOwned([beretCrown, beretBand], ownedGeos);
  } else {
    const capTopG = xform(new THREE.CylinderGeometry(0.138, 0.130, 0.078, 14), 0, 0.148, -0.005, -0.06);
    const capBrimG = xform(new THREE.BoxGeometry(0.23, 0.022, 0.135), 0, 0.112, 0.118, 0.12);
    capGeo = mergeOwned([capTopG, capBrimG], ownedGeos);
  }
  const capGuard = new THREE.Mesh(capGeo, matLib.darkMetal);
  head.add(capGuard);

  const helmParts = [
    xform(new THREE.SphereGeometry(0.144, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 0, 0.088, 0),
    xform(new THREE.BoxGeometry(0.048, 0.032, 0.28), 0, 0.215, 0),
    xform(new THREE.BoxGeometry(0.24, 0.020, 0.09), 0, 0.095, 0.115, 0.08),
  ];
  const helmet = new THREE.Mesh(mergeOwned(helmParts, ownedGeos), matLib.gold);
  head.add(helmet);

  // Bata de laboratorio abierta al frente con solapas
  const coat = new THREE.Mesh(buildOpenCoatGeometry(0.22, 0.56, 0.22, 0.09, ownedGeos), matLib.white);
  hips.add(coat);

  // Faldón de levita ceremonial VIP (abierto al frente, hereda tela borgoña de 'vip')
  const vipTailcoat = new THREE.Mesh(trackSlice(buildOpenCoatGeometry(0.20, 0.58, 0.215, 0.12, ownedGeos), 'cloth'), cloth);
  hips.add(vipTailcoat);

  // Insignias doradas VIP (charreteras, botonadura doble y medallón en Vandermeer)
  const vipGoldParts = [
    xform(new THREE.BoxGeometry(0.095, 0.026, 0.09), -(shW + 0.03), 0.625, 0, 0, 0, 0.12),
    xform(new THREE.BoxGeometry(0.095, 0.026, 0.09), shW + 0.03, 0.625, 0, 0, 0, -0.12),
    xform(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8), -0.065, 0.48, 0.162, Math.PI / 2),
    xform(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8), 0.065, 0.48, 0.162, Math.PI / 2),
    xform(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8), -0.065, 0.39, 0.158, Math.PI / 2),
    xform(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8), 0.065, 0.39, 0.158, Math.PI / 2),
  ];
  if (prof.isVandermeer) {
    vipGoldParts.push(xform(new THREE.CylinderGeometry(0.034, 0.034, 0.022, 10), 0.095, 0.555, 0.158, Math.PI / 2));
    vipGoldParts.push(xform(new THREE.TorusGeometry(0.145, 0.014, 6, 14, Math.PI), -0.14, 0.54, 0.09, 0.4, 0.3, -0.4));
  }
  const vipRegalia = new THREE.Mesh(mergeOwned(vipGoldParts, ownedGeos), matLib.gold);
  hips.add(vipRegalia);

  // Silueta distintiva Dra. Elena Kessler: gafas AR holográficas + ribete neural cian
  let kesslerVisor = null;
  let kesslerCollar = null;
  if (prof.isKessler) {
    const arParts = [
      xform(new THREE.BoxGeometry(0.21, 0.036, 0.024), 0, 0.046, 0.125),
      xform(new THREE.BoxGeometry(0.016, 0.016, 0.12), -0.112, 0.048, 0.065),
      xform(new THREE.BoxGeometry(0.016, 0.016, 0.12), 0.112, 0.048, 0.065),
    ];
    kesslerVisor = new THREE.Mesh(mergeOwned(arParts, ownedGeos), matLib.glowCyan);
    head.add(kesslerVisor);

    const kcParts = [
      xform(new THREE.BoxGeometry(0.038, 0.32, 0.030), -0.115, 0.45, 0.152, -0.04, 0, -0.10),
      xform(new THREE.BoxGeometry(0.038, 0.32, 0.030), 0.115, 0.45, 0.152, -0.04, 0, 0.10),
      xform(new THREE.BoxGeometry(0.055, 0.075, 0.022), -0.105, 0.50, 0.166),
    ];
    kesslerCollar = new THREE.Mesh(mergeOwned(kcParts, ownedGeos), matLib.glowCyan);
    hips.add(kesslerCollar);
  }

  // Distintivos visuales de Enforcers (radio táctica en chief, pañuelo en chef, gafas en sci_senior)
  let enforcerHead = null;
  let enforcerTorso = null;
  if (prof.enforcerFor === 'guard') {
    const badge = xform(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 8), -0.055, 0.132, 0.126, Math.PI / 2);
    enforcerHead = new THREE.Mesh(mergeOwned([badge], ownedGeos), matLib.gold);
    head.add(enforcerHead);

    const radioParts = [
      xform(new THREE.BoxGeometry(0.055, 0.095, 0.045), -0.18, 0.58, 0.12, -0.15),
      xform(new THREE.CylinderGeometry(0.006, 0.008, 0.22, 6), -0.195, 0.72, 0.095, -0.12),
      xform(new THREE.BoxGeometry(0.075, 0.024, 0.024), 0.14, 0.55, 0.158),
    ];
    enforcerTorso = new THREE.Mesh(mergeOwned(radioParts, ownedGeos), matLib.gold);
    hips.add(enforcerTorso);
  } else if (prof.enforcerFor === 'cook') {
    const scarfParts = [
      xform(new THREE.TorusGeometry(0.115, 0.022, 8, 14), 0, 0.635, 0.015, Math.PI / 2 + 0.18),
      xform(new THREE.BoxGeometry(0.048, 0.16, 0.025), -0.028, 0.53, 0.148, -0.08, 0, 0.16),
      xform(new THREE.BoxGeometry(0.048, 0.16, 0.025), 0.028, 0.53, 0.148, -0.08, 0, -0.16),
    ];
    enforcerTorso = new THREE.Mesh(mergeOwned(scarfParts, ownedGeos), matLib.gold);
    hips.add(enforcerTorso);
  } else if (prof.enforcerFor === 'scientist') {
    const glassParts = [
      xform(new THREE.TorusGeometry(0.032, 0.006, 6, 12), -0.046, 0.044, 0.124),
      xform(new THREE.TorusGeometry(0.032, 0.006, 6, 12), 0.046, 0.044, 0.124),
      xform(new THREE.BoxGeometry(0.032, 0.008, 0.01), 0, 0.048, 0.124),
    ];
    enforcerHead = new THREE.Mesh(mergeOwned(glassParts, ownedGeos), matLib.gold);
    head.add(enforcerHead);

    const stoleParts = [
      xform(new THREE.BoxGeometry(0.055, 0.36, 0.028), -0.115, 0.44, 0.150),
      xform(new THREE.BoxGeometry(0.055, 0.36, 0.028), 0.115, 0.44, 0.150),
    ];
    enforcerTorso = new THREE.Mesh(mergeOwned(stoleParts, ownedGeos), matLib.darkMetal);
    hips.add(enforcerTorso);
  }

  // Vestido de gala para invitadas civiles (guest1, guest3)
  let galaSkirt = null;
  if (prof.hasGown) {
    const skirtPts = [[0.14, -0.34], [0.27, -0.34], [0.23, -0.10], [0.175, 0.14], [0.0, 0.15]].map(([r, y]) => new THREE.Vector2(r, y));
    const skirtG = trackSlice(scaled(new THREE.LatheGeometry(skirtPts, 16), 1.06, 1.0, 0.88), 'cloth');
    ownedGeos.push(skirtG);
    galaSkirt = new THREE.Mesh(skirtG, cloth);
    galaSkirt.receiveShadow = true;
    hips.add(galaSkirt);
  }

  let tie;
  if (bakeNpcTie) {
    tie = new THREE.Object3D();
  } else {
    const tieParts = [
      xform(new THREE.BoxGeometry(0.052, 0.048, 0.028), 0, 0.56, 0.156),
      xform(new THREE.BoxGeometry(0.056, 0.25, 0.022), 0, 0.41, 0.158, -0.03),
    ];
    tie = new THREE.Mesh(mergeOwned(tieParts, ownedGeos), matLib.gold);
    hips.add(tie);
  }

  const apronParts = [
    xform(new THREE.BoxGeometry(0.36, 0.48, 0.024), 0, 0.05, 0.154),
    xform(scaled(new THREE.CylinderGeometry(0.195, 0.195, 0.032, 14), 1.04, 1.0, 0.72), 0, 0.24, 0),
  ];
  const apron = new THREE.Mesh(mergeOwned(apronParts, ownedGeos), matLib.white);
  hips.add(apron);

  const trayParts = [
    xform(new THREE.CylinderGeometry(0.195, 0.18, 0.020, 16), 0, -0.24, 0.16),
    xform(new THREE.TorusGeometry(0.19, 0.012, 6, 16), 0, -0.228, 0.16, Math.PI / 2),
  ];
  const tray = new THREE.Mesh(mergeOwned(trayParts, ownedGeos), matLib.brushedSteel);
  armL.elbow.add(tray);

  let vest;
  if (bakeNpcVest) {
    vest = new THREE.Object3D();
  } else {
    const vestParts = [
      xform(new THREE.BoxGeometry(0.46, 0.34, 0.26), 0, 0.42, 0),
      xform(new THREE.BoxGeometry(0.085, 0.14, 0.25), -0.155, 0.58, 0),
      xform(new THREE.BoxGeometry(0.085, 0.14, 0.25), 0.155, 0.58, 0),
      xform(new THREE.BoxGeometry(0.09, 0.10, 0.045), -0.11, 0.34, 0.145),
      xform(new THREE.BoxGeometry(0.09, 0.10, 0.045), 0.11, 0.34, 0.145),
    ];
    vest = new THREE.Mesh(mergeOwned(vestParts, ownedGeos), vestMat);
    hips.add(vest);
  }

  // 7. Objetos empuñados por S-7 en armR.elbow
  const gunParts = [
    xform(new THREE.BoxGeometry(0.044, 0.052, 0.21), 0, 0.032, 0.065),
    xform(new THREE.BoxGeometry(0.040, 0.115, 0.058), 0, -0.032, -0.008, 0.24),
    xform(new THREE.BoxGeometry(0.016, 0.034, 0.055), 0, -0.008, 0.045),
    xform(new THREE.CylinderGeometry(0.022, 0.022, 0.19, 10), 0, 0.036, 0.255, Math.PI / 2),
  ];
  const gun = new THREE.Mesh(mergeOwned(gunParts, ownedGeos), matLib.darkMetal);
  gun.position.set(0, -0.27, 0.05);
  armR.elbow.add(gun);

  const wireParts = [
    xform(new THREE.CylinderGeometry(0.014, 0.014, 0.11, 8), -0.055, 0, 0.03, 0, 0, Math.PI / 2),
    xform(new THREE.CylinderGeometry(0.014, 0.014, 0.11, 8), 0.055, 0, 0.09, 0, 0, Math.PI / 2),
    xform(new THREE.TorusGeometry(0.095, 0.006, 6, 16), 0, -0.01, 0.13, Math.PI / 2),
  ];
  const wire = new THREE.Mesh(mergeOwned(wireParts, ownedGeos), matLib.brushedSteel);
  wire.position.set(0, -0.27, 0.04);
  armR.elbow.add(wire);

  const vialParts = [
    xform(new THREE.CylinderGeometry(0.032, 0.032, 0.12, 10), 0, 0, 0.04, Math.PI / 2),
    xform(new THREE.CylinderGeometry(0.010, 0.004, 0.055, 8), 0, 0, 0.125, Math.PI / 2),
    xform(new THREE.CylinderGeometry(0.038, 0.038, 0.018, 10), 0, 0, -0.025, Math.PI / 2),
  ];
  const vial = new THREE.Mesh(mergeOwned(vialParts, ownedGeos), matLib.glowGreen);
  vial.position.set(0, -0.27, 0.05);
  armR.elbow.add(vial);

  const trapParts = [
    xform(new THREE.CylinderGeometry(0.095, 0.11, 0.042, 12), 0, 0, 0.06),
    xform(new THREE.BoxGeometry(0.22, 0.022, 0.032), 0, 0.012, 0.06),
    xform(new THREE.BoxGeometry(0.032, 0.022, 0.22), 0, 0.012, 0.06),
  ];
  const trapProp = new THREE.Mesh(mergeOwned(trapParts, ownedGeos), matLib.darkMetal);
  trapProp.position.set(0, -0.27, 0.05);
  armR.elbow.add(trapProp);

  // 8. Props contextuales de NPCs (armas en combate, datapad en trabajo, copa/taza al beber)
  let npcGun = null;
  let npcDatapad = null;
  let npcGlass = null;
  if (!isPlayer) {
    const ngParts = [
      xform(new THREE.BoxGeometry(0.044, 0.055, 0.22), 0, 0.032, 0.075),
      xform(new THREE.BoxGeometry(0.040, 0.11, 0.055), 0, -0.028, 0.002, 0.22),
      xform(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8), 0, 0.036, 0.21, Math.PI / 2),
    ];
    npcGun = new THREE.Mesh(mergeOwned(ngParts, ownedGeos), matLib.darkMetal);
    npcGun.position.set(0, -0.27, 0.05);
    npcGun.visible = false;
    armR.elbow.add(npcGun);

    const padParts = [
      xform(new THREE.BoxGeometry(0.15, 0.016, 0.21), 0, 0, 0.09, -0.18),
    ];
    npcDatapad = new THREE.Mesh(mergeOwned(padParts, ownedGeos), matLib.glowCyan);
    npcDatapad.position.set(0.03, -0.26, 0.04);
    npcDatapad.visible = false;
    armL.elbow.add(npcDatapad);

    const gobletPts = [[0, 0], [0.036, 0], [0.009, 0.012], [0.009, 0.065], [0.044, 0.095], [0.040, 0.145], [0.034, 0.145], [0.036, 0.098], [0, 0.085]].map(([r, y]) => new THREE.Vector2(r, y));
    const glassMat = (outfitId === 'vip' || outfitId === 'suit') ? matLib.gold : matLib.white;
    npcGlass = track(new THREE.Mesh(new THREE.LatheGeometry(gobletPts, 12), glassMat));
    npcGlass.position.set(0, -0.28, 0.06);
    npcGlass.visible = false;
    armR.elbow.add(npcGlass);
  }

  const accessories = {
    hatChef,
    capGuard,
    helmet,
    coat,
    tie,
    apron,
    tray,
    vest,
    vipTailcoat,
    vipRegalia,
  };
  if (kesslerVisor) accessories.kesslerVisor = kesslerVisor;
  if (kesslerCollar) accessories.kesslerCollar = kesslerCollar;
  if (enforcerHead) accessories.enforcerHead = enforcerHead;
  if (enforcerTorso) accessories.enforcerTorso = enforcerTorso;
  if (galaSkirt) accessories.galaSkirt = galaSkirt;

  const held = { pistol: gun, garrote: wire, poison: vial, trap: trapProp };
  for (const k in held) held[k].visible = false;

  const parts = {
    hips, torso, chest, head, skull, hair, visor,
    armL: armL.shoulder, armR: armR.shoulder,
    elbowL: armL.elbow, elbowR: armR.elbow,
    legL: legL.thighGrp, legR: legR.thighGrp,
    kneeL: legL.knee, kneeR: legR.knee,
  };

  function hideNpcProps() {
    if (npcGun) npcGun.visible = false;
    if (npcDatapad) npcDatapad.visible = false;
    if (npcGlass) npcGlass.visible = false;
  }

  let curOutfitId = outfitId;
  let lastPoseT = null;
  let wasProne = false;

  function applyColorPalette(clothHex, accentHex, skinHex, hairHex, vestHex = 0x2b3a4a, tieHex = 0xd8b45c) {
    for (const sl of colorSlices) {
      const hex = sl.role === 'cloth' ? clothHex
        : sl.role === 'accent' ? accentHex
        : sl.role === 'vest' ? vestHex
        : sl.role === 'tie' ? tieHex
        : sl.role === 'hair' ? hairHex
        : skinHex;
      paintSlice(sl.geo, sl.start, sl.end, hex);
    }
  }

  function applyOutfit(id, player) {
    curOutfitId = id;
    const o = OUTFITS[id] || OUTFITS.suit;
    const useGalaVariant = !player && id === 'suit' && prof.clothOverride !== null;
    const clothHex = useGalaVariant ? prof.clothOverride : o.color;
    const accentHex = useGalaVariant ? prof.accentOverride : o.accent;
    applyColorPalette(clothHex, accentHex, o.skin, prof.hairHex);
    skin.color.setHex(player ? 0xcfd8e2 : 0xffffff);
    skin.metalness = player ? 0.86 : 0.02;
    skin.roughness = player ? 0.28 : 0.68;

    for (const k in accessories) accessories[k].visible = false;
    hideNpcProps();

    const wearsFullHat = id === 'cook' || id === 'tech' || (id === 'guard' && prof.enforcerFor !== 'guard');
    hair.visible = !player && !wearsFullHat;
    visor.visible = !!player;
    if (s7Chassis) s7Chassis.visible = !!player;
    if (s7CoreGlow) s7CoreGlow.visible = !!player;

    if (id === 'cook') {
      accessories.hatChef.visible = true;
      accessories.apron.visible = true;
    }
    if (id === 'waiter') {
      accessories.vest.visible = true;
      accessories.tie.visible = true;
      accessories.tray.visible = true;
    }
    if (id === 'guard') {
      accessories.capGuard.visible = true;
      accessories.vest.visible = true;
    }
    if (id === 'scientist') {
      accessories.coat.visible = true;
    }
    if (id === 'tech') {
      accessories.helmet.visible = true;
      accessories.vest.visible = true;
    }
    if (id === 'vip') {
      accessories.tie.visible = true;
      accessories.vipTailcoat.visible = true;
      accessories.vipRegalia.visible = true;
    }
    if (!player) {
      if (kesslerVisor && id === 'scientist') kesslerVisor.visible = true;
      if (kesslerCollar && id === 'scientist') kesslerCollar.visible = true;
      if (enforcerHead) enforcerHead.visible = true;
      if (enforcerTorso) enforcerTorso.visible = true;
      if (galaSkirt && id === 'suit') galaSkirt.visible = true;
    }
  }
  applyOutfit(outfitId, isPlayer);

  // Estado suavizado para transiciones limpias a 60 FPS sin saltos articulares
  const cur = {
    hipsY: 0.94, hipsX: 0, hipsYaw: 0, hipsZ: 0,
    headX: 0, headY: 0, headZ: 0,
    armLX: 0, armLY: 0, armLZ: 0.04, elbowLX: -0.24,
    armRX: 0, armRY: 0, armRZ: -0.04, elbowRX: -0.24,
    legLX: 0, kneeLX: 0.05,
    legRX: 0, kneeRX: 0.05,
  };

  return {
    group: g,
    parts,
    accessories,
    held,
    profile: prof,
    get outfitId() { return curOutfitId; },
    set outfitId(v) { curOutfitId = v; },
    _stripped: false,
    applyOutfit,
    resetPose() {
      lastPoseT = null;
      wasProne = false;
    },
    setHeld(itemId, holster) {
      for (const k in held) held[k].visible = false;
      if (!holster && held[itemId]) held[itemId].visible = true;
    },
    setVisorColor(hex) {
      visorMat.color.setHex(hex).multiplyScalar(1.7);
    },
    setInstinctHighlight(torsoHex, headHex = torsoHex) {
      cloth.emissive.setHex(torsoHex);
      skin.emissive.setHex(headHex);
    },
    setStripped(flag, outfitFallback) {
      if (flag) {
        const o = OUTFITS[curOutfitId] || OUTFITS.suit;
        applyColorPalette(0x8a8f98, 0x8a8f98, o.skin, prof.hairHex, 0x8a8f98, 0x8a8f98);
        for (const k in accessories) accessories[k].visible = false;
        hideNpcProps();
        hair.visible = !isPlayer;
      } else {
        applyOutfit(outfitFallback || curOutfitId, isPlayer);
      }
      this._stripped = !!flag;
    },
    pose(e, t, opts = {}) {
      const speed = e.moving || 0;
      const walk = speed > 0.05;
      const run = speed > 2.6;
      const anim = e.anim || 0;
      const state = opts.state ?? e.state ?? null;
      const rawAct = opts.act ?? e.act ?? null;
      const activeAct = (!walk && (state === 'idle' || state === 'work' || opts.forceAct)) ? rawAct : null;

      const phase = t * (walk ? (run ? 5.2 + speed * 1.18 : 3.9 + speed * 1.15) : 1.5) + anim;
      const amp = walk ? clamp(speed / 3.1, 0.24, 1.25) : 0.035;
      const sL = Math.sin(phase);
      const sR = -sL;
      const c2 = Math.cos(phase * 2);

      // Base: locomoción multiharmónica o respiración natural en reposo
      let hipsY = 0.94 + (walk ? (-c2 * 0.022 * amp + 0.016) : Math.sin(t * 1.55 + anim) * 0.009);
      let hipsX = walk ? (run ? 0.14 : 0.045 * amp) : 0;
      let hipsYaw = walk ? sL * 0.075 * amp : Math.sin(t * 0.55 + anim) * 0.025;
      let hipsZ = walk ? sL * 0.035 * amp : 0;

      let legLX = walk ? sL * 0.64 * amp : 0;
      let legRX = walk ? sR * 0.64 * amp : 0;
      let kneeLX = walk ? (0.08 + Math.max(0, -sL) * 0.92 * amp) : 0.05;
      let kneeRX = walk ? (0.08 + Math.max(0, -sR) * 0.92 * amp) : 0.05;

      let armLX = -sL * (run ? 0.62 : 0.44) * amp;
      let armLY = 0;
      let armLZ = 0.05;
      let armRX = -sR * (run ? 0.62 : 0.44) * amp;
      let armRY = 0;
      let armRZ = -0.05;
      let elbowLX = (run ? -0.58 : -0.22) - Math.max(0, -sL) * 0.36 * amp;
      let elbowRX = (run ? -0.58 : -0.22) - Math.max(0, -sR) * 0.36 * amp;

      let headX = walk && run ? -0.06 : 0;
      let headY = clamp((opts.lookYaw || 0) + Math.sin(t * 0.62 + anim) * (walk ? 0.07 : 0.14), -0.68, 0.68);
      let headZ = 0;

      // Visibilidad y estabilización dinámica de bandeja para disfraz 'waiter'
      const carryTray = curOutfitId === 'waiter' && !this._stripped &&
        !['combat', 'panic', 'flee', 'shock', 'sick', 'grabbed'].includes(state) &&
        !opts.dead && !opts.sleep && !opts.dragging && !opts.aiming && !opts.jackedIn && !opts.channel;
      if (curOutfitId === 'waiter') accessories.tray.visible = carryTray;
      if (carryTray) {
        armLX = -0.36;
        armLY = 0.12;
        armLZ = 0.08;
        elbowLX = -1.26;
      }

      // Visibilidad de props contextuales de NPCs (reseteados en cada frame)
      let showNpcGun = false;
      let showDatapad = false;
      let showGlass = false;

      // Acciones contextuales de ruta de NPCs
      if (!isPlayer && activeAct) {
        if (activeAct === 'speech') {
          // Marcus Vandermeer en el atril: gestos expresivos de orador
          const g1 = Math.sin(t * 2.1 + anim);
          const g2 = Math.cos(t * 1.45 + anim);
          hipsX = -0.04;
          hipsYaw = Math.sin(t * 0.85 + anim) * 0.12;
          headY = Math.sin(t * 0.95 + anim) * 0.34;
          headX = -0.05 + g1 * 0.05;
          armRX = -0.78 + g1 * 0.28;
          armRY = -0.18 + g2 * 0.16;
          armRZ = -0.24 - Math.max(0, g1) * 0.18;
          elbowRX = -0.68 + g2 * 0.22;
          armLX = -0.52 - g2 * 0.20;
          armLY = 0.16;
          armLZ = 0.18;
          elbowLX = -0.74 + g1 * 0.15;
        } else if (activeAct === 'work') {
          if (curOutfitId === 'cook' || curOutfitId === 'waiter') {
            // Preparación en barra / cocina
            hipsX = 0.12;
            headX = 0.24;
            headY = Math.sin(t * 1.4 + anim) * 0.16;
            if (!carryTray) {
              armLX = -0.62 + Math.sin(t * 3.8 + anim) * 0.10;
              armLY = 0.22;
              elbowLX = -0.92;
            }
            armRX = -0.68 + Math.cos(t * 4.4 + anim) * 0.14;
            armRY = -0.20;
            elbowRX = -0.96 + Math.sin(t * 5.2 + anim) * 0.12;
          } else {
            // Científicos / Dra. Kessler / Seguridad / Técnico operando datapad
            showDatapad = true;
            hipsX = 0.07;
            headX = 0.26 + Math.sin(t * 0.9 + anim) * 0.06;
            headY = Math.sin(t * 0.75 + anim) * 0.12;
            armLX = -0.68;
            armLY = 0.34;
            armLZ = 0.12;
            elbowLX = -1.08;
            armRX = -0.74 + Math.sin(t * 4.8 + anim) * 0.07;
            armRY = -0.28;
            armRZ = -0.08;
            elbowRX = -1.02 + Math.cos(t * 6.2 + anim) * 0.09;
          }
        } else if (activeAct.startsWith('drink:')) {
          // Ciclo periódico de sorbo con copa/taza
          showGlass = true;
          const sip = clamp(Math.sin(t * 1.15 + anim) * 1.35 - 0.15, 0, 1);
          headX = -0.18 * sip;
          headY = (1 - sip) * Math.sin(t * 0.5 + anim) * 0.16;
          armRX = -0.52 - sip * 0.78;
          armRY = -0.16 - sip * 0.18;
          armRZ = -0.08;
          elbowRX = -0.82 - sip * 0.56;
        } else if (activeAct === 'look') {
          // Vigilancia activa con mano en cinturón
          headY = Math.sin(t * 0.85 + anim) * 0.48;
          hipsYaw = headY * 0.25;
          armLX = 0.14;
          armLZ = 0.18;
          elbowLX = -0.58;
        }
      }

      // Estados reactivos de sigilo, alerta, enfermedad y combate en NPCs
      if (!isPlayer) {
        if (state === 'suspicious' || state === 'investigate') {
          hipsX = Math.max(hipsX, 0.10);
          headY = clamp((opts.lookYaw || 0) + Math.sin(t * 2.4 + anim) * 0.26, -0.68, 0.68);
          if (!walk && curOutfitId === 'guard') {
            // Mano al comunicador táctico en oído/hombro
            armRX = -0.95;
            armRY = -0.32;
            armRZ = -0.22;
            elbowRX = -1.35;
          }
        } else if (state === 'shock') {
          hipsX = -0.10;
          hipsY = 0.91;
          kneeLX = 0.18;
          kneeRX = 0.18;
          headY = Math.sin(t * 6.0 + anim) * 0.22;
          armLX = -1.05;
          armLY = 0.22;
          armLZ = 0.24;
          elbowLX = -1.15;
          armRX = -1.05;
          armRY = -0.22;
          armRZ = -0.24;
          elbowRX = -1.15;
        } else if (state === 'panic' || state === 'flee') {
          if (walk) {
            hipsX = 0.18;
            headY = Math.sin(t * 5.5 + anim) * 0.30;
            armLX = -0.85 - sL * 0.52;
            armLZ = 0.24;
            elbowLX = -0.95;
            armRX = -0.85 - sR * 0.52;
            armRZ = -0.24;
            elbowRX = -0.95;
          } else {
            // Refugiado agachado cubriéndose la cabeza
            hipsY = 0.66;
            hipsX = 0.36;
            legLX = -0.82;
            legRX = -0.82;
            kneeLX = 1.28;
            kneeRX = 1.28;
            headX = 0.34;
            armLX = -1.28;
            armLY = 0.28;
            elbowLX = -1.32;
            armRX = -1.28;
            armRY = -0.28;
            elbowRX = -1.32;
          }
        } else if (state === 'sick') {
          // Envenenado: encorvado sujetándose el estómago y tambaleándose
          hipsY = 0.83 + Math.sin(t * 4.2) * 0.02;
          hipsX = 0.48;
          hipsZ = Math.sin(t * 3.1) * 0.09;
          legLX = -0.26 + Math.sin(t * 4.5) * 0.18;
          legRX = -0.26 - Math.sin(t * 4.5) * 0.18;
          kneeLX = 0.52;
          kneeRX = 0.52;
          headX = 0.36;
          headZ = Math.cos(t * 3.4) * 0.16;
          armLX = -0.58;
          armLY = 0.52;
          armLZ = 0.12;
          elbowLX = -1.28;
          armRX = -0.88;
          armRY = -0.35;
          elbowRX = -1.22;
        } else if (state === 'combat') {
          // Guardia en combate: desenfunda arma corta en postura Weaver a dos manos
          showNpcGun = true;
          hipsY = walk ? hipsY - 0.03 : 0.89;
          hipsX = Math.max(hipsX, 0.09);
          hipsYaw = -0.18;
          if (!walk) {
            legLX = -0.14;
            legRX = 0.12;
            kneeLX = 0.24;
            kneeRX = 0.18;
          }
          headY = 0.16;
          headX = -0.04;
          armRX = -1.38 + Math.sin(t * 3.2 + anim) * 0.02;
          armRY = 0.06;
          armRZ = -0.06;
          elbowRX = -0.14;
          armLX = -1.16;
          armLY = 0.44;
          armLZ = 0.16;
          elbowLX = -0.44;
        }
      }

      // Overrides de jugador S-7 y estados compartidos
      if (opts.crouch) {
        hipsY = 0.64 + (walk ? Math.abs(Math.cos(phase)) * 0.025 : 0);
        hipsX = 0.28;
        legLX = -0.78 + sL * 0.35 * amp;
        legRX = -0.78 + sR * 0.35 * amp;
        kneeLX = 1.15;
        kneeRX = 1.15;
      }
      if (opts.jackedIn) {
        hipsY = opts.crouch ? 0.60 : 0.90;
        hipsX = 0.18;
        headX = 0.38;
        headY = Math.sin(t * 2.2) * 0.05;
        armLX = -0.74;
        armLY = 0.28;
        armLZ = 0.18;
        elbowLX = -1.18;
        armRX = -0.80;
        armRY = -0.28;
        armRZ = -0.18;
        elbowRX = -1.22 + Math.sin(t * 6) * 0.045;
      }
      if (opts.dragging) {
        hipsX = 0.36;
        hipsY = 0.82;
        armLX = 0.65;
        armLY = 0;
        armLZ = 0.10;
        armRX = 0.65;
        armRY = 0;
        armRZ = -0.10;
        elbowLX = -0.35;
        elbowRX = -0.35;
      }
      if (opts.aiming) {
        armRX = -1.42;
        armRY = -0.06;
        armRZ = -0.08;
        elbowRX = -0.12;
        armLX = -1.18;
        armLY = 0.38;
        armLZ = 0.18;
        elbowLX = -0.42;
      }
      if (opts.channel) {
        if (!isPlayer && state === 'grabbed') {
          hipsX = -0.08;
          headX = -0.22;
          headY = Math.sin(t * 11) * 0.18;
          armLX = -1.12 + Math.sin(t * 10) * 0.15;
          armLZ = 0.25;
          elbowLX = -1.28;
          armRX = -1.12 - Math.sin(t * 10) * 0.15;
          armRZ = -0.25;
          elbowRX = -1.28;
        } else {
          hipsX = 0.22;
          armRX = -0.78 + Math.sin(t * 9) * 0.20;
          armRY = 0;
          armRZ = 0;
          elbowRX = -0.65;
          armLX = -0.68;
          armLY = 0;
          armLZ = 0;
          elbowLX = -0.55;
        }
      }
      if (opts.dead || opts.sleep) {
        showNpcGun = false;
        showDatapad = false;
        showGlass = false;
        hipsY = 0.20;
        hipsX = -Math.PI / 2;
        hipsYaw = 0;
        hipsZ = opts.dead ? 0.12 : 0;
        legLX = opts.dead ? 0.12 : -0.25;
        legRX = opts.dead ? -0.10 : -0.15;
        kneeLX = opts.dead ? 0.18 : 0.65;
        kneeRX = opts.dead ? 0.08 : 0.45;
        armLX = -0.45;
        armLY = 0;
        armLZ = 0.18;
        armRX = 0.32;
        armRY = 0;
        armRZ = -0.18;
        elbowLX = -0.25;
        elbowRX = -0.20;
        headX = 0;
        headY = opts.dead ? 0.28 : -0.18;
        headZ = 0;
      }

      if (npcGun) npcGun.visible = showNpcGun && !this._stripped;
      if (npcDatapad) npcDatapad.visible = showDatapad && !this._stripped;
      if (npcGlass) npcGlass.visible = showGlass && !this._stripped;

      const isProne = !!(opts.dead || opts.sleep);
      const dt = lastPoseT === null ? 1 : (t - lastPoseT);
      lastPoseT = t;
      const snap = opts.snap || isProne || wasProne || dt <= 0 || dt > 0.25;
      wasProne = isProne;
      if (snap) {
        cur.hipsY = hipsY; cur.hipsX = hipsX; cur.hipsYaw = hipsYaw; cur.hipsZ = hipsZ;
        cur.headX = headX; cur.headY = headY; cur.headZ = headZ;
        cur.armLX = armLX; cur.armLY = armLY; cur.armLZ = armLZ; cur.elbowLX = elbowLX;
        cur.armRX = armRX; cur.armRY = armRY; cur.armRZ = armRZ; cur.elbowRX = elbowRX;
        cur.legLX = legLX; cur.kneeLX = kneeLX; cur.legRX = legRX; cur.kneeRX = kneeRX;
      } else {
        const b = clamp(1 - Math.exp(-12 * dt), 0, 1);
        cur.hipsY += (hipsY - cur.hipsY) * b;
        cur.hipsX += (hipsX - cur.hipsX) * b;
        cur.hipsYaw += (hipsYaw - cur.hipsYaw) * b;
        cur.hipsZ += (hipsZ - cur.hipsZ) * b;
        cur.headX += (headX - cur.headX) * b;
        cur.headY += (headY - cur.headY) * b;
        cur.headZ += (headZ - cur.headZ) * b;
        cur.armLX += (armLX - cur.armLX) * b;
        cur.armLY += (armLY - cur.armLY) * b;
        cur.armLZ += (armLZ - cur.armLZ) * b;
        cur.elbowLX += (elbowLX - cur.elbowLX) * b;
        cur.armRX += (armRX - cur.armRX) * b;
        cur.armRY += (armRY - cur.armRY) * b;
        cur.armRZ += (armRZ - cur.armRZ) * b;
        cur.elbowRX += (elbowRX - cur.elbowRX) * b;
        cur.legLX += (legLX - cur.legLX) * b;
        cur.kneeLX += (kneeLX - cur.kneeLX) * b;
        cur.legRX += (legRX - cur.legRX) * b;
        cur.kneeRX += (kneeRX - cur.kneeRX) * b;
      }

      parts.hips.position.y = cur.hipsY;
      parts.hips.rotation.set(cur.hipsX, cur.hipsYaw, cur.hipsZ);
      parts.head.rotation.set(cur.headX, cur.headY, cur.headZ);
      parts.armL.rotation.set(cur.armLX, cur.armLY, cur.armLZ);
      parts.armR.rotation.set(cur.armRX, cur.armRY, cur.armRZ);
      parts.elbowL.rotation.set(cur.elbowLX, 0, 0);
      parts.elbowR.rotation.set(cur.elbowRX, 0, 0);
      parts.legL.rotation.set(cur.legLX, 0, 0);
      parts.legR.rotation.set(cur.legRX, 0, 0);
      parts.kneeL.rotation.set(cur.kneeLX, 0, 0);
      parts.kneeR.rotation.set(cur.kneeRX, 0, 0);
    },
    dispose() {
      for (const geo of ownedGeos) geo.dispose();
      charMats.dispose();
    },
  };
}

// Unidad robótica cuadrúpeda con solver IK analítico de 2 huesos por extremidad
export function createBotRig(kind, matLib) {
  const group = new THREE.Group();
  const ownedGeos = [];
  const track = (m) => { ownedGeos.push(m.geometry); return m; };

  const bodyMat = kind === 'maint' ? matLib.gold : matLib.darkMetal;
  const trimMat = kind === 'maint' ? matLib.paintedMetal : matLib.brushedSteel;
  const eyeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(kind === 'maint' ? COLORS.amber : COLORS.cyan).multiplyScalar(1.8),
    toneMapped: false,
  });

  const chassis = new THREE.Group();
  chassis.position.y = 0.36;
  group.add(chassis);

  // Chasis biselado + cúpulas de servomotores + paquete ventral fusionados (1 malla con sombra)
  const hullParts = [
    xform(new THREE.BoxGeometry(0.34, 0.12, 0.48), 0, 0, 0),
    xform(new THREE.BoxGeometry(0.26, 0.08, 0.56), 0, 0.01, 0),
    xform(new THREE.BoxGeometry(0.22, 0.055, 0.32), 0, -0.075, -0.02),
    xform(new THREE.CylinderGeometry(0.055, 0.055, 0.40, 10), 0, -0.015, 0.18, 0, 0, Math.PI / 2),
    xform(new THREE.CylinderGeometry(0.055, 0.055, 0.40, 10), 0, -0.015, -0.18, 0, 0, Math.PI / 2),
  ];
  const hull = new THREE.Mesh(mergeOwned(hullParts, ownedGeos), bodyMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  chassis.add(hull);

  // Caparazón dorsal diferenciando unidad de mantenimiento vs seguridad
  const caraParts = [
    xform(new THREE.BoxGeometry(0.29, 0.045, 0.38), 0, 0.082, -0.02),
    xform(new THREE.BoxGeometry(0.38, 0.04, 0.18), 0, 0.02, 0),
  ];
  if (kind === 'maint') {
    // Bastidor trasero de herramientas y cilindros hidráulicos
    caraParts.push(xform(new THREE.BoxGeometry(0.26, 0.085, 0.15), 0, 0.135, -0.13));
    caraParts.push(xform(new THREE.CylinderGeometry(0.032, 0.032, 0.22, 10), 0, 0.145, -0.22, 0, 0, Math.PI / 2));
  } else {
    // Aletas gemelas de radar/antena táctica y carenado frontal
    caraParts.push(xform(new THREE.BoxGeometry(0.018, 0.13, 0.11), -0.11, 0.145, -0.14, -0.32));
    caraParts.push(xform(new THREE.BoxGeometry(0.018, 0.13, 0.11), 0.11, 0.145, -0.14, -0.32));
    caraParts.push(xform(new THREE.BoxGeometry(0.14, 0.038, 0.16), 0, 0.112, 0.08));
  }
  const carapace = new THREE.Mesh(mergeOwned(caraParts, ownedGeos), trimMat);
  carapace.receiveShadow = true;
  chassis.add(carapace);

  // Tiras de estado luminosas en chasis
  const ledStripParts = [
    xform(new THREE.BoxGeometry(0.014, 0.018, 0.26), -0.175, 0.025, 0),
    xform(new THREE.BoxGeometry(0.014, 0.018, 0.26), 0.175, 0.025, 0),
    xform(new THREE.CylinderGeometry(0.026, 0.032, 0.032, 10), 0, 0.118, kind === 'maint' ? 0.06 : -0.04),
  ];
  const statusLeds = new THREE.Mesh(mergeOwned(ledStripParts, ownedGeos), eyeMat);
  chassis.add(statusLeds);

  // Cabezal sensor en cardán
  const gimbal = new THREE.Group();
  gimbal.position.set(0, 0.04, 0.26);
  chassis.add(gimbal);

  const podParts = [
    xform(new THREE.SphereGeometry(0.074, 12, 10), 0, 0, 0),
    xform(new THREE.BoxGeometry(0.14, 0.042, 0.09), 0, 0.038, 0.03, 0.12),
  ];
  const pod = new THREE.Mesh(mergeOwned(podParts, ownedGeos), matLib.darkMetal);
  gimbal.add(pod);

  const eyeParts = [
    xform(new THREE.CylinderGeometry(0.038, 0.038, 0.04, 12), 0, 0, 0.062, Math.PI / 2),
    xform(new THREE.CylinderGeometry(0.016, 0.016, 0.035, 8), -0.046, 0.008, 0.052, Math.PI / 2),
    xform(new THREE.CylinderGeometry(0.016, 0.016, 0.035, 8), 0.046, 0.008, 0.052, Math.PI / 2),
  ];
  const eye = new THREE.Mesh(mergeOwned(eyeParts, ownedGeos), eyeMat);
  gimbal.add(eye);

  const l1 = 0.22, l2 = 0.24;
  const legs = [];
  const mounts = [
    { sx: -1, sz: 1, phaseOff: 0 },
    { sx: 1, sz: -1, phaseOff: 0 },
    { sx: 1, sz: 1, phaseOff: Math.PI },
    { sx: -1, sz: -1, phaseOff: Math.PI },
  ];

  for (const mnt of mounts) {
    const mount = new THREE.Group();
    mount.position.set(mnt.sx * 0.19, -0.02, mnt.sz * 0.18);
    mount.rotation.y = mnt.sx * -0.26 * mnt.sz;
    chassis.add(mount);

    const femur = new THREE.Group();
    mount.add(femur);
    const femurParts = [
      xform(new THREE.CapsuleGeometry(0.028, l1 - 0.05, 6, 10), 0, -l1 * 0.5, 0),
      xform(new THREE.BoxGeometry(0.042, l1 * 0.68, 0.068), mnt.sx * 0.012, -l1 * 0.44, 0.012),
      xform(new THREE.CylinderGeometry(0.012, 0.012, l1 * 0.72, 6), 0, -l1 * 0.48, -0.028, 0.12),
    ];
    const femurMesh = new THREE.Mesh(mergeOwned(femurParts, ownedGeos), trimMat);
    femurMesh.receiveShadow = true;
    femur.add(femurMesh);

    const tibia = new THREE.Group();
    tibia.position.set(0, -l1, 0);
    femur.add(tibia);
    const tibiaParts = [
      xform(new THREE.CylinderGeometry(0.034, 0.034, 0.038, 8), 0, 0, 0, 0, 0, Math.PI / 2),
      xform(new THREE.CapsuleGeometry(0.022, l2 - 0.04, 6, 10), 0, -l2 * 0.5, 0),
      xform(new THREE.BoxGeometry(0.052, 0.028, 0.072), 0, -l2 + 0.006, 0.014),
      xform(new THREE.SphereGeometry(0.028, 8, 6), 0, -l2, 0.01),
    ];
    const tibiaMesh = new THREE.Mesh(mergeOwned(tibiaParts, ownedGeos), matLib.darkMetal);
    tibiaMesh.receiveShadow = true;
    tibia.add(tibiaMesh);

    legs.push({ mount, femur, tibia, sx: mnt.sx, sz: mnt.sz, phaseOff: mnt.phaseOff });
  }

  return {
    group,
    chassis,
    gimbal,
    pose(unit, t, opts = {}) {
      const disabled = !!opts.disabled;
      const hijacked = !!opts.hijacked;
      const speed = disabled ? 0 : (unit.moving || 0);
      const moving = speed > 0.05;
      const anim = unit.anim || 0;

      const baseHex = disabled ? 0x334048 : hijacked ? COLORS.gold : (kind === 'maint' ? COLORS.amber : COLORS.cyan);
      eyeMat.color.setHex(baseHex).multiplyScalar(disabled ? 0.6 : 1.75);

      const freq = 6.6 + speed * 1.85;
      const bodyY = disabled ? 0.19 : 0.35 + (moving ? Math.sin(t * freq * 2 + anim) * 0.014 : Math.sin(t * 2.5 + anim) * 0.008);
      chassis.position.y = bodyY;
      chassis.rotation.x = disabled ? 0.18 : (moving ? 0.045 + Math.cos(t * freq + anim) * 0.018 : 0);
      chassis.rotation.z = moving ? Math.sin(t * freq + anim) * 0.038 : 0;
      const scanRate = kind === 'sec' ? 2.6 : 1.8;
      gimbal.rotation.y = disabled ? -0.42 : Math.sin(t * scanRate + anim) * (moving ? 0.22 : 0.44);
      gimbal.rotation.x = disabled ? 0.45 : Math.cos(t * 1.4 + anim) * 0.06;

      const stride = moving ? clamp(speed / 3.4, 0.25, 1.0) * 0.135 : 0;
      const liftH = moving ? 0.095 : 0;

      for (const leg of legs) {
        const ph = t * freq + anim + leg.phaseOff;
        const s = Math.sin(ph);
        const c = Math.cos(ph);
        const stepZ = leg.sz * 0.05 + c * stride;
        const swingLift = s > 0 ? Math.sin(s * Math.PI * 0.5) * liftH : 0;
        const targetYDown = Math.max(0.12, (bodyY - 0.02) - swingLift);
        const { hipRotX, kneeRotX } = solveTwoBoneIK(l1, l2, stepZ, targetYDown);
        leg.femur.rotation.x = hipRotX;
        leg.tibia.rotation.x = kneeRotX;
      }
    },
    dispose() {
      for (const geo of ownedGeos) geo.dispose();
      eyeMat.dispose();
    },
  };
}
