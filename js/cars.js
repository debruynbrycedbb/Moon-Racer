// Car models: load, put them in one common frame (front = +Z, left = +X, wheels on y = 0)
// and rig the wheels so they can spin and steer.
import * as THREE from 'three';

export const CARS = [
  {
    id: 'u9', name: 'BYD Yangwang U9', file: 'assets/models/car-byd-u9.glb',
    topSpeed: 500,            // km/h
    accel: 24, brake: 30, grip: 23, aeroGrip: 0.085,
    wheelNodes: /^SM_Hub/,
    eye: [0.36, 1.08, -0.02],
  },
  {
    id: 'laferrari', name: 'Ferrari LaFerrari', file: 'assets/models/car-laferrari.glb',
    topSpeed: 300,
    accel: 15, brake: 28, grip: 22, aeroGrip: 0.09,
    wheelNodes: /TYRE/,
    eye: [0.34, 0.9, -0.05],
  },
];

const _box = new THREE.Box3(), _c = new THREE.Vector3(), _s = new THREE.Vector3();

export function prepareCar(gltf, spec) {
  const root = new THREE.Group();          // moved by the physics
  const body = new THREE.Group();          // leans a little in corners
  const model = gltf.scene;
  root.add(body); body.add(model);
  root.updateMatrixWorld(true);

  // wheel centres from the named wheel nodes
  const centres = [];
  model.traverse(o => {
    if (!o.isMesh && spec.wheelNodes.test(o.name) && !(o.parent && spec.wheelNodes.test(o.parent.name))) {
      _box.setFromObject(o);
      if (!_box.isEmpty()) centres.push(_box.getCenter(new THREE.Vector3()));
    }
  });
  if (centres.length !== 4) console.warn(spec.name, 'expected 4 wheels, found', centres.length);

  // recentre: middle of the four wheels at x = z = 0, lowest point at y = 0
  const mid = new THREE.Vector3();
  centres.forEach(c => mid.add(c));
  mid.multiplyScalar(1 / Math.max(1, centres.length));
  _box.setFromObject(model);
  const ground = _box.min.y;
  model.position.set(-mid.x, -ground, -mid.z);
  root.updateMatrixWorld(true);
  centres.forEach(c => { c.x -= mid.x; c.y -= ground; c.z -= mid.z; });

  const glass = [];
  // materials: cheap glass instead of the costly "transmission" pass, shadows off (the game fakes the car shadow)
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false;
    o.layers.enable(2);                    // layer 2 = "things that cast the car's shadow"
    const m = o.material;
    if (!m) return;
    if (m.transmission > 0 || /glass|window/i.test(m.name)) {
      glass.push(o);
      m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.38);
      m.color.multiplyScalar(0.35); m.roughness = 0.14; m.metalness = 0.9; m.depthWrite = false;
      o.renderOrder = 2;
    }
    m.envMapIntensity = 1.0;
    // no perfect mirrors: they turn the sun into a single blinding pixel
    if (!m.roughnessMap) m.roughness = Math.max(m.roughness, 0.14);
    if (m.clearcoat > 0) m.clearcoatRoughness = Math.max(m.clearcoatRoughness, 0.1);
  });

  // collect the parts of each wheel
  const wheels = centres.map(c => {
    const steer = new THREE.Group(), spin = new THREE.Group();
    steer.position.copy(c);
    steer.add(spin);
    body.add(steer);
    return { centre: c, radius: c.y, front: c.z > 0, left: c.x > 0, steer, spin, parts: 0 };
  });
  root.updateMatrixWorld(true);
  const meshes = [];
  model.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    _box.setFromObject(o); _box.getCenter(_c); _box.getSize(_s);
    for (const w of wheels) {
      const R = w.radius * 1.12;
      const inside = _box.min.y > w.centre.y - R && _box.max.y < w.centre.y + R &&
                     _box.min.z > w.centre.z - R && _box.max.z < w.centre.z + R &&
                     Math.abs(_c.x - w.centre.x) < 0.3 && _s.x < 0.6;
      if (!inside) continue;
      // brake calipers turn with the steering but do not spin
      (/brake/i.test(o.name) || /brake/i.test(o.parent.name) ? w.steer : w.spin).attach(o);
      w.parts++;
      break;
    }
  }

  _box.setFromObject(root);
  const size = _box.getSize(new THREE.Vector3());
  const front = wheels.filter(w => w.front), rear = wheels.filter(w => !w.front);
  const zOf = list => list.reduce((s, w) => s + w.centre.z, 0) / Math.max(1, list.length);
  return {
    spec, root, body, wheels, size, glass,
    wheelbase: zOf(front) - zOf(rear),
    trackWidth: Math.abs(front[0]?.centre.x ?? 0.8) * 2,
    frontZ: zOf(front), rearZ: zOf(rear),
    wheelRadius: wheels.reduce((s, w) => s + w.radius, 0) / Math.max(1, wheels.length),
  };
}

// spin and steer the wheels to match the physics state
export function animateWheels(car, state, dt) {
  for (const w of car.wheels) {
    w.spin.rotation.x += (state.vF / w.radius) * dt;
    if (w.front) w.steer.rotation.y = state.steerAngle;
  }
}
