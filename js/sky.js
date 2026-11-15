// Space backdrop: stars, Earth, and the reflection map the car paint uses.
import * as THREE from 'three';

const NOISE = /* glsl */`
  float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= .5; } return s; }
`;

export function createSky(sunDir) {
  const group = new THREE.Group();
  group.name = 'sky';

  // ----- stars -----
  const N = 3200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(a) * 5000; pos[i * 3 + 1] = u * 5000; pos[i * 3 + 2] = r * Math.sin(a) * 5000;
    const b = Math.pow(rnd(), 3.2) * 1.5 + 0.12, tint = rnd();
    col[i * 3] = b * (tint > 0.8 ? 1.0 : 0.85); col[i * 3 + 1] = b * 0.9; col[i * 3 + 2] = b * (tint < 0.3 ? 1.0 : 0.85);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, depthTest: false, depthWrite: false, fog: false }));
  stars.renderOrder = -12; stars.frustumCulled = false;
  group.add(stars);

  // ----- Earth -----
  const earthDir = new THREE.Vector3(-0.42, 0.27, -0.83).normalize();
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(430, 64, 48),
    new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDir.clone() } },
      depthTest: false, depthWrite: false,
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vP; varying vec3 vView;
        void main(){
          vP = normalize(position);
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vView = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun; varying vec3 vN; varying vec3 vP; varying vec3 vView;
        ${NOISE}
        void main(){
          float land = smoothstep(0.50, 0.56, fbm(vP * 2.3 + 4.0));
          float lat = abs(vP.y);
          vec3 ocean = mix(vec3(0.015, 0.07, 0.22), vec3(0.02, 0.16, 0.34), fbm(vP * 6.0));
          vec3 ground = mix(vec3(0.10, 0.20, 0.06), vec3(0.34, 0.27, 0.15), fbm(vP * 5.0 + 9.0));
          vec3 c = mix(ocean, ground, land);
          c = mix(c, vec3(0.9), smoothstep(0.80, 0.93, lat + fbm(vP * 4.0) * 0.12));      // ice caps
          float cl = smoothstep(0.50, 0.74, fbm(vP * 3.2 + vec3(1.7, 0.0, 2.3) + fbm(vP * 7.0) * 0.6));
          c = mix(c, vec3(0.95), cl * 0.9);
          float d = dot(vN, uSun);
          float day = smoothstep(-0.12, 0.3, d);
          float rim = pow(1.0 - max(dot(vN, vView), 0.0), 2.6);
          vec3 lit = c * day * 1.5 + vec3(0.25, 0.55, 1.0) * rim * (0.2 + day) * 1.2;
          lit += vec3(1.0) * pow(max(dot(reflect(-uSun, vN), vView), 0.0), 40.0) * (1.0 - land) * (1.0 - cl) * 0.6 * day;
          gl_FragColor = vec4(lit, 1.0);
        }`,
    }));
  earth.position.copy(earthDir).multiplyScalar(6000);
  earth.rotation.set(0.4, 1.1, 0.2);
  earth.renderOrder = -11; earth.frustumCulled = false;
  group.add(earth);

  // soft blue halo around Earth
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(0.25, 0.5, 1.0), transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false }));
  halo.scale.setScalar(430 * 3.1);
  halo.position.copy(earth.position);
  halo.renderOrder = -11.5;
  group.add(halo);

  return { group, earthDir };
}

export function glowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Reflection map: black sky, a hard sun, grey ground. Gives the car paint something to mirror.
export function createEnvironment(renderer, sunDir, earthDir) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(50, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uSun: { value: sunDir.clone() }, uEarth: { value: earthDir.clone() } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform vec3 uSun; uniform vec3 uEarth; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD);
          vec3 ground = vec3(0.2) * smoothstep(0.02, -0.25, d.y);
          vec3 sky = vec3(0.012, 0.016, 0.024) + vec3(0.05, 0.055, 0.06) * smoothstep(0.25, 0.0, d.y) * step(0.0, d.y);
          vec3 c = mix(sky, ground, smoothstep(0.02, -0.02, d.y));
          float s = dot(d, uSun);
          c += vec3(1.0, 0.97, 0.9) * (smoothstep(0.994, 0.9985, s) * 70.0 + smoothstep(0.9, 1.0, s) * 0.6);
          c += vec3(0.2, 0.45, 0.9) * smoothstep(0.985, 0.998, dot(d, uEarth)) * 2.0;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.01).texture;
  pmrem.dispose();
  return tex;
}
