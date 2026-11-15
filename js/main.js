// Moon Racer: screen flow.  map -> (dive) -> showroom -> drive
import { createMap, lonLatToWorld, worldToLonLat } from './map.js';
import { initGamepad, onButton, pad } from './gamepad.js?v=4';
import { createEngineSound } from './engine-sound.js?v=4';
import { formatTime, formatDelta } from './laps.js?v=3';

// The one circuit for now. Position = Tranquility Base (Apollo 11 landing site).
const CIRCUIT = { number: '01', name: 'Tranquility Circuit', lon: 23.47, lat: 0.67 };

const $ = id => document.getElementById(id);
const screens = { map: $('map-screen'), showroom: $('showroom'), hud: $('hud') };
const veil = $('veil'), veilText = $('veil-text'), veilBar = $('veil-bar');
const canvas = $('scene'), mapEl = $('map');
const wait = ms => new Promise(r => setTimeout(r, ms));

function show(name) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('is-active', k === name);
}
function setVeil(on, text = '') {
  veilText.textContent = text;
  veil.classList.toggle('is-on', on);
  return wait(on ? 620 : 0);
}

// ---------- map ----------
const map = createMap({ el: $('map'), world: $('map-world'), pins: $('map-pins') });
const spot = lonLatToWorld(CIRCUIT.lon, CIRCUIT.lat);
map.addPin({ ...spot, number: CIRCUIT.number, label: CIRCUIT.name, onSelect: enterCircuit });

const fmt = (v, pos, neg) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;
map.onHover(p => {
  const { lon, lat } = worldToLonLat(p.x, p.y);
  $('readout-lat').textContent = fmt(lat, 'N', 'S');
  $('readout-lon').textContent = fmt(lon, 'E', 'W');
});
$('zoom-in').addEventListener('click', () => map.zoomBy(1.6));
$('zoom-out').addEventListener('click', () => map.zoomBy(1 / 1.6));
$('go-circuit').addEventListener('click', enterCircuit);
$('credits-open').addEventListener('click', () => $('credits').showModal());

// Opening move: start wide, drift towards the near side where the circuit is.
// (on a phone the marker sits left of centre so its label fits on screen)
map.view.x = spot.x + (window.innerWidth < 720 ? 480 : -500); map.view.y = spot.y; map.refresh();

// ---------- engine sound (Ferrari only; silent if audio is unavailable) ----------
const engine = createEngineSound();
window.__engine = engine;                 // for testing in the console
// browsers only allow sound after a click or key press on the page
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => engine.unlock(), { capture: true });

// ---------- 3D game (loaded in the background once the map is up) ----------
let game = null, gamePromise = null, progress = 0, busy = false, state = 'map';
function loadGame() {
  if (!gamePromise) {
    gamePromise = import('./game.js?v=4')
      .then(m => m.createGame({
        canvas,
        onProgress: p => { progress = p; veilBar.style.width = Math.round(p * 100) + '%'; },
        onHud: updateHud,
        onNote: showNote,
        onLap: onLapEvent,
        readPad: pad,
      }))
      .then(g => { game = g; window.__mr = g; fillShowroom(); return g; });
    gamePromise.catch(err => {
      console.error(err);
      gamePromise = null;
    });
  }
  return gamePromise;
}
if ('requestIdleCallback' in window) requestIdleCallback(loadGame, { timeout: 2500 }); else setTimeout(loadGame, 1200);

// ---------- map -> circuit ----------
async function enterCircuit() {
  if (busy || state !== 'map') return;
  busy = true;
  map.lock(true);
  const loading = loadGame();
  // dive: fly to the circuit, then rush in while the screen goes dark
  await map.flyTo({ x: spot.x, y: spot.y, scale: 2.5, duration: 1500, ease: t => t * t * (3 - 2 * t) });
  mapEl.classList.add('is-diving');
  await wait(450);
  await setVeil(true, 'Descending to ' + CIRCUIT.name);
  show(null);                       // the map fades out behind the dark screen
  await wait(550);
  veil.classList.add('is-loading');
  try {
    await loading;
  } catch (e) {
    veil.classList.remove('is-loading');
    veilText.textContent = 'The circuit could not load. Check your connection and try again.';
    await wait(2600);
    await backToMap(true);
    return;
  }
  veil.classList.remove('is-loading');
  canvas.classList.add('is-on');
  game.start();
  const intro = game.playIntro();
  await wait(150);
  setVeil(false);
  await intro;
  state = 'showroom';
  show('showroom');
  busy = false;
  $('drive-btn').focus({ preventScroll: true });
}

async function backToMap(force) {
  if (busy && !force) return;
  busy = true;
  closeMenu();
  engine.stop();
  await setVeil(true);
  if (game) game.stop();
  canvas.classList.remove('is-on');
  state = 'map';
  mapEl.classList.remove('is-diving');
  show('map');
  map.lock(false);
  map.view.scale = Math.max(map.minScale, 0.9);
  map.refresh();
  setVeil(false);
  map.flyTo({ x: spot.x, y: spot.y, scale: Math.max(map.minScale * 1.3, 0.45), duration: 1400 });
  busy = false;
}

// ---------- showroom ----------
let carIndex = 0;
const keyboardLikely = !window.matchMedia('(hover: none) and (pointer: coarse)').matches;
function fillShowroom() {
  setCar(0);
  updateControlHints();
}
function updateControlHints() {
  const usePad = pad().connected;
  $('drive-btn').disabled = !keyboardLikely && !usePad;
  $('drive-hint').textContent = usePad ? 'Controller ready: R2 to accelerate, ✕ to start'
    : keyboardLikely ? 'Arrow keys or W A S D to drive · a PS5 controller works too'
    : 'Driving needs a keyboard or a game controller. Open Moon Racer on a computer, or connect a controller.';
  $('hud-keys').hidden = usePad;
  $('hud-pad').hidden = !usePad;
}
function setCar(i) {
  const n = game.cars.length;
  carIndex = (i + n) % n;
  const c = game.cars[carIndex];
  $('car-name').textContent = c.name;
  $('car-speed').textContent = c.topSpeed;
  $('hud-car').textContent = c.name;
  game.showCar(carIndex);
  engine.preload(c.id);                 // fetch the engine sounds while you look at the car
  showBest();
}
function showBest() {
  const t = game.bestFor(carIndex);
  $('car-best').textContent = t == null ? 'No lap time yet' : 'Best lap ' + formatTime(t);
}
$('car-prev').addEventListener('click', () => state === 'showroom' && setCar(carIndex - 1));
$('car-next').addEventListener('click', () => state === 'showroom' && setCar(carIndex + 1));
$('back-to-map').addEventListener('click', () => backToMap());
$('drive-btn').addEventListener('click', startDrive);

async function startDrive() {
  if (busy || state !== 'showroom') return;
  busy = true;
  engine.unlock();
  await setVeil(true);
  game.drive(carIndex);
  buildMinimap();
  state = 'drive';
  show('hud');
  const id = game.cars[carIndex].id;
  hudGear.hidden = !engine.has(id);
  engine.start(id);
  setVeil(false);
  busy = false;
  // a controller press alone may not count as "the player interacted", so sound can still be locked
  if (engine.has(id)) setTimeout(() => { if (engine.blocked && state === 'drive') showNote('Click or press any key to turn on the sound', 3200); }, 900);
}

async function toShowroom() {
  if (busy) return;
  busy = true;
  closeMenu();
  engine.stop();
  await setVeil(true);
  game.showroom(carIndex);
  showBest();
  state = 'showroom';
  show('showroom');
  setVeil(false);
  busy = false;
}

// ---------- HUD ----------
const hudSpeed = $('hud-speed'), hudGear = $('hud-gear'), miniCar = $('minimap-car'), note = $('hud-note');
let mini = null, noteTimer = 0, lastSpeed = -1, lastGear = '';
function buildMinimap() {
  if (mini) return;
  const pts = game.trackOutline;                       // [[x,z],...]
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const pad = 5, w = x1 - x0, h = z1 - z0, s = 100 / w;
  mini = { x0, z0, s, pad };
  $('minimap').setAttribute('viewBox', `${-pad} ${-pad} ${100 + pad * 2} ${h * s + pad * 2}`);
  $('minimap-track').setAttribute('d', 'M' + pts.map(([x, z]) => `${((x - x0) * s).toFixed(1)} ${((z - z0) * s).toFixed(1)}`).join('L') + 'Z');
}
function updateHud(h) {
  const kmh = Math.round(h.speed * 3.6);
  if (kmh !== lastSpeed) { hudSpeed.textContent = kmh; lastSpeed = kmh; }
  const gear = engine.update(h);
  if (gear && gear !== lastGear) { hudGear.textContent = gear; lastGear = gear; }
  if (h.lap) updateLapHud(h.lap);
  if (mini) {
    miniCar.setAttribute('cx', ((h.x - mini.x0) * mini.s).toFixed(1));
    miniCar.setAttribute('cy', ((h.z - mini.z0) * mini.s).toFixed(1));
  }
}
// ---------- lap timer ----------
const lapEl = $('hud-lap'), lapClock = $('lap-clock'), lapNo = $('lap-no'), lapBest = $('lap-best');
const lights = $('hud-lights'), splitEl = $('hud-split');
const sectorEls = [...document.querySelectorAll('#lap-sectors li')];
let goUntil = 0, splitTimer = 0, shown = {};
const setText = (el, key, text) => { if (shown[key] !== text) { el.textContent = text; shown[key] = text; } };

function updateLapHud(v) {
  setText(lapClock, 'clock', formatTime(v.phase === 'running' ? v.clock : 0));
  setText(lapNo, 'no', 'Lap ' + v.lapNo);
  setText(lapBest, 'best', v.best == null ? '–' : formatTime(v.best));
  lapEl.classList.toggle('is-void', v.void);
  sectorEls.forEach((el, k) => el.classList.toggle('is-current', v.phase === 'running' && k === v.splits.length));
  // countdown: one more red light every second, then all green on GO
  const counting = v.phase === 'countdown', go = performance.now() < goUntil;
  lights.hidden = !counting && !go;
  if (!lights.hidden) {
    const on = counting ? Math.min(3, Math.max(1, 4 - Math.ceil(v.countdown))) : 3;
    lights.classList.toggle('is-go', !counting);
    [...lights.children].forEach((l, k) => l.classList.toggle('is-on', k < on));
  }
}
function flashSplit(html, cls, ms = 3000) {
  splitEl.innerHTML = html;
  splitEl.className = 'hud__split is-on ' + cls;
  clearTimeout(splitTimer);
  splitTimer = setTimeout(() => splitEl.classList.remove('is-on'), ms);
}
const deltaClass = d => (d == null ? '' : d <= 0 ? 'is-faster' : 'is-slower');
function onLapEvent(e) {
  if (e.type === 'countdown') {
    sectorEls.forEach(el => { el.className = ''; });
    splitEl.classList.remove('is-on');
    goUntil = 0;
  } else if (e.type === 'go') {
    goUntil = performance.now() + 900;
  } else if (e.type === 'split') {
    const cls = e.void ? 'is-void' : deltaClass(e.delta) || 'is-done';
    sectorEls[e.sector - 1].className = cls;
    flashSplit(`<b>Sector ${e.sector}</b> ${formatTime(e.time)} <em>${formatDelta(e.delta)}</em>`, cls);
  } else if (e.type === 'void') {
    showNote(`${e.reason}: lap void`, 2200);
  } else if (e.type === 'lap') {
    const last = sectorEls[sectorEls.length - 1];
    if (!e.valid) {
      last.className = 'is-void';
      flashSplit(`<b>Lap void</b> ${formatTime(e.time)} <em>not counted</em>`, 'is-void', 3500);
    } else if (e.isBest) {
      last.className = 'is-best';
      flashSplit(`<b>New best lap</b> ${formatTime(e.time)} <em>${formatDelta(e.delta)}</em>`, 'is-best', 4500);
    } else {
      last.className = deltaClass(e.delta);
      flashSplit(`<b>Lap</b> ${formatTime(e.time)} <em>${formatDelta(e.delta)}</em>`, deltaClass(e.delta), 3500);
    }
    // the next lap starts now: clear the sector bars after a moment
    setTimeout(() => sectorEls.forEach(el => { if (state === 'drive') el.className = ''; }), 2500);
  }
}

function showNote(text, ms = 1600) {
  note.textContent = text;
  note.classList.add('is-on');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => note.classList.remove('is-on'), ms);
}

// ---------- pause menu ----------
const menu = $('menu');
function openMenu() { menu.hidden = false; game.pause(true); engine.pause(true); showVolume(); showGhostLabel(); $('menu-clear').textContent = 'Clear best laps'; $('menu-resume').focus(); }
function closeMenu() { if (menu.hidden) return; menu.hidden = true; if (game) game.pause(false); engine.pause(false); }
const volInput = $('menu-volume');
function showVolume() {
  const v = engine.muted ? 0 : Math.round(engine.volume * 100);
  volInput.value = v;
  $('menu-volume-val').textContent = engine.muted ? 'muted' : v + '%';
}
volInput.addEventListener('input', () => { engine.volume = volInput.value / 100; showVolume(); });
function nudgeVolume(dir) { engine.volume = Math.round(engine.volume * 20 + dir) / 20; showVolume(); }
function toggleMute() {
  engine.muted = !engine.muted;
  if (!engine.muted && engine.volume === 0) engine.volume = 0.5;
  showNote(engine.muted ? 'Sound off (M)' : 'Sound on', 1400);
}
$('menu-resume').addEventListener('click', closeMenu);
$('menu-car').addEventListener('click', toShowroom);
$('menu-map').addEventListener('click', () => backToMap());
$('menu-restart').addEventListener('click', restartLap);
$('menu-ghost').addEventListener('click', () => { game.setGhost(!game.ghostOn); showGhostLabel(); });
let clearArmed = 0;
$('menu-clear').addEventListener('click', () => {
  // two presses, so a slip of the finger does not wipe your times
  if (performance.now() > clearArmed) {
    clearArmed = performance.now() + 3000;
    $('menu-clear').textContent = 'Press again to clear all best laps';
    setTimeout(() => { $('menu-clear').textContent = 'Clear best laps'; }, 3000);
    return;
  }
  clearArmed = 0;
  game.clearBests();
  $('menu-clear').textContent = 'Best laps cleared';
});
function showGhostLabel() { $('menu-ghost').textContent = 'Ghost: ' + (game.ghostOn ? 'on' : 'off'); }
function restartLap() {
  if (state !== 'drive') return;
  closeMenu();
  game.restartLap();
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!menu.hidden) closeMenu();
    else if (state === 'drive' && !busy) openMenu();
    else if (state === 'showroom' && !busy) backToMap();
  } else if (state === 'showroom' && !busy) {
    if (e.key === 'ArrowLeft') setCar(carIndex - 1);
    else if (e.key === 'ArrowRight') setCar(carIndex + 1);
  } else if (state === 'drive' && !busy && menu.hidden && e.code === 'KeyT' && !e.repeat) {
    restartLap();
  }
  if (e.code === 'KeyM' && !e.repeat && state === 'drive') { toggleMute(); if (!menu.hidden) showVolume(); }
});

// ---------- game controller (PS5 DualSense and other standard pads) ----------
const credits = $('credits');
function activeLayer() {
  if (credits.open) return credits;
  if (!menu.hidden) return menu;
  return screens[state] || null;
}
function moveFocus(dir) {
  const layer = activeLayer();
  if (!layer) return;
  const list = [...layer.querySelectorAll('button:not([disabled]), input[type=range]')].filter(b => b.offsetParent !== null);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  list[(i < 0 ? 0 : i + dir + list.length) % list.length].focus();
}
function confirmPress() {
  const layer = activeLayer(), el = document.activeElement;
  if (layer && el && el.tagName === 'BUTTON' && layer.contains(el)) { el.click(); return; }
  if (el === volInput) return;                       // the slider uses left/right; ✕ does nothing there
  if (credits.open) credits.close();
  else if (!menu.hidden) closeMenu();
  else if (state === 'map') enterCircuit();
  else if (state === 'showroom') startDrive();
}
function goBack() {
  if (credits.open) credits.close();
  else if (!menu.hidden) closeMenu();
  else if (state === 'showroom' && !busy) backToMap();
}
onButton(name => {
  if (busy) return;
  const driving = state === 'drive' && menu.hidden;
  if (driving) {
    if (name === 'options') openMenu();
    else if (name === 'triangle') game.cycleCamera();
    else if (name === 'circle') game.resetCar();
    else if (name === 'create') restartLap();
    return;
  }
  if (name === 'options' && state === 'drive') closeMenu();
  else if (name === 'cross') confirmPress();
  else if (name === 'circle') goBack();
  else if (name === 'up') moveFocus(-1);
  else if (name === 'down') moveFocus(1);
  else if (document.activeElement === volInput && (name === 'left' || name === 'right')) nudgeVolume(name === 'left' ? -1 : 1)
  else if (state === 'showroom' && menu.hidden && (name === 'left' || name === 'right')) setCar(carIndex + (name === 'left' ? -1 : 1));
});
initGamepad({
  onConnect: () => { updateControlHints(); showNote('Controller connected', 2000); },
  onDisconnect: () => {
    updateControlHints();
    showNote('Controller disconnected', 2400);
    if (state === 'drive' && menu.hidden && !busy) openMenu();
  },
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'drive' && menu.hidden && !busy) openMenu();
});
