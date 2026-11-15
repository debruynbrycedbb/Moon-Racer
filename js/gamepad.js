// Game controller support (made for the PS5 DualSense, works with any controller the
// browser reports in the "standard" layout, such as Xbox pads).
//   L2 brake / reverse, R2 throttle (pressure-sensitive), left stick steer,
//   Square handbrake, Triangle camera, Circle reset (Back in menus), Cross confirm,
//   Options pause, D-pad move between buttons and change car.

export const BUTTONS = {
  cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7,
  create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, ps: 16,
};
const STICK_DEADZONE = 0.08, TRIGGER_DEADZONE = 0.04;

const listeners = new Set();
const state = { connected: false, name: '', throttle: 0, brake: 0, steer: 0, handbrake: false };
let held = [], raf = 0, timer = 0;

// press(buttonName) is called once each time a button goes down
export function onButton(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function pad() { return state; }

function pick() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const g of list) if (g && g.connected) return g;
  return null;
}

const dead = (v, d) => (Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d));
const btn = (g, i) => { const b = g.buttons[i]; return b ? (typeof b === 'object' ? b.value || (b.pressed ? 1 : 0) : b) : 0; };

function poll() {
  const g = pick();
  if (!g) {
    if (state.connected) Object.assign(state, { connected: false, throttle: 0, brake: 0, steer: 0, handbrake: false });
    held = [];
    return;
  }
  state.connected = true;
  state.name = g.id;
  state.throttle = Math.max(0, dead(btn(g, BUTTONS.r2), TRIGGER_DEADZONE));
  state.brake = Math.max(0, dead(btn(g, BUTTONS.l2), TRIGGER_DEADZONE));
  // a gentle curve: small stick movements give fine steering, full lock is still full lock
  const x = dead(g.axes[0] || 0, STICK_DEADZONE);
  state.steer = -Math.sign(x) * Math.pow(Math.abs(x), 1.4);     // the game's steering is "left = positive"
  state.handbrake = btn(g, BUTTONS.square) > 0.5;
  for (const [name, i] of Object.entries(BUTTONS)) {
    const down = btn(g, i) > 0.5;
    if (down && !held[i]) for (const fn of listeners) fn(name);
    held[i] = down;
  }
}

function loop() {
  poll();
  raf = requestAnimationFrame(loop);
}

function startPolling() {
  if (raf) return;
  raf = requestAnimationFrame(loop);
  // frames stop in a background tab; keep reading so buttons are not "stuck" on return
  timer = setInterval(() => { if (document.hidden) poll(); }, 250);
}
function stopPolling() {
  cancelAnimationFrame(raf); clearInterval(timer); raf = 0; timer = 0;
  poll();
}

export function initGamepad({ onConnect = () => {}, onDisconnect = () => {} } = {}) {
  if (!('getGamepads' in navigator)) return;
  window.addEventListener('gamepadconnected', e => {
    startPolling();
    poll();
    onConnect(e.gamepad);
  });
  window.addEventListener('gamepaddisconnected', e => {
    if (!pick()) { stopPolling(); onDisconnect(e.gamepad); }
  });
  if (pick()) startPolling();          // already connected before the page loaded
}
