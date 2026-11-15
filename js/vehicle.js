// Simple arcade driving physics (Earth-like gravity, no Moon physics).
// The car is a point with a heading; grip pulls sideways slip back to zero,
// so pushing too hard makes it slide wide instead of turning on rails.
const G = 9.81;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Vehicle {
  constructor(surface) {
    this.surface = surface;
    this.hit = { y: 0, nx: 0, ny: 1, nz: 0 };
    this.tmp = { y: 0, nx: 0, ny: 1, nz: 0 };
    this.reset(0, 0, 0, 0);
  }

  setCar(car) {
    this.car = car;
    const s = car.spec;
    this.vmax = s.topSpeed / 3.6;
    this.L = car.wheelbase;
    this.halfTrack = car.trackWidth / 2;
  }

  reset(x, y, z, heading) {
    this.x = x; this.y = y; this.z = z; this.heading = heading;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.vF = 0; this.vL = 0;                 // speed forwards / sideways (to the left)
    this.steer = 0; this.steerAngle = 0;
    this.grounded = true; this.airTime = 0;
    this.pitch = 0; this.roll = 0;            // attitude from the road
    this.lean = 0; this.squat = 0;            // extra body movement from cornering / accelerating
    this.nx = 0; this.ny = 1; this.nz = 0;
    this.lastGroundY = y;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }

  // input: { throttle 0..1, brake 0..1, steer -1..1 (left positive), handbrake bool }
  step(input, dt) {
    const s = this.car.spec, surf = this.surface;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);       // forward
    const lx = fz, lz = -fx;                                              // left
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * lx + this.vz * lz;
    const speed = Math.abs(vF);

    // steering: less lock at speed, so the car asks for a little more than the tyres can give
    const fullGrip = s.grip + s.aeroGrip * speed;
    const grip = fullGrip * (input.handbrake ? 0.45 : 1);
    const rate = input.steer !== 0 ? 3.4 : 6.5;
    this.steer += clamp(input.steer - this.steer, -rate * dt, rate * dt);
    const lock = Math.min(0.56, Math.atan(this.L * fullGrip * 1.12 / Math.max(25, speed * speed)));
    this.steerAngle = this.steer * lock;

    // a very short hop still counts as "wheels down", so bumps do not cut the controls
    if (this.grounded || this.airTime < 0.12) {
      if (!this.grounded) this.airTime += dt;
      const yaw = vF / this.L * Math.tan(this.steerAngle);
      this.heading += yaw * dt;
      const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading), nlx = nfz, nlz = -nfx;
      vF = this.vx * nfx + this.vz * nfz;
      vL = this.vx * nlx + this.vz * nlz;

      // engine, brakes, drag
      let a = 0;
      const k = clamp(Math.abs(vF) / this.vmax, 0, 1);
      if (input.throttle > 0) a += vF >= -0.5 ? (s.accel * (1 - k * k) + 0.7) * input.throttle : s.brake * input.throttle;
      if (input.brake > 0) {
        if (vF > 0.6) a -= s.brake * input.brake;
        else a -= vF > -14 ? 7 * input.brake : 0;                         // reverse gear, up to about 50 km/h
      }
      if (input.handbrake) a -= Math.sign(vF) * 9;
      if (!input.throttle) a -= Math.sign(vF) * (0.6 + 0.00045 * vF * vF);  // rolling + air resistance when coasting
      a -= G * Math.sin(this.pitch);                                      // hills
      const before = vF;
      vF += a * dt;
      if (!input.throttle && !input.brake && before * vF < 0) vF = 0;     // do not creep backwards when coasting to a stop
      if (vF > this.vmax) vF = this.vmax;

      // tyres pull sideways slip back to zero, as hard as the grip allows
      const pull = grip * dt;
      vL -= clamp(vL, -pull, pull);
      this.vx = nfx * vF + nlx * vL;
      this.vz = nfz * vF + nlz * vL;
      // body movement for looks
      const latG = clamp(yaw * vF / G, -4, 4);
      this.lean += (clamp(latG * 0.012, -0.05, 0.05) - this.lean) * Math.min(1, 6 * dt);
      this.squat += (clamp(-a * 0.0016, -0.03, 0.03) - this.squat) * Math.min(1, 6 * dt);
    } else {
      this.airTime += dt;
      this.lean *= 1 - Math.min(1, 3 * dt);
    }
    this.vF = vF; this.vL = vL;

    // move
    const oldY = this.y;
    this.x += this.vx * dt; this.z += this.vz * dt;

    // ground under the car
    const has = surf.query(this.x, this.z, oldY + 0.6, this.hit);
    if (this.grounded) {
      if (has) {
        // where free flight would put the car; aerodynamic downforce presses it onto the road at speed,
        // so it only takes off over sharp crests
        const press = G + 0.0045 * speed * speed;
        const free = oldY + this.vy * dt - 0.5 * press * dt * dt;
        if (this.hit.y < free - 0.004) { this.grounded = false; this.airTime = 0; this.y = free; this.vy -= G * dt; }
        else { this.vy = (this.hit.y - oldY) / dt; this.y = this.hit.y; }
      } else { this.grounded = false; this.airTime = 0; }
    }
    if (!this.grounded) {
      if (this.airTime > 0 || !has) { this.vy -= G * dt; this.y += this.vy * dt; }
      if (has && this.y <= this.hit.y && this.vy <= 0) {                  // touch down
        this.y = this.hit.y; this.vy = 0; this.grounded = true; this.airTime = 0;
      }
    }

    // attitude: follow the road under the four wheels
    if (this.grounded) {
      this.lastGroundY = this.y;
      const h = (dx, dz) => {
        const wx = this.x + lx * dx + fx * dz, wz = this.z + lz * dx + fz * dz;
        return surf.query(wx, wz, this.y + 0.6, this.tmp) ? this.tmp.y : this.y;
      };
      const fz2 = this.car.frontZ, rz2 = this.car.rearZ, ht = this.halfTrack;
      const fl = h(ht, fz2), fr = h(-ht, fz2), rl = h(ht, rz2), rr = h(-ht, rz2);
      const pitch = Math.atan2((fl + fr) / 2 - (rl + rr) / 2, this.L);
      const roll = Math.atan2((fl + rl) / 2 - (fr + rr) / 2, ht * 2);
      const e = Math.min(1, 14 * dt);
      this.pitch += (pitch - this.pitch) * e;
      this.roll += (roll - this.roll) * e;
    } else {
      this.pitch += (clamp(-this.vy * 0.012, -0.5, 0.3) - this.pitch) * Math.min(1, 1.5 * dt);
    }
  }
}
