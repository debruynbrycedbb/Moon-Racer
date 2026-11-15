// The circuit: materials, road markings, light strips, the drivable surface
// and where the thruster pods go.
import * as THREE from 'three';

export const CYAN = new THREE.Color(0.22, 1.0, 1.25);

// ---------- drivable surface: fast "what is under this point?" lookups ----------
export class Surface {
  constructor(meshes, cell = 8) {
    this.cell = cell;
    this.grid = new Map();
    const tris = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (const m of meshes) {
      m.updateMatrixWorld(true);
      const pos = m.geometry.attributes.position, idx = m.geometry.index;
      const count = idx ? idx.count : pos.count;
      for (let i = 0; i < count; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
        if (n.y < 0.5) continue;                         // only faces you can drive on
        const t = tris.length / 12;
        tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, n.x, n.y, n.z);
        const x0 = Math.floor(Math.min(a.x, b.x, c.x) / cell), x1 = Math.floor(Math.max(a.x, b.x, c.x) / cell);
        const z0 = Math.floor(Math.min(a.z, b.z, c.z) / cell), z1 = Math.floor(Math.max(a.z, b.z, c.z) / cell);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
          const k = gx * 73856093 ^ gz * 19349663;
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, list = []);
          list.push(t);
        }
      }
    }
    this.tris = new Float32Array(tris);
  }

  // Highest drivable point at (x, z) that is not above maxY. Returns false if there is none.
  query(x, z, maxY, out) {
    const list = this.grid.get(Math.floor(x / this.cell) * 73856093 ^ Math.floor(z / this.cell) * 19349663);
    if (!list) return false;
    const T = this.tris;
    let best = -Infinity, hit = -1;
    for (let k = 0; k < list.length; k++) {
      const o = list[k] * 12;
      const ax = T[o], az = T[o + 2], bx = T[o + 3], bz = T[o + 5], cx = T[o + 6], cz = T[o + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (d === 0) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
      const y = u * T[o + 1] + v * T[o + 4] + w * T[o + 7];
      if (y > best && y <= maxY) { best = y; hit = o; }
    }
    if (hit < 0) return false;
    out.y = best; out.nx = T[hit + 9]; out.ny = T[hit + 10]; out.nz = T[hit + 11];
    return true;
  }
}

// ---------- textures drawn in code ----------
function roadTexture(renderer) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1024;                         // 9 m across, 24 m along
  const g = c.getContext('2d');
  g.fillStyle = '#25272b'; g.fillRect(0, 0, c.width, c.height);
  // asphalt grain
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < d.length; i += 4) {
    const v = (rnd() - 0.5) * 26 + (rnd() < 0.02 ? 22 : 0);
    d[i] += v; d[i + 1] += v; d[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
  // darker rubbered racing line down the middle
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0.15, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.22)'); grad.addColorStop(0.85, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  const m = c.width / 9, mv = c.height / 24;
  g.fillStyle = '#d9d9d2';
  g.fillRect(0.3 * m, 0, 0.2 * m, c.height);              // edge lines
  g.fillRect(c.width - 0.5 * m, 0, 0.2 * m, c.height);
  g.fillRect(c.width / 2 - 0.08 * m, 2 * mv, 0.16 * m, 4 * mv);   // centre dashes: 4 m on, 8 m off
  g.fillRect(c.width / 2 - 0.08 * m, 14 * mv, 0.16 * m, 4 * mv);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1 / 24);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 288; c.height = 64;
  const g = c.getContext('2d');
  for (let y = 0; y < 2; y++) for (let x = 0; x < 9; x++) {
    g.fillStyle = (x + y) % 2 ? '#e6e6e0' : '#101113';
    g.fillRect(x * 32, y * 32, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- centre line with direction and curvature ----------
function buildCentre(data) {
  const n = data.sections, pts = [];
  for (let i = 0; i < n; i++) {
    const L = data.left[i], R = data.right[i];
    pts.push({ x: (L[0] + R[0]) / 2, y: (L[1] + R[1]) / 2, z: (L[2] + R[2]) / 2, dist: data.dist[i] });
  }
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    pts[i].tx = dx / l; pts[i].tz = dz / l;                // unit direction of travel
  }
  const win = 5;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - win + n) % n], b = pts[(i + win) % n];
    let dh = Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz);
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    let ds = b.dist - a.dist; if (ds < 0) ds += data.length;
    pts[i].curv = dh / ds;                                 // 1 / corner radius, sign = direction
  }
  return pts;
}

// ---------- thruster positions ----------
// A pod under every corner apex (where the deck carries the most side load),
// then extra pods so no stretch of deck spans more than ~maxSpan metres.
export function podPositions(centre, length, { maxSpan = 210, minGap = 95 } = {}) {
  const n = centre.length, picks = [];
  const tight = 1 / 130;
  let i = 0;
  // start scanning from a straight so a corner is never split by the lap seam
  while (i < n && Math.abs(centre[i].curv) > tight) i++;
  const startScan = i;
  let run = -1;
  for (let k = 0; k < n; k++) {
    const j = (startScan + k) % n;
    if (Math.abs(centre[j].curv) > tight) {
      if (run < 0 || Math.abs(centre[j].curv) > Math.abs(centre[run].curv)) run = j;
    } else if (run >= 0) { picks.push(run); run = -1; }
  }
  if (run >= 0) picks.push(run);
  const gap = (a, b) => { let d = centre[b].dist - centre[a].dist; if (d < 0) d += length; return d; };
  picks.sort((a, b) => a - b);
  // drop apexes that sit too close to the previous one
  const apex = [];
  for (const p of picks) if (!apex.length || gap(apex[apex.length - 1], p) > minGap) apex.push(p);
  if (apex.length > 1 && gap(apex[apex.length - 1], apex[0]) < minGap) apex.pop();
  // fill the long spans
  const out = [];
  const atDist = d => {
    d = ((d % length) + length) % length;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (centre[mid].dist <= d) lo = mid; else hi = mid - 1; }
    return lo;
  };
  for (let a = 0; a < apex.length; a++) {
    const p = apex[a], q = apex[(a + 1) % apex.length];
    out.push(p);
    const g = apex.length === 1 ? length : gap(p, q);
    const extra = Math.ceil(g / maxSpan) - 1;
    for (let e = 1; e <= extra; e++) out.push(atDist(centre[p].dist + g * e / (extra + 1)));
  }
  out.sort((a, b) => a - b);
  return out;
}

// ---------- build ----------
export function buildTrack(gltfScene, data, renderer) {
  const group = new THREE.Group();
  group.name = 'track';
  const part = {};
  gltfScene.traverse(o => { if (o.isMesh) part[o.name] = o; });

  const road = part.road, deck = part.deck;
  road.material = new THREE.MeshStandardMaterial({ map: roadTexture(renderer), roughness: 0.82, metalness: 0.0 });
  deck.material = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 0.58, metalness: 0.55 });
  part.kerb_red.material = new THREE.MeshStandardMaterial({ color: 0xc8231f, roughness: 0.7 });
  part.kerb_white.material = new THREE.MeshStandardMaterial({ color: 0xdedcd4, roughness: 0.7 });
  for (const m of [road, deck, part.kerb_red, part.kerb_white]) {
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }

  const centre = buildCentre(data);
  const n = data.sections;
  const surface = new Surface([road, part.kerb_red, part.kerb_white]);

  // start / finish line across the first two metres of the lap
  {
    const L0 = data.left[0], R0 = data.right[0], L1 = data.left[1], R1 = data.right[1], up = 0.025;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      L0[0], L0[1] + up, L0[2], R0[0], R0[1] + up, R0[2], L1[0], L1[1] + up, L1[2], R1[0], R1[1] + up, R1[2]], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    g.computeVertexNormals();
    const line = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: checkerTexture(), roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    line.receiveShadow = true;
    group.add(line);
  }

  // cyan light strips along both sides of the deck
  {
    const pos = [], idx = [];
    const period = 56, on = 15, drop = 1.9, half = 0.2, out = 0.1;
    for (const side of ['left', 'right']) {
      const rail = data[side];
      let open = false;
      for (let i = 0; i <= n; i++) {
        const k = i % n, d = i === n ? data.length : data.dist[k];
        const lit = (d % period) < on && data.length - d > 6;
        if (!lit) { open = false; continue; }
        const c = centre[k];
        let ox = rail[k][0] - c.x, oz = rail[k][2] - c.z;
        const l = Math.hypot(ox, oz); ox /= l; oz /= l;
        const x = rail[k][0] + ox * out, z = rail[k][2] + oz * out, y = rail[k][1] - drop;
        const v = pos.length / 3;
        pos.push(x, y + half, z, x, y - half, z);
        if (open) idx.push(v - 2, v - 1, v, v, v - 1, v + 1);
        open = true;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const strips = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(2.2), side: THREE.DoubleSide }));
    strips.name = 'strips';
    group.add(strips);
  }

  // nearest centre-line section to a point, searching outwards from a hint
  function nearest(x, z, hint = -1, reach = 40) {
    let best = 0, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < n; i++) { const d = (centre[i].x - x) ** 2 + (centre[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    } else {
      for (let o = -reach; o <= reach; o++) {
        const i = (hint + o + n) % n, d = (centre[i].x - x) ** 2 + (centre[i].z - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  const box = new THREE.Box3().setFromObject(road);
  return {
    group, surface, centre, nearest, box,
    length: data.length,
    outline: centre.filter((_, i) => i % 4 === 0).map(p => [p.x, p.z]),
  };
}
