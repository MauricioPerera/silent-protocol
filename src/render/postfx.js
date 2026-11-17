// ---------------------------------------------------------------------------
// Postprocesado HDR lineal (HalfFloat MSAA 4x + Pirámide Bloom + AgX nativo)
// ---------------------------------------------------------------------------
import * as THREE from '../../vendor/three.module.js';

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const PREFILTER_FRAG = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 texelSize;
  uniform float threshold;
  uniform float knee;
  varying vec2 vUv;

  vec3 softThreshold(vec3 c) {
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    rq = (rq * rq) / (4.0 * knee + 1e-5);
    float w = max(rq, br - threshold) / max(br, 1e-5);
    return c * max(w, 0.0);
  }

  void main() {
    vec2 d = texelSize;
    vec3 c0 = texture2D(tInput, vUv + vec2(-d.x, -d.y)).rgb;
    vec3 c1 = texture2D(tInput, vUv + vec2( d.x, -d.y)).rgb;
    vec3 c2 = texture2D(tInput, vUv + vec2(-d.x,  d.y)).rgb;
    vec3 c3 = texture2D(tInput, vUv + vec2( d.x,  d.y)).rgb;
    vec3 c4 = texture2D(tInput, vUv).rgb;
    vec3 avg = (c0 + c1 + c2 + c3) * 0.125 + c4 * 0.5;
    gl_FragColor = vec4(softThreshold(min(avg, vec3(16.0))), 1.0);
  }
`;

const DOWNSAMPLE_FRAG = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 texelSize;
  varying vec2 vUv;

  void main() {
    vec2 d = texelSize;
    vec3 a = texture2D(tInput, vUv + vec2(-d.x, -d.y)).rgb;
    vec3 b = texture2D(tInput, vUv + vec2( d.x, -d.y)).rgb;
    vec3 c = texture2D(tInput, vUv + vec2(-d.x,  d.y)).rgb;
    vec3 e = texture2D(tInput, vUv + vec2( d.x,  d.y)).rgb;
    vec3 m = texture2D(tInput, vUv).rgb;
    gl_FragColor = vec4((a + b + c + e) * 0.125 + m * 0.5, 1.0);
  }
`;

const UPSAMPLE_FRAG = /* glsl */ `
  uniform sampler2D tLow;
  uniform sampler2D tHigh;
  uniform vec2 texelSize;
  uniform float radius;
  varying vec2 vUv;

  void main() {
    vec2 d = texelSize * radius;
    vec3 s = vec3(0.0);
    s += texture2D(tLow, vUv + vec2(-d.x, -d.y)).rgb * 1.0;
    s += texture2D(tLow, vUv + vec2( 0.0, -d.y)).rgb * 2.0;
    s += texture2D(tLow, vUv + vec2( d.x, -d.y)).rgb * 1.0;
    s += texture2D(tLow, vUv + vec2(-d.x,  0.0)).rgb * 2.0;
    s += texture2D(tLow, vUv).rgb * 4.0;
    s += texture2D(tLow, vUv + vec2( d.x,  0.0)).rgb * 2.0;
    s += texture2D(tLow, vUv + vec2(-d.x,  d.y)).rgb * 1.0;
    s += texture2D(tLow, vUv + vec2( 0.0,  d.y)).rgb * 2.0;
    s += texture2D(tLow, vUv + vec2( d.x,  d.y)).rgb * 1.0;
    vec3 high = texture2D(tHigh, vUv).rgb;
    gl_FragColor = vec4(high + s * (1.0 / 16.0), 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float bloomStrength;
  varying vec2 vUv;

  void main() {
    vec3 base = texture2D(tScene, vUv).rgb;
    vec3 bloom = texture2D(tBloom, vUv).rgb;
    gl_FragColor = vec4(base + bloom * bloomStrength, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function supportsHdrPostFX(renderer) {
  if (!renderer || !renderer.extensions) return false;
  if (renderer.capabilities && renderer.capabilities.isWebGL2) {
    return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  }
  return renderer.extensions.has('EXT_color_buffer_half_float');
}

export function createPostFX(renderer, width = 1280, height = 720, quality = 'high') {
  const hdrCapable = supportsHdrPostFX(renderer);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const passScene = new THREE.Scene();

  const prefilterMat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: PREFILTER_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      tInput: { value: null },
      texelSize: { value: new THREE.Vector2(1 / 640, 1 / 360) },
      threshold: { value: 0.92 },
      knee: { value: 0.42 },
    },
  });

  const downMat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: DOWNSAMPLE_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      tInput: { value: null },
      texelSize: { value: new THREE.Vector2(1 / 320, 1 / 180) },
    },
  });

  const upMat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: UPSAMPLE_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      tLow: { value: null },
      tHigh: { value: null },
      texelSize: { value: new THREE.Vector2(1 / 160, 1 / 90) },
      radius: { value: 1.15 },
    },
  });

  const compMat = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: COMPOSITE_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
    uniforms: {
      tScene: { value: null },
      tBloom: { value: null },
      bloomStrength: { value: 0.34 },
    },
  });

  const quad = new THREE.Mesh(quadGeo, prefilterMat);
  quad.frustumCulled = false;
  passScene.add(quad);

  let curQuality = quality;
  let curW = Math.max(2, width);
  let curH = Math.max(2, height);
  let enabled = false;
  let sceneRT = null;
  let downRTs = [];
  let upRTs = [];
  let lastAllocKey = '';

  function freeTargets() {
    if (sceneRT) { sceneRT.dispose(); sceneRT = null; }
    for (const rt of downRTs) rt.dispose();
    for (const rt of upRTs) rt.dispose();
    downRTs = [];
    upRTs = [];
    lastAllocKey = '';
  }

  function allocateTargets() {
    const nextEnabled = hdrCapable && curQuality !== 'low';
    const dpr = renderer.getPixelRatio();
    const pw = Math.max(4, Math.floor(curW * dpr));
    const ph = Math.max(4, Math.floor(curH * dpr));
    const samples = renderer.capabilities.isWebGL2 ? (curQuality === 'high' ? 4 : 2) : 0;
    const levels = curQuality === 'high' ? 4 : 3;
    const key = nextEnabled ? `1_${pw}_${ph}_${samples}_${levels}` : '0';
    if (key === lastAllocKey) return;

    freeTargets();
    enabled = nextEnabled;
    lastAllocKey = key;
    if (!enabled) return;

    sceneRT = new THREE.WebGLRenderTarget(pw, ph, {
      type: THREE.HalfFloatType,
      samples,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    let mw = Math.max(2, pw >> 1);
    let mh = Math.max(2, ph >> 1);
    for (let i = 0; i < levels; i++) {
      downRTs.push(new THREE.WebGLRenderTarget(mw, mh, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      }));
      if (i < levels - 1) {
        upRTs.push(new THREE.WebGLRenderTarget(mw, mh, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
        }));
      }
      mw = Math.max(2, mw >> 1);
      mh = Math.max(2, mh >> 1);
    }
  }

  allocateTargets();

  return {
    get enabled() { return enabled; },
    resize(w, h) {
      curW = Math.max(2, w);
      curH = Math.max(2, h);
      allocateTargets();
    },
    setQuality(q, w = curW, h = curH) {
      curQuality = q;
      curW = Math.max(2, w);
      curH = Math.max(2, h);
      allocateTargets();
    },
    compile(scene, camera) {
      if (enabled && sceneRT) {
        renderer.setRenderTarget(sceneRT);
        renderer.compile(scene, camera);
        renderer.setRenderTarget(null);
      } else {
        renderer.setRenderTarget(null);
        renderer.compile(scene, camera);
      }
    },
    render(scene, camera) {
      if (!enabled || !sceneRT || !downRTs.length) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }

      // 1. Escena principal a FBO HalfFloat MSAA (lineal)
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);

      // 2. Umbral suave + pirámide Downsample
      quad.material = prefilterMat;
      prefilterMat.uniforms.tInput.value = sceneRT.texture;
      prefilterMat.uniforms.texelSize.value.set(1 / sceneRT.width, 1 / sceneRT.height);
      renderer.setRenderTarget(downRTs[0]);
      renderer.render(passScene, orthoCam);

      quad.material = downMat;
      for (let i = 1; i < downRTs.length; i++) {
        const prev = downRTs[i - 1];
        downMat.uniforms.tInput.value = prev.texture;
        downMat.uniforms.texelSize.value.set(1 / prev.width, 1 / prev.height);
        renderer.setRenderTarget(downRTs[i]);
        renderer.render(passScene, orthoCam);
      }

      // 3. Pirámide Upsample (tent filter)
      quad.material = upMat;
      let prevBloom = downRTs[downRTs.length - 1];
      for (let i = downRTs.length - 2; i >= 0; i--) {
        const target = upRTs[i];
        upMat.uniforms.tLow.value = prevBloom.texture;
        upMat.uniforms.tHigh.value = downRTs[i].texture;
        upMat.uniforms.texelSize.value.set(1 / prevBloom.width, 1 / prevBloom.height);
        renderer.setRenderTarget(target);
        renderer.render(passScene, orthoCam);
        prevBloom = target;
      }

      // 4. Composición final HDR -> AgXToneMapping + LinearToSRGB
      quad.material = compMat;
      compMat.uniforms.tScene.value = sceneRT.texture;
      compMat.uniforms.tBloom.value = prevBloom.texture;
      renderer.setRenderTarget(null);
      renderer.render(passScene, orthoCam);
    },
    dispose() {
      freeTargets();
      quadGeo.dispose();
      prefilterMat.dispose();
      downMat.dispose();
      upMat.dispose();
      compMat.dispose();
    },
  };
}
