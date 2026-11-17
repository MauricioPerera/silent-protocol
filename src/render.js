// ---------------------------------------------------------------------------
// Orquestador 3D (Three.js r160): PBR, rigs FK/IK, pool de luces y Post-FX
// ---------------------------------------------------------------------------
import * as THREE from '../vendor/three.module.js';
import { WALLS, PROPS, DOORS, LIGHTS, zoneAt } from './level.js';
import { ZONES, COLORS, VISION } from './config.js';
import { clamp, segBox, normAngle } from './mathx.js';
import { signalOrigin } from './cyber.js';
import { createMaterialLibrary } from './render/mats.js';
import { createHumanoidRig, createBotRig } from './render/rigs.js';
import {
  scaleGeometryUVs, scaleBoxUVs, mergeBufferGeometries, mergeStaticMeshes,
  buildPropMesh, buildLightCone,
} from './render/props.js';
import { createPostFX } from './render/postfx.js';

const tmpV = new THREE.Vector3();

function labelTexture(text, color = '#8fe9dd', bg = 'rgba(6,12,16,0.85)') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  if (bg !== 'rgba(0,0,0,0)') {
    g.strokeStyle = color; g.lineWidth = 4; g.strokeRect(6, 6, 500, 116);
  }
  g.fillStyle = color;
  g.font = 'bold 54px monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function coneMesh(range, fov, color) {
  const seg = 22;
  const pos = [0, 0, 0];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = -fov / 2 + (fov * i) / seg;
    pos.push(Math.sin(a) * range, 0, Math.cos(a) * range);
    if (i > 0) idx.push(0, i, i + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.06;
  m.renderOrder = 2;
  return m;
}

export class View {
  constructor(canvas, sim, opts = {}) {
    this.canvas = canvas;
    this.sim = sim;
    this.quality = opts.quality || 'high';
    this.showcaseMode = !!opts.showcase;
    this.shaderErrors = [];
    this.ownedTextures = [];
    this.ownedGeos = [];
    this.ownedMats = [];

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.debug.checkShaderErrors = true;
    this.renderer.debug.onShaderError = (gl, _prog, vShader, fShader) => {
      this.shaderErrors.push({
        vertex: gl.getShaderInfoLog(vShader) || '',
        fragment: gl.getShaderInfoLog(fShader) || '',
      });
    };
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.matLib = createMaterialLibrary(this.renderer, this.quality);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050a14);
    this.scene.fog = new THREE.Fog(0x060d19, 64, 185);
    this.scene.environment = this.matLib.envMap;
    this.matLib.onEnvUpdate((tex) => {
      this.scene.environment = tex;
    });

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 340);
    this.camYaw = Math.PI;
    this.camPitch = 0.42;
    this.camDist = 4.6;
    this.camPos = new THREE.Vector3(0, 4, 28);

    const w = canvas.clientWidth || innerWidth || 1280;
    const h = canvas.clientHeight || innerHeight || 720;
    this.postfx = createPostFX(this.renderer, w, h, this.quality);

    this.chars = new Map();
    this.unitRigs = new Map();
    this.cones = new Map();
    this.fxObjects = [];
    this.seenFx = new WeakSet();
    this.instinct = false;
    this.time = 0;
    this.lastDrawCalls = 0;
    this.lastTriangles = 0;

    if (!this.showcaseMode) {
      this.buildSky();
      this.buildLights();
      this.buildLevel();
      this.buildInteractables();
      this.buildCameras();
      this.buildCharactersAndUnits();
      this.buildContactShadows();
      this.buildFxPool();
      this.resize();
      this.precompileShaders();
    } else {
      this.resize();
    }
  }

  precompileShaders() {
    this.wallMesh.material = this.matLib.wallXray;
    this.trimMesh.material = this.matLib.trimXray;
    this.postfx.compile(this.scene, this.camera);
    this.wallMesh.material = this.matLib.wallOpaque;
    this.trimMesh.material = this.matLib.trimOpaque;
    this.postfx.compile(this.scene, this.camera);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(220, 48, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: true,
      uniforms: {
        top: { value: new THREE.Color(0x081222) },
        bot: { value: new THREE.Color(0x0c1726) },
        uPano: { value: this.matLib.skyTex },
        uOffset: { value: this.matLib.skyUOffset ?? 0.106 },
        uMix: { value: this.matLib.hasPano ? 1.0 : 0.0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        void main() {
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 top;
        uniform vec3 bot;
        uniform sampler2D uPano;
        uniform float uOffset;
        uniform float uMix;
        varying vec3 vP;
        void main() {
          vec3 d = normalize(vP);
          float h = d.y * 0.5 + 0.5;
          vec3 grad = mix(bot, top, smoothstep(0.35, 0.85, h));
          float u = fract(atan(d.z, d.x) * 0.15915494 + uOffset);
          float v = clamp(asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5, 0.002, 0.998);
          vec3 pano = texture2D(uPano, vec2(u, v)).rgb;
          float lum = dot(pano, vec3(0.2126, 0.7152, 0.0722));
          pano *= 1.08 + smoothstep(0.35, 0.90, lum) * 0.65;
          gl_FragColor = vec4(mix(grad, pano, uMix), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.ownedGeos.push(geo);
    this.ownedMats.push(mat);
    this.skyDome = new THREE.Mesh(geo, mat);
    this.skyDome.frustumCulled = false;
    this.skyMat = mat;
    this.skyMix = this.matLib.hasPano ? 1.0 : 0.0;
    this.scene.add(this.skyDome);

    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 450; i++) {
      const a = (i * 2.39996) % (Math.PI * 2);
      const y = 22 + ((i * 37) % 115);
      const r = 92 + ((i * 19) % 48);
      pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x9fb6d8, size: 0.7, sizeAttenuation: true, fog: false });
    this.ownedGeos.push(starGeo);
    this.ownedMats.push(starMat);
    this.skyStars = new THREE.Points(starGeo, starMat);
    this.scene.add(this.skyStars);
  }

  updateSky(dt) {
    if (!this.skyDome || !this.skyMat) return;
    this.skyDome.position.set(this.camera.position.x, 0, this.camera.position.z);
    if (this.matLib.hasPano && this.skyMix < 1) {
      this.skyMix = Math.min(1, this.skyMix + Math.max(0.016, dt) * 2.8);
      this.skyMat.uniforms.uMix.value = this.skyMix;
      this.skyMat.uniformsNeedUpdate = true;
    }
    if (this.skyStars) {
      this.skyStars.visible = this.skyMix < 0.98;
    }
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x3a4a68, 0x0b0f16, 0.50));
    const moon = new THREE.DirectionalLight(0xa6c0ec, 0.78);
    moon.position.set(-28, 40, 22);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const c = moon.shadow.camera;
    c.left = -34; c.right = 34; c.top = 34; c.bottom = -34; c.near = 1; c.far = 110;
    moon.shadow.bias = -0.0009;
    moon.shadow.normalBias = 0.03;
    this.scene.add(moon);
    this.moon = moon;

    // Pool fijo de 7 PointLight siempre visibles (evita recompilar shaders PBR)
    this.lightPool = [];
    for (let i = 0; i < 7; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 16, 2);
      pl.visible = true;
      this.scene.add(pl);
      this.lightPool.push(pl);
    }

    this.lightFixtures = LIGHTS.map((l) => {
      const zn = zoneAt(l.x, l.z) || 'other';
      const outdoor = zn === 'patio';
      const coneObj = buildLightCone(l, this.matLib);
      coneObj.group.visible = !outdoor;
      if (!outdoor) this.scene.add(coneObj.group);
      return {
        def: l,
        zone: zn,
        outdoor,
        coneObj,
        score: 0,
        flicker: 1,
      };
    });
  }

  buildLevel() {
    // Bahía nocturna circundante (refleja el panorama lunar PMREM bajo el muelle y la lancha)
    const seaGeo = scaleGeometryUVs(new THREE.PlaneGeometry(360, 360), 120, 240);
    this.ownedGeos.push(seaGeo);
    const sea = new THREE.Mesh(seaGeo, this.matLib.ocean);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.11;
    sea.receiveShadow = true;
    this.scene.add(sea);

    // Plataforma costera de piedra que sostiene el perímetro completo [-22..22] x [-18..26]
    const cliffGeo = scaleBoxUVs(new THREE.BoxGeometry(46.4, 0.32, 45.2), 46.4, 0.32, 45.2, 3.2);
    this.ownedGeos.push(cliffGeo);
    const cliff = new THREE.Mesh(cliffGeo, this.matLib.concrete);
    cliff.position.set(0, -0.165, 3.4);
    cliff.receiveShadow = true;
    this.scene.add(cliff);

    this.zoneFloors = {};
    this.zoneLabels = [];
    for (const z of ZONES) {
      const [x0, z0, x1, z1] = z.rect;
      const w = x1 - x0, d = z1 - z0;
      const geo = scaleGeometryUVs(new THREE.PlaneGeometry(w, d), w / 3.2, d / 3.2);
      this.ownedGeos.push(geo);
      const mat = this.matLib.makeZoneFloorMaterial(z);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      m.receiveShadow = true;
      this.scene.add(m);
      this.zoneFloors[z.id] = m;

      const lTex = labelTexture(z.name);
      const lGeo = new THREE.PlaneGeometry(6, 1.5);
      const lMat = new THREE.MeshBasicMaterial({ map: lTex, transparent: true, depthTest: false, opacity: 0.9 });
      this.ownedTextures.push(lTex);
      this.ownedGeos.push(lGeo);
      this.ownedMats.push(lMat);
      const lab = new THREE.Mesh(lGeo, lMat);
      lab.position.set((x0 + x1) / 2, 3.6, (z0 + z1) / 2);
      lab.renderOrder = 5;
      lab.visible = false;
      this.scene.add(lab);
      this.zoneLabels.push(lab);
    }

    // Muros fusionados en 1 malla principal + 1 malla de remate superior (intercambio instantáneo en Instinto)
    const wallGeos = [];
    const trimGeos = [];
    for (const w of WALLS) {
      const wg = scaleBoxUVs(new THREE.BoxGeometry(w.w, w.h, w.d), w.w, w.h, w.d, 2.8);
      wg.translate(w.x, w.h / 2, w.z);
      wallGeos.push(wg);

      const tg = new THREE.BoxGeometry(w.w + 0.02, 0.05, w.d + 0.02);
      tg.translate(w.x, w.h - 0.04, w.z);
      trimGeos.push(tg);
    }
    const mergedWallGeo = mergeBufferGeometries(wallGeos);
    const mergedTrimGeo = mergeBufferGeometries(trimGeos);
    for (const g of [...wallGeos, ...trimGeos]) g.dispose();
    this.ownedGeos.push(mergedWallGeo, mergedTrimGeo);

    this.wallMesh = new THREE.Mesh(mergedWallGeo, this.matLib.wallOpaque);
    this.wallMesh.castShadow = true;
    this.wallMesh.receiveShadow = true;
    this.wallMesh.renderOrder = 1;
    this.scene.add(this.wallMesh);

    this.trimMesh = new THREE.Mesh(mergedTrimGeo, this.matLib.trimOpaque);
    this.trimMesh.castShadow = false;
    this.trimMesh.renderOrder = 1;
    this.scene.add(this.trimMesh);

    // Puertas con carteles fusionados por texto + marcos candidatos a fusión estática
    const doorTexCache = new Map();
    const doorSignBuckets = new Map();
    const staticRoots = [];
    if (this.lightFixtures) {
      for (const lf of this.lightFixtures) {
        if (!lf.outdoor) staticRoots.push(lf.coneObj.group);
      }
    }

    for (const d of DOORS) {
      let sMat = doorTexCache.get(d.label);
      if (!sMat) {
        const tex = labelTexture(d.label, '#ffca7a');
        sMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
        this.ownedTextures.push(tex);
        this.ownedMats.push(sMat);
        doorTexCache.set(d.label, sMat);
        doorSignBuckets.set(d.label, []);
      }
      const bucket = doorSignBuckets.get(d.label);
      const m1 = new THREE.Matrix4().makeRotationY(d.rot).setPosition(d.x, 0, d.z);
      const s1 = new THREE.PlaneGeometry(2.2, 0.55);
      s1.translate(0, 2.55, 0.25);
      s1.applyMatrix4(m1);
      bucket.push(s1);
      const s2 = new THREE.PlaneGeometry(2.2, 0.55);
      s2.rotateY(Math.PI);
      s2.translate(0, 2.55, -0.25);
      s2.applyMatrix4(m1);
      bucket.push(s2);

      const g = new THREE.Group();
      g.position.set(d.x, 0, d.z);
      g.rotation.y = d.rot;

      const pL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 2.35, 0.50), this.matLib.paintedMetal);
      pL.position.set(-1.15, 1.175, 0);
      pL.castShadow = true; pL.receiveShadow = true;
      g.add(pL);
      const pR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 2.35, 0.50), this.matLib.paintedMetal);
      pR.position.set(1.15, 1.175, 0);
      pR.castShadow = true; pR.receiveShadow = true;
      g.add(pR);

      this.scene.add(g);
      staticRoots.push(g);
    }
    for (const [label, geos] of doorSignBuckets) {
      const mergedSign = mergeBufferGeometries(geos);
      for (const sg of geos) sg.dispose();
      this.ownedGeos.push(mergedSign);
      this.scene.add(new THREE.Mesh(mergedSign, doorTexCache.get(label)));
    }

    this.propRefs = { ownedMaterials: [] };
    for (const p of PROPS) {
      const pg = buildPropMesh(p, this.matLib, this.propRefs);
      this.scene.add(pg);
      staticRoots.push(pg);
    }

    // Obras de arte y planos técnicos enmarcados sobre muros sólidos verificados (cero impacto en sim.boxes)
    const wallArtworks = [
      { kind: 'painting', art: 'portrait',  x: 0.0,    y: 1.92, z: -5.77,  w: 2.05, h: 2.05, rot: 0 },
      { kind: 'painting', art: 'maritime',  x: 13.77,  y: 1.84, z: 3.80,   w: 2.65, h: 1.55, rot: -Math.PI / 2 },
      { kind: 'painting', art: 'maritime',  x: 13.77,  y: 1.84, z: -3.80,  w: 2.40, h: 1.45, rot: -Math.PI / 2 },
      { kind: 'painting', art: 'maritime',  x: -13.77, y: 1.84, z: -3.00,  w: 2.45, h: 1.45, rot: Math.PI / 2 },
      { kind: 'painting', art: 'maritime',  x: 14.0,   y: 1.86, z: -17.77, w: 2.80, h: 1.62, rot: 0 },
      { kind: 'painting', art: 'portrait',  x: 16.6,   y: 1.78, z: -12.23, w: 1.45, h: 1.45, rot: Math.PI },
      { kind: 'painting', art: 'maritime',  x: 4.8,    y: 1.80, z: -11.77, w: 2.20, h: 1.32, rot: 0 },
      { kind: 'painting', art: 'blueprint', x: 21.77,  y: 1.88, z: -1.20,  w: 2.20, h: 1.55, rot: -Math.PI / 2 },
      { kind: 'painting', art: 'blueprint', x: 21.77,  y: 1.88, z: 7.40,   w: 2.20, h: 1.55, rot: -Math.PI / 2 },
    ];
    for (const wa of wallArtworks) {
      const wg = buildPropMesh(wa, this.matLib, this.propRefs);
      this.scene.add(wg);
      staticRoots.push(wg);
    }

    this.chandelier = this.propRefs.chandelier || null;
    this.boat = this.propRefs.boat || null;
    this.puddles = { lab: this.propRefs.puddleLab || null };
    this.terminalScreen = this.propRefs.terminalScreen || null;
    this.poolWater = this.propRefs.poolWater || null;

    // Fusiona todo el mobiliario opaco estático + marcos de puertas por material
    this.staticBatch = mergeStaticMeshes(staticRoots);
    for (const m of this.staticBatch.meshes) this.scene.add(m);
  }

  buildInteractables() {
    this.itMarkers = [];
    const ringGeo = new THREE.RingGeometry(0.34, 0.46, 20);
    const iconGeo = new THREE.PlaneGeometry(0.7, 0.7);
    this.ownedGeos.push(ringGeo, iconGeo);

    const iconTexCache = new Map();
    for (const id in this.sim.interactables) {
      const it = this.sim.interactables[id];
      if (it.type === 'lure') continue;
      const color = {
        container: COLORS.cyan, poison: 0x7dffb0, sabotage: COLORS.amber,
        cameras: 0x9fb6ff, intel: COLORS.gold, extract: COLORS.green, pickup: 0xffffff,
      }[it.type] || 0xffffff;
      const sym = { container: '▣', poison: '☠', sabotage: '⚡', cameras: '◉', intel: '◆', extract: '➤', pickup: '+' }[it.type] || '?';
      const cacheKey = `${sym}_${color}`;
      let iMat = iconTexCache.get(cacheKey);
      if (!iMat) {
        const tex = labelTexture(sym, '#' + color.toString(16).padStart(6, '0'), 'rgba(0,0,0,0)');
        iMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false });
        this.ownedTextures.push(tex);
        this.ownedMats.push(iMat);
        iconTexCache.set(cacheKey, iMat);
      }

      const g = new THREE.Group();
      const rMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false });
      this.ownedMats.push(rMat);
      const ring = new THREE.Mesh(ringGeo, rMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      ring.renderOrder = 4;
      g.add(ring);

      const icon = new THREE.Mesh(iconGeo, iMat);
      icon.position.y = 1.5;
      icon.renderOrder = 4;
      g.add(icon);

      g.position.set(it.x, 0, it.z);
      g.visible = false;
      this.scene.add(g);
      this.itMarkers.push({ it, group: g, ring, icon });
    }
  }

  buildCameras() {
    this.camMeshes = [];
    const bodyGeo = new THREE.BoxGeometry(0.22, 0.18, 0.38);
    const lensGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.10, 12);
    lensGeo.rotateX(Math.PI / 2);
    this.ownedGeos.push(bodyGeo, lensGeo);

    for (const c of this.sim.cams) {
      const g = new THREE.Group();
      g.position.set(c.x, 2.7, c.z);
      g.rotation.y = c.yaw;
      g.add(new THREE.Mesh(bodyGeo, this.matLib.darkMetal));
      const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.red).multiplyScalar(1.5), toneMapped: false });
      this.ownedMats.push(lensMat);
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(0, 0, 0.23);
      g.add(lens);
      this.scene.add(g);

      const cone = coneMesh(c.range, c.fov, COLORS.red);
      cone.position.set(c.x, 0.07, c.z);
      cone.rotation.y = c.yaw;
      cone.material.opacity = 0.10;
      cone.visible = false;
      this.ownedGeos.push(cone.geometry);
      this.ownedMats.push(cone.material);
      this.scene.add(cone);
      this.camMeshes.push({ c, group: g, lens, cone });
    }
  }

  buildCharactersAndUnits() {
    this.playerChar = createHumanoidRig(this.sim.player.outfit, true, this.matLib);
    this.scene.add(this.playerChar.group);

    for (const n of this.sim.npcs) {
      const c = createHumanoidRig(n.outfit, false, this.matLib, {
        id: n.id,
        role: n.role,
        target: !!n.target,
        enforcerFor: n.enforcerFor || null,
      });
      this.scene.add(c.group);
      this.chars.set(n.id, c);
      const cone = coneMesh(VISION.range, VISION.fov, COLORS.cyan);
      cone.visible = false;
      this.ownedGeos.push(cone.geometry);
      this.ownedMats.push(cone.material);
      this.scene.add(cone);
      this.cones.set(n.id, cone);
    }

    for (const u of (this.sim.units || [])) {
      const br = createBotRig(u.kind, this.matLib);
      this.scene.add(br.group);
      this.unitRigs.set(u.id, br);
    }
  }

  buildContactShadows() {
    const sz = 64;
    const buf = new Uint8Array(sz * sz * 4);
    for (let y = 0; y < sz; y++) {
      const dy = (y + 0.5) / sz * 2 - 1;
      for (let x = 0; x < sz; x++) {
        const dx = (x + 0.5) / sz * 2 - 1;
        const r2 = Math.min(1, dx * dx + dy * dy);
        const a = Math.pow(1 - r2, 2.25);
        const o = (y * sz + x) * 4;
        buf[o] = 2;
        buf[o + 1] = 4;
        buf[o + 2] = 8;
        buf[o + 3] = Math.round(a * 255);
      }
    }
    const shadowTex = new THREE.DataTexture(buf, sz, sz, THREE.RGBAFormat);
    shadowTex.needsUpdate = true;
    this.ownedTextures.push(shadowTex);

    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    this.ownedGeos.push(shadowGeo);

    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    this.ownedMats.push(shadowMat);

    const groundedKinds = new Set([
      'table', 'chair', 'podium', 'buffet', 'plant', 'piano', 'sofa',
      'pod', 'cryo', 'terminal', 'crate', 'toolbox', 'fountain', 'lounge', 'statue',
    ]);
    const staticProps = PROPS.filter((pr) => groundedKinds.has(pr.kind));
    this.dynShadowSlots = 1 + this.sim.npcs.length + (this.sim.units ? this.sim.units.length : 0);
    const total = this.dynShadowSlots + staticProps.length;

    const inst = new THREE.InstancedMesh(shadowGeo, shadowMat, total);
    inst.frustumCulled = false;
    inst.renderOrder = 2;

    this._shadowDummy = new THREE.Matrix4();
    this._shadowPos = new THREE.Vector3();
    this._shadowQuat = new THREE.Quaternion();
    this._shadowScale = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);

    staticProps.forEach((pr, idx) => {
      const slot = this.dynShadowSlots + idx;
      const sx = (pr.w || (pr.r ? pr.r * 2 : 1)) * 1.24;
      const szp = (pr.d || (pr.r ? pr.r * 2 : 1)) * 1.24;
      this._shadowPos.set(pr.x, 0.024, pr.z);
      this._shadowQuat.setFromAxisAngle(this._yAxis, pr.rot || 0);
      this._shadowScale.set(sx, 1, szp);
      this._shadowDummy.compose(this._shadowPos, this._shadowQuat, this._shadowScale);
      inst.setMatrixAt(slot, this._shadowDummy);
    });
    inst.instanceMatrix.needsUpdate = true;
    this.contactShadows = inst;
    this.scene.add(inst);
  }

  updateContactShadows(sim) {
    const inst = this.contactShadows;
    if (!inst) return;
    const shadowY = (x, z) => (Math.abs(x) <= 2.05 && z >= 22.45 ? 0.156 : 0.025);
    const setSlot = (slot, x, z, yaw, sx, sz) => {
      this._shadowPos.set(x, shadowY(x, z), z);
      this._shadowQuat.setFromAxisAngle(this._yAxis, yaw);
      this._shadowScale.set(sx, 1, sz);
      this._shadowDummy.compose(this._shadowPos, this._shadowQuat, this._shadowScale);
      inst.setMatrixAt(slot, this._shadowDummy);
    };

    const p = sim.player;
    const ps = p.crouch ? 0.92 : 1.06;
    setSlot(0, p.x, p.z, p.yaw, ps, ps);

    const bodyMap = new Map();
    for (const b of sim.bodies) {
      if (!b.hidden) bodyMap.set(b.npcId, b);
    }

    for (let i = 0; i < sim.npcs.length; i++) {
      const n = sim.npcs[i];
      const slot = 1 + i;
      if (n.alive && n.conscious) {
        setSlot(slot, n.x, n.z, n.yaw, 1.02, 1.02);
      } else {
        const b = bodyMap.get(n.id);
        if (b) setSlot(slot, b.x, b.z, b.yaw, 0.94, 1.82);
        else setSlot(slot, 0, -50, 0, 0, 0);
      }
    }

    const baseUnit = 1 + sim.npcs.length;
    const units = sim.units || [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      setSlot(baseUnit + i, u.x, u.z, u.yaw, 0.96, 1.18);
    }
    inst.instanceMatrix.needsUpdate = true;
  }

  buildFxPool() {
    this.fxGroup = new THREE.Group();
    this.scene.add(this.fxGroup);
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
    this.linkLineMat = new THREE.LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.65 });
    this.ringGeo = new THREE.RingGeometry(0.5, 0.62, 24);
    this.linkLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.linkLine = new THREE.Line(this.linkLineGeo, this.linkLineMat);
    this.linkLine.visible = false;
    this.linkLine.frustumCulled = false;
    this.scene.add(this.linkLine);

    this.ownedMats.push(this.tracerMat, this.linkLineMat);
    this.ownedGeos.push(this.ringGeo, this.linkLineGeo);

    this.muzzleLight = new THREE.PointLight(0xffd9a0, 0, 8, 2);
    this.muzzleLight.visible = true;
    this.muzzleUntil = 0;
    this.scene.add(this.muzzleLight);
  }

  disposeTrapGroup(group) {
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      if (o.material && !this.matLib.sharedSet.has(o.material)) o.material.dispose?.();
    });
  }

  disposeFxEntry(o) {
    this.fxGroup.remove(o.mesh);
    if (o.kind === 'line') o.mesh.geometry?.dispose?.();
    else if (o.kind === 'ring') o.mesh.material?.dispose?.();
  }

  attachSim(sim) {
    this.sim = sim;
    this.seenFx = new WeakSet();
    if (this.traps) {
      for (const [, m] of this.traps) { this.scene.remove(m); this.disposeTrapGroup(m); }
      this.traps.clear();
    }
    for (const o of this.fxObjects) this.disposeFxEntry(o);
    this.fxObjects.length = 0;
    this.muzzleLight.intensity = 0;
    this.muzzleUntil = 0;
    this.linkLine.visible = false;
    if (this.coinMeshes) this.coinMeshes.forEach((m) => { m.visible = false; });
    if (this.chandelier) { this.chandelier.rotation.set(0, 0, 0); this.chandelier.position.y = 4.2; }
    if (this.puddles && this.puddles.lab && this.puddles.lab.material.emissive) {
      this.puddles.lab.material.emissive.setHex(0x000000);
      this.puddles.lab.material.emissiveIntensity = 0;
    }
    if (this.terminalScreen) this.terminalScreen.material.color.setHex(COLORS.cyan).multiplyScalar(1.5);
    for (const m of this.itMarkers) {
      if (sim.interactables[m.it.id]) m.it = sim.interactables[m.it.id];
      const baseColor = {
        container: COLORS.cyan, poison: 0x7dffb0, sabotage: COLORS.amber,
        cameras: 0x9fb6ff, intel: COLORS.gold, extract: COLORS.green, pickup: 0xffffff,
      }[m.it.type] || 0xffffff;
      m.ring.material.color.setHex(baseColor);
    }
    for (const cm of this.camMeshes) {
      const nextCam = sim.cams.find((c) => c.id === cm.c.id);
      if (nextCam) cm.c = nextCam;
    }
    this.playerChar.applyOutfit(sim.player.outfit, true);
    this.playerChar.resetPose();
    for (const n of sim.npcs) {
      const c = this.chars.get(n.id);
      if (c) {
        c.applyOutfit(n.outfit, false);
        c.resetPose();
        c._stripped = false;
        c.setInstinctHighlight(0x000000, 0x000000);
        c.group.visible = true;
      }
    }
    this.camPos.set(sim.player.x, 4, sim.player.z + 5);
    this._xrayState = undefined;
  }

  setQuality(q) {
    const prevShadows = this.renderer.shadowMap.enabled;
    const prevPostfx = this.postfx.enabled;
    this.quality = q;
    const dpr = devicePixelRatio || 1;
    if (q === 'high') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.6));
      this.renderer.shadowMap.enabled = true;
    } else if (q === 'medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.15));
      this.renderer.shadowMap.enabled = true;
    } else {
      this.renderer.setPixelRatio(0.85);
      this.renderer.shadowMap.enabled = false;
    }
    if (this.moon) this.moon.castShadow = q !== 'low';
    this.matLib.setQuality(q);
    const w = Math.max(2, this.canvas.clientWidth || innerWidth || 1280);
    const h = Math.max(2, this.canvas.clientHeight || innerHeight || 720);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx.setQuality(q, w, h);
    if (!this.showcaseMode && this.wallMesh && (prevShadows !== this.renderer.shadowMap.enabled || prevPostfx !== this.postfx.enabled)) {
      this.precompileShaders();
    }
  }

  resize() {
    const w = Math.max(2, this.canvas.clientWidth || innerWidth || 1280);
    const h = Math.max(2, this.canvas.clientHeight || innerHeight || 720);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx.resize(w, h);
  }

  updateCamera(dt, input) {
    const sim = this.sim;
    const link = sim.link;

    if (link && link.mode === 'camera') {
      const cam = sim.cams.find((c) => c.id === link.targetId);
      if (cam) {
        const yaw = cam.yaw + (link.camYawOffset || 0);
        const pitch = clamp(link.camPitch ?? 0.22, -0.15, 0.75);
        const fx = Math.sin(yaw) * Math.cos(pitch);
        const fy = -Math.sin(pitch);
        const fz = Math.cos(yaw) * Math.cos(pitch);
        this.camera.position.set(cam.x + Math.sin(cam.yaw) * 0.28, 2.66, cam.z + Math.cos(cam.yaw) * 0.28);
        this.camera.lookAt(cam.x + fx * 10, 2.66 + fy * 10, cam.z + fz * 10);
        this.camPos.copy(this.camera.position);
        return;
      }
    }

    if (link && link.mode === 'unit') {
      const u = sim.units && sim.units.find((x) => x.id === link.targetId);
      if (u) {
        this.camYaw = input.camYaw;
        this.camPitch = clamp(input.camPitch, 0.05, 0.95);
        const distTarget = 2.35;
        const headY = 0.55;
        const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
        const ox = u.x - fx * distTarget * Math.cos(this.camPitch);
        const oz = u.z - fz * distTarget * Math.cos(this.camPitch);
        const oy = headY + distTarget * Math.sin(this.camPitch) + 0.22;
        const dx = ox - u.x, dz = oz - u.z;
        const len = Math.hypot(dx, dz) || 1;
        let allowed = len;
        for (const b of sim.unitBoxes) {
          if (!b.tall) continue;
          const t = segBox(u.x, u.z, ox, oz, b);
          if (t >= 0 && t <= 1) allowed = Math.min(allowed, t * len - 0.18);
        }
        allowed = Math.max(0.55, allowed);
        const k = allowed / len;
        this.camPos.lerp(tmpV.set(u.x + dx * k, headY + (oy - headY) * k, u.z + dz * k), Math.min(1, dt * 16));
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(u.x + fx * 2.0, headY + 0.1 - this.camPitch * 0.6, u.z + fz * 2.0);
        return;
      }
    }

    const p = sim.player;
    this.camYaw = input.camYaw;
    this.camPitch = clamp(input.camPitch, -0.35, 1.15);
    const targetDist = input.aim ? 2.5 : (p.crouch ? 4.0 : 4.7);
    this.camDist += (targetDist - this.camDist) * Math.min(1, dt * 8);
    const headY = p.crouch ? 1.15 : 1.62;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const shoulder = input.aim ? 0.75 : 0.35;
    const ox = p.x - fx * this.camDist * Math.cos(this.camPitch) - fz * shoulder;
    const oz = p.z - fz * this.camDist * Math.cos(this.camPitch) + fx * shoulder;
    const oy = headY + this.camDist * Math.sin(this.camPitch) + 0.35;
    const dx = ox - p.x, dz = oz - p.z;
    const len = Math.hypot(dx, dz) || 1;
    let allowed = len;
    for (const b of sim.boxes) {
      if (!b.tall) continue;
      const t = segBox(p.x, p.z, ox, oz, b);
      if (t >= 0 && t <= 1) allowed = Math.min(allowed, t * len - 0.25);
    }
    allowed = Math.max(0.9, allowed);
    const k = allowed / len;
    const cx = p.x + dx * k, cz = p.z + dz * k;
    const cy = headY + (oy - headY) * k;
    this.camPos.lerp(tmpV.set(cx, cy, cz), Math.min(1, dt * 14));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(p.x + fx * 2.2, headY + (input.aim ? 0.1 : 0.25) - this.camPitch * 1.4, p.z + fz * 2.2);
  }

  aimRay() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const o = this.camera.position;
    return { ox: o.x, oy: o.y, oz: o.z, dx: dir.x, dy: dir.y, dz: dir.z };
  }

  project(x, y, z) {
    tmpV.set(x, y, z).project(this.camera);
    return {
      x: (tmpV.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-tmpV.y * 0.5 + 0.5) * this.canvas.clientHeight,
      behind: tmpV.z > 1,
    };
  }

  updateLightPool(sim, focusX, focusZ) {
    for (const lf of this.lightFixtures) {
      const dx = lf.def.x - focusX, dz = lf.def.z - focusZ;
      lf.score = dx * dx + dz * dz;
      const off = sim.blackout > 0 && lf.zone === 'hall';
      lf.flicker = off ? (Math.sin(this.time * 31 + lf.def.x) > 0.88 ? 0.35 : 0.02) : 1;
    }
    const sorted = this.lightFixtures.slice().sort((a, b) => a.score - b.score);
    const activeLimit = this.quality === 'low' ? 4 : this.lightPool.length;
    for (let i = 0; i < sorted.length; i++) {
      const f = (!sorted[i].outdoor && i < activeLimit) ? sorted[i].flicker * (this.instinct ? 0.55 : 1) : 0;
      sorted[i].coneObj.setFactor(f);
    }
    const instScale = this.instinct ? 0.75 : 1;
    for (let i = 0; i < this.lightPool.length; i++) {
      const pl = this.lightPool[i];
      const item = i >= activeLimit ? null : sorted[i];
      if (!item) {
        pl.intensity = 0;
        continue;
      }
      pl.color.setHex(item.def.color);
      pl.position.set(item.def.x, item.def.y, item.def.z);
      pl.distance = item.def.dist;
      pl.intensity = item.def.intensity * item.flicker * instScale;
    }
  }

  render(sim, dt, input) {
    this.renderer.info.reset();
    this.time += dt;
    const t = this.time;
    const p = sim.player;
    const remoteActive = !!(sim.link && sim.link.mode !== 's7');
    this.instinct = p.instinctOn || remoteActive;
    const focus = signalOrigin(sim);

    // Chasis S-7
    const pc = this.playerChar;
    if (pc.outfitId !== p.outfit) { pc.applyOutfit(p.outfit, true); pc.outfitId = p.outfit; }
    pc.group.position.set(p.x, 0, p.z);
    pc.group.rotation.y = p.yaw;
    pc.setHeld(p.item, p.holster || !!p.dragging || p.jackedIn);
    pc.pose(p, t, {
      crouch: p.crouch,
      jackedIn: p.jackedIn,
      dragging: !!p.dragging,
      aiming: p.aiming && p.item === 'pistol' && !p.holster && !p.jackedIn,
      channel: !!p.channel,
      dead: sim.status === 'dead',
    });
    pc.setVisorColor(sim.alarm === 2 ? COLORS.red : p.jackedIn ? COLORS.gold : COLORS.cyan);

    // Unidades robóticas (sim.units)
    for (const u of (sim.units || [])) {
      const br = this.unitRigs.get(u.id);
      if (!br) continue;
      br.group.position.set(u.x, 0, u.z);
      br.group.rotation.y = u.yaw;
      br.pose(u, t, {
        disabled: sim.time < u.disabledUntil,
        hijacked: sim.link && sim.link.mode === 'unit' && sim.link.targetId === u.id,
      });
    }

    // Haz de enlace remoto S-7 <-> cámara/bot
    if (remoteActive) {
      const posAttr = this.linkLineGeo.attributes.position;
      posAttr.setXYZ(0, p.x, p.crouch ? 0.95 : 1.35, p.z);
      posAttr.setXYZ(1, focus.x, focus.y, focus.z);
      posAttr.needsUpdate = true;
      this.linkLine.visible = true;
      this.linkLineMat.opacity = 0.35 + Math.sin(t * 9) * 0.2;
    } else {
      this.linkLine.visible = false;
    }

    // NPCs humanos
    for (const n of sim.npcs) {
      const c = this.chars.get(n.id);
      if (!n.alive || !n.conscious) {
        c.group.visible = false;
        this.cones.get(n.id).visible = false;
        continue;
      }
      if (c._stripped) c.setStripped(false, n.outfit);
      c.group.visible = true;
      c.group.position.set(n.x, 0, n.z);
      c.group.rotation.y = n.yaw;
      const stateColor = n.state === 'combat' ? COLORS.red : n.awareness > 0.4 ? COLORS.amber : COLORS.cyan;
      let lookYaw = 0;
      if (n.state === 'suspicious') {
        lookYaw = clamp(normAngle(Math.atan2(p.x - n.x, p.z - n.z) - n.yaw), -0.62, 0.62);
      } else if (n.state === 'investigate' && (n.goal || n.lookAt)) {
        const tgt = n.goal || n.lookAt;
        lookYaw = clamp(normAngle(Math.atan2(tgt.x - n.x, tgt.z - n.z) - n.yaw), -0.62, 0.62);
      } else if (n.lookTimer > 0 && n.lookAt && (n.state === 'patrol' || n.state === 'idle')) {
        lookYaw = clamp(normAngle(Math.atan2(n.lookAt.x - n.x, n.lookAt.z - n.z) - n.yaw), -0.62, 0.62);
      }
      c.pose(n, t, { channel: n.state === 'grabbed', lookYaw });
      const distSq = (n.x - focus.x) ** 2 + (n.z - focus.z) ** 2;
      c.parts.torso.castShadow = distSq < 320;
      const cone = this.cones.get(n.id);
      const showCone = this.instinct && distSq < 290;
      cone.visible = showCone;
      if (showCone) {
        cone.position.set(n.x, 0.06, n.z);
        cone.rotation.y = n.yaw;
        cone.material.color.setHex(stateColor);
        cone.material.opacity = n.state === 'combat' ? 0.22 : 0.13;
      }

      c.setInstinctHighlight(
        this.instinct ? (n.target ? 0x6b5210 : 0x11333a) : 0x000000,
        this.instinct ? (n.target ? 0x7a5c14 : 0x14383f) : 0x000000
      );
    }

    // Cuerpos caídos (reutilizan rigs en this.chars con materiales aislados)
    for (const b of sim.bodies) {
      const c = this.chars.get(b.npcId);
      if (!c) continue;
      c.group.visible = !b.hidden;
      if (b.hidden) continue;
      c.group.position.set(b.x, 0, b.z);
      c.group.rotation.y = b.yaw;
      c.pose({ moving: 0, anim: 0 }, t, b.type === 'dead' ? { dead: true } : { sleep: true });
      if (b.stripped && !c._stripped) c.setStripped(true);
      c.setInstinctHighlight(this.instinct ? 0x4a1020 : 0x000000, 0x000000);
    }

    // Conmutación de muros en Instinto por referencia de material precompilado (cero needsUpdate)
    const xray = !!this.instinct;
    if (this._xrayState !== xray) {
      this._xrayState = xray;
      this.wallMesh.material = xray ? this.matLib.wallXray : this.matLib.wallOpaque;
      this.trimMesh.material = xray ? this.matLib.trimXray : this.matLib.trimOpaque;
      for (const l of this.zoneLabels) l.visible = xray;
    }
    if (xray) {
      for (const l of this.zoneLabels) l.lookAt(this.camera.position);
    }

    // Marcadores 3D de interactuables (medidos desde el emisor activo)
    for (const m of this.itMarkers) {
      const d = Math.hypot(m.it.x - focus.x, m.it.z - focus.z);
      const show = !m.it.taken && (this.instinct ? d < 16 : d < 5.5);
      m.group.visible = show;
      if (show) {
        m.icon.lookAt(this.camera.position);
        m.icon.position.y = 1.4 + Math.sin(t * 2 + m.it.x) * 0.08;
        const showRing = d < 9.5;
        m.ring.visible = showRing;
        if (showRing) {
          const near = d < 2.6;
          m.ring.material.opacity = near ? 0.95 : 0.4;
          m.ring.scale.setScalar(near ? 1.15 + Math.sin(t * 5) * 0.06 : 1);
          if (m.it.type === 'poison' && m.it.poisoned) m.ring.material.color.setHex(0x7dffb0);
          if (m.it.type === 'container') m.ring.material.color.setHex(m.it.stored.length >= m.it.cap ? COLORS.red : COLORS.cyan);
        }
      }
    }

    // Cámaras de vigilancia (incluye estado loopedUntil)
    for (const cm of this.camMeshes) {
      const looped = sim.time < (cm.c.loopedUntil || 0);
      const controlled = sim.link && sim.link.mode === 'camera' && sim.link.targetId === cm.c.id;
      cm.group.visible = !controlled;
      const col = !cm.c.active ? 0x445055 : looped ? COLORS.cyan : sim.alarm === 2 ? COLORS.red : 0xff8a5c;
      cm.lens.material.color.setHex(col).multiplyScalar(cm.c.active ? 1.4 : 0.7);
      cm.cone.visible = this.instinct && cm.c.active && !looped && !controlled;
      const camYaw = cm.c.currentYaw ?? cm.c.yaw;
      cm.group.rotation.y = camYaw;
      cm.cone.rotation.y = camYaw;
    }

    // Props dinámicos y luces
    if (this.chandelier) {
      this.chandelier.position.y = sim.chandelier.y;
      if (sim.chandelier.landed) { this.chandelier.rotation.z = 0.35; this.chandelier.rotation.x = 0.2; }
    }
    if (this.puddles && this.puddles.lab) {
      const on = sim.electro > 0;
      this.puddles.lab.material.emissive.setHex(on ? 0x2ad8ff : 0x000000);
      this.puddles.lab.material.emissiveIntensity = on ? 0.75 + Math.sin(t * 22) * 0.45 : 0;
    }
    if (this.terminalScreen) {
      this.terminalScreen.material.color.setHex(sim.objectives.core ? 0x2a4548 : COLORS.cyan).multiplyScalar(sim.objectives.core ? 0.8 : 1.5);
    }
    if (this.poolWater) this.poolWater.material.opacity = 0.8 + Math.sin(t * 1.5) * 0.05;
    if (this.boat) {
      this.boat.position.y = Math.sin(t * 1.35) * 0.024;
      this.boat.rotation.z = Math.sin(t * 0.95) * 0.016;
    }

    // Trampas eléctricas colocadas
    this.traps ||= new Map();
    const trapIds = new Set();
    for (const tr of sim.traps) {
      trapIds.add(tr.id);
      let m = this.traps.get(tr.id);
      if (!m) {
        m = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), this.matLib.darkMetal);
        base.position.y = 0.03;
        m.add(base);
        const ledMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false });
        const led = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), ledMat);
        led.position.y = 0.08;
        m.add(led);
        m.userData.led = led;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1.1, 20),
          new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        m.add(ring);
        m.position.set(tr.x, 0, tr.z);
        this.scene.add(m);
        this.traps.set(tr.id, m);
      }
      m.userData.led.material.color.setHex(Math.sin(t * 8) > 0 ? COLORS.cyan : 0x14555a);
    }
    for (const [id, m] of this.traps) {
      if (!trapIds.has(id)) {
        this.scene.remove(m);
        this.disposeTrapGroup(m);
        this.traps.delete(id);
      }
    }

    // Monedas
    this.coinMeshes ||= [];
    while (this.coinMeshes.length < sim.coins.length) {
      const cg = new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10);
      this.ownedGeos.push(cg);
      const m = new THREE.Mesh(cg, this.matLib.gold);
      this.scene.add(m);
      this.coinMeshes.push(m);
    }
    this.coinMeshes.forEach((m, i) => {
      const c = sim.coins[i];
      m.visible = !!c;
      if (c) { m.position.set(c.x, c.y, c.z); m.rotation.x = c.landed ? Math.PI / 2 : t * 12; }
    });

    this.updateContactShadows(sim);
    this.updateFx(sim, t);
    this.updateCamera(dt, input);
    this.updateSky(dt);
    this.updateLightPool(sim, focus.x, focus.z);
    this.postfx.render(this.scene, this.camera);

    this.lastDrawCalls = this.renderer.info.render.calls;
    this.lastTriangles = this.renderer.info.render.triangles;
  }

  updateFx(sim, t) {
    if (this.muzzleLight.intensity > 0 && t >= this.muzzleUntil) {
      this.muzzleLight.intensity = 0;
    }
    for (let i = this.fxObjects.length - 1; i >= 0; i--) {
      const o = this.fxObjects[i];
      if (t - o.born > o.life) {
        this.disposeFxEntry(o);
        this.fxObjects.splice(i, 1);
      } else if (o.kind === 'ring') {
        const k = (t - o.born) / o.life;
        o.mesh.scale.setScalar(0.4 + k * o.radius);
        o.mesh.material.opacity = (1 - k) * 0.7;
      }
    }
    for (const f of sim.fx) {
      if (this.seenFx.has(f)) continue;
      this.seenFx.add(f);
      const add = (mesh, life, kind, radius = 3) => {
        this.fxGroup.add(mesh);
        this.fxObjects.push({ mesh, born: t, life, kind, radius });
      };
      if (f.kind === 'tracer') {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(f.x, f.y, f.z), new THREE.Vector3(f.tx, f.y - 0.1, f.tz)]);
        const line = new THREE.Line(geo, this.tracerMat);
        add(line, 0.12, 'line');
      } else if (f.kind === 'muzzle') {
        this.muzzleLight.position.set(f.x, f.y, f.z);
        this.muzzleLight.intensity = 30;
        this.muzzleUntil = t + 0.07;
      } else if (['kill', 'subdue', 'hide', 'disguise', 'objective', 'poison', 'coin', 'alarm', 'crash', 'spark', 'hit', 'hack'].includes(f.kind)) {
        const color = {
          kill: COLORS.red, subdue: COLORS.cyan, hide: COLORS.cyan, disguise: COLORS.green,
          objective: COLORS.gold, poison: 0x7dffb0, coin: COLORS.gold, alarm: COLORS.red,
          crash: COLORS.amber, spark: 0x9fe8ff, hit: COLORS.red, hack: COLORS.cyan,
        }[f.kind];
        const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(1.4),
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(f.x, 0.08, f.z);
        add(ring, f.kind === 'alarm' ? 1.4 : 0.8, 'ring', f.kind === 'crash' ? 8 : f.kind === 'alarm' ? 10 : 3);
      }
    }
  }

  getDiagnostics() {
    let activeLights = 0;
    this.scene.traverse((o) => {
      if (o.isPointLight && o.visible && o.intensity > 0) activeLights++;
    });
    return {
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      activeLights,
      totalPointLightsInScene: (this.lightPool ? this.lightPool.length : 0) + (this.muzzleLight ? 1 : 0),
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs ? this.renderer.info.programs.length : 0,
      shaderErrors: this.shaderErrors.slice(),
      postfxEnabled: this.postfx.enabled,
    };
  }

  dispose() {
    if (this.traps) {
      for (const [, m] of this.traps) this.disposeTrapGroup(m);
      this.traps.clear();
    }
    for (const o of this.fxObjects) this.disposeFxEntry(o);
    if (this.staticBatch) this.staticBatch.dispose();
    if (this.contactShadows) this.contactShadows.dispose();
    if (this.lightFixtures) {
      for (const lf of this.lightFixtures) lf.coneObj.dispose();
    }
    if (this.playerChar) this.playerChar.dispose();
    for (const [, c] of this.chars) c.dispose();
    for (const [, br] of this.unitRigs) br.dispose();
    if (this.propRefs && this.propRefs.ownedMaterials) {
      for (const m of this.propRefs.ownedMaterials) m.dispose();
    }
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    for (const t of this.ownedTextures) t.dispose();
    this.scene.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    this.postfx.dispose();
    this.matLib.dispose();
    this.renderer.dispose();
  }
}
