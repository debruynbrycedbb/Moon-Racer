// Moon Racer: screen flow.  map -> (dive) -> showroom -> drive
import { createMap, lonLatToWorld, worldToLonLat } from './map.js';

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

// Opening move: start wide, drift towards the near side where the circuit is.
// (on a phone the marker sits left of centre so its label fits on screen)
map.view.x = spot.x + (window.innerWidth < 720 ? 480 : -500); map.view.y = spot.y; map.refresh();

// ---------- 3D game (loaded in the background once the map is up) ----------
let game = null, gamePromise = null, progress = 0, busy = false, state = 'map';
function loadGame() {
  if (!gamePromise) {
    gamePromise = import('./game.js')
      .then(m => m.createGame({
        canvas,
        onProgress: p => { progress = p; veilBar.style.width = Math.round(p * 100) + '%'; },
        onHud: updateHud,
        onNote: showNote,
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
  if (!keyboardLikely) {
    $('drive-btn').disabled = true;
    $('drive-hint').textContent = 'Driving needs a keyboard for now. Open Moon Racer on a computer to drive.';
  }
}
function setCar(i) {
  const n = game.cars.length;
  carIndex = (i + n) % n;
  const c = game.cars[carIndex];
  $('car-name').textContent = c.name;
  $('car-speed').textContent = c.topSpeed;
  $('hud-car').textContent = c.name;
  game.showCar(carIndex);
}
$('car-prev').addEventListener('click', () => state === 'showroom' && setCar(carIndex - 1));
$('car-next').addEventListener('click', () => state === 'showroom' && setCar(carIndex + 1));
$('back-to-map').addEventListener('click', () => backToMap());
$('drive-btn').addEventListener('click', startDrive);

async function startDrive() {
  if (busy || state !== 'showroom') return;
  busy = true;
  await setVeil(true);
  game.drive(carIndex);
  buildMinimap();
  state = 'drive';
  show('hud');
  setVeil(false);
  busy = false;
  showNote('Free drive', 2200);
}

async function toShowroom() {
  if (busy) return;
  busy = true;
  closeMenu();
  await setVeil(true);
  game.showroom(carIndex);
  state = 'showroom';
  show('showroom');
  setVeil(false);
  busy = false;
}

// ---------- HUD ----------
const hudSpeed = $('hud-speed'), miniCar = $('minimap-car'), note = $('hud-note');
let mini = null, noteTimer = 0, lastSpeed = -1;
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
  if (mini) {
    miniCar.setAttribute('cx', ((h.x - mini.x0) * mini.s).toFixed(1));
    miniCar.setAttribute('cy', ((h.z - mini.z0) * mini.s).toFixed(1));
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
function openMenu() { menu.hidden = false; game.pause(true); $('menu-resume').focus(); }
function closeMenu() { if (menu.hidden) return; menu.hidden = true; if (game) game.pause(false); }
$('menu-resume').addEventListener('click', closeMenu);
$('menu-car').addEventListener('click', toShowroom);
$('menu-map').addEventListener('click', () => backToMap());

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!menu.hidden) closeMenu();
    else if (state === 'drive' && !busy) openMenu();
    else if (state === 'showroom' && !busy) backToMap();
  } else if (state === 'showroom' && !busy) {
    if (e.key === 'ArrowLeft') setCar(carIndex - 1);
    else if (e.key === 'ArrowRight') setCar(carIndex + 1);
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'drive' && menu.hidden && !busy) openMenu();
});
