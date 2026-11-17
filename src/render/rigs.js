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

function makeCapsuleMesh(radius, length, mat, x = 0, y = 0, z = 0, shadow = false) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

export function createHumanoidRig(outfitId, isPlayer, matLib) {
  const g = new THREE.Group();
  const charMats = matLib.makeCharacterMaterials(isPlayer);
  const { cloth, accent, skin, vestMat, visor: visorMat } = charMats;
  const ownedGeos = [];
  const track = (mesh) => { ownedGeos.push(mesh.geometry); return mesh; };

  const hips = new THREE.Group();
  hips.position.y = 0.94;
  g.add(hips);

  // Torso esculpido + pelvis fusionados (1 malla con sombra)
  const torsoPts = [
    [0.0, -0.06], [0.17, -0.05], [0.19, 0.08], [0.16, 0.24],
    [0.22, 0.46], [0.24, 0.60], [0.16, 0.66], [0.0, 0.67],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torsoGeo = new THREE.LatheGeometry(torsoPts, 14);
  torsoGeo.scale(1.08, 1.0, 0.68);
  ownedGeos.push(torsoGeo);
  const torso = new THREE.Mesh(torsoGeo, cloth);
  torso.castShadow = true;
  torso.receiveShadow = true;
  hips.add(torso);

  // Placa pectoral / solapas (1 malla)
  const chestGeo = new THREE.BoxGeometry(0.46, 0.22, 0.27);
  ownedGeos.push(chestGeo);
  const chest = new THREE.Mesh(chestGeo, accent);
  chest.position.set(0, 0.50, 0.01);
  chest.receiveShadow = true;
  hips.add(chest);

  // Cabeza + cuello fusionados (1 malla)
  const head = new THREE.Group();
  head.position.y = 0.78;
  hips.add(head);

  const neckG = new THREE.CylinderGeometry(0.062, 0.072, 0.13, 10);
  neckG.translate(0, -0.08, 0);
  const craniumPts = [
    [0.0, -0.09], [0.09, -0.08], [0.118, -0.02], [0.125, 0.06],
    [0.118, 0.14], [0.08, 0.19], [0.0, 0.20],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const craniumG = new THREE.LatheGeometry(craniumPts, 14);
  craniumG.scale(0.96, 1.0, 1.06);
  const skullGeo = mergeBufferGeometries([neckG, craniumG]);
  neckG.dispose(); craniumG.dispose();
  ownedGeos.push(skullGeo);
  const skull = new THREE.Mesh(skullGeo, skin);
  skull.receiveShadow = true;
  head.add(skull);

  const hair = track(new THREE.Mesh(new THREE.SphereGeometry(0.126, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), cloth));
  hair.position.set(0, 0.055, -0.008);
  head.add(hair);

  const visor = track(new THREE.Mesh(new THREE.CylinderGeometry(0.126, 0.126, 0.052, 14, 1, false, -0.85, 1.7), visorMat));
  visor.position.set(0, 0.04, 0.012);
  visor.visible = !!isPlayer;
  head.add(visor);

  // Brazos articulados (hombro -> codo -> antebrazo+mano)
  function buildArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.29, 0.57, 0);
    hips.add(shoulder);

    const upper = track(makeCapsuleMesh(0.062, 0.19, cloth, 0, -0.13, 0, false));
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.27, 0);
    shoulder.add(elbow);

    const foreG = new THREE.CapsuleGeometry(0.052, 0.18, 6, 10);
    foreG.translate(0, -0.12, 0);
    const handG = new THREE.SphereGeometry(0.056, 8, 8);
    handG.scale(0.85, 1.1, 0.95);
    handG.translate(0, -0.26, 0.01);
    const mergedFore = mergeBufferGeometries([foreG, handG]);
    foreG.dispose(); handG.dispose();
    ownedGeos.push(mergedFore);
    const fore = new THREE.Mesh(mergedFore, skin);
    fore.receiveShadow = true;
    elbow.add(fore);

    return { shoulder, elbow, upper, fore };
  }

  const armL = buildArm(-1);
  const armR = buildArm(1);

  // Piernas articuladas (cadera -> muslo -> rodilla -> espinilla+bota)
  function buildLeg(side) {
    const thighGrp = new THREE.Group();
    thighGrp.position.set(side * 0.125, -0.02, 0);
    hips.add(thighGrp);

    const thigh = track(makeCapsuleMesh(0.078, 0.28, cloth, 0, -0.20, 0, true));
    thighGrp.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, -0.42, 0);
    thighGrp.add(knee);

    const shinG = new THREE.CapsuleGeometry(0.065, 0.28, 6, 10);
    shinG.translate(0, -0.20, 0);
    const bootG = new THREE.BoxGeometry(0.15, 0.10, 0.26);
    bootG.translate(0, -0.45, 0.045);
    const mergedShin = mergeBufferGeometries([shinG, bootG]);
    shinG.dispose(); bootG.dispose();
    ownedGeos.push(mergedShin);
    const shin = new THREE.Mesh(mergedShin, matLib.darkMetal);
    shin.receiveShadow = true;
    knee.add(shin);

    return { thighGrp, knee, thigh, shin };
  }

  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // Accesorios de los 7 disfraces (fusionados por pieza, ocultos si no aplican)
  const chefPts = [[0, 0], [0.13, 0], [0.135, 0.12], [0.165, 0.20], [0.14, 0.26], [0, 0.27]].map(([r, y]) => new THREE.Vector2(r, y));
  const hatChef = track(new THREE.Mesh(new THREE.LatheGeometry(chefPts, 14), matLib.white));
  hatChef.position.set(0, 0.14, 0);
  head.add(hatChef);

  const capTopG = new THREE.CylinderGeometry(0.135, 0.13, 0.08, 12);
  capTopG.translate(0, 0.15, 0);
  const capBrimG = new THREE.BoxGeometry(0.24, 0.025, 0.14);
  capBrimG.translate(0, 0.115, 0.12);
  const capGeo = mergeBufferGeometries([capTopG, capBrimG]);
  capTopG.dispose(); capBrimG.dispose();
  ownedGeos.push(capGeo);
  const capGuard = new THREE.Mesh(capGeo, matLib.darkMetal);
  head.add(capGuard);

  const helmet = track(new THREE.Mesh(new THREE.SphereGeometry(0.142, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), matLib.gold));
  helmet.position.set(0, 0.09, 0);
  head.add(helmet);

  const coat = track(new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.28, 0.56, 14, 1, true), matLib.white));
  coat.position.set(0, 0.06, 0);
  hips.add(coat);

  const tie = track(new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.28, 0.02), matLib.gold));
  tie.position.set(0, 0.42, 0.155);
  hips.add(tie);

  const apron = track(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.025), matLib.white));
  apron.position.set(0, 0.06, 0.155);
  hips.add(apron);

  const tray = track(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.025, 14), matLib.brushedSteel));
  tray.position.set(0, -0.24, 0.16);
  armL.elbow.add(tray);

  const vest = track(new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.36, 0.29), vestMat));
  vest.position.set(0, 0.42, 0);
  hips.add(vest);

  // Objetos empuñados en la mano derecha (elbowR)
  const gunBody = new THREE.BoxGeometry(0.05, 0.11, 0.20);
  gunBody.translate(0, 0, 0.05);
  const gunSup = new THREE.CylinderGeometry(0.022, 0.022, 0.18, 8);
  gunSup.rotateX(Math.PI / 2);
  gunSup.translate(0, 0.035, 0.22);
  const gunGeo = mergeBufferGeometries([gunBody, gunSup]);
  gunBody.dispose(); gunSup.dispose();
  ownedGeos.push(gunGeo);
  const gun = new THREE.Mesh(gunGeo, matLib.darkMetal);
  gun.position.set(0, -0.27, 0.06);
  armR.elbow.add(gun);

  const wire = track(new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.36), matLib.brushedSteel));
  wire.position.set(0, -0.27, 0.08);
  armR.elbow.add(wire);

  const vial = track(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.13, 10), matLib.glowGreen));
  vial.position.set(0, -0.27, 0.07);
  armR.elbow.add(vial);

  const trapProp = track(new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.11, 0.045, 12), matLib.darkMetal));
  trapProp.position.set(0, -0.27, 0.08);
  armR.elbow.add(trapProp);

  const accessories = { hatChef, capGuard, helmet, coat, tie, apron, tray, vest };
  const held = { pistol: gun, garrote: wire, poison: vial, trap: trapProp };
  const parts = {
    hips, torso, chest, head, skull, hair, visor,
    armL: armL.shoulder, armR: armR.shoulder,
    elbowL: armL.elbow, elbowR: armR.elbow,
    legL: legL.thighGrp, legR: legR.thighGrp,
    kneeL: legL.knee, kneeR: legR.knee,
  };

  function applyOutfit(id, player) {
    const o = OUTFITS[id] || OUTFITS.suit;
    cloth.color.setHex(o.color);
    accent.color.setHex(o.accent);
    skin.color.setHex(player ? 0xcfd8e2 : o.skin);
    skin.metalness = player ? 0.86 : 0.02;
    skin.roughness = player ? 0.28 : 0.68;
    for (const k in accessories) accessories[k].visible = false;
    hair.visible = !player;
    visor.visible = !!player;
    if (id === 'cook') { accessories.hatChef.visible = true; accessories.apron.visible = true; }
    if (id === 'waiter') { accessories.vest.visible = true; accessories.tie.visible = true; accessories.tray.visible = true; }
    if (id === 'guard') { accessories.capGuard.visible = true; accessories.vest.visible = true; }
    if (id === 'scientist') { accessories.coat.visible = true; }
    if (id === 'tech') { accessories.helmet.visible = true; accessories.vest.visible = true; }
    if (id === 'vip') { accessories.tie.visible = true; }
  }
  applyOutfit(outfitId, isPlayer);

  return {
    group: g,
    parts,
    accessories,
    held,
    outfitId,
    _stripped: false,
    applyOutfit,
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
        cloth.color.setHex(0x8a8f98);
        accent.color.setHex(0x8a8f98);
        for (const k in accessories) accessories[k].visible = false;
      } else if (outfitFallback) {
        applyOutfit(outfitFallback, isPlayer);
      }
      this._stripped = !!flag;
    },
    pose(e, t, opts = {}) {
      const speed = e.moving || 0;
      const walk = speed > 0.05;
      const phase = t * (walk ? 4.2 + speed * 1.12 : 1.6) + (e.anim || 0);
      const amp = walk ? clamp(speed / 3.2, 0.25, 1.15) : 0.04;

      const sL = Math.sin(phase);
      const sR = -sL;
      parts.legL.rotation.set(sL * 0.62 * amp, 0, 0);
      parts.legR.rotation.set(sR * 0.62 * amp, 0, 0);
      parts.kneeL.rotation.set(walk ? Math.max(0, -sL) * 0.88 * amp : 0.05, 0, 0);
      parts.kneeR.rotation.set(walk ? Math.max(0, -sR) * 0.88 * amp : 0.05, 0, 0);

      parts.armL.rotation.set(-sL * 0.45 * amp, 0, 0.04);
      parts.armR.rotation.set(-sR * 0.45 * amp, 0, -0.04);
      parts.elbowL.rotation.set(accessories.tray.visible ? -1.25 : (-0.24 - Math.max(0, -sL) * 0.35 * amp), 0, 0);
      parts.elbowR.rotation.set(-0.24 - Math.max(0, -sR) * 0.35 * amp, 0, 0);

      parts.hips.position.y = 0.94 + (walk ? Math.abs(Math.cos(phase)) * 0.042 : Math.sin(t * 1.6) * 0.01);
      parts.hips.rotation.set(walk ? 0.04 * amp : 0, walk ? sL * 0.06 * amp : 0, 0);
      parts.head.rotation.set(0, Math.sin(t * 0.6 + (e.anim || 0)) * 0.14, 0);

      if (opts.crouch) {
        parts.hips.position.y = 0.64;
        parts.hips.rotation.x = 0.28;
        parts.legL.rotation.x = -0.78 + sL * 0.35 * amp;
        parts.legR.rotation.x = -0.78 + sR * 0.35 * amp;
        parts.kneeL.rotation.x = 1.15;
        parts.kneeR.rotation.x = 1.15;
      }
      if (opts.jackedIn) {
        parts.hips.position.y = opts.crouch ? 0.60 : 0.90;
        parts.hips.rotation.x = 0.16;
        parts.head.rotation.set(0.38, Math.sin(t * 2.2) * 0.05, 0);
        parts.armL.rotation.set(-0.72, 0.25, 0.18);
        parts.armR.rotation.set(-0.78, -0.25, -0.18);
        parts.elbowL.rotation.set(-1.15, 0, 0);
        parts.elbowR.rotation.set(-1.20 + Math.sin(t * 6) * 0.04, 0, 0);
      }
      if (opts.dragging) {
        parts.hips.rotation.x = 0.36;
        parts.hips.position.y = 0.82;
        parts.armL.rotation.set(0.65, 0, 0.1);
        parts.armR.rotation.set(0.65, 0, -0.1);
        parts.elbowL.rotation.set(-0.35, 0, 0);
        parts.elbowR.rotation.set(-0.35, 0, 0);
      }
      if (opts.aiming) {
        parts.armR.rotation.set(-1.42, -0.06, -0.08);
        parts.elbowR.rotation.set(-0.12, 0, 0);
        parts.armL.rotation.set(-1.18, 0.38, 0.18);
        parts.elbowL.rotation.set(-0.42, 0, 0);
      }
      if (opts.channel) {
        parts.hips.rotation.x = 0.22;
        parts.armR.rotation.set(-0.78 + Math.sin(t * 9) * 0.2, 0, 0);
        parts.elbowR.rotation.set(-0.65, 0, 0);
        parts.armL.rotation.set(-0.68, 0, 0);
        parts.elbowL.rotation.set(-0.55, 0, 0);
      }
      if (opts.dead || opts.sleep) {
        parts.hips.rotation.set(-Math.PI / 2, 0, opts.dead ? 0.12 : 0);
        parts.hips.position.y = 0.20;
        parts.legL.rotation.x = opts.dead ? 0.12 : -0.25;
        parts.legR.rotation.x = opts.dead ? -0.1 : -0.15;
        parts.kneeL.rotation.x = opts.dead ? 0.18 : 0.65;
        parts.kneeR.rotation.x = opts.dead ? 0.08 : 0.45;
        parts.armL.rotation.x = -0.45;
        parts.armR.rotation.x = 0.32;
      }
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

  const hull = track(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.50), bodyMat));
  hull.castShadow = true;
  hull.receiveShadow = true;
  chassis.add(hull);

  const carapace = track(new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.05, 0.38), trimMat));
  carapace.position.set(0, 0.09, -0.02);
  chassis.add(carapace);

  // Cabezal sensor en cardán
  const gimbal = new THREE.Group();
  gimbal.position.set(0, 0.04, 0.25);
  chassis.add(gimbal);

  const pod = track(new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), matLib.darkMetal));
  gimbal.add(pod);

  const eye = track(new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.04, 12), eyeMat));
  eye.rotation.x = Math.PI / 2;
  eye.position.z = 0.065;
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
    mount.position.set(mnt.sx * 0.18, -0.02, mnt.sz * 0.18);
    mount.rotation.y = mnt.sx * -0.28 * mnt.sz;
    chassis.add(mount);

    const femur = new THREE.Group();
    mount.add(femur);
    const femurMesh = track(makeCapsuleMesh(0.028, l1 - 0.05, trimMat, 0, -l1 * 0.5, 0, false));
    femur.add(femurMesh);

    const tibia = new THREE.Group();
    tibia.position.set(0, -l1, 0);
    femur.add(tibia);
    const tibiaMesh = track(makeCapsuleMesh(0.022, l2 - 0.04, matLib.darkMetal, 0, -l2 * 0.5, 0, false));
    tibia.add(tibiaMesh);

    const foot = track(new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), eyeMat));
    foot.position.set(0, -l2, 0);
    tibia.add(foot);

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

      const baseHex = disabled ? 0x334048 : hijacked ? COLORS.gold : (kind === 'maint' ? COLORS.amber : COLORS.cyan);
      eyeMat.color.setHex(baseHex).multiplyScalar(disabled ? 0.6 : 1.75);

      const bodyY = disabled ? 0.19 : 0.35 + (moving ? Math.sin(t * 14) * 0.015 : Math.sin(t * 2.5) * 0.008);
      chassis.position.y = bodyY;
      chassis.rotation.x = disabled ? 0.18 : (moving ? 0.05 : 0);
      chassis.rotation.z = moving ? Math.sin(t * 7 + (unit.anim || 0)) * 0.04 : 0;
      gimbal.rotation.y = disabled ? -0.4 : Math.sin(t * 2.2 + (unit.anim || 0)) * 0.35;
      gimbal.rotation.x = disabled ? 0.45 : 0;

      const freq = 6.5 + speed * 1.8;
      const stride = moving ? clamp(speed / 3.4, 0.25, 1.0) * 0.13 : 0;
      const liftH = moving ? 0.09 : 0;

      for (const leg of legs) {
        const ph = t * freq + (unit.anim || 0) + leg.phaseOff;
        const s = Math.sin(ph);
        const c = Math.cos(ph);
        const stepZ = leg.sz * 0.05 + c * stride;
        const lift = Math.max(0, s) * liftH;
        const targetYDown = Math.max(0.12, (bodyY - 0.02) - lift);
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
