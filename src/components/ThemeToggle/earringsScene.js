// Ported as-is from the Drama Collective site (dramacollectivewebsite_v17, src/scene/earrings.js);
// only its imports, the decoder's path and the stage-light colours (fixed to that site's tokens, so
// the earrings keep their own metal and stone look) differ.
//
// The sun and moon earrings that hang from the theme switch (docs/earrings/SPEC.md): the light
// theme's sun, the dark theme's moon. The model (assets/models/earrings.glb, made by
// tools/earrings/build-earrings.mjs) holds both, each cut into its rigid parts (the star, the
// pendant, the links, beads and charms of its strands), each part's geometry about the point it
// hangs from, with its joint, mass, colliders and swing limits in the node's extras. The ear wire
// is not in the model: each earring hangs from the button by the top loop of its star.
//
// The parts are rigid bodies joined at those points, solved by XPBD (Müller et al., "Detailed
// Rigid Body Simulation with Extended Position Based Dynamics", 2020): positions, quaternions,
// velocities, and a diagonal inertia from each part's box and mass. Each joint is a spherical joint
// with no give at all (metal and stone do not stretch), with limits on how far the part may turn
// from its parent: further in the earring's plane than out of it, as a loop through a loop jams,
// and least about the loop itself (its twist), which also turns slowly back to face the page.
// The model's pose is the pose it hangs in, not wherever its weight would tip it: from the pendant
// down, gravity pulls each part at a point chosen for that, and the star hangs from the point of
// its loop that balances what hangs below. The air slows it a little and the loops slow its
// turning. Parts that do not hang from each other cannot pass through each other (soft spheres),
// nor back through the page. The star hangs from the theme button, wherever the bar has put it. A part
// taken hold of is pulled toward the pointer, by a pull stiff enough to follow and too weak to tear
// a loop open; let go, it swings back with the speed it had. All of this is stepped at a fixed 600
// steps a second, with no allocation per step. The solver leaves each joint a small fraction of a
// pixel apart; what is drawn closes it exactly (Rig.project).
//
// The drop is a spring (src/ui/spring.js, react-spring's model): the star's loop comes down out of
// the button and lands with one small jump (the only overshoot on the site, asked for by the
// owner). It does not stay: on that jump back up, once the rebound has stopped gathering speed, it
// carries straight on up into the button at that speed (LIFT), with no settling and no wait, and is
// gone about 1.3 s after it began to come down. Taken hold of on the way, it stops where it is
// while held (and comes back out if pulled down); sent up (let go, a second switch, the bar going
// away), it goes up at once, without a jump. The chain feels only a share of that spring's speed
// (`carry`): the rest of it the whole earring is carried, so it unfolds and swings as it lands,
// and is still swinging as it goes up, instead of being flung.
//
// It is lit as the site's other pieces are: the theme's stage light (the warm spot from above in
// the dark, the house lights up in the light), a faint slate rim, a soft room for the metal and the
// stones to reflect, and the cursor's gold glow as a small lamp held in front of the part under the
// pointer (as on the masks, src/scene/masks.js, and the statue, src/scene/thinker.js). One canvas
// under the button, drawn only while an earring is moving (src/ui/earrings.js places it), with no
// more pixels behind it than a laptop's screen needs (MAX_PIXELS).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Spring } from '../../lib/spring.js';

// the Draco decoder served with the site (public/draco/), from the site's root whatever the route
const DRACO_PATH = new URL(`${import.meta.env.BASE_URL}draco/`, location.origin).href;

const DEG = Math.PI / 180;
export const STEP = 1 / 600; // s: the physics' fixed time step (10 steps a frame at 60 frames a second)
const MAX_STEPS = 40; // a frame never runs more than this many (after a stall, time is let go)
const ROW = 0.01; // model units: the height of each band of an earring's outline (about 3 px at 540 px tall)

// The physics, in the model's own units (an earring is about 1.6 high, from its star's top loop to
// its lowest charm) and seconds.
export const PHYSICS = {
  gravity: 30, // about 10,000 px/s² at 540 px high: the whole earring swings about once a second
  linearDrag: 1.6, // the air, on each part's speed and turn (per second): settled in about 2 s
  angularDrag: 2,
  jointDamping: 4, // the loops' friction on a part's turn against its parent's (per second)
  twistDamping: 12, // and more on its twist about the loop
  twistShare: 0.6, // a loop twists at most this share of the most it may turn out of the plane
  twistReturn: 12, // how strongly a twisted part turns back to face the page (per second squared)
  limitCompliance: 2e-5, // the swing limits: hard
  contactCompliance: 2e-6, // parts against parts: firm, not rigid
  backCompliance: 2e-5, // and against the page behind
  dragCompliance: 2e-5, // the pull of the pointer: stiff but not rigid
  maxPull: 0.008, // and how far it may pull a part in one step (4.8 units/s, 1,600 px/s, at most)
  passes: 4, // joint passes a step (down the chain and back up)
  back: 0.1, // how far behind the earring (at rest) the page lies
  carry: 0.08, // the share of the drop spring's speed the chain feels as its own
  massFloor: 0.03, // the lightest a part is taken to be (the pendant is 30 times a bead)
  fold: { inPlane: 16, outOfPlane: 5, twist: 7 }, // degrees: how the parts lie folded in the button
};

// The drop, the jump and the return (docs/earrings/SPEC.md §4): ζ 0.52 coming down, 1.0 going up
// when sent up (and when stopped by a hand on its way up)
export const DROP = { mass: 1, tension: 180, friction: 14, precision: 0.0005 };
export const RETURN = { mass: 1, tension: 210, friction: 29, precision: 0.0005 };
// Going on up from the landing's jump (docs/earrings/SPEC.md §0, point 4): a soft pull, with no
// friction, toward a point LIFT_TO above where it is out of sight. It takes over when the rebound
// is at its fastest (about 580 px/s at 540 px high, about 0.4 s after it began to come down),
// where the drop's spring no longer speeds it up, so there is no hitch; it is too weak to slow it,
// so the earring keeps that speed and gathers a little (about 130 px/s² at the start, half that at
// the end) until it is out of sight, about 0.9 s later.
export const LIFT = { mass: 1, tension: 0.1, friction: 0, precision: 0.0005 };
const LIFT_TO = 2; // model units
// model units: held on its way up, how far below the point held the pointer may go before the
// earring is drawn back out after it (about 10 px at 540 px high)
const SLACK = 0.03;

// ---- vector and quaternion helpers on flat arrays (no allocation in the loop) ----

const T = new Float64Array(3); // scratch: the result of rot, rotInv and invI
const U = new Float64Array(3); // scratch for a second vector

/** (vx, vy, vz) turned by the quaternion at q[o..o+3], into out. */
function rot(q, o, vx, vy, vz, out) {
  const qx = q[o], qy = q[o + 1], qz = q[o + 2], qw = q[o + 3];
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}
/** (vx, vy, vz) turned back by the quaternion at q[o..o+3], into out. */
function rotInv(q, o, vx, vy, vz, out) {
  const qx = -q[o], qy = -q[o + 1], qz = -q[o + 2], qw = q[o + 3];
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}

/**
 * One earring's physics: its parts as rigid bodies, parents before children, the star first.
 * Bodies sit at their centres of mass. `spec` is the earring's extras (its anchor and height) with
 * its parts' own extras (assets/models/earrings.json has the same).
 */
export class Rig {
  constructor(spec, physics = PHYSICS) {
    const P = (this.physics = physics);
    const parts = spec.parts;
    const n = (this.n = parts.length);
    this.names = parts.map((p) => p.part);
    const index = new Map(this.names.map((k, i) => [k, i]));
    this.parent = Int16Array.from(parts, (p) => (p.parent ? index.get(p.parent) : -1));
    for (let i = 0; i < n; i++) if (this.parent[i] >= i) throw new Error('earrings: a part comes before its parent');
    this.anchor = spec.anchor.slice(); // the point of the star's top loop it hangs from, in earring space
    this.height = spec.height;

    this.x = new Float64Array(3 * n); this.q = new Float64Array(4 * n);
    this.v = new Float64Array(3 * n); this.w = new Float64Array(3 * n);
    this.px = new Float64Array(3 * n); this.pq = new Float64Array(4 * n);
    this.m = new Float64Array(n); this.im = new Float64Array(n); this.iI = new Float64Array(3 * n);
    this.rp = new Float64Array(3 * n); // a part's own pivot, in its body frame
    this.origin = new Float64Array(3 * n); // its mesh's origin (the model's pivot), in its body frame
    this.ra = new Float64Array(3 * n); // where its parent carries it, in the parent's body frame
    this.rg = new Float64Array(3 * n); // where gravity pulls it, in its body frame
    this.rest = new Float64Array(n); // each pivot's distance from its parent's pivot at rest
    this.limIn = new Float64Array(n); this.limOut = new Float64Array(n); this.limTwist = new Float64Array(n);
    this.Iw = new Float64Array(9 * n); // the world inverse inertia, each step (inertia())
    for (let i = 0; i < n; i++) this.m[i] = Math.max(parts[i].mass, P.massFloor);
    // The star hangs from the point at the height of its loop's anchor that its own weight and the
    // weight hanging from it balance on (`pin`, a hair beside the anchor itself), so that it hangs
    // upright, as made, rather than tipped by what hangs below it. That point is pinned where the
    // anchor's rest place is plus the same offset: at rest the anchor is exactly under the button.
    let mx = this.m[0] * parts[0].com[0], mz = this.m[0] * parts[0].com[2], mt = this.m[0];
    for (let i = 1; i < n; i++) {
      if (this.parent[i] !== 0) continue;
      let mk = 0;
      for (let k = i; k < n; k++) { let a = k; while (a > i) a = this.parent[a]; if (a === i) mk += this.m[k]; }
      mx += mk * parts[i].pivot[0]; mz += mk * parts[i].pivot[2]; mt += mk;
    }
    this.pin = [mx / mt, this.anchor[1], mz / mt];
    this.pinOffset = [this.pin[0] - this.anchor[0], 0, this.pin[2] - this.anchor[2]];

    for (let i = 0; i < n; i++) {
      const p = parts[i], c = p.com, piv = this.parent[i] < 0 ? this.pin : p.pivot;
      this.im[i] = 1 / this.m[i];
      // a box's inertia, from the part's bounds (thin parts are floored, so none spins away)
      const sx = Math.max(p.bounds.max[0] - p.bounds.min[0], 0.04);
      const sy = Math.max(p.bounds.max[1] - p.bounds.min[1], 0.04);
      const sz = Math.max(p.bounds.max[2] - p.bounds.min[2], 0.04);
      const k = this.m[i] / 12;
      this.iI[3 * i] = 1 / (k * (sy * sy + sz * sz));
      this.iI[3 * i + 1] = 1 / (k * (sx * sx + sz * sz));
      this.iI[3 * i + 2] = 1 / (k * (sx * sx + sy * sy));
      for (let a = 0; a < 3; a++) this.rp[3 * i + a] = piv[a] - c[a];
      for (let a = 0; a < 3; a++) this.origin[3 * i + a] = p.pivot[a] - c[a];
      const pp = this.parent[i] >= 0 ? parts[this.parent[i]] : null;
      for (let a = 0; a < 3; a++) this.ra[3 * i + a] = pp ? piv[a] - pp.com[a] : 0;
      const from = pp ? (this.parent[this.parent[i]] < 0 ? this.pin : pp.pivot) : this.pin;
      this.rest[i] = Math.hypot(piv[0] - from[0], piv[1] - from[1], piv[2] - from[2]);
      this.limIn[i] = p.swing.inPlane * DEG;
      this.limOut[i] = p.swing.outOfPlane * DEG;
      this.limTwist[i] = p.swing.outOfPlane * DEG * P.twistShare;
    }

    // The model's pose is the pose it hangs in, though its weight alone would tip some parts (the
    // crescent hangs from a loop off its centre of mass; a bead on a head pin sticks out sideways).
    // From the pendant down, gravity pulls each part at a point of its own chosen for that: working
    // up from the strands' ends, each part's and its children's weight falls straight below the
    // part's pivot (in x and z; the height is the part's own centre of mass). It is still gravity
    // on a point of the part, so nothing is gained or lost as it swings. The star is too light to
    // hold the pendant's weight off centre that way: it hangs from its balance point instead (pin,
    // above).
    const depth = new Int8Array(n);
    for (let i = 0; i < n; i++) depth[i] = this.parent[i] < 0 ? 0 : depth[this.parent[i]] + 1;
    const below = new Float64Array(n); // the weight hanging from each pivot, the part's own included
    for (let i = n - 1; i >= 0; i--) {
      below[i] += this.m[i];
      if (this.parent[i] >= 0) below[this.parent[i]] += below[i];
    }
    for (let i = 0; i < n; i++) {
      if (depth[i] < 1) continue;
      const piv = parts[i].pivot, c = parts[i].com;
      let sx = 0, sz = 0;
      for (let j = i + 1; j < n; j++) {
        if (this.parent[j] !== i) continue;
        sx += below[j] * (parts[j].pivot[0] - piv[0]);
        sz += below[j] * (parts[j].pivot[2] - piv[2]);
      }
      this.rg[3 * i] = piv[0] - sx / this.m[i] - c[0];
      this.rg[3 * i + 2] = piv[2] - sz / this.m[i] - c[2];
    }

    // Colliders: each part's small spheres, in its body frame, and its bounding sphere for a first test.
    const spheres = [];
    this.bound = new Float64Array(4 * n);
    for (let i = 0; i < n; i++) {
      const col = parts[i].collider, c = parts[i].com;
      for (const s of col.spheres) spheres.push([i, s[0] - c[0], s[1] - c[1], s[2] - c[2], s[3]]);
      this.bound.set([col.sphere.c[0] - c[0], col.sphere.c[1] - c[1], col.sphere.c[2] - c[2], col.sphere.r], 4 * i);
    }
    this.sOwner = Int16Array.from(spheres, (s) => s[0]);
    this.sLocal = Float64Array.from(spheres.flatMap((s) => [s[1], s[2], s[3]]));
    this.sR = Float64Array.from(spheres, (s) => s[4]);
    // Every two parts that do not hang one from the other, and each pair of their small spheres.
    // Where two such parts touched in the source (strands fused side by side) their spheres overlap
    // at rest: those pairs are left out, since holding them apart would trap a strand that had
    // turned past its neighbour (it could not turn back); their other spheres still keep them apart.
    const pairs = [], mins = [], partPairs = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (this.parent[i] === j || this.parent[j] === i) continue;
        const from = pairs.length / 2;
        for (let a = 0; a < spheres.length; a++) {
          if (spheres[a][0] !== i) continue;
          for (let b = 0; b < spheres.length; b++) {
            if (spheres[b][0] !== j) continue;
            const ca = parts[i].com, cb = parts[j].com;
            const d0 = Math.hypot(spheres[b][1] + cb[0] - spheres[a][1] - ca[0], spheres[b][2] + cb[1] - spheres[a][2] - ca[1], spheres[b][3] + cb[2] - spheres[a][3] - ca[2]);
            if (d0 < spheres[a][4] + spheres[b][4]) continue;
            pairs.push(a, b);
            mins.push(spheres[a][4] + spheres[b][4]);
          }
        }
        partPairs.push(i, j, from, pairs.length / 2);
      }
    }
    this.partPairs = Int16Array.from(partPairs);
    this.pairs = Int16Array.from(pairs);
    this.pairMin = Float64Array.from(mins);
    this.boundW = new Float64Array(4 * n); // bounding spheres in the world, each step
    this.sWorld = new Float64Array(3 * spheres.length); // small spheres' offsets in the world, each step
    this.shown = new Float64Array(3 * n); // where each part is drawn (project)
    // the page lies a little behind the deepest of the spheres at rest (measured from the anchor)
    this.zBack = Math.min(...spheres.map((sp) => sp[3] + parts[sp[0]].com[2] - sp[4])) - this.anchor[2];
    // How hard it is to twist each part and everything hanging from it about its pivot's upright,
    // at rest: a loop's twist (which a joint at a point does not pass on) turns all of that back.
    this.twistI = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const piv = this.parent[i] < 0 ? this.pin : parts[i].pivot;
      for (let k = i; k < n; k++) {
        let a = k;
        while (a > i) a = this.parent[a];
        if (a !== i) continue;
        const c = parts[k].com;
        this.twistI[i] += 1 / this.iI[3 * k + 1] + this.m[k] * ((c[0] - piv[0]) ** 2 + (c[2] - piv[2]) ** 2);
      }
    }

    // the pointer's hold, if any: the part, the point held (body frame), the target (world)
    this.hold = { part: -1, r: new Float64Array(3), t: new Float64Array(3) };
    this.target = new Float64Array(3); // where the star's pin is held
    this.residual = 0; // the largest joint gap the solver left in the last frame (before projection)
    this.pose(0, 0, 0);
  }

  /**
   * Hang it at rest with the star's anchor at (ax, ay, az), each part turned from its parent by
   * `fold[i]` (a quaternion [x, y, z, w]; none: the rest pose). Still.
   */
  pose(ax, ay, az, fold = null) {
    const { n, x, q, v, w, rp, ra } = this;
    for (let i = 0; i < n; i++) {
      const p = this.parent[i];
      const f = fold?.[i] ?? [0, 0, 0, 1];
      let px, py, pz;
      if (p < 0) {
        q.set(f, 4 * i);
        rot(q, 4 * i, this.pinOffset[0], 0, this.pinOffset[2], T);
        px = ax + T[0]; py = ay + T[1]; pz = az + T[2];
      } else {
        // q_i = q_p * f
        const ax2 = q[4 * p], ay2 = q[4 * p + 1], az2 = q[4 * p + 2], aw = q[4 * p + 3];
        const [bx, by, bz, bw] = f;
        q[4 * i] = aw * bx + ax2 * bw + ay2 * bz - az2 * by;
        q[4 * i + 1] = aw * by - ax2 * bz + ay2 * bw + az2 * bx;
        q[4 * i + 2] = aw * bz + ax2 * by - ay2 * bx + az2 * bw;
        q[4 * i + 3] = aw * bw - ax2 * bx - ay2 * by - az2 * bz;
        rot(q, 4 * p, ra[3 * i], ra[3 * i + 1], ra[3 * i + 2], T);
        px = x[3 * p] + T[0]; py = x[3 * p + 1] + T[1]; pz = x[3 * p + 2] + T[2];
      }
      rot(q, 4 * i, rp[3 * i], rp[3 * i + 1], rp[3 * i + 2], T);
      x[3 * i] = px - T[0]; x[3 * i + 1] = py - T[1]; x[3 * i + 2] = pz - T[2];
    }
    v.fill(0); w.fill(0);
    this.target.set([ax + this.pinOffset[0], ay, az + this.pinOffset[2]]);
    this.hold.part = -1;
    this.project();
  }

  /** Move the whole earring (the window's scale changed). */
  translate(dx, dy, dz) {
    for (let i = 0; i < this.n; i++) { this.x[3 * i] += dx; this.x[3 * i + 1] += dy; this.x[3 * i + 2] += dz; }
    this.target[0] += dx; this.target[1] += dy; this.target[2] += dz;
    this.project();
  }

  /** The inverse inertia in the world, times (vx, vy, vz), into T. */
  invI(i, vx, vy, vz) {
    const M = this.Iw, o = 9 * i;
    T[0] = M[o] * vx + M[o + 1] * vy + M[o + 2] * vz;
    T[1] = M[o + 3] * vx + M[o + 4] * vy + M[o + 5] * vz;
    T[2] = M[o + 6] * vx + M[o + 7] * vy + M[o + 8] * vz;
  }

  /**
   * Each body's inverse inertia in the world (R diag R^T, as a 3 x 3 matrix), from its turn now:
   * worked out once a step and used by every correction in it (the turn a step makes is small).
   */
  inertia() {
    const q = this.q, M = this.Iw, iI = this.iI;
    for (let i = 0; i < this.n; i++) {
      const x = q[4 * i], y = q[4 * i + 1], z = q[4 * i + 2], w = q[4 * i + 3];
      // the rotation matrix's columns
      const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
      const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
      const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
      const a = iI[3 * i], b = iI[3 * i + 1], c = iI[3 * i + 2], o = 9 * i;
      M[o] = r00 * r00 * a + r01 * r01 * b + r02 * r02 * c;
      M[o + 1] = r00 * r10 * a + r01 * r11 * b + r02 * r12 * c;
      M[o + 2] = r00 * r20 * a + r01 * r21 * b + r02 * r22 * c;
      M[o + 3] = M[o + 1];
      M[o + 4] = r10 * r10 * a + r11 * r11 * b + r12 * r12 * c;
      M[o + 5] = r10 * r20 * a + r11 * r21 * b + r12 * r22 * c;
      M[o + 6] = M[o + 2];
      M[o + 7] = M[o + 5];
      M[o + 8] = r20 * r20 * a + r21 * r21 * b + r22 * r22 * c;
    }
  }

  /** Turn body i by the small rotation s * (wx, wy, wz) (q += s/2 [w, 0] q, normalised). */
  spin(i, wx, wy, wz, s) {
    const q = this.q, o = 4 * i, h = 0.5 * s;
    const qx = q[o], qy = q[o + 1], qz = q[o + 2], qw = q[o + 3];
    const nx = qx + h * (wx * qw + wy * qz - wz * qy);
    const ny = qy + h * (-wx * qz + wy * qw + wz * qx);
    const nz = qz + h * (wx * qy - wy * qx + wz * qw);
    const nw = qw + h * (-wx * qx - wy * qy - wz * qz);
    const l = 1 / Math.hypot(nx, ny, nz, nw);
    q[o] = nx * l; q[o + 1] = ny * l; q[o + 2] = nz * l; q[o + 3] = nw * l;
  }

  /**
   * A positional correction (XPBD): moves the point r_a of body a along +n and the point r_b of
   * body b along -n until they have closed a gap c between them (or by less, with compliance).
   * Body -1 is the world, which does not move. Returns the impulse given.
   */
  positional(a, rax, ray, raz, b, rbx, rby, rbz, nx, ny, nz, c, alphaT) {
    let w = 0;
    if (a >= 0) {
      const cx = ray * nz - raz * ny, cy = raz * nx - rax * nz, cz = rax * ny - ray * nx;
      this.invI(a, cx, cy, cz);
      w += this.im[a] + cx * T[0] + cy * T[1] + cz * T[2];
    }
    if (b >= 0) {
      const cx = rby * nz - rbz * ny, cy = rbz * nx - rbx * nz, cz = rbx * ny - rby * nx;
      this.invI(b, cx, cy, cz);
      w += this.im[b] + cx * T[0] + cy * T[1] + cz * T[2];
    }
    const lambda = c / (w + alphaT);
    const px = nx * lambda, py = ny * lambda, pz = nz * lambda;
    const x = this.x;
    if (a >= 0) {
      x[3 * a] += px * this.im[a]; x[3 * a + 1] += py * this.im[a]; x[3 * a + 2] += pz * this.im[a];
      this.invI(a, ray * pz - raz * py, raz * px - rax * pz, rax * py - ray * px);
      this.spin(a, T[0], T[1], T[2], 1);
    }
    if (b >= 0) {
      x[3 * b] -= px * this.im[b]; x[3 * b + 1] -= py * this.im[b]; x[3 * b + 2] -= pz * this.im[b];
      this.invI(b, rby * pz - rbz * py, rbz * px - rbx * pz, rbx * py - rby * px);
      this.spin(b, T[0], T[1], T[2], -1);
    }
    return lambda;
  }

  /** An angular correction (XPBD): turns b by up to theta about -n against a (a by +n). */
  angular(a, b, nx, ny, nz, theta, alphaT) {
    let w = 0;
    if (a >= 0) { this.invI(a, nx, ny, nz); w += nx * T[0] + ny * T[1] + nz * T[2]; }
    if (b >= 0) { this.invI(b, nx, ny, nz); w += nx * T[0] + ny * T[1] + nz * T[2]; }
    const lambda = theta / (w + alphaT);
    if (a >= 0) { this.invI(a, nx * lambda, ny * lambda, nz * lambda); this.spin(a, T[0], T[1], T[2], 1); }
    if (b >= 0) { this.invI(b, nx * lambda, ny * lambda, nz * lambda); this.spin(b, T[0], T[1], T[2], -1); }
  }

  /** Damps the turn of b against a about the unit axis n by the fraction k of its speed there. */
  dampTurn(a, b, nx, ny, nz, k) {
    const wv = this.w;
    const s = (wv[3 * b] - (a >= 0 ? wv[3 * a] : 0)) * nx + (wv[3 * b + 1] - (a >= 0 ? wv[3 * a + 1] : 0)) * ny + (wv[3 * b + 2] - (a >= 0 ? wv[3 * a + 2] : 0)) * nz;
    if (s === 0) return;
    let w = 0;
    if (a >= 0) { this.invI(a, nx, ny, nz); w += nx * T[0] + ny * T[1] + nz * T[2]; }
    this.invI(b, nx, ny, nz); w += nx * T[0] + ny * T[1] + nz * T[2];
    const lambda = (s * k) / w;
    this.invI(b, nx * lambda, ny * lambda, nz * lambda);
    wv[3 * b] -= T[0]; wv[3 * b + 1] -= T[1]; wv[3 * b + 2] -= T[2];
    if (a >= 0) {
      this.invI(a, nx * lambda, ny * lambda, nz * lambda);
      wv[3 * a] += T[0]; wv[3 * a + 1] += T[1]; wv[3 * a + 2] += T[2];
    }
  }

  /** Take hold of part i at the world point (wx, wy, wz). */
  grab(i, wx, wy, wz) {
    const x = this.x;
    rotInv(this.q, 4 * i, wx - x[3 * i], wy - x[3 * i + 1], wz - x[3 * i + 2], T);
    this.hold.r.set(T);
    this.hold.t.set([wx, wy, wz]);
    this.hold.part = i;
  }
  dragTo(wx, wy, wz) { this.hold.t[0] = wx; this.hold.t[1] = wy; this.hold.t[2] = wz; }
  release() { this.hold.part = -1; }

  /**
   * How far the pointer holding a part is below the point it holds (model units; 0 if it is not
   * below, or nothing is held).
   */
  below() {
    const i = this.hold.part;
    if (i < 0) return 0;
    rot(this.q, 4 * i, this.hold.r[0], this.hold.r[1], this.hold.r[2], T);
    return Math.max(0, this.x[3 * i + 1] + T[1] - this.hold.t[1]);
  }

  /**
   * One step of h seconds, the star pinned so that its anchor would be at (ax, ay, az) at rest. `carry` moves the whole
   * earring by that much in y first, without giving it any speed (the share of the drop spring's
   * motion it is carried by rather than pulled).
   */
  step(h, ax, ay, az, carry = 0) {
    const P = this.physics, { n, x, q, v, w, px, pq, rg } = this;
    const g = P.gravity;
    this.target[0] = ax + this.pinOffset[0]; this.target[1] = ay; this.target[2] = az + this.pinOffset[2];
    this.inertia();
    // the twist's slow return: each part turns back toward facing the page as its parent does
    const kr = P.twistReturn * h;
    for (let i = 0; i < n; i++) {
      const p = this.parent[i], o = 4 * i;
      let ry;
      if (p < 0) ry = q[o + 3] < 0 ? -q[o + 1] : q[o + 1];
      else {
        const a = 4 * p;
        ry = q[a + 3] * q[o + 1] + q[a] * q[o + 2] - q[a + 1] * q[o + 3] - q[a + 2] * q[o];
        if (q[a + 3] * q[o + 3] + q[a] * q[o] + q[a + 1] * q[o + 1] + q[a + 2] * q[o + 2] < 0) ry = -ry;
      }
      if (!ry) continue;
      // about the parent's upright, as strong as what hangs from the loop is heavy to twist (2 ry is
      // the angle, near enough)
      if (p >= 0) rot(q, 4 * p, 0, 1, 0, U); else { U[0] = 0; U[1] = 1; U[2] = 0; }
      const t = -2 * ry * kr * this.twistI[i];
      const ux = U[0] * t, uy = U[1] * t, uz = U[2] * t;
      this.invI(i, ux, uy, uz);
      w[3 * i] += T[0]; w[3 * i + 1] += T[1]; w[3 * i + 2] += T[2];
      if (p >= 0) { this.invI(p, -ux, -uy, -uz); w[3 * p] += T[0]; w[3 * p + 1] += T[1]; w[3 * p + 2] += T[2]; }
    }
    // carried, then moved by what it had, by gravity, and by gravity's turn about its point
    for (let i = 0; i < n; i++) {
      const k = 3 * i;
      x[k + 1] += carry;
      px[k] = x[k]; px[k + 1] = x[k + 1]; px[k + 2] = x[k + 2];
      pq[4 * i] = q[4 * i]; pq[4 * i + 1] = q[4 * i + 1]; pq[4 * i + 2] = q[4 * i + 2]; pq[4 * i + 3] = q[4 * i + 3];
      v[k + 1] -= g * h;
      if (rg[k] || rg[k + 2]) {
        rot(q, 4 * i, rg[k], 0, rg[k + 2], U);
        const mg = this.m[i] * g * h;
        this.invI(i, U[2] * mg, 0, -U[0] * mg);
        w[k] += T[0]; w[k + 1] += T[1]; w[k + 2] += T[2];
      }
      x[k] += v[k] * h; x[k + 1] += v[k + 1] * h; x[k + 2] += v[k + 2] * h;
      this.spin(i, w[k], w[k + 1], w[k + 2], h);
    }
    const h2 = h * h;
    this.inertia();

    // the pointer's pull, clamped
    const hold = this.hold;
    if (hold.part >= 0) {
      const i = hold.part;
      rot(q, 4 * i, hold.r[0], hold.r[1], hold.r[2], U);
      const dx = hold.t[0] - x[3 * i] - U[0], dy = hold.t[1] - x[3 * i + 1] - U[1], dz = hold.t[2] - x[3 * i + 2] - U[2];
      const c = Math.hypot(dx, dy, dz);
      if (c > 1e-9) this.positional(i, U[0], U[1], U[2], -1, 0, 0, 0, dx / c, dy / c, dz / c, Math.min(c, P.maxPull), P.dragCompliance / h2);
    }

    // parts against parts: first their bounding spheres, then their small ones
    const bw = this.boundW, bd = this.bound;
    for (let i = 0; i < n; i++) {
      rot(q, 4 * i, bd[4 * i], bd[4 * i + 1], bd[4 * i + 2], T);
      bw[4 * i] = x[3 * i] + T[0]; bw[4 * i + 1] = x[3 * i + 1] + T[1]; bw[4 * i + 2] = x[3 * i + 2] + T[2];
      bw[4 * i + 3] = bd[4 * i + 3];
    }
    // each small sphere's offset from its part's centre, in the world, once a step
    const pairs = this.pairs, sL = this.sLocal, sO = this.sOwner, sR = this.sR, pp = this.partPairs, sW = this.sWorld;
    for (let s = 0; s < sO.length; s++) {
      rot(q, 4 * sO[s], sL[3 * s], sL[3 * s + 1], sL[3 * s + 2], T);
      sW[3 * s] = T[0]; sW[3 * s + 1] = T[1]; sW[3 * s + 2] = T[2];
    }
    const cA = P.contactCompliance / h2;
    for (let m = 0; m < pp.length; m += 4) {
      const i = pp[m], j = pp[m + 1];
      const ddx = bw[4 * j] - bw[4 * i], ddy = bw[4 * j + 1] - bw[4 * i + 1], ddz = bw[4 * j + 2] - bw[4 * i + 2], rr = bw[4 * i + 3] + bw[4 * j + 3];
      if (ddx * ddx + ddy * ddy + ddz * ddz > rr * rr) continue;
      for (let k = 2 * pp[m + 2]; k < 2 * pp[m + 3]; k += 2) {
        const a3 = 3 * pairs[k], b3 = 3 * pairs[k + 1];
        const dx = x[3 * j] + sW[b3] - x[3 * i] - sW[a3], dy = x[3 * j + 1] + sW[b3 + 1] - x[3 * i + 1] - sW[a3 + 1], dz = x[3 * j + 2] + sW[b3 + 2] - x[3 * i + 2] - sW[a3 + 2];
        const min = this.pairMin[k >> 1];
        if (dx * dx + dy * dy + dz * dz >= min * min) continue;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-9) continue;
        const nx = dx / d, ny = dy / d, nz = dz / d, ra2 = sR[pairs[k]], rb2 = sR[pairs[k + 1]];
        // where they meet: on each sphere's surface toward the other
        this.positional(i, sW[a3] + nx * ra2, sW[a3 + 1] + ny * ra2, sW[a3 + 2] + nz * ra2, j, sW[b3] - nx * rb2, sW[b3 + 1] - ny * rb2, sW[b3 + 2] - nz * rb2, -nx, -ny, -nz, min - d, cA);
      }
    }

    // the page behind: nothing passes back through it
    const zMin = az + this.zBack - P.back, cB = P.backCompliance / h2;
    for (let s = 0; s < sO.length; s++) {
      const i = sO[s];
      if (bw[4 * i + 2] - bw[4 * i + 3] > zMin) continue; // the whole part is in front
      const depth = zMin - (x[3 * i + 2] + sW[3 * s + 2] - sR[s]);
      if (depth > 0) this.positional(i, sW[3 * s], sW[3 * s + 1], sW[3 * s + 2] - sR[s], -1, 0, 0, 0, 0, 0, 1, depth, cB);
    }

    // swing limits: each part's turn from its parent, as a rotation vector in the parent's frame
    // (x: out of the plane, y: the twist about the loop, z: in the plane), held within its limits
    const cL = P.limitCompliance / h2;
    for (let i = 0; i < n; i++) {
      const p = this.parent[i], o = 4 * i;
      const bx = q[o], by = q[o + 1], bz = q[o + 2], bwq = q[o + 3];
      let rx, ry, rz, rw;
      if (p < 0) { rx = bx; ry = by; rz = bz; rw = bwq; } else {
        const a = 4 * p, ax2 = q[a], ay2 = q[a + 1], az2 = q[a + 2], aw = q[a + 3];
        rx = aw * bx - ax2 * bwq - ay2 * bz + az2 * by;
        ry = aw * by + ax2 * bz - ay2 * bwq - az2 * bx;
        rz = aw * bz - ax2 * by + ay2 * bx - az2 * bwq;
        rw = aw * bwq + ax2 * bx + ay2 * by + az2 * bz;
      }
      if (rw < 0) { rx = -rx; ry = -ry; rz = -rz; rw = -rw; }
      const s = Math.hypot(rx, ry, rz);
      if (s < 1e-9) continue;
      const k = (2 * Math.atan2(s, rw)) / s;
      const vx = rx * k, vy = ry * k, vz = rz * k;
      const lo = this.limOut[i], li = this.limIn[i], lt = this.limTwist[i];
      const ex = vx > lo ? vx - lo : vx < -lo ? vx + lo : 0;
      const ey = vy > lt ? vy - lt : vy < -lt ? vy + lt : 0;
      const ez = vz > li ? vz - li : vz < -li ? vz + li : 0;
      if (!ex && !ey && !ez) continue;
      if (p >= 0) rot(q, 4 * p, ex, ey, ez, U); else { U[0] = ex; U[1] = ey; U[2] = ez; }
      const th = Math.hypot(U[0], U[1], U[2]);
      this.angular(p, i, U[0] / th, U[1] / th, U[2] / th, th, cL);
    }

    // the joints, with no give: down the chain from the pin and back up, ending at the pin
    for (let it = 0; it < P.passes; it++) {
      this.solveJoints(0, n, 1);
      this.solveJoints(n - 1, -1, -1);
    }

    // speeds, from where the step has taken each part
    const kl = Math.exp(-P.linearDrag * h), ka = Math.exp(-P.angularDrag * h);
    for (let i = 0; i < n; i++) {
      const k = 3 * i, o = 4 * i;
      v[k] = ((x[k] - px[k]) / h) * kl; v[k + 1] = ((x[k + 1] - px[k + 1]) / h) * kl; v[k + 2] = ((x[k + 2] - px[k + 2]) / h) * kl;
      // dq = q * conj(pq)
      const ax2 = q[o], ay2 = q[o + 1], az2 = q[o + 2], aw = q[o + 3];
      const bx = -pq[o], by = -pq[o + 1], bz = -pq[o + 2], bwq = pq[o + 3];
      const dx = aw * bx + ax2 * bwq + ay2 * bz - az2 * by;
      const dy = aw * by - ax2 * bz + ay2 * bwq + az2 * bx;
      const dz = aw * bz + ax2 * by - ay2 * bx + az2 * bwq;
      const dw = aw * bwq - ax2 * bx - ay2 * by - az2 * bz;
      const sg = dw >= 0 ? (2 / h) * ka : (-2 / h) * ka;
      w[k] = dx * sg; w[k + 1] = dy * sg; w[k + 2] = dz * sg;
    }
    // the loops' friction: on each part's turn against its parent, and more on its twist
    const kj = 1 - Math.exp(-P.jointDamping * h), kt = 1 - Math.exp(-P.twistDamping * h);
    for (let i = 0; i < n; i++) {
      const p = this.parent[i];
      const rx = w[3 * i] - (p >= 0 ? w[3 * p] : 0), ry = w[3 * i + 1] - (p >= 0 ? w[3 * p + 1] : 0), rz = w[3 * i + 2] - (p >= 0 ? w[3 * p + 2] : 0);
      const s = Math.hypot(rx, ry, rz);
      if (s > 1e-9) this.dampTurn(p, i, rx / s, ry / s, rz / s, kj);
      if (p >= 0) rot(q, 4 * p, 0, 1, 0, U); else { U[0] = 0; U[1] = 1; U[2] = 0; }
      this.dampTurn(p, i, U[0], U[1], U[2], kt);
    }
  }

  /** The spherical joints and the star's pin, in the order given (from, to, by). */
  solveJoints(from, to, by) {
    const { x, q, rp, ra, target } = this;
    for (let i = from; i !== to; i += by) {
      const p = this.parent[i];
      rot(q, 4 * i, rp[3 * i], rp[3 * i + 1], rp[3 * i + 2], U);
      const bx = x[3 * i] + U[0], by2 = x[3 * i + 1] + U[1], bz = x[3 * i + 2] + U[2];
      let axw, ayw, azw, rax = 0, ray = 0, raz = 0;
      if (p < 0) { axw = target[0]; ayw = target[1]; azw = target[2]; } else {
        rot(q, 4 * p, ra[3 * i], ra[3 * i + 1], ra[3 * i + 2], T);
        rax = T[0]; ray = T[1]; raz = T[2];
        axw = x[3 * p] + rax; ayw = x[3 * p + 1] + ray; azw = x[3 * p + 2] + raz;
      }
      const dx = bx - axw, dy = by2 - ayw, dz = bz - azw;
      const c = Math.hypot(dx, dy, dz);
      if (c < 1e-12) continue;
      this.positional(p, rax, ray, raz, i, U[0], U[1], U[2], dx / c, dy / c, dz / c, c, 0);
    }
  }

  /**
   * After a frame's steps, where each part is drawn (`shown`, its centre): the gap each joint was
   * left with by the solver (`residual`, a small fraction of a pixel) is closed exactly, down the
   * chain from the pin, by moving each part onto its parent's loop. Only the drawing moves: moving
   * the bodies themselves would lift the parts each frame for gravity to drop again, which feeds
   * the swing. What is drawn never shows a loop apart.
   */
  project() {
    const { n, x, q, rp, ra, target, shown } = this;
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const p = this.parent[i];
      rot(q, 4 * i, rp[3 * i], rp[3 * i + 1], rp[3 * i + 2], U);
      let axw, ayw, azw, gx = 0, gy = 0, gz = 0;
      if (p < 0) { axw = target[0]; ayw = target[1]; azw = target[2]; } else {
        rot(q, 4 * p, ra[3 * i], ra[3 * i + 1], ra[3 * i + 2], T);
        axw = x[3 * p] + T[0]; ayw = x[3 * p + 1] + T[1]; azw = x[3 * p + 2] + T[2];
        gx = shown[3 * p] - x[3 * p]; gy = shown[3 * p + 1] - x[3 * p + 1]; gz = shown[3 * p + 2] - x[3 * p + 2];
      }
      const dx = axw - x[3 * i] - U[0], dy = ayw - x[3 * i + 1] - U[1], dz = azw - x[3 * i + 2] - U[2];
      worst = Math.max(worst, Math.hypot(dx, dy, dz));
      shown[3 * i] = x[3 * i] + dx + gx; shown[3 * i + 1] = x[3 * i + 1] + dy + gy; shown[3 * i + 2] = x[3 * i + 2] + dz + gz;
    }
    this.residual = worst;
  }

  /** Each part's pivot in the world, into out (3 per part), as solved or (`drawn`) as drawn. */
  pivots(out = new Float64Array(3 * this.n), drawn = false) {
    const c = drawn ? this.shown : this.x;
    for (let i = 0; i < this.n; i++) {
      rot(this.q, 4 * i, this.rp[3 * i], this.rp[3 * i + 1], this.rp[3 * i + 2], T);
      out[3 * i] = c[3 * i] + T[0]; out[3 * i + 1] = c[3 * i + 1] + T[1]; out[3 * i + 2] = c[3 * i + 2] + T[2];
    }
    return out;
  }

  /**
   * How well the joints hold (for testing), as drawn and as the solver left them: for each part,
   * the gap between its pivot and where its parent carries it, and its pivot's distance from its
   * parent's pivot against the distance at rest (stretch, a fraction).
   */
  measure() {
    const one = (drawn) => {
      const c = drawn ? this.shown : this.x;
      const piv = this.pivots(undefined, drawn);
      const parts = [];
      let gap = 0, stretch = 0;
      for (let i = 0; i < this.n; i++) {
        const p = this.parent[i];
        let cx, cy, cz;
        if (p < 0) { cx = this.target[0]; cy = this.target[1]; cz = this.target[2]; } else {
          rot(this.q, 4 * p, this.ra[3 * i], this.ra[3 * i + 1], this.ra[3 * i + 2], T);
          cx = c[3 * p] + T[0]; cy = c[3 * p + 1] + T[1]; cz = c[3 * p + 2] + T[2];
        }
        const e = Math.hypot(piv[3 * i] - cx, piv[3 * i + 1] - cy, piv[3 * i + 2] - cz);
        const from = p < 0 ? this.target : piv.subarray(3 * p, 3 * p + 3);
        const d = Math.hypot(piv[3 * i] - from[0], piv[3 * i + 1] - from[1], piv[3 * i + 2] - from[2]);
        const rel = p < 0 ? 0 : Math.abs(d - this.rest[i]) / this.rest[i];
        gap = Math.max(gap, e);
        stretch = Math.max(stretch, rel);
        parts.push({ part: this.names[i], gap: e, distance: d, rest: this.rest[i], stretch: rel });
      }
      return { gap, stretch, parts };
    };
    const drawn = one(true), solved = one(false);
    return { gap: drawn.gap, stretch: drawn.stretch, parts: drawn.parts, solver: { gap: solved.gap, stretch: solved.stretch, parts: solved.parts } };
  }

  /** How far each part has turned from its parent (degrees: in the plane, out of it, twist). */
  angles() {
    const out = [];
    const q = this.q;
    for (let i = 0; i < this.n; i++) {
      const p = this.parent[i], o = 4 * i;
      const bx = q[o], by = q[o + 1], bz = q[o + 2], bw = q[o + 3];
      let rx = bx, ry = by, rz = bz, rw = bw;
      if (p >= 0) {
        const a = 4 * p, ax = q[a], ay = q[a + 1], az = q[a + 2], aw = q[a + 3];
        rx = aw * bx - ax * bw - ay * bz + az * by;
        ry = aw * by + ax * bz - ay * bw - az * bx;
        rz = aw * bz - ax * by + ay * bx - az * bw;
        rw = aw * bw + ax * bx + ay * by + az * bz;
      }
      if (rw < 0) { rx = -rx; ry = -ry; rz = -rz; rw = -rw; }
      const s = Math.hypot(rx, ry, rz), k = s < 1e-9 ? 2 : (2 * Math.atan2(s, rw)) / s;
      out.push([rz * k / DEG, rx * k / DEG, ry * k / DEG]);
    }
    return out;
  }
}

// ---- the scene ----

// The stage in each theme: the key from above (the warm spot in the dark, the house light in the
// light), the slate rim behind, the soft fill from all round, the room the metal reflects, the
// exposure, and the cursor's lamp at its brightest.
const STAGE = {
  dark: { key: 2.6, rim: 1.1, hemi: 0.25, env: 0.55, exposure: 1.05, glow: 0.5 },
  light: { key: 2.2, rim: 0.45, hemi: 0.9, env: 0.95, exposure: 0.95, glow: 0.32 },
};
// The finish laid over the model's own maps: all of it a touch glossier, the metal more so, and a
// thin clear coat over everything so the stones read as polished stone (onyx, pearl, shell).
const FINISH = { roughness: 0.9, metalGloss: 0.72, clearcoat: 0.4, clearcoatRoughness: 0.2, normal: 1 };
// The cursor's lamp: how far in front of the earring it is held, how far its light reaches (model
// units), and how quickly it eases after the pointer.
const GLOW = { ahead: 0.2, reach: 0.75, ease: 12 };
const FOV = 20;
// The most pixels the canvas is drawn with (its CSS size times the pixel ratio squared): enough for
// the canvas of an earring 540 px high on a laptop's 2x screen. A taller earring on a sharper
// screen is drawn a little softer rather than with more pixels (and GPU memory) than that.
const MAX_PIXELS = 2.4e6;

// the Drama Collective's own palette, which the earrings' stage light is made of (its tokens.css)
const PALETTE = {
  '--gold-100': '#faf4de', '--gold-300': '#f3e7b8', '--gold-600': '#cbae57',
  '--plum-100': '#f3e7e9', '--plum-800': '#40142a', '--slate-300': '#a7b0b0',
};
const tokenColor = (name, fallback = '#ebd88c') => new THREE.Color(PALETTE[name] || fallback);

export class Earrings {
  /**
   * Make both earrings from the model: its bytes, if the page has fetched them ahead, or its URL.
   * @param {ArrayBuffer|string} source   assets/models/earrings.glb
   * @param {object} [o]   see the constructor
   */
  static async create(source, o) {
    const draco = new DRACOLoader().setDecoderPath(DRACO_PATH).setDecoderConfig({ type: 'wasm' });
    try {
      const loader = new GLTFLoader().setDRACOLoader(draco);
      const gltf = typeof source === 'string' ? await loader.loadAsync(source) : await loader.parseAsync(source, '');
      return new Earrings(gltf, o);
    } finally {
      draco.dispose();
    }
  }

  /**
   * @param {object} gltf
   * @param {object} [o]
   * @param {boolean} [o.reduced]   no drop and no swing: an earring hangs still
   */
  constructor(gltf, { reduced = false } = {}) {
    this.reduced = reduced;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(dpr);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setClearColor(0x000000, 0);
    this.canvas = r.domElement;
    this.canvas.className = 'earring-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    // the room the metal and the stones reflect (three's RoomEnvironment), pre-filtered once, and
    // again if the browser drops the WebGL context and gives it back (three restores the model's
    // textures itself, but not what was drawn into a render target: without the room the metal
    // would come back black). While the context is lost the canvas is out of sight.
    this._makeEnv();
    this.lost = false;
    this._onLost = () => { this.lost = true; this.canvas.style.opacity = '0'; };
    this._onRestored = () => {
      this.lost = false;
      this._makeEnv();
      this.canvas.style.opacity = '';
      this.dirty = true;
    };
    this.canvas.addEventListener('webglcontextlost', this._onLost);
    this.canvas.addEventListener('webglcontextrestored', this._onRestored);

    // the lights: the key from above and a little in front, the rim from behind, a soft fill, and
    // the cursor's lamp (off until a pointer is near)
    this.key = new THREE.DirectionalLight(0xffffff, 0);
    this.key.position.set(-0.35, 1, 0.75);
    this.rim = new THREE.DirectionalLight(tokenColor('--slate-300', '#9aa4b1'), 0);
    this.rim.position.set(0.6, 0.35, -1);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
    this.glow = new THREE.PointLight(0xffffff, 0, GLOW.reach, 2);
    this.scene.add(this.key, this.key.target, this.rim, this.rim.target, this.hemi, this.glow);

    this.metalGloss = { value: FINISH.metalGloss };
    this.earrings = {};
    for (const name of ['moon', 'sun']) {
      const group = gltf.scene.getObjectByName(name);
      if (!group?.userData?.parts) throw new Error(`earrings: no ${name}`);
      // the earring's extras name its parts, parents first; each part's own extras hold its joint
      const found = group.userData.parts.map((part) => {
        let mesh = null;
        group.traverse((o) => { if (!mesh && o.isMesh && o.userData.part === part) mesh = o; });
        if (!mesh) throw new Error(`earrings: no ${part}`);
        return mesh;
      });
      const spec = { ...group.userData, parts: found.map((m) => m.userData) };
      const rig = new Rig(spec);
      const holder = new THREE.Group();
      holder.visible = false;
      let material = null;
      const meshes = found.map((mesh) => {
        const part = mesh.userData.part;
        material ??= this._jewellery(mesh.material);
        const m = new THREE.Mesh(mesh.geometry, material);
        m.userData.part = part;
        m.matrixAutoUpdate = false;
        holder.add(m);
        return m;
      });
      this.scene.add(holder);
      const b = spec.bounds;
      this.earrings[name] = {
        name, rig, holder, meshes, material,
        pivots: spec.parts.map((p) => p.pivot), // where each part's mesh hangs from, as made (its origin)
        // how far below its top it reaches (from the star's top loop to the lowest charm), how
        // far its anchor is below that top, and how wide it is
        drop: spec.top - b.min[1], lift: spec.top - spec.anchor[1], width: b.max[0] - b.min[0],
        spring: new Spring({ config: RETURN }),
        // in; out (coming down and landing, or held); lifting (going on up from its landing, on its
        // own: it can still be taken hold of); rising (sent up); still (reduced motion)
        state: 'in',
        landed: false, // out, and come down through its rest at least once since it was brought down
        offset: 0,
        clock: 0, // s of physics since it was last brought down (for testing: ?debug)
      };
    }
    gltf.scene.traverse((o) => { if (o.isMesh && !this._owns(o.geometry)) o.geometry.dispose(); });
    // the two are drawn at one scale: the height between theirs (the sun's is 5% the taller)
    this.height = (this.earrings.moon.drop + this.earrings.sun.drop) / 2;
    // each earring's outline hanging at rest (for fitting it beside the page's heading, clears, and
    // for the slot under the button it comes down through, neck)
    for (const e of Object.values(this.earrings)) e.outline = this._outline(e);

    this.ppu = 540 / this.height; // CSS px per model unit
    this.box = { left: 0, top: 0, w: 0, h: 0 };
    this.anchorPx = { x: 0, y: 0 };
    this.anchor = new THREE.Vector3(); // where the top of each star's loop hangs at rest under the button, in the world
    this.acc = 0;
    this.dirty = true;
    this.anchorMoved = false;
    this.pointer = { x: 0, y: 0, on: 0, to: 0, seen: false };
    this.glowAt = new THREE.Vector3();
    this.glowTo = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.held = null; // { earring, part }
    this.v3 = new THREE.Vector3();
    this.cost = 0; // ms the last frame's physics took
    this.steps = 0; // and how many steps it ran
    this.setTheme('dark');
  }

  /**
   * An earring's outline hanging at rest, as it was made: for each band ROW high, from the top of
   * the star's loop down, the leftmost and rightmost of its vertices in that band, across from the
   * loop's top (model units; an empty band is [Infinity, -Infinity]).
   */
  _outline(e) {
    const rows = Math.ceil(e.drop / ROW) + 1;
    const out = new Float64Array(2 * rows);
    for (let k = 0; k < rows; k++) { out[2 * k] = Infinity; out[2 * k + 1] = -Infinity; }
    const ax = e.rig.anchor[0], top = e.rig.anchor[1] + e.lift;
    e.meshes.forEach((m, i) => {
      const pos = m.geometry.getAttribute('position'), piv = e.pivots[i];
      for (let v = 0; v < pos.count; v++) {
        const x = piv[0] + pos.getX(v) - ax, k = Math.floor((top - piv[1] - pos.getY(v)) / ROW);
        if (k < 0 || k >= rows) continue;
        if (x < out[2 * k]) out[2 * k] = x;
        if (x > out[2 * k + 1]) out[2 * k + 1] = x;
      }
    });
    return out;
  }

  /** The room the metal reflects, pre-filtered (small: 0.04 blur). */
  _makeEnv() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTarget?.dispose();
    this.envTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.envTarget.texture;
    room.dispose();
    pmrem.dispose();
  }

  _owns(geometry) {
    return Object.values(this.earrings).some((e) => e.meshes.some((m) => m.geometry === geometry));
  }

  /** The finish: the model's maps on a physical material, a clear coat, the metal glossier. */
  _jewellery(src) {
    const m = new THREE.MeshPhysicalMaterial({
      map: src.map,
      normalMap: src.normalMap,
      roughnessMap: src.roughnessMap,
      metalnessMap: src.metalnessMap,
      roughness: FINISH.roughness,
      metalness: 1,
      clearcoat: FINISH.clearcoat,
      clearcoatRoughness: FINISH.clearcoatRoughness,
    });
    if (src.normalScale) m.normalScale.copy(src.normalScale).multiplyScalar(FINISH.normal);
    // where the map says metal, its roughness is brought down a little further
    m.onBeforeCompile = (s) => {
      s.uniforms.uMetalGloss = this.metalGloss;
      s.fragmentShader = `uniform float uMetalGloss;\n${s.fragmentShader}`.replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\n\troughnessFactor *= mix(1.0, uMetalGloss, metalnessFactor);',
      );
    };
    src.dispose();
    return m;
  }

  /** Compile the shaders and upload the textures ahead of the first drop (off the main thread where the browser can). */
  async warm() {
    for (const e of Object.values(this.earrings)) {
      for (const k of ['map', 'normalMap', 'roughnessMap']) if (e.material[k]) this.renderer.initTexture(e.material[k]);
      e.holder.visible = true;
    }
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* compiled on first draw instead */ }
    for (const e of Object.values(this.earrings)) e.holder.visible = e.state !== 'in';
  }

  setTheme(theme) {
    this.theme = theme === 'light' ? 'light' : 'dark';
    const s = STAGE[this.theme];
    const white = new THREE.Color(1, 1, 1);
    // the dark theme's key is the warm stage spot (gold-300 carried toward white); the light
    // theme's is the house light, whiter
    this.key.color.copy(tokenColor('--gold-300').lerp(white, this.theme === 'dark' ? 0.45 : 0.8));
    this.key.intensity = s.key;
    this.rim.intensity = s.rim;
    this.hemi.color.copy(tokenColor('--gold-100', '#faf3dc').lerp(white, 0.6));
    this.hemi.groundColor.copy(tokenColor(this.theme === 'light' ? '--plum-100' : '--plum-800', '#3a1428'));
    this.hemi.intensity = s.hemi;
    this.scene.environmentIntensity = s.env;
    this.glow.color.copy(tokenColor(this.theme === 'light' ? '--gold-600' : '--gold-300'));
    this.renderer.toneMappingExposure = s.exposure;
    this.dirty = true;
  }

  /** How tall an earring is drawn (CSS px). */
  setScale(px) {
    const ppu = px / this.height;
    if (Math.abs(ppu - this.ppu) < 1e-6) return;
    const k = this.ppu / ppu;
    // the world is the window in model units: at the new scale the same place on the screen is
    // somewhere else, so each earring is carried there
    for (const e of Object.values(this.earrings)) {
      const t = e.rig.target, top = t[1] - e.offset + e.lift;
      e.rig.translate(t[0] * k - t[0], top * k - top, 0);
    }
    this.ppu = ppu;
    this.dirty = true;
  }

  /** The canvas's box on the screen (CSS px): its top is where the earring comes out of the button. */
  setBox(left, top, w, h) {
    const b = this.box;
    if (w !== b.w || h !== b.h) {
      // the screen's pixel ratio (at most 2), unless that would put more than MAX_PIXELS behind it
      const ratio = Math.min(this.dpr, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
      if (Math.abs(ratio - this.renderer.getPixelRatio()) > 1e-3) this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    }
    if (left !== b.left || top !== b.top || w !== b.w || h !== b.h) {
      this.canvas.style.transform = `translate(${left}px, ${top}px)`;
      this.dirty = true;
    }
    Object.assign(b, { left, top, w, h });
    // the camera looks straight at the box, so the plane z = 0 is drawn at exactly the page's scale
    const ppu = this.ppu, half = Math.tan((FOV / 2) * DEG);
    const dist = h / 2 / ppu / half;
    this.camera.position.set((left + w / 2) / ppu, -(top + h / 2) / ppu, dist);
    this.camera.near = dist * 0.5;
    this.camera.far = dist * 1.5;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Where the top of each star's loop hangs at rest (just under the button's glyph, CSS px). */
  setAnchor(x, y) {
    this.anchorPx.x = x; this.anchorPx.y = y;
    const ax = x / this.ppu, ay = -y / this.ppu;
    if (Math.abs(ax - this.anchor.x) > 1e-7 || Math.abs(ay - this.anchor.y) > 1e-7) this.anchorMoved = true;
    this.anchor.set(ax, ay, this.earrings.moon.rig.anchor[2]);
  }

  /** The world's y at which an earring's anchor hangs at rest: its loop's top at this.anchor, the anchor `lift` below. */
  _ay(e) {
    return this.anchor.y - e.lift;
  }

  /** The offset (model units, up: the world is y up) at which an earring is wholly above the box's top, out of sight. */
  _hidden(e) {
    return e.drop + Math.max(0, this.anchorPx.y - this.box.top) / this.ppu + 0.04;
  }

  /** Bring an earring down out of the button (or back down, if it was on its way up). */
  drop(name) {
    const e = this.earrings[name];
    if (!e) return;
    if (e.state === 'in' || e.state === 'still') {
      const hidden = this._hidden(e);
      e.offset = hidden;
      e.spring.jump(hidden);
      e.rig.pose(this.anchor.x, this._ay(e) + hidden, this.anchor.z, this.reduced ? null : this._fold(e.rig));
    }
    e.spring.to(0, DROP);
    e.clock = 0;
    e.state = 'out';
    e.landed = false;
    e.holder.visible = true;
    this.dirty = true;
  }

  /** An earring goes on up from its landing's jump, on its own (LIFT), at the speed it has. */
  _lift(e) {
    e.spring.to(this._hidden(e) + LIFT_TO, LIFT);
    e.state = 'lifting';
  }

  /**
   * Held on its way up, an earring stays where it was taken hold of; pulled down further than its
   * strands reach, it comes back out after the pointer, as far as its rest under the button (and is
   * then out, hanging there, until it is let go).
   */
  _pullOut(e) {
    const s = e.spring, excess = e.rig.below() - SLACK;
    if (excess > 0) s.to(Math.max(0, Math.min(s.target, e.offset - excess)), RETURN);
    if (s.target === 0 && e.offset < 0.003) { e.state = 'out'; e.landed = true; }
  }

  /** Send an earring back up into the button, from where it is and with the speed it has. */
  retract(name) {
    const e = this.earrings[name];
    if (!e || e.state === 'in') return;
    if (this.held?.earring === e) this.release();
    if (e.state === 'still') { this.hide(name); return; }
    e.spring.to(this._hidden(e) + 0.3, RETURN);
    e.state = 'rising';
  }

  /** Reduced motion: hang an earring still under the button (shown and hidden by the page). */
  still(name) {
    for (const k of Object.keys(this.earrings)) if (k !== name) this.hide(k);
    const e = this.earrings[name];
    e.offset = 0;
    e.spring.jump(0);
    e.rig.pose(this.anchor.x, this._ay(e), this.anchor.z);
    this._sync(e);
    e.state = 'still';
    e.holder.visible = true;
    this.dirty = true;
  }

  hide(name) {
    const e = this.earrings[name];
    e.state = 'in';
    e.holder.visible = false;
    e.rig.release();
    e.rig.project();
    this.dirty = true;
  }

  /** A pose folded up as in the button: each part turned a little from its parent, this way or that. */
  _fold(rig) {
    const f = PHYSICS.fold, out = [];
    const sign = Math.random() < 0.5 ? 1 : -1;
    const qt = new THREE.Quaternion(), e = new THREE.Euler();
    const depth = new Int8Array(rig.n);
    for (let i = 0; i < rig.n; i++) {
      depth[i] = rig.parent[i] < 0 ? 0 : depth[rig.parent[i]] + 1;
      if (rig.parent[i] < 0) { out.push([0, 0, 0, 1]); continue; }
      const s = sign * (depth[i] % 2 ? 1 : -1) * (0.6 + 0.4 * Math.random());
      e.set(f.outOfPlane * DEG * (Math.random() * 2 - 1), f.twist * DEG * (Math.random() * 2 - 1), f.inPlane * DEG * s);
      qt.setFromEuler(e);
      out.push([qt.x, qt.y, qt.z, qt.w]);
    }
    return out;
  }

  /**
   * Whether both earrings, hanging at rest `px` tall with the top of the star's loop at (cx, top)
   * (CSS px), keep at least `gap` px from every one of `rects` (DOMRects on the screen).
   */
  clears(px, cx, top, rects, gap = 0) {
    const k = px / this.height, h = ROW * k;
    for (const e of Object.values(this.earrings)) {
      const o = e.outline;
      for (let b = 0; b < o.length; b += 2) {
        if (o[b] > o[b + 1]) continue;
        const y0 = top + (b / 2) * h - gap, y1 = y0 + h + 2 * gap, x0 = cx + o[b] * k - gap, x1 = cx + o[b + 1] * k + gap;
        for (const q of rects) if (y1 > q.top && y0 < q.bottom && x1 > q.left && x0 < q.right) return false;
      }
    }
    return true;
  }

  /**
   * For each earring coming down out of the button (and not yet down through its rest) or going
   * back up into it, how far above its rest it is (CSS px), into `out`: the page then hides what of
   * it is above the bar's edge, but for a slot.
   */
  lifts(out = []) {
    out.length = 0;
    for (const e of Object.values(this.earrings)) {
      if (e.state === 'rising' || e.state === 'lifting' || (e.state === 'out' && !e.landed)) out.push(e.offset * this.ppu);
    }
    return out;
  }

  /**
   * How far either earring, hanging at rest, reaches to either side of the top of its star's loop
   * in its top `depth` (both in drawn heights): the half-width of the slot it comes down through.
   */
  neck(depth) {
    let half = 0;
    for (const e of Object.values(this.earrings)) {
      const o = e.outline, rows = Math.min(o.length / 2, Math.ceil((depth * this.height) / ROW));
      for (let k = 0; k < rows; k++) if (o[2 * k] <= o[2 * k + 1]) half = Math.max(half, -o[2 * k], o[2 * k + 1]);
    }
    return half / this.height;
  }

  /** Whether an earring is out (coming down, hanging, going up, or still). */
  get active() {
    return Object.values(this.earrings).some((e) => e.state !== 'in');
  }

  state(name) { return this.earrings[name]?.state; }

  /**
   * Advance the physics by dt seconds (in fixed steps), then place the parts. Returns whether any
   * earring is still out. An earring is never at rest while it is out: it comes down, lands, and on
   * its landing's jump goes on up (unless it is held, and then it is held); one on its way up is put
   * away once it is out of sight.
   */
  step(dt) {
    const t0 = performance.now();
    this.steps = 0;
    const moved = this.anchorMoved;
    this.anchorMoved = false;
    // an earring hanging still (reduced motion) is carried with the button
    for (const e of Object.values(this.earrings)) {
      if (e.state !== 'still' || !moved) continue;
      e.rig.pose(this.anchor.x, this._ay(e), this.anchor.z);
      this._sync(e);
      this.dirty = true;
    }
    const moving = [];
    for (const e of Object.values(this.earrings)) if (e.state === 'out' || e.state === 'lifting' || e.state === 'rising') moving.push(e);
    if (moving.length && !this.reduced) {
      this.acc = Math.min(this.acc + Math.min(dt, 0.1), MAX_STEPS * STEP);
      const carry = 1 - PHYSICS.carry;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.steps++;
        for (const e of moving) {
          if (e.state === 'in') continue;
          const before = e.spring.value, speed = e.spring.velocity;
          e.spring.step(STEP);
          e.clock += STEP;
          e.offset = e.spring.value;
          e.rig.step(STEP, this.anchor.x, this._ay(e) + e.offset, this.anchor.z, (e.offset - before) * carry);
          const held = this.held?.earring === e;
          if (e.state === 'out' && !e.landed && e.offset <= 0 && e.spring.velocity < 0) e.landed = true;
          // landed, it jumps back up, and once that jump has stopped gathering speed it goes on up
          if (e.state === 'out' && e.landed && !held && e.spring.velocity > 0 && e.spring.velocity <= speed) this._lift(e);
          else if (e.state === 'lifting' && held) this._pullOut(e);
          if ((e.state === 'lifting' || e.state === 'rising') && e.offset >= this._hidden(e)) this.hide(e.name);
        }
      }
      for (const e of moving) {
        if (e.state === 'in') continue;
        e.rig.project();
        this._sync(e);
      }
      this.dirty = true;
    } else {
      this.acc = 0;
    }
    this.cost = performance.now() - t0;
    this._glow(dt);
    return this.active;
  }

  /** The parts' meshes where their bodies are. */
  _sync(e) {
    const rig = e.rig;
    for (let i = 0; i < rig.n; i++) {
      const m = e.meshes[i];
      rot(rig.q, 4 * i, rig.origin[3 * i], rig.origin[3 * i + 1], rig.origin[3 * i + 2], T);
      m.position.set(rig.shown[3 * i] + T[0], rig.shown[3 * i + 1] + T[1], rig.shown[3 * i + 2] + T[2]);
      m.quaternion.set(rig.q[4 * i], rig.q[4 * i + 1], rig.q[4 * i + 2], rig.q[4 * i + 3]);
      m.updateMatrix();
      m.matrixWorld.copy(m.matrix);
    }
  }

  render() {
    if (!this.dirty || this.lost) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  }

  /** An empty canvas (nothing is out). */
  clear() {
    if (!this.lost) this.renderer.clear();
    this.dirty = true;
  }

  /** The ray from the camera through a point on the screen (CSS px). */
  _rayAt(cx, cy) {
    const b = this.box;
    this.ndc.set(((cx - b.left) / b.w) * 2 - 1, -((cy - b.top) / b.h) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray;
  }

  /** The part of the named earring under a point on the screen, if any: { earring, part, point }. */
  pick(cx, cy, name) {
    const e = this.earrings[name];
    if (!e || (e.state !== 'out' && e.state !== 'lifting')) return null;
    this._rayAt(cx, cy);
    const hit = this.ray.intersectObjects(e.meshes, false)[0];
    if (!hit) return null;
    return { earring: e, part: e.meshes.indexOf(hit.object), point: hit.point.clone() };
  }

  /**
   * Take hold of a part where the pointer met it. On its way up, the earring stops there (with the
   * give of the return's spring, about 15 px); on its way down, it comes on down to its rest under
   * the button, and from now on is drawn whole.
   */
  grab(hit) {
    const e = hit.earring;
    this.held = { earring: e, part: hit.part, z: hit.point.z };
    if (e.state === 'lifting') e.spring.to(e.offset, RETURN);
    else e.landed = true;
    e.rig.grab(hit.part, hit.point.x, hit.point.y, hit.point.z);
  }

  /** The pointer has moved (CSS px): the held point is pulled toward it, on the plane through it parallel to the screen. */
  dragTo(cx, cy) {
    if (!this.held) return;
    const ray = this._rayAt(cx, cy);
    const t = (this.held.z - ray.origin.z) / ray.direction.z;
    const p = this.v3.copy(ray.direction).multiplyScalar(t).add(ray.origin);
    this.held.earring.rig.dragTo(p.x, p.y, p.z);
  }

  release() {
    this.held?.earring.rig.release();
    this.held = null;
  }

  /**
   * The named earring's extent on the screen (CSS px), from its parts' colliders: { left, top,
   * right, bottom }, or null if it is not out.
   */
  rect(name) {
    const e = this.earrings[name];
    if (!e || e.state === 'in') return null;
    const rig = e.rig, cam = this.camera, ppu = this.ppu, b = this.box;
    const cx = b.left + b.w / 2, cy = b.top + b.h / 2;
    let l = Infinity, t = Infinity, r = -Infinity, bt = -Infinity;
    for (let s = 0; s < rig.sOwner.length; s++) {
      const i = rig.sOwner[s];
      rot(rig.q, 4 * i, rig.sLocal[3 * s], rig.sLocal[3 * s + 1], rig.sLocal[3 * s + 2], T);
      const wx = rig.x[3 * i] + T[0], wy = rig.x[3 * i + 1] + T[1], wz = rig.x[3 * i + 2] + T[2];
      const k = cam.position.z / (cam.position.z - wz); // nearer the camera, drawn larger
      const sx = cx + (wx - cam.position.x) * ppu * k, sy = cy - (wy - cam.position.y) * ppu * k, sr = rig.sR[s] * ppu * k;
      l = Math.min(l, sx - sr); r = Math.max(r, sx + sr); t = Math.min(t, sy - sr); bt = Math.max(bt, sy + sr);
    }
    return { left: l, top: t, right: r, bottom: bt };
  }

  /**
   * The named earring's outline on the screen, as an SVG path of circles (its parts' colliders,
   * each grown by `grow` px) about the point (ox, oy) (CSS px): the clip-path of the zone that
   * takes the pointer, so that the pointer is taken over the earring and the page has it elsewhere.
   */
  hitPath(name, ox, oy, grow = 0) {
    const e = this.earrings[name];
    if (!e || e.state === 'in') return '';
    const rig = e.rig, cam = this.camera, ppu = this.ppu, b = this.box;
    const cx = b.left + b.w / 2, cy = b.top + b.h / 2;
    let d = '';
    for (let s = 0; s < rig.sOwner.length; s++) {
      const i = rig.sOwner[s];
      rot(rig.q, 4 * i, rig.sLocal[3 * s], rig.sLocal[3 * s + 1], rig.sLocal[3 * s + 2], T);
      const wx = rig.x[3 * i] + T[0], wy = rig.x[3 * i + 1] + T[1], wz = rig.x[3 * i + 2] + T[2];
      const k = cam.position.z / (cam.position.z - wz);
      const sx = cx + (wx - cam.position.x) * ppu * k - ox, sy = cy - (wy - cam.position.y) * ppu * k - oy;
      const r = rig.sR[s] * ppu * k + grow, rs = r.toFixed(1), dd = (2 * r).toFixed(1);
      d += `M${(sx - r).toFixed(1)} ${sy.toFixed(1)}a${rs} ${rs} 0 1 0 ${dd} 0a${rs} ${rs} 0 1 0 -${dd} 0Z`;
    }
    return d;
  }

  /** The pointer (CSS px), and whether it is there at all: the cursor's lamp follows it. */
  setPointer(cx, cy, on = true) {
    const p = this.pointer;
    p.x = cx; p.y = cy; p.to = on ? 1 : 0;
    if (!on) return;
    // the lamp: on the line from the camera through the pointer, just in front of the earring
    const ray = this._rayAt(cx, cy);
    const z = this.earrings.moon.rig.anchor[2] + 0.1 + GLOW.ahead;
    const t = (z - ray.origin.z) / ray.direction.z;
    this.glowTo.copy(ray.direction).multiplyScalar(t).add(ray.origin);
    if (!p.seen) { this.glowAt.copy(this.glowTo); p.seen = true; }
  }

  _glow(dt) {
    const p = this.pointer;
    const was = p.on, before = this.v3.copy(this.glowAt);
    const k = this.reduced ? 1 : 1 - Math.exp(-GLOW.ease * dt);
    this.glowAt.lerp(this.glowTo, k);
    p.on += (p.to - p.on) * (this.reduced ? 1 : 1 - Math.exp(-6 * dt));
    if (Math.abs(p.on - p.to) < 0.002) p.on = p.to;
    this.glow.position.copy(this.glowAt);
    this.glow.intensity = p.on * STAGE[this.theme].glow;
    if (Math.abs(p.on - was) > 1e-4 || before.distanceToSquared(this.glowAt) > 1e-8) this.dirty = true;
  }

  dispose() {
    for (const e of Object.values(this.earrings)) {
      for (const m of e.meshes) m.geometry.dispose();
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) e.material[k]?.dispose();
      e.material.dispose();
    }
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    this.envTarget.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
