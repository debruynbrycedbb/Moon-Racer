// The 3D side of Moon Racer: the floating circuit, the showroom and driving.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildTrack, podPositions, CYAN } from './track.js';
import { CARS, prepareCar, animateWheels } from './cars.js';
import { Vehicle } from './vehicle.js';
import { createLaps } from './laps.js?v=3';
import { createSky, createEnvironment, glowTexture } from './sky.js';

// ---------- scene settings ----------
const SUN_DIR = new THREE.Vector3(0.58, 0.46, 0.67).normalize();     // direction towards the sun
const MOON_OFFSET = new THREE.Vector3(791, 185, -12);                // puts a crater floor under the circuit
const POD = { scale: 20, neck: 2.6, flame: 26 };
// timing: the start/finish line is the checkered strip at the start of the lap; splits at these distances (metres)
const CIRCUIT_ID = 'tranquility';
const SPLITS = [1100, 2470];
const GRID_BACK = 2;                                                  // sections behind the line where the car waits for GO
const FILES = {
  moon: ['assets/models/moon-surface.glb', 9.8],
  track: ['assets/models/track.glb', 1.2],
  thruster: ['assets/models/thruster.glb', 1.0],
  car0: [CARS[0].file, 2.0],
  car1: [CARS[1].file, 2.1],
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const LAPS_SKIP = 99;                                                 // debug: a step long enough to finish the countdown
const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);

export async function createGame({ canvas, onProgress = () => {}, onHud = () => {}, onNote = () => {}, onLap = () => {}, readPad = null }) {
  const timing = {}, t0 = performance.now();
  const mark = name => { timing[name] = Math.round(performance.now() - t0); };
  const breathe = () => new Promise(r => setTimeout(r, 0));     // let the map stay responsive while this builds
  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.4, 90000);
  camera.layers.enable(0);

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // A mirror-sharp sun glint can overflow the image buffer, and the glow pass then smears it into
  // big black squares. Cap the brightness first.
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        if (isnan(c.r) || isnan(c.g) || isnan(c.b)) c = vec4(0.0, 0.0, 0.0, 1.0);
        gl_FragColor = vec4(clamp(c.rgb, 0.0, 40.0), 1.0); }`,
  }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.35, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // ---------- load everything ----------
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const done = {}, totalWeight = Object.values(FILES).reduce((s, f) => s + f[1], 0);
  const report = () => onProgress(Object.entries(FILES).reduce((s, [k, f]) => s + (done[k] || 0) * f[1], 0) / totalWeight);
  const load = key => new Promise((resolve, reject) => loader.load(FILES[key][0],
    g => { done[key] = 1; report(); resolve(g); },
    e => { if (e.total) { done[key] = Math.min(0.98, e.loaded / e.total); report(); } },
    reject));
  const [moonG, trackG, thrusterG, car0G, car1G, trackData] = await Promise.all([
    load('moon'), load('track'), load('thruster'), load('car0'), load('car1'),
    fetch('assets/data/track.json').then(r => { if (!r.ok) throw new Error('track.json ' + r.status); return r.json(); }),
    document.fonts ? document.fonts.load('64px "Saira Stencil One"').catch(() => {}) : null,
  ]);

  mark('downloaded');
  // ---------- light ----------
  const sun = new THREE.DirectionalLight(0xfff6ea, 3.3);
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0x1c2740, 0x3a3835, 0.55));

  // ---------- sky ----------
  const sky = createSky(SUN_DIR);
  scene.add(sky.group);
  scene.environment = createEnvironment(renderer, SUN_DIR, sky.earthDir);
  scene.environmentIntensity = 0.9;

  // ---------- Moon ----------
  const moon = moonG.scene;
  moon.position.copy(MOON_OFFSET);
  const moonMeshes = [];
  moon.traverse(o => {
    if (!o.isMesh) return;
    moonMeshes.push(o);
    o.receiveShadow = true; o.castShadow = false;
    o.material.envMapIntensity = 0.12;
    o.material.side = THREE.FrontSide;
    o.material.normalScale = new THREE.Vector2(1.25, 1.25);
    o.material.roughnessMap = null; o.material.metalnessMap = null;      // regolith is simply rough everywhere
    o.material.roughness = 0.96; o.material.metalness = 0;
    o.material.color.setScalar(0.74);
    if (o.material.map) o.material.map.anisotropy = 8;
  });
  scene.add(moon);
  // flat plain out to the horizon, so the terrain model's edge is not a cliff into nothing
  // (a ring, because the middle is covered by the terrain model, which dips below this level)
  const plain = new THREE.Mesh(new THREE.RingGeometry(4930, 80000, 96, 1), new THREE.MeshStandardMaterial({ color: 0x38393b, roughness: 1, metalness: 0 }));
  plain.material.envMapIntensity = 0.1;
  plain.rotation.x = -Math.PI / 2;
  plain.position.set(MOON_OFFSET.x, MOON_OFFSET.y - 205, MOON_OFFSET.z);
  scene.add(plain);
  scene.updateMatrixWorld(true);

  // rough height map of the terrain (highest point in each 40 m cell), for placing things on the ground
  const HF = { cell: 40, n: 260, data: null };
  {
    HF.data = new Float32Array(HF.n * HF.n).fill(-1e9);
    const v = new THREE.Vector3(), half = HF.n * HF.cell / 2;
    for (const m of moonMeshes) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const gx = Math.floor((v.x - MOON_OFFSET.x + half) / HF.cell), gz = Math.floor((v.z - MOON_OFFSET.z + half) / HF.cell);
        if (gx < 0 || gz < 0 || gx >= HF.n || gz >= HF.n) continue;
        const k = gz * HF.n + gx;
        if (v.y > HF.data[k]) HF.data[k] = v.y;
      }
    }
  }
  function groundAt(x, z) {
    const half = HF.n * HF.cell / 2;
    const gx = Math.floor((x - MOON_OFFSET.x + half) / HF.cell), gz = Math.floor((z - MOON_OFFSET.z + half) / HF.cell);
    let best = -1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const X = gx + dx, Z = gz + dz;
      if (X < 0 || Z < 0 || X >= HF.n || Z >= HF.n) continue;
      best = Math.max(best, HF.data[Z * HF.n + X]);
    }
    return best > -1e8 ? best : plain.position.y;
  }
  mark('terrain');
  await breathe();

  // ---------- circuit ----------
  const track = buildTrack(trackG.scene, trackData, renderer);
  scene.add(track.group);
  const trackCentre = track.box.getCenter(new THREE.Vector3());

  // ---------- lap timing gates ----------
  const gateAt = index => {
    const c = track.centre[index], L = trackData.left[index], R = trackData.right[index];
    return { index, x: c.x, y: c.y, z: c.z, tx: c.tx, tz: c.tz, half: Math.hypot(L[0] - R[0], L[2] - R[2]) / 2 };
  };
  const sectionAt = d => track.centre.findIndex(p => p.dist >= d);
  const gates = [gateAt(0), ...SPLITS.map(d => gateAt(sectionAt(d)))];
  const laps = createLaps({ circuitId: CIRCUIT_ID, gates, onEvent: e => onLap(e) });

  // sun shadow: one big static map for the circuit's shadow on the Moon
  {
    const half = track.box.getSize(new THREE.Vector3()).length() / 2 + 40;
    sun.position.copy(trackCentre).addScaledVector(SUN_DIR, 1200);
    sun.target.position.copy(trackCentre);
    sun.castShadow = true;
    const s = sun.shadow;
    s.mapSize.set(4096, 4096);
    s.camera.left = -half; s.camera.right = half; s.camera.top = half; s.camera.bottom = -half;
    s.camera.near = 450; s.camera.far = 2500;
    s.bias = -0.0006; s.normalBias = 0.5;
    s.camera.updateProjectionMatrix();
  }

  mark('track');
  await breathe();
  // ---------- thruster pods ----------
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: CYAN.clone() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uColor;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float t = vUv.y;                                        // 1 at the nozzle, 0 at the tip
        float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        float flick = 0.86 + 0.14 * sin(uTime * 46.0 + vW.x * 0.7 + vW.z * 1.3) * sin(uTime * 17.0 + t * 30.0);
        float shock = 0.8 + 0.2 * sin(t * 26.0 - uTime * 22.0);
        float a = core * pow(t, 1.25) * flick * shock;
        vec3 col = mix(uColor, vec3(1.0), pow(t, 2.5) * core);
        gl_FragColor = vec4(col * a * 3.4, a);
      }`,
  });
  const glowTex = glowTexture();
  const smokeTex = smokeTexture();
  const podMetal = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.6, metalness: 0.6 });

  // the thruster model lies on its side: stand it nose-down and centre it under the origin
  const podModel = new THREE.Group();
  {
    const m = thrusterG.scene;
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar(POD.scale);
    podModel.add(m);
    podModel.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(m), c = b.getCenter(new THREE.Vector3());
    m.position.set(-c.x, -POD.neck - b.max.y, -c.z);
    podModel.userData.height = b.max.y - b.min.y;
    m.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      if (o.material.name === 'Engine_light') {
        o.material = new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.6) });
      } else o.material.envMapIntensity = 0.7;
    });
  }

  function makePod(scale = 1, number = null) {
    const g = new THREE.Group();
    const model = podModel.clone(true);
    g.add(model);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(3.4, POD.neck + 0.6, 6.5), podMetal);
    neck.position.y = -POD.neck / 2;
    neck.castShadow = true;
    g.add(neck);
    const tipY = -POD.neck - podModel.userData.height;
    const flame = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 0.25, POD.flame, 20, 1, true), flameMat);
    flame.position.y = tipY - POD.flame / 2 + 0.8;
    g.add(flame);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.1, POD.flame * 0.62, 14, 1, true), flameMat);
    inner.position.y = tipY - POD.flame * 0.31 + 0.8;
    g.add(inner);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: CYAN.clone().multiplyScalar(1.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(16);
    glow.position.y = tipY - 1.5;
    g.add(glow);
    if (number !== null) addPodNumber(g, number);
    g.scale.setScalar(scale);
    g.userData.tipY = tipY * scale;
    return g;
  }

  // painted pod numbers (drawn in code, in the same stencil face as the interface)
  function addPodNumber(g, number) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.font = '112px "Saira Stencil One", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#f4b21b';
    x.fillText(String(number).padStart(2, '0'), 128, 70);
    // worn paint
    x.globalCompositeOperation = 'destination-out';
    let s = number * 97 + 3;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 260; i++) { x.globalAlpha = r() * 0.8; x.fillRect(r() * 256, r() * 128, 1 + r() * 7, 1 + r() * 2.5); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const side of [1, -1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34 * POD.scale, 0.17 * POD.scale), mat);
      p.position.set(side * (0.33 * POD.scale + 0.06), -POD.neck - 0.36 * POD.scale, 0);
      p.rotation.y = side * Math.PI / 2;
      g.add(p);
    }
  }

  const podIdx = podPositions(track.centre, track.length);
  const pods = [];
  const dust = new THREE.Group();
  scene.add(dust);
  podIdx.forEach((ci, k) => {
    const c = track.centre[ci];
    const pod = makePod(1, k + 1);
    pod.position.set(c.x, c.y - 5.05, c.z);              // underside of the 5 m deep deck
    pod.rotation.y = Math.atan2(c.tx, c.tz);
    scene.add(pod);
    const gy = groundAt(c.x, c.z);
    const light = new THREE.PointLight(CYAN, 900, 150, 1.7);
    light.position.set(c.x, gy + 13, c.z);
    scene.add(light);
    // lit dust kicked up where the jet meets the ground
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: new THREE.Color(0.35, 0.8, 1.0), transparent: true, opacity: 0.2, depthWrite: false, rotation: Math.random() * 6.28 }));
      const a = Math.random() * 6.28, r = i === 0 ? 0 : 8 + Math.random() * 16;
      sp.position.set(c.x + Math.cos(a) * r, gy + 5 + Math.random() * 4, c.z + Math.sin(a) * r);
      sp.userData = { base: 26 + Math.random() * 20, phase: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.12 };
      sp.scale.setScalar(sp.userData.base);
      dust.add(sp);
    }
    pods.push({ pod, light, groundY: gy, clearance: pod.position.y + pod.userData.tipY - gy });
  });

  // ---------- showroom pad: a small hover platform beside the start line ----------
  const start = track.centre[0];
  const startHeading = Math.atan2(start.tx, start.tz);
  const pad = new THREE.Group();
  {
    // put it on whichever side of the start straight has more open space
    const side = [1, -1].map(s => {
      const x = start.x + start.tz * s * 30, z = start.z - start.tx * s * 30;
      let d = Infinity;
      for (const p of track.centre) d = Math.min(d, Math.hypot(p.x - x, p.z - z));
      return { x, z, d };
    }).sort((a, b) => b.d - a.d)[0];
    pad.position.set(side.x, start.y + 1.5, side.z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 3.7, 0.8, 48), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.45, metalness: 0.7 }));
    disc.position.y = -0.4;
    pad.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.05, 0.045, 8, 96), new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.05) }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.03;
    pad.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(4.31, 0.04, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4b21b).multiplyScalar(0.75) }));
    ring2.rotation.x = Math.PI / 2; ring2.position.y = -0.42;
    pad.add(ring2);
    const lift = makePod(0.2);
    lift.position.y = -0.8;
    pad.add(lift);
    scene.add(pad);
  }

  mark('pods');
  await breathe();
  // ---------- cars ----------
  const cars = [prepareCar(car0G, CARS[0]), prepareCar(car1G, CARS[1])];
  cars.forEach(c => { c.root.visible = false; scene.add(c.root); });
  let car = cars[0];
  const veh = new Vehicle(track.surface);
  veh.setCar(car);

  // the car's own shadow: its outline seen from the sun, projected onto the road under it
  const shadowCam = new THREE.OrthographicCamera(-4.6, 4.6, 4.6, -4.6, 1, 60);
  shadowCam.layers.set(2);
  const shadowRT = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: false });
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const shadowDecal = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { uMap: { value: shadowRT.texture }, uMatrix: { value: new THREE.Matrix4() }, uOpacity: { value: 0.78 } },
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      vertexShader: 'uniform mat4 uMatrix; varying vec4 vS; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vS = uMatrix * w; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; uniform float uOpacity; varying vec4 vS;
        void main(){
          vec2 uv = vS.xy / vS.w * 0.5 + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
          float a = 0.0; float px = 1.6 / 256.0;
          for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) a += texture2D(uMap, uv + vec2(float(i), float(j)) * px).r;
          a = a / 9.0 * uOpacity;
          vec2 e = smoothstep(0.0, 0.06, uv) * smoothstep(1.0, 0.94, uv);
          gl_FragColor = vec4(0.0, 0.0, 0.0, a * e.x * e.y);
        }`,
    }));
  shadowDecal.renderOrder = 1;
  scene.add(shadowDecal);
  const _m = new THREE.Matrix4();
  function renderCarShadow() {
    shadowCam.position.copy(car.root.position).addScaledVector(SUN_DIR, 25);
    shadowCam.lookAt(car.root.position);
    shadowCam.updateMatrixWorld();
    const bg = scene.background, om = scene.overrideMaterial;
    scene.background = null; scene.overrideMaterial = outlineMat;
    renderer.setRenderTarget(shadowRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, shadowCam);
    renderer.setRenderTarget(null);
    scene.background = bg; scene.overrideMaterial = om;
    shadowDecal.material.uniforms.uMatrix.value.multiplyMatrices(shadowCam.projectionMatrix, _m.copy(shadowCam.matrixWorld).invert());
  }

  // ---------- ghost: a see-through copy of the car replaying your best lap ----------
  const ghostMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: CYAN.clone() }, uOpacity: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));     // bright at the outline, faint face-on
        float a = (0.05 + 0.6 * pow(f, 2.2)) * uOpacity;
        gl_FragColor = vec4(uColor * 1.4, a);
      }`,
  });
  const ghosts = cars.map(c => {
    const root = c.root.clone(true), map = new Map(), a = [], b = [];
    c.root.traverse(o => a.push(o)); root.traverse(o => b.push(o));
    a.forEach((o, i) => map.set(o, b[i]));
    root.traverse(o => {
      if (!o.isMesh) return;
      o.material = ghostMat; o.layers.disable(2); o.renderOrder = 3; o.visible = true;
    });
    root.visible = false;
    scene.add(root);
    return { root, body: map.get(c.body), wheels: c.wheels.map(w => ({ ...w, steer: map.get(w.steer), spin: map.get(w.spin) })) };
  });
  const ghostState = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, steerAngle: 0, vF: 0 };
  let ghost = ghosts[0];
  function updateGhost(dt) {
    const t = laps.phase === 'running' ? laps.clock : 0;
    const on = state === 'drive' && laps.phase !== 'idle' && laps.ghostAt(t, ghostState);
    ghost.root.visible = !!on;
    if (!on) return;
    const g = ghostState;
    ghost.root.position.set(g.x, g.y, g.z);
    ghost.root.rotation.set(-g.pitch, g.heading, g.roll, 'YXZ');
    animateWheels(ghost, g, dt);
    // fade out when it is right on top of you, so it never hides the road
    const d = Math.hypot(g.x - veh.x, g.y - veh.y, g.z - veh.z);
    ghostMat.uniforms.uOpacity.value = clamp((d - 1.5) / 10, 0.2, 1);
  }

  mark('cars');
  await breathe();
  // ---------- state ----------
  let state = 'idle', paused = false, running = false, raf = 0, last = 0, time = 0;
  let camMode = 'chase', camYaw = 0, safeIdx = 0, fallTimer = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const keys = new Set();
  let intro = null;

  const padTop = () => pad.position.y + 0.02;
  function carToPad() {
    car.root.position.set(pad.position.x, padTop(), pad.position.z);
    car.root.rotation.set(0, time * 0.35, 0, 'YXZ');
    car.body.rotation.set(0, 0, 0);
    shadowDecal.position.copy(car.root.position).setY(padTop() + 0.03);
    shadowDecal.rotation.set(0, 0, 0);
  }
  function selectCar(i) {
    cars.forEach((c, k) => { c.root.visible = k === i; });
    car = cars[i];
    ghosts.forEach(g => { g.root.visible = false; });
    ghost = ghosts[i];
    veh.setCar(car);
    setCamMode(camMode);
  }
  // from the driver's seat the tinted glass only darkens the view, so it is switched off there
  function setCamMode(mode) {
    camMode = mode;
    for (const c of cars) for (const g of c.glass) g.visible = !(mode === 'cockpit' && state === 'drive' && c === car);
  }

  // showroom camera: a slow sweep around the pad, with the circuit and Earth behind the car
  const showAngle = Math.atan2(-sky.earthDir.x, -sky.earthDir.z);     // stand opposite Earth
  function showPose(outPos, outLook) {
    const a = showAngle + Math.sin(time * 0.13) * 0.38 + 0.35;
    const narrow = camera.aspect < 0.9;
    const r = narrow ? 13 : 7.6, h = narrow ? 3.0 : 1.25;
    outPos.set(pad.position.x + Math.sin(a) * r, padTop() + h + Math.sin(time * 0.21) * 0.15, pad.position.z + Math.cos(a) * r);
    // on a tall phone screen, aim below the car so it sits above the panel instead of behind it
    outLook.set(pad.position.x, padTop() + (narrow ? -1.5 : 1.05), pad.position.z);
  }

  function placeAtStart(index = 0) {
    const c = track.centre[index];
    const heading = Math.atan2(c.tx, c.tz);
    veh.reset(c.x, c.y + 0.02, c.z, heading);
    safeIdx = index; fallTimer = 0;
    camYaw = heading;
    camPos.set(c.x - Math.sin(heading) * 7, c.y + 2.4, c.z - Math.cos(heading) * 7);
    syncCar(0);
  }

  function syncCar(dt) {
    car.root.position.set(veh.x, veh.y, veh.z);
    car.root.rotation.set(-veh.pitch, veh.heading, veh.roll, 'YXZ');
    car.body.rotation.set(veh.squat, 0, veh.lean);
    animateWheels(car, veh, dt);
    shadowDecal.position.set(veh.x, veh.y + 0.03, veh.z);
    shadowDecal.rotation.set(-veh.pitch, veh.heading, veh.roll, 'YXZ');
    shadowDecal.visible = veh.grounded || veh.airTime < 0.5;
  }

  const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  function readInput() {
    const k = c => keys.has(c);
    input.throttle = k('KeyW') || k('ArrowUp') ? 1 : 0;
    input.brake = k('KeyS') || k('ArrowDown') ? 1 : 0;
    input.steer = (k('KeyA') || k('ArrowLeft') ? 1 : 0) - (k('KeyD') || k('ArrowRight') ? 1 : 0);
    input.handbrake = k('Space');
    // a game controller adds to the keyboard: whichever is pushed further wins
    const p = readPad && readPad();
    if (p && p.connected) {
      input.throttle = Math.max(input.throttle, p.throttle);
      input.brake = Math.max(input.brake, p.brake);
      if (!input.steer) input.steer = p.steer;
      input.handbrake = input.handbrake || p.handbrake;
    }
  }

  function respawn(message, reason) {
    if (laps.frozen) return;                                  // already waiting on the line
    const voids = laps.phase === 'running' && !laps.view().void;
    laps.voidLap(reason || message);                          // shows "<reason>: lap void"
    placeAtStart(safeIdx);
    laps.teleported();
    if (message && !voids) onNote(message);
  }
  const gridIndex = () => (track.centre.length - GRID_BACK) % track.centre.length;
  function toGrid() {
    placeAtStart(gridIndex());
    laps.begin(CARS[cars.indexOf(car)].id);
  }

  function updateDrive(dt) {
    readInput();
    if (laps.frozen) {
      laps.step(dt, veh);                                     // counting down: the car waits on the line
    } else {
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let i = 0; i < steps; i++) { veh.step(input, dt / steps); laps.step(dt / steps, veh); }
    }
    if (veh.grounded) {
      safeIdx = track.nearest(veh.x, veh.z, safeIdx, 60);
      fallTimer = 0;
    } else {
      fallTimer += dt;
      if (veh.y < veh.lastGroundY - 20 || fallTimer > 3.5) respawn('Back on track', 'Fell off');
    }
    syncCar(dt);
    updateGhost(dt);
    onHud({ speed: veh.speed, x: veh.x, z: veh.z, lap: laps.view() });
  }

  const _fwd = new THREE.Vector3(), _eye = new THREE.Vector3(), _q = new THREE.Quaternion(), _flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  function updateDriveCamera(dt) {
    const k = clamp(veh.speed / veh.vmax, 0, 1);
    if (camMode === 'cockpit') {
      const e = car.spec.eye;
      car.root.updateMatrixWorld(true);                    // use this frame's car position, not last frame's
      camera.position.copy(_eye.set(e[0], e[1], e[2]).applyMatrix4(car.body.matrixWorld));
      car.body.getWorldQuaternion(_q);
      camera.quaternion.copy(_q).multiply(_flip);
      camera.rotateY(veh.steer * 0.16);
      camera.rotateX(-0.05);
      setLens(78 + 8 * k, 0.07);
      return;
    }
    // chase: swing behind the car with a little lag
    let d = veh.heading - camYaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    camYaw += d * (1 - Math.exp(-6.5 * dt));
    const dist = 5.9 + 2.3 * k, height = 1.95 + 0.45 * k;
    const tx = veh.x - Math.sin(camYaw) * dist, tz = veh.z - Math.cos(camYaw) * dist, ty = veh.y + height;
    camPos.x = tx; camPos.z = tz;
    camPos.y += (ty - camPos.y) * (1 - Math.exp(-9 * dt));
    if (!veh.grounded && fallTimer > 0.35) camPos.y = Math.max(camPos.y, veh.lastGroundY + 3);   // watch the fall from the deck
    camera.position.copy(camPos);
    _fwd.set(Math.sin(veh.heading), 0, Math.cos(veh.heading));
    camLook.set(veh.x, veh.y + 1.05, veh.z).addScaledVector(_fwd, 2.5);
    camera.up.set(0, 1, 0);
    camera.lookAt(camLook);
    setLens(58 + 20 * Math.pow(k, 0.8), 0.4);
  }
  function setLens(fov, near) {
    if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== near) {
      camera.fov = fov; camera.near = near; camera.updateProjectionMatrix();
    }
  }

  // ---------- intro: straight down from the map view, then swoop to the showroom ----------
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _l = new THREE.Vector3();
  function updateIntro(dt) {
    intro.t = Math.min(1, intro.t + dt / intro.duration);
    const k = smooth(intro.t);
    showPose(_b, _l);
    _a.set(trackCentre.x, trackCentre.y + 1500, trackCentre.z);
    _c.set((_a.x + _b.x) / 2, trackCentre.y + 420, (_a.z + _b.z) / 2 + 160);
    // quadratic curve a -> c -> b
    camera.position.set(
      (1 - k) * (1 - k) * _a.x + 2 * (1 - k) * k * _c.x + k * k * _b.x,
      (1 - k) * (1 - k) * _a.y + 2 * (1 - k) * k * _c.y + k * k * _b.y,
      (1 - k) * (1 - k) * _a.z + 2 * (1 - k) * k * _c.z + k * k * _b.z);
    const lk = smooth(clamp(intro.t * 1.25, 0, 1));
    camLook.set(trackCentre.x, trackCentre.y, trackCentre.z).lerp(_l, lk);
    camera.up.set(0, lk, -(1 - lk)).normalize();           // north-up like the map, then level out
    camera.lookAt(camLook);
    setLens(58, 0.4);
    if (intro.t >= 1) { const r = intro.resolve; intro = null; state = 'showroom'; r(); }
  }

  // ---------- frame loop ----------
  let slow = 0, frames = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (!paused) {
      time += dt;
      flameMat.uniforms.uTime.value = time;
      for (const sp of dust.children) {
        const u = sp.userData;
        sp.scale.setScalar(u.base * (1 + 0.12 * Math.sin(time * 0.6 + u.phase)));
        sp.material.rotation += u.spin * dt;
        sp.material.opacity = 0.17 + 0.05 * Math.sin(time * 0.9 + u.phase * 2);
      }
      if (state === 'drive') { updateDrive(dt); updateDriveCamera(dt); }
      else {
        carToPad();
        if (state === 'intro') updateIntro(dt);
        else { showPose(camera.position, camLook); camera.up.set(0, 1, 0); camera.lookAt(camLook); setLens(camera.aspect < 0.9 ? 62 : 50, 0.4); }
      }
    }
    if (api.debug.freeCam) {                              // testing only: park the camera somewhere
      camera.position.fromArray(api.debug.freeCam.pos); camera.up.set(0, 1, 0);
      camera.lookAt(camLook.fromArray(api.debug.freeCam.look)); setLens(api.debug.freeCam.fov || 50, 0.4);
    }
    sky.group.position.copy(camera.position);
    renderCarShadow();
    composer.render(dt);

    // drop the resolution once if the machine is struggling
    if (!paused && pixelRatio > 1) {
      frames++; if (dt > 0.03) slow++;
      if (frames >= 150) { if (slow > 90) { pixelRatio = 1; resize(); } frames = 0; slow = 0; }
    }
  }

  window.addEventListener('keydown', e => {
    if (state !== 'drive' || paused) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyC') cycleCamera();
    if (e.code === 'KeyR') respawn('Reset');
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  function cycleCamera() { setCamMode(camMode === 'chase' ? 'cockpit' : 'chase'); onNote(camMode === 'chase' ? 'Chase camera' : 'Cockpit camera'); }
  window.addEventListener('blur', () => keys.clear());

  // first render: builds the static shadow map and compiles the shaders while the screen is still dark
  resize();
  selectCar(0);
  carToPad();
  showPose(camera.position, camLook);
  camera.lookAt(camLook);
  scene.updateMatrixWorld(true);
  cars.forEach(c => { c.root.visible = true; });           // so both cars' shaders get compiled now, not on first use
  ghosts.forEach(g => { g.root.visible = true; });
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
  mark('compiled');
  await breathe();
  renderer.shadowMap.needsUpdate = true;
  composer.render(0);
  selectCar(0);
  mark('firstFrame');
  onProgress(1);

  const api = {
    cars: CARS.map(c => ({ name: c.name, topSpeed: c.topSpeed })),
    trackOutline: track.outline,
    start() { if (running) return; running = true; resize(); last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); keys.clear(); state = 'idle'; paused = false; laps.stop(); setCamMode('chase'); },
    playIntro() {
      state = 'intro';
      return new Promise(resolve => { intro = { t: 0, duration: 4.6, resolve }; });
    },
    showCar(i) { selectCar(i); if (state !== 'drive') carToPad(); },
    showroom(i) { state = 'showroom'; laps.stop(); selectCar(i); setCamMode('chase'); keys.clear(); shadowDecal.visible = true; },
    drive(i) { state = 'drive'; selectCar(i); toGrid(); setCamMode('chase'); keys.clear(); },
    pause(v) { paused = v; keys.clear(); last = performance.now(); },
    // driving actions (keyboard and controller both come through here)
    cycleCamera() { if (state === 'drive' && !paused) cycleCamera(); },
    resetCar() { if (state === 'drive' && !paused) respawn('Reset'); },
    restartLap() { if (state === 'drive') { toGrid(); keys.clear(); } },
    // lap times and the ghost
    bestFor: i => laps.bestFor(CARS[i].id),
    get ghostOn() { return laps.ghostOn; },
    setGhost(on) { laps.setGhost(on); },
    clearBests() { laps.clearBests(); },
    laps,
    // handles for testing in the browser console
    debug: { scene, camera, renderer, veh, track, pods, cars, pad, sun, get car() { return car; }, get state() { return state; }, keys, sky, bloom, moon, freeCam: null, timing,
      // run the driving physics for a while without waiting for real time (testing only)
      sim(seconds, inp = {}) {
        const i = { throttle: 0, brake: 0, steer: 0, handbrake: false, ...inp }, log = [];
        for (let t = 0; t < seconds; t += 1 / 120) {
          veh.step(i, 1 / 120);
          if (veh.grounded) safeIdx = track.nearest(veh.x, veh.z, safeIdx, 60);
        }
        syncCar(0); camYaw = veh.heading;
        return { kmh: Math.round(veh.speed * 3.6), x: +veh.x.toFixed(1), y: +veh.y.toFixed(2), z: +veh.z.toFixed(1), grounded: veh.grounded, idx: safeIdx, vL: +veh.vL.toFixed(2) };
      },
      set camMode(v) { setCamMode(v); },
      // drive a full lap on autopilot and report how it went (testing only)
      autoLap(maxSeconds = 400, pace = 0.8) {
        const n = track.centre.length, dt = 1 / 120, inp = { throttle: 0, brake: 0, steer: 0, handbrake: false };
        placeAtStart(0);
        let falls = 0, top = 0, t = 0, progress = 0, prev = 0, airMax = 0, wasGrounded = true; const where = [];
        while (t < maxSeconds && progress < n - 2) {
          const sp = veh.speed, look = Math.round(4 + sp * 0.22);
          const tg = track.centre[(safeIdx + look) % n];
          let ang = Math.atan2(tg.x - veh.x, tg.z - veh.z) - veh.heading;
          while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
          inp.steer = clamp(ang * 3, -1, 1);
          let vt = veh.vmax;                                   // slow down for the tightest bend coming up
          for (let a = 0; a < 120; a++) {
            const c = Math.abs(track.centre[(safeIdx + a) % n].curv);
            if (c > 1e-4) vt = Math.min(vt, Math.sqrt(car.spec.grip * pace / c) + a * 0.35);
          }
          inp.throttle = sp < vt ? 1 : 0; inp.brake = sp > vt * 1.05 ? 1 : 0;
          veh.step(inp, dt); t += dt;
          top = Math.max(top, sp);
          if (veh.grounded) {
            safeIdx = track.nearest(veh.x, veh.z, safeIdx, 60);
            let d = safeIdx - prev; if (d < -n / 2) d += n; if (d > n / 2) d -= n;
            progress += d; prev = safeIdx;
            wasGrounded = true;
          } else {
            if (wasGrounded) {
              const c = track.centre[safeIdx], off = Math.hypot(veh.x - c.x, veh.z - c.z);
              where.push({ idx: safeIdx, kmh: Math.round(sp * 3.6), radius: Math.round(1 / Math.max(1e-4, Math.abs(c.curv))), offCentre: +off.toFixed(1), slip: +veh.vL.toFixed(1), vt: Math.round(vt * 3.6) });
              wasGrounded = false;
            }
            airMax = Math.max(airMax, veh.airTime);
            if (veh.y < veh.lastGroundY - 20) { falls++; placeAtStart(safeIdx); }
          }
        }
        syncCar(0);
        return { lapSeconds: +t.toFixed(1), topKmh: Math.round(top * 3.6), falls, sectionsDone: progress, of: n, longestAir: +airMax.toFixed(2), where };
      },
      // drive timed laps on autopilot through the real lap timer (testing only). Skips the countdown.
      timedLaps(count = 2, pace = 0.8, maxSeconds = 900) {
        const n = track.centre.length, dt = 1 / 120, inp = { throttle: 0, brake: 0, steer: 0, handbrake: false }, out = [];
        const stopAt = laps.view().lapNo + count;
        if (laps.phase === 'idle') toGrid();
        laps.step(LAPS_SKIP, veh);
        for (let t = 0; t < maxSeconds && laps.view().lapNo < stopAt; t += dt) {
          const sp = veh.speed, tg = track.centre[(safeIdx + Math.round(4 + sp * 0.22)) % n];
          let ang = Math.atan2(tg.x - veh.x, tg.z - veh.z) - veh.heading;
          while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
          inp.steer = clamp(ang * 3, -1, 1);
          let vt = veh.vmax;
          for (let a = 0; a < 120; a++) {
            const c = Math.abs(track.centre[(safeIdx + a) % n].curv);
            if (c > 1e-4) vt = Math.min(vt, Math.sqrt(car.spec.grip * pace / c) + a * 0.35);
          }
          inp.throttle = sp < vt ? 1 : 0; inp.brake = sp > vt * 1.05 ? 1 : 0;
          veh.step(inp, dt); laps.step(dt, veh);
          if (veh.grounded) safeIdx = track.nearest(veh.x, veh.z, safeIdx, 60);
          else if (veh.y < veh.lastGroundY - 20) { laps.voidLap('Fell off'); placeAtStart(safeIdx); laps.teleported(); }
        }
        syncCar(0); camYaw = veh.heading;
        return laps.view();
      },
      gates,
    },
  };
  return api;
}

function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let s = 99;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 46; i++) {
    const x = 64 + (r() - 0.5) * 62, y = 64 + (r() - 0.5) * 62, rad = 12 + r() * 24;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,0.13)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  }
  // fade to nothing at the edge so the sprite has no visible square
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
