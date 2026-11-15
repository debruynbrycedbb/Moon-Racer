// Engine sound (Web Audio). Only cars listed in SOUNDS make a sound; the BYD U9 stays silent for now.
// Each gear has its own looping recording. An automatic gearbox picks the gear from the speed,
// the loop's pitch rises with the revs, and gear changes blend over a few hundredths of a second.
// Purely for sound and the gear readout: it never changes how the car drives.
// If audio is unavailable or a file fails to load, the game simply plays silently.

const DIR = 'assets/audio/';
export const SOUNDS = {
  laferrari: {
    idle: 'ferrari-idle.wav',
    gears: [1, 2, 3, 4, 5, 6].map(n => `ferrari-gear${n}.wav`),
    startup: 'ferrari-startup.m4a',
    startupCatch: 1.3,                         // seconds into the startup clip where the engine fires
    gearTop: [85, 130, 175, 220, 262, 300],    // km/h at the top of each gear
    reverseTop: 50,
  },
};
const SETTINGS_KEY = 'moon-racer-settings';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- automatic gearbox (no audio, easy to test) ----------
export function gearFor(spec, kmh, gear) {
  const top = spec.gearTop;
  let g = clamp(gear, 0, top.length - 1);
  while (g < top.length - 1 && kmh > top[g] * 0.97) g++;                   // shift up near the top of the gear
  while (g > 0 && kmh < top[g - 1] * 0.78) g--;                            // shift down once the revs fall well off
  return g;
}

function loadSettings(storage) {
  try { return { volume: 0.7, muted: false, ...JSON.parse(storage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { volume: 0.7, muted: false }; }
}

export function createEngineSound({ storage = window.localStorage } = {}) {
  const settings = loadSettings(storage);
  const save = () => { try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };
  const AC = window.AudioContext || window.webkitAudioContext;

  let ctx = null, master = null, bus = null, filter = null;
  const buffers = {};          // carId -> Promise<{ idle, gears[], startup }>
  let live = null;             // what is playing: { spec, sources[], gains[], idleGain, ... }
  let paused = false, lastT = 0;

  function ensureContext() {
    if (ctx || !AC) return ctx;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      applyVolume(0);
    } catch (e) { console.warn('No engine sound:', e); ctx = null; }
    return ctx;
  }
  function applyVolume(t = 0.05) {
    if (!master) return;
    const v = settings.muted || paused ? 0 : settings.volume * settings.volume;   // squared: the slider feels even
    master.gain.setTargetAtTime(v, ctx.currentTime, t);
  }

  async function decode(name) {
    const res = await fetch(DIR + name);
    if (!res.ok) throw new Error(name + ' ' + res.status);
    const data = await res.arrayBuffer();
    return new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail));
  }
  function preload(carId) {
    const spec = SOUNDS[carId];
    if (!spec || !ensureContext()) return null;
    if (!buffers[carId]) {
      buffers[carId] = Promise.all([decode(spec.idle), Promise.all(spec.gears.map(decode)), decode(spec.startup)])
        .then(([idle, gears, startup]) => ({ idle, gears, startup }));
      buffers[carId].catch(e => { console.warn('Engine sound failed to load:', e); delete buffers[carId]; });
    }
    return buffers[carId];
  }

  function loop(buffer, out) {
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(g); g.connect(out);
    src.start(0, Math.random() * buffer.duration);      // random start, so the loops never line up
    return { src, gain: g };
  }

  async function start(carId) {
    stop(0);
    const spec = SOUNDS[carId];
    if (!spec || !ensureContext()) return;
    const token = {};
    live = token;
    let b;
    try { b = await preload(carId); } catch { return; }
    if (live !== token) return;                         // left the car while loading
    // chain: each loop -> its gain -> load filter -> bus (startup fade) -> master
    bus = ctx.createGain(); bus.gain.value = 0;
    filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2500; filter.Q.value = 0.5;
    filter.connect(bus); bus.connect(master);
    const now = ctx.currentTime;
    const click = ctx.createBufferSource();
    click.buffer = b.startup;
    const clickGain = ctx.createGain(); clickGain.gain.value = 0.9;
    click.connect(clickGain); clickGain.connect(master);
    click.start(now);
    bus.gain.setValueAtTime(0, now + spec.startupCatch);
    bus.gain.linearRampToValueAtTime(1, now + spec.startupCatch + 0.35);
    Object.assign(token, {
      spec, bus, filter, click,
      idle: loop(b.idle, filter),
      gears: b.gears.map(buf => loop(buf, filter)),
      gear: 0, label: 'N', rev: 0, load: 0, cutUntil: 0,
      busFree: now + spec.startupCatch + 0.4,           // the startup fade owns the bus volume until then
    });
    token.idle.gain.gain.value = 1;
    lastT = performance.now();
  }

  function stop(fade = 0.25) {
    const l = live;
    live = null;
    if (!l || !l.gears) return;
    const end = ctx.currentTime + fade + 0.05;
    l.bus.gain.cancelScheduledValues(ctx.currentTime);
    l.bus.gain.setTargetAtTime(0, ctx.currentTime, fade / 3 + 0.001);
    for (const s of [l.idle, ...l.gears]) { try { s.src.stop(end); } catch {} }
    try { l.click.stop(end); } catch {}
    setTimeout(() => l.bus.disconnect(), (fade + 0.2) * 1000);
  }

  // h: { speed m/s, vF m/s (negative = reversing), throttle 0..1, brake 0..1, frozen (waiting on the line) }
  // returns the gear to show ('N', 'R', '1'..'6'), or null when this car has no engine sound
  function update(h) {
    const l = live;
    const t = performance.now(), dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    if (!l) return null;
    if (!l.gears) return 'N';                           // still loading
    const spec = l.spec, now = ctx.currentTime, kmh = Math.abs(h.vF) * 3.6;
    l.load += (Math.max(h.throttle, 0.12) - l.load) * Math.min(1, dt * 10);

    let clip = 0, rpm, idleMix;
    if (h.frozen) {                                     // on the line: neutral, the throttle just revs
      l.rev += (h.throttle - l.rev) * Math.min(1, dt * (h.throttle > l.rev ? 5 : 3));
      l.gear = 0; l.label = 'N';
      rpm = 0.2 + 0.85 * l.rev;
      idleMix = clamp(1 - l.rev * 2.5, 0, 1);
    } else if (h.vF < -0.5) {                           // reversing
      l.gear = 0; l.label = 'R';
      rpm = 0.2 + 0.8 * Math.min(1, kmh / spec.reverseTop);
      idleMix = clamp(1 - kmh / 8, 0, 1);
    } else {
      const g = gearFor(spec, kmh, l.gear);
      if (g > l.gear) l.cutUntil = now + 0.07;          // a short cut in power on each upshift
      l.gear = g; l.label = String(g + 1); clip = g;
      rpm = clamp(kmh / spec.gearTop[g], 0.2, 1.05);
      idleMix = g === 0 ? clamp(1 - kmh / 14, 0, 1) * (1 - h.throttle * 0.8) : 0;
      l.rev = 0;
    }
    // volume of each loop: the current gear in, the others out
    l.gears.forEach((s, i) => s.gain.gain.setTargetAtTime(i === clip ? 1 - idleMix : 0, now, 0.045));
    l.idle.gain.gain.setTargetAtTime(idleMix, now, 0.06);
    l.gears[clip].src.playbackRate.setTargetAtTime(0.7 + 0.48 * rpm, now, 0.03);
    // off the throttle the engine goes quieter and duller; a dip on each upshift
    const cut = now < l.cutUntil ? 0.35 : 1;
    l.filter.frequency.setTargetAtTime(1400 + 9000 * l.load * l.load, now, 0.05);
    if (now > l.busFree) l.bus.gain.setTargetAtTime((0.55 + 0.45 * l.load) * cut, now, 0.03);
    return l.label;
  }

  function unlock() {
    if (!ensureContext()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  return {
    preload, start, stop, update, unlock,
    has: carId => !!SOUNDS[carId],
    get blocked() { return !!ctx && ctx.state !== 'running'; },
    pause(v) { paused = v; applyVolume(); },
    get volume() { return settings.volume; },
    set volume(v) { settings.volume = clamp(v, 0, 1); if (settings.volume > 0) settings.muted = false; save(); applyVolume(); },
    get muted() { return settings.muted; },
    set muted(v) { settings.muted = !!v; save(); applyVolume(); },
    debug: { get ctx() { return ctx; }, get live() { return live; } },
  };
}
