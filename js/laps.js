// Lap timing rules: countdown, start/finish line, sector splits, void laps,
// personal bests per car and the ghost recording. No 3D in here: game.js feeds
// in the car's position after every physics step and draws what this file says.

export const LAPS = {
  countdown: 3,            // seconds of red lights before GO
  ghostHz: 20,             // ghost samples per second of lap time
  gateSlack: 3,            // metres beyond the road edge that still count as crossing a gate
  gateHeight: 8,           // metres above/below the road that still count (not while falling past)
  saveKey: 'moon-racer-v1',
};

// one ghost sample: position, attitude, steering and forward speed (for the wheels)
const FIELDS = ['x', 'y', 'z', 'heading', 'pitch', 'roll', 'steerAngle', 'vF'];
const NF = FIELDS.length;
const DIGITS = [2, 2, 2, 3, 3, 3, 3, 1];   // rounding when saved, to keep the save small

// gates: [start/finish line, split 1, split 2, ...], each { x, y, z, tx, tz, half } (tx, tz = direction of travel)
export function createLaps({ circuitId, gates, onEvent = () => {}, storage = safeStorage() }) {
  const save = load(storage);
  const bests = save.best[circuitId] || (save.best[circuitId] = {});

  const s = {
    carId: null, phase: 'idle', countdown: 0, clock: 0, lapNo: 0,
    nextGate: 1, splits: [], void: false, voidReason: '',
    last: null, rec: [], nextSample: 0, prevX: null, prevZ: null,
  };

  function emit(type, data = {}) { onEvent({ type, ...data }); }

  function begin(carId) {
    Object.assign(s, {
      carId, phase: 'countdown', countdown: LAPS.countdown, clock: 0, lapNo: 1,
      nextGate: 1, splits: [], void: false, voidReason: '', rec: [], nextSample: 0, prevX: null, prevZ: null,
    });
    emit('countdown');
  }

  function stop() { s.phase = 'idle'; }

  // called after every physics step with the car's state (a Vehicle)
  function step(dt, car) {
    if (s.phase === 'countdown') {
      s.countdown -= dt;
      if (s.countdown <= 0) { s.countdown = 0; s.phase = 'running'; s.clock = 0; emit('go'); record(car); }
      return;
    }
    if (s.phase !== 'running') return;
    s.clock += dt;
    if (s.prevX !== null) checkGate(dt, car);
    s.prevX = car.x; s.prevZ = car.z;
    if (s.clock >= s.nextSample) record(car);
  }

  function record(car) {
    for (const f of FIELDS) s.rec.push(car[f]);
    s.nextSample = (s.rec.length / NF) / LAPS.ghostHz;
  }

  function checkGate(dt, car) {
    const g = gates[s.nextGate];
    const before = (s.prevX - g.x) * g.tx + (s.prevZ - g.z) * g.tz;
    const after = (car.x - g.x) * g.tx + (car.z - g.z) * g.tz;
    if (!(before < 0 && after >= 0)) return;                      // only forwards, in race direction
    const side = Math.abs((car.x - g.x) * g.tz - (car.z - g.z) * g.tx);
    if (side > g.half + LAPS.gateSlack || Math.abs(car.y - g.y) > LAPS.gateHeight) return;
    const frac = before / (before - after);                          // exactly when the line was crossed
    const t = s.clock - dt * (1 - frac);
    const best = bests[s.carId];
    if (s.nextGate !== 0) {
      const k = s.splits.length;
      s.splits.push(t);
      const ref = best && !s.void ? best.splits[k] : null;
      emit('split', { sector: k + 1, time: t, delta: ref != null ? t - ref : null, void: s.void });
      s.nextGate = (s.nextGate + 1) % gates.length;
      return;
    }
    finishLap(t);
    // the next lap starts at the moment of crossing
    s.clock -= t;
    s.lapNo++;
    s.nextGate = 1; s.splits = []; s.void = false; s.voidReason = '';
    s.rec = []; s.nextSample = 0;
    record(car);
  }

  function finishLap(time) {
    const prev = bests[s.carId];
    const valid = !s.void;
    const isBest = valid && (!prev || time < prev.time);
    s.last = { time, valid, isBest };
    if (isBest) {
      bests[s.carId] = {
        time, splits: s.splits.slice(), date: new Date().toISOString().slice(0, 10),
        hz: LAPS.ghostHz, ghost: s.rec.map((v, i) => round(v, DIGITS[i % NF])),
      };
      persist();
    }
    emit('lap', { time, valid, isBest, delta: prev && valid ? time - prev.time : null, reason: s.voidReason });
  }

  function voidLap(reason) {
    if (s.phase !== 'running' || s.void) return;
    s.void = true; s.voidReason = reason;
    emit('void', { reason });
  }

  // the car was moved (reset / respawn): do not count the jump as crossing a gate
  function teleported() { s.prevX = null; s.prevZ = null; }

  // where the ghost is at lap time t; false when there is no ghost or it has finished
  function ghostAt(t, out) {
    const b = bests[s.carId];
    if (!save.ghost || !b || !b.ghost) return false;
    const n = b.ghost.length / NF, f = Math.max(0, t) * b.hz, i = Math.floor(f);
    if (i >= n - 1) return false;
    const u = f - i, g = b.ghost, o = i * NF;
    for (let k = 0; k < NF; k++) out[FIELDS[k]] = g[o + k] + (g[o + NF + k] - g[o + k]) * u;
    return true;
  }

  function persist() {
    try { storage && storage.setItem(LAPS.saveKey, JSON.stringify(save)); } catch (e) { /* storage full or blocked: keep playing */ }
  }

  return {
    begin, stop, step, voidLap, teleported, ghostAt,
    get frozen() { return s.phase === 'countdown'; },
    get phase() { return s.phase; },
    get clock() { return s.clock; },
    view() {
      const b = bests[s.carId];
      return {
        phase: s.phase, countdown: s.countdown, clock: s.clock, lapNo: s.lapNo,
        void: s.void, splits: s.splits, sectors: gates.length,
        best: b ? b.time : null, bestSplits: b ? b.splits : null, last: s.last,
      };
    },
    bestFor: carId => (bests[carId] ? bests[carId].time : null),
    get ghostOn() { return save.ghost; },
    setGhost(on) { save.ghost = !!on; persist(); },
    clearBests() { for (const k of Object.keys(bests)) delete bests[k]; persist(); },
    debug: { state: s, bests, save },
  };
}

// ---------- saving ----------
function safeStorage() {
  try { return window.localStorage; } catch (e) { return null; }
}
function load(storage) {
  const fresh = { v: 1, ghost: true, best: {} };
  try {
    const raw = storage && storage.getItem(LAPS.saveKey);
    if (!raw) return fresh;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || typeof d.best !== 'object' || d.best === null) return fresh;
    return { v: 1, ghost: d.ghost !== false, best: d.best };
  } catch (e) { return fresh; }
}
function round(v, d) { const m = 10 ** d; return Math.round(v * m) / m; }

// 83.456 -> "1:23.456"
export function formatTime(t) {
  if (t == null || !isFinite(t)) return '–:––.–––';
  const ms = Math.max(0, Math.round(t * 1000));
  const m = Math.floor(ms / 60000), sec = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${m}:${String(sec).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
// 1.2345 -> "+1.235", -0.4 -> "−0.400"
export function formatDelta(d) {
  if (d == null) return '';
  return (d < 0 ? '−' : '+') + Math.abs(d).toFixed(3);
}
