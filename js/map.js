// Flat, draggable map of the Moon (equirectangular image, cut into tiles).
// World units are pixels of the full 8192 x 4096 image.

const W = 8192, H = 4096, TILE = 1024;
const LEVELS = [
  { z: 1, width: 4096 },
  { z: 2, width: 8192 },
];

export function lonLatToWorld(lon, lat) {
  return { x: (lon + 180) / 360 * W, y: (90 - lat) / 180 * H };
}
export function worldToLonLat(x, y) {
  return { lon: x / W * 360 - 180, lat: 90 - y / H * 180 };
}

export function createMap({ el, world, pins, onMove }) {
  const view = { x: W / 2, y: H / 2, scale: 1 };   // x,y = world point at the centre of the screen
  let vw = 1, vh = 1, minScale = 0.1;
  const maxScale = 2.5;
  let locked = false;
  let anim = null;
  const pinList = [];

  // ----- layers -----
  world.style.width = W + 'px';
  world.style.height = H + 'px';
  const base = new Image();
  base.src = 'assets/map/base.webp';
  base.alt = '';
  base.style.cssText = `left:0;top:0;width:${W}px;height:${H}px`;
  world.appendChild(base);
  const tiles = new Map();   // key -> img

  function measure() {
    vw = el.clientWidth; vh = el.clientHeight;
    minScale = Math.max(vw / W, vh / H);
    clamp();
    apply();
  }

  function clamp(allowOver = false) {
    if (!allowOver) view.scale = Math.min(maxScale, Math.max(minScale, view.scale));
    const hw = vw / 2 / view.scale, hh = vh / 2 / view.scale;
    view.x = hw >= W / 2 ? W / 2 : Math.min(W - hw, Math.max(hw, view.x));
    view.y = hh >= H / 2 ? H / 2 : Math.min(H - hh, Math.max(hh, view.y));
  }

  function apply() {
    const tx = vw / 2 - view.x * view.scale, ty = vh / 2 - view.y * view.scale;
    world.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${view.scale})`;
    for (const p of pinList) {
      p.el.style.transform = `translate3d(${p.x * view.scale + tx}px,${p.y * view.scale + ty}px,0)`;
    }
    loadTiles();
    if (onMove) onMove(view);
  }

  function loadTiles() {
    const need = W * view.scale * Math.min(window.devicePixelRatio || 1, 2);
    const level = need > 4096 * 1.15 ? LEVELS[1] : need > 2048 * 1.15 ? LEVELS[0] : null;
    if (!level) return;
    const size = TILE * (W / level.width);            // tile size in world units
    const hw = vw / 2 / view.scale, hh = vh / 2 / view.scale;
    const x0 = Math.max(0, Math.floor((view.x - hw) / size)), x1 = Math.min(W / size - 1, Math.floor((view.x + hw) / size));
    const y0 = Math.max(0, Math.floor((view.y - hh) / size)), y1 = Math.min(H / size - 1, Math.floor((view.y + hh) / size));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const key = `${level.z}_${tx}_${ty}`;
        if (tiles.has(key)) continue;
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        // 0.5px overlap hides hairline seams between tiles
        img.style.cssText = `left:${tx * size}px;top:${ty * size}px;width:${size + 0.5}px;height:${size + 0.5}px;z-index:${level.z};opacity:0;transition:opacity .3s`;
        img.onload = () => { img.style.opacity = 1; };
        img.src = `assets/map/${key}.webp`;
        tiles.set(key, img);
        world.appendChild(img);
      }
    }
  }

  function screenToWorld(sx, sy) {
    return { x: view.x + (sx - vw / 2) / view.scale, y: view.y + (sy - vh / 2) / view.scale };
  }

  function zoomAt(sx, sy, factor) {
    const before = screenToWorld(sx, sy);
    view.scale = Math.min(maxScale, Math.max(minScale, view.scale * factor));
    view.x = before.x - (sx - vw / 2) / view.scale;
    view.y = before.y - (sy - vh / 2) / view.scale;
    clamp(); apply();
  }

  // ----- animation (used for the buttons and for the dive into a circuit) -----
  function flyTo({ x, y, scale, duration = 900, ease = t => 1 - Math.pow(1 - t, 3), over = false }) {
    cancelAnimationFrame(anim);
    const from = { ...view }, t0 = performance.now();
    return new Promise(resolve => {
      const step = now => {
        const t = Math.min(1, (now - t0) / duration), k = ease(t);
        // zoom in log space so the speed feels even
        view.scale = Math.exp(Math.log(from.scale) + (Math.log(scale) - Math.log(from.scale)) * k);
        view.x = from.x + (x - from.x) * k;
        view.y = from.y + (y - from.y) * k;
        clamp(over); apply();
        if (t < 1) anim = requestAnimationFrame(step); else resolve();
      };
      anim = requestAnimationFrame(step);
    });
  }

  // ----- pointer input: drag with one finger/mouse, pinch with two -----
  const pointers = new Map();
  let moved = 0, pinchDist = 0;
  el.addEventListener('pointerdown', e => {
    if (locked || e.target.closest('.pin')) return;
    cancelAnimationFrame(anim);
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (pointers.size === 2) pinchDist = dist();
    el.classList.add('is-dragging');
  });
  el.addEventListener('pointermove', e => {
    if (!locked && !pointers.size) { hover(e); return; }
    const p = pointers.get(e.pointerId);
    if (!p || locked) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      view.x -= dx / view.scale; view.y -= dy / view.scale;
      moved += Math.abs(dx) + Math.abs(dy);
      clamp(); apply();
    } else if (pointers.size === 2) {
      const d = dist(), c = centre();
      if (pinchDist > 0) zoomAt(c.x, c.y, d / pinchDist);
      pinchDist = d;
    }
    hover(e);
  });
  const end = e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (!pointers.size) el.classList.remove('is-dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  function dist() { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
  function centre() { const [a, b] = [...pointers.values()]; const r = el.getBoundingClientRect(); return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }; }

  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (locked) return;
    cancelAnimationFrame(anim);
    const r = el.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0018)));
  }, { passive: false });

  el.addEventListener('keydown', e => {
    if (locked) return;
    const step = 90 / view.scale;
    const k = e.key;
    if (k === 'ArrowLeft') view.x -= step;
    else if (k === 'ArrowRight') view.x += step;
    else if (k === 'ArrowUp') view.y -= step;
    else if (k === 'ArrowDown') view.y += step;
    else if (k === '+' || k === '=') return zoomBy(1.5);
    else if (k === '-' || k === '_') return zoomBy(1 / 1.5);
    else return;
    e.preventDefault(); clamp(); apply();
  });

  let hoverCb = null;
  function hover(e) {
    if (!hoverCb) return;
    const r = el.getBoundingClientRect();
    hoverCb(screenToWorld(e.clientX - r.left, e.clientY - r.top));
  }

  function zoomBy(f) {
    return flyTo({ x: view.x, y: view.y, scale: Math.min(maxScale, Math.max(minScale, view.scale * f)), duration: 350 });
  }

  function addPin({ x, y, number, label, onSelect }) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin';
    b.setAttribute('aria-label', `Go to ${label}`);
    b.innerHTML = `<i class="pin__ring"></i><i class="pin__ring"></i><i class="pin__dot"></i><span class="pin__label"><b>${number}</b>${label}</span>`;
    b.addEventListener('click', () => { if (!locked) onSelect(); });
    pins.appendChild(b);
    pinList.push({ el: b, x, y });
    apply();
    return b;
  }

  new ResizeObserver(measure).observe(el);
  measure();
  view.scale = minScale;
  clamp(); apply();

  return {
    view, flyTo, zoomBy, addPin,
    onHover(cb) { hoverCb = cb; },
    lock(v) { locked = v; },
    get minScale() { return minScale; },
    refresh: measure,
  };
}
