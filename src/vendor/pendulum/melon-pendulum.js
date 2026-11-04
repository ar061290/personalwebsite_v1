/*! <melon-pendulum> - a watermelon slice that becomes a ballistic pendulum. No dependencies. */
(function () {
'use strict';

// ---- geometry.js ---------------------------------------------------------------------
// Shared geometry of the reel's figure ("Ballistic Pendulum with Disk and Mass"), in the reel's
// own pixel space: 1280 x 720, x right, y DOWN. Every renderer draws in these units; the element
// scales the canvas so that one unit is one reel pixel. Measured from the reel's frames.
//
// Physics state (see reel-physics.js): phi [rad], x [R], y [R], with R = 1.
//   phi > 0: platform displaced to the right.  x: disk centre M from platform centre S1.
//   psi = -x: disk angle, maths convention (counter-clockwise positive).
//   y: block centre m3 from M along K e1.

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (v) => 1 - (1 - v) * (1 - v) * (1 - v);
const easeInOut = (v) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);

const REEL = {
  W: 1280,
  H: 720,
  R: 188, //              disk radius
  A: [262, 137], //       left ceiling pivot, carries the torsion spring k_phi
  O: [1010, 137], //      right ceiling pivot O, origin of frames I and Z
  L: 447.2, //            link length l
  a: 748, //              platform length a = pivot spacing (parallelogram)
  barHalf: 11, //         platform half thickness (the h in the figure)
  hubH: 199, //           M above the platform centre line (R + h)
  postX: -323, //         post on the platform, from S1
  postH: 235, //          post height above the platform top
  slotHalf: 32, //        slot half width
  block: 46, //           block side
  b: 0.27, //             M to S2, in R
  ceilingY: 97,
  ceilingX0: 165,
  ceilingX1: 1105,
  // Where the 3D slice sits before the morph (diagram space): centre and radius.
  sliceX: 840,
  sliceY: 330,
  sliceR: 250,
  // The reel's first frame, the state the animation starts from.
  start: { phi: 0.3564, x: 0.3457, y: 0.6872 },
  startV: { dphi: -0.00906, dx: 0.01939, dy: 0 }, // fitted
};

// Positions of every moving point for a physics state, in reel pixels. Writes into `o`.
function reelPose(phi, x, y, o) {
  const R = REEL.R;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  o.phi = phi;
  o.Wx = REEL.A[0] + REEL.L * sp; //            platform left end (W origin, pivot of link 4)
  o.Wy = REEL.A[1] + REEL.L * cp;
  o.Ex = REEL.O[0] + REEL.L * sp; //            platform right end (pivot of link 5)
  o.Ey = REEL.O[1] + REEL.L * cp;
  o.S1x = o.Wx + REEL.a / 2; //                platform centre S1
  o.S1y = o.Wy;
  o.Mx = o.S1x + x * R; //                     disk centre M (the hub)
  o.My = o.S1y - REEL.hubH;
  const psi = -x;
  o.psi = psi;
  o.e1x = Math.cos(psi); //                    K e1 on screen (y down)
  o.e1y = -Math.sin(psi);
  o.e2x = -Math.sin(psi); //                   K e2 on screen
  o.e2y = -Math.cos(psi);
  o.y = y;
  o.Bx = o.Mx + y * R * o.e1x; //              block centre S3
  o.By = o.My + y * R * o.e1y;
  o.S2x = o.Mx - REEL.b * R * o.e1x; //        disk centre of mass S2
  o.S2y = o.My - REEL.b * R * o.e1y;
  o.Px = o.Mx + 0.31 * R * o.e2x; //           point on the K e2 axis where the y and b dimensions meet
  o.Py = o.My + 0.31 * R * o.e2y;
  return o;
}

// Colours are [r, g, b, a] arrays (a in 0..1). mix() blends two, css() formats one.
function mix(a, b, t) {
  const u = 1 - t;
  return (
    'rgba(' +
    ((a[0] * u + b[0] * t) | 0) + ',' +
    ((a[1] * u + b[1] * t) | 0) + ',' +
    ((a[2] * u + b[2] * t) | 0) + ',' +
    (a[3] * u + b[3] * t) + ')'
  );
}
function css(a) {
  return 'rgba(' + a[0] + ',' + a[1] + ',' + a[2] + ',' + a[3] + ')';
}

// Default palette, used by the dev pages; the element reads the real one from CSS variables.
const DEFAULT_COLORS = {
  paper: [250, 250, 248, 1],
  ink: [17, 17, 17, 1],
  shade: [190, 190, 190, 1], //   block m3 fill
  accent: [217, 67, 90, 1],
  rind: [44, 106, 46, 1],
  rindLight: [214, 235, 176, 1],
  stripe: [156, 198, 100, 1],
  flesh: [238, 74, 90, 1],
  fleshDeep: [196, 38, 58, 1],
  seed: [27, 25, 22, 1],
};

// ---- reel-physics.js -----------------------------------------------------------------
// Ballistic pendulum with disk and mass: the system in the reel.
//
// A platform (1, mass m1) hangs from two parallel links of length l (a parallelogram), so it
// translates on a circle: its angle is phi, with a torsion spring k_phi at the left pivot.
// A slotted disk (2, mass m2, inertia J2 about its centre of mass S2) rolls without slipping on
// the platform; x is its centre M measured from the platform centre S1, so psi = -x / R.
// S2 sits a distance b behind M, opposite the slot. A spring-damper k1, c1 ties M to a post on the
// platform. A block (3, mass m3) slides in the slot at distance y from M on a spring k2.
//
// Generalised coordinates q = [phi, x, y]. Lengths are in disk radii (R = 1), time in seconds.
// The equations come from Kane's method: for every body, velocity = J(q) q' and acceleration =
// J q'' + bias(q, q'), so  sum m J^T J q'' = sum J^T (F - m bias) + Q.

// Fitted to the reel's motion tracked frame by frame (tools/fit-reel.js): over its 9.3 s the
// simulation follows the reel with RMS errors of 0.72 deg in phi, 2.6 px in x and 3.5 px in y.
// The block's mass and spring were then set heavier and damped (same equilibrium, same fit
// quality) so that dragging the swing cannot excite a stiff, undamped mode.
const REEL_DEFAULTS = {
  l: 2.378, //    link length (447 px in the reel, R = 188 px)
  H: 1.0585, //   height of M above the platform centre line: R + h
  b: 0.27, //     M to S2
  g: 40.16, //    g / R in 1/s^2 (fitted; a 1.53 s swing)
  m1: 15.81, //   masses relative to the disk, m2 = 1
  m2: 1,
  m3: 0.08,
  J2: 28.84, //   disk inertia about S2, in m2 R^2
  J3: 0.01,
  kphi: 24.51, // torsion spring at the left pivot
  k1: 302,
  x0: 0.1204, //  rest position of M for spring k1
  k2: 98, //      block spring: 35 rad/s
  L0: 0.6553,
  c1: 2.576,
  c2: 0.84, //    block damping ratio 0.15
  cphi: 0,
  yMin: 0.3, //   block stops in the slot
  yMax: 0.85,
  xMin: -0.75, // the disk stays between the damper and the platform's right end
  xMax: 0.95,
  e: 0.3,
};

class ReelPhysics {
  constructor(params) {
    this.p = Object.assign({}, REEL_DEFAULTS, params);
    this.s = new Float64Array(6); // phi, x, y, phi', x', y'
    this._k = [new Float64Array(6), new Float64Array(6), new Float64Array(6), new Float64Array(6)];
    this._tmp = new Float64Array(6);
    this._M = new Float64Array(9);
    this._r = new Float64Array(3);
    this.force = 0; // horizontal force on the platform (pointer drag)
  }

  set(phi, x, y, dphi, dx, dy) {
    const s = this.s;
    s[0] = phi;
    s[1] = x;
    s[2] = y;
    s[3] = dphi || 0;
    s[4] = dx || 0;
    s[5] = dy || 0;
  }

  _deriv(s, out) {
    const p = this.p;
    const M = this._M;
    const r = this._r;
    const phi = s[0];
    const x = s[1];
    const y = s[2];
    const dp = s[3];
    const dx = s[4];
    const dy = s[5];
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const psi = -x;
    const c1 = Math.cos(psi);
    const s1 = Math.sin(psi);
    // Platform motion shared by every body: velocity l phi' (c, s), bias l phi'^2 (-s, c).
    const ax = p.l * c;
    const ay = p.l * sn;
    const bx = -p.l * dp * dp * sn;
    const by = p.l * dp * dp * c;
    for (let i = 0; i < 9; i++) M[i] = 0;
    r[0] = r[1] = r[2] = 0;

    // Platform, m1.
    M[0] += p.m1 * (ax * ax + ay * ay);
    r[0] += ax * (-p.m1 * bx) + ay * (-p.m1 * p.g - p.m1 * by);

    // Disk centre of mass S2 = M - b e1. Jx = (1,0) + b e2, bias += b x'^2 e1.
    {
      const m = p.m2;
      const jxx = 1 - p.b * s1;
      const jxy = p.b * c1;
      const bbx = bx + p.b * dx * dx * c1;
      const bby = by + p.b * dx * dx * s1;
      const fx = -m * bbx;
      const fy = -m * p.g - m * bby;
      M[0] += m * (ax * ax + ay * ay);
      M[1] += m * (ax * jxx + ay * jxy);
      M[4] += m * (jxx * jxx + jxy * jxy);
      r[0] += ax * fx + ay * fy;
      r[1] += jxx * fx + jxy * fy;
    }

    // Block m3 = M + y e1. Jx = (1,0) - y e2, Jy = e1, bias += -2 x' y' e2 - y x'^2 e1.
    {
      const m = p.m3;
      const jxx = 1 + y * s1;
      const jxy = -y * c1;
      const jyx = c1;
      const jyy = s1;
      const bbx = bx + 2 * dx * dy * s1 - y * dx * dx * c1;
      const bby = by - 2 * dx * dy * c1 - y * dx * dx * s1;
      const fx = -m * bbx;
      const fy = -m * p.g - m * bby;
      M[0] += m * (ax * ax + ay * ay);
      M[1] += m * (ax * jxx + ay * jxy);
      M[2] += m * (ax * jyx + ay * jyy);
      M[4] += m * (jxx * jxx + jxy * jxy);
      M[5] += m * (jxx * jyx + jxy * jyy);
      M[8] += m * (jyx * jyx + jyy * jyy);
      r[0] += ax * fx + ay * fy;
      r[1] += jxx * fx + jxy * fy;
      r[2] += jyx * fx + jyy * fy;
    }

    // Rotation of disk and block, psi' = -x'.
    M[4] += p.J2 * p.m2 + p.J3;

    // Springs, dampers, and the pointer pulling the platform sideways.
    r[0] += -p.kphi * phi - p.cphi * dp + ax * this.force;
    r[1] += -p.k1 * (x - p.x0) - p.c1 * dx;
    r[2] += -p.k2 * (y - p.L0) - p.c2 * dy;

    M[3] = M[1];
    M[6] = M[2];
    M[7] = M[5];
    solve3(M, r);
    out[0] = dp;
    out[1] = dx;
    out[2] = dy;
    out[3] = r[0];
    out[4] = r[1];
    out[5] = r[2];
  }

  step(dt) {
    const s = this.s;
    const [k1, k2, k3, k4] = this._k;
    const t = this._tmp;
    const h = dt / 2;
    this._deriv(s, k1);
    for (let i = 0; i < 6; i++) t[i] = s[i] + h * k1[i];
    this._deriv(t, k2);
    for (let i = 0; i < 6; i++) t[i] = s[i] + h * k2[i];
    this._deriv(t, k3);
    for (let i = 0; i < 6; i++) t[i] = s[i] + dt * k3[i];
    this._deriv(t, k4);
    for (let i = 0; i < 6; i++) s[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);

    // Stops: the block at the ends of its slot, the disk at the ends of the platform.
    const p = this.p;
    if (s[2] < p.yMin) {
      s[2] = p.yMin;
      if (s[5] < 0) s[5] = -s[5] * p.e;
    } else if (s[2] > p.yMax) {
      s[2] = p.yMax;
      if (s[5] > 0) s[5] = -s[5] * p.e;
    }
    if (s[1] > p.xMax) {
      s[1] = p.xMax;
      if (s[4] > 0) s[4] = -s[4] * p.e;
    } else if (s[1] < p.xMin) {
      s[1] = p.xMin;
      if (s[4] < 0) s[4] = -s[4] * p.e;
    }
  }

  energy() {
    return this._kinetic() + this._potential();
  }

  // Velocities of each body straight from their definitions, independent of _deriv.
  _kinetic() {
    const p = this.p;
    const s = this.s;
    const c = Math.cos(s[0]);
    const sn = Math.sin(s[0]);
    const psi = -s[1];
    const c1 = Math.cos(psi);
    const s1 = Math.sin(psi);
    const dp = s[3];
    const dx = s[4];
    const dy = s[5];
    const vpx = p.l * dp * c;
    const vpy = p.l * dp * sn;
    const v2x = vpx + dx - p.b * dx * s1;
    const v2y = vpy + p.b * dx * c1;
    const v3x = vpx + dx + s[2] * dx * s1 + dy * c1;
    const v3y = vpy - s[2] * dx * c1 + dy * s1;
    return (
      0.5 * p.m1 * (vpx * vpx + vpy * vpy) +
      0.5 * p.m2 * (v2x * v2x + v2y * v2y) +
      0.5 * p.m3 * (v3x * v3x + v3y * v3y) +
      0.5 * (p.J2 * p.m2 + p.J3) * dx * dx
    );
  }

  _potential() {
    const p = this.p;
    const s = this.s;
    const yp = -p.l * Math.cos(s[0]);
    const s1 = Math.sin(-s[1]);
    return (
      p.g * (p.m1 * yp + p.m2 * (yp + p.H - p.b * s1) + p.m3 * (yp + p.H + s[2] * s1)) +
      0.5 * p.kphi * s[0] * s[0] +
      0.5 * p.k1 * (s[1] - p.x0) * (s[1] - p.x0) +
      0.5 * p.k2 * (s[2] - p.L0) * (s[2] - p.L0)
    );
  }
}

// Solve the symmetric 3x3 system M a = r in place (a written into r). Gaussian elimination.
function solve3(M, r) {
  const a00 = M[0], a01 = M[1], a02 = M[2];
  const a11 = M[4], a12 = M[5], a22 = M[8];
  const l10 = a01 / a00;
  const l20 = a02 / a00;
  const b11 = a11 - l10 * a01;
  const b12 = a12 - l10 * a02;
  const b22 = a22 - l20 * a02;
  const l21 = b12 / b11;
  const c22 = b22 - l21 * b12;
  const r1 = r[1] - l10 * r[0];
  const r2 = r[2] - l20 * r[0] - l21 * r1;
  const z2 = r2 / c22;
  const z1 = (r1 - b12 * z2) / b11;
  const z0 = (r[0] - a01 * z1 - a02 * z2) / a00;
  r[0] = z0;
  r[1] = z1;
  r[2] = z2;
}


// ---- melon-slice.js ------------------------------------------------------------------
// The melon slice that becomes disk (2) of the reel. Plain script: it is concatenated after
// geometry.js inside the element's IIFE and uses REEL, TAU, seg, lerp, easeInOut, clamp01, mix and
// css from there. Public API, one function:
//
//   drawMelon(ctx, m, pose, C, time, opts)
//
//   ctx   2D context, already scaled so that 1 unit = 1 reel pixel. Its state is left untouched.
//   m     morph, 0..1. 0: a 3D watermelon wedge. 1: exactly the reel's disk (2) at `pose`: the
//         slotted rim, the hub M and the block m3 (no fill, so the diagram shows through).
//   pose  reelPose() output (Mx, My, e1x, e1y, e2x, e2y, Bx, By, psi).
//   C     palette ([r, g, b, a] arrays, like DEFAULT_COLORS).
//   time  seconds; drives the idle sway of the slice while m < 1.
//   opts  { still: true => no idle motion, hover: 0..1 => outline / rind edge up to 60% heavier }.
//
// The slice is a real 3D prism (two sector faces, two cut faces, the curved rind band) rotated by
// yaw / pitch / roll and projected orthographically (weak perspective: every planar face maps
// affinely, so each face's artwork is drawn through ctx.transform). Faces are back-face culled; the
// prism is convex while it has thickness, so culling alone gives a correct picture and the side
// faces are painted before the flat face only to hide anti-aliasing seams.
//
// The morph: the slice turns face-on and flattens, slides and scales onto the hub M, and opens
// around its apex (the apex becomes the hub) until its two cut edges become the slot walls along
// K e1. The flesh drains to transparent, the rind to a single ink outline, the centre seed slides
// tip first through the apex into the slot and becomes the block, the other seeds fade, and the hub
// rings fade in.

const MELON_SLICE = (() => {
  const PI = Math.PI;
  const HALF_PI = PI / 2;

  // ---- The reel's disk at m = 1 (measured on the reel frames by integrating ink across lines) ----
  const LW_RIM = 3.3; //                     rim, slot walls and the tick at the hub
  const LW_BLOCK = 3.4; //                   outline of the block m3
  const LW_SKETCH = 1.9; //                  sketched seeds and rind line in the figure
  const SEED_SKETCH = 1.5; //                sketched seed size, relative to the fruit's seeds
  const RIND_SKETCH = 0.87; //               inner edge of the rind, in disk radii
  const BLOCK_HALF = REEL.block / 2 + 1; //  block, half side at the stroke centreline
  const BLOCK_DOT = 5; //                    S3
  const HUB_R1 = 14.6; //                    hub M, outer ring
  const HUB_W1 = 3.3;
  const HUB_R2 = 7.3; //                     inner ring
  const HUB_W2 = 2.8;
  const HUB_DOT = 3; //                      centre dot

  // ---- The slice at m = 0 (lengths in slice radii) ----
  const HALF0 = (32 * PI) / 180; //  wedge half-angle
  const HALF_T = 0.15; //            half thickness (thickness 0.3 R)
  const SKIN = 0.04; //              dark green skin seen on the flat faces
  const SEED_A = 0.043; //           seed half length
  const SEED_B = 0.026; //           seed half width

  // Idle motion: smooth sinusoids. At time 0 they equal the still pose.
  const SWAY = 0.38; //   yaw amplitude, about +-22 deg
  const SWAY_W = TAU / 6;
  const SWAY_PH = -0.9;
  const PITCH0 = 0.17; // top tipped towards the viewer, so the striped rind shows
  const PITCH_A = 0.04;
  const PITCH_W = TAU / 8.3;
  const PITCH_PH = 0.6;
  const ROLL0 = -0.05;
  const ROLL_A = 0.025;
  const ROLL_W = TAU / 7.1;
  const ROLL_PH = 2.1;
  const BOB_A = 3.5; //   px
  const BOB_W = TAU / 4.4;

  // Light, camera space (x right, y up, z towards the viewer): key light from the top left.
  const AMB = 0.5;
  const DIF = 0.7;
  let LX = -0.4;
  let LY = 0.62;
  let LZ = 0.68;
  {
    const l = Math.hypot(LX, LY, LZ);
    LX /= l;
    LY /= l;
    LZ /= l;
  }
  let HX = LX;
  let HY = LY;
  let HZ = LZ + 1;
  {
    const l = Math.hypot(HX, HY, HZ);
    HX /= l;
    HY /= l;
    HZ /= l;
  }

  // ---- Unit outlines, NS points, axis along +x: teardrop (tip at +x), circle, square ----
  const NS = 32; // multiple of 8, so the square's corners are sampled exactly
  const TEAR = new Float64Array(NS * 2);
  const CIRC = new Float64Array(NS * 2);
  const SQR = new Float64Array(NS * 2);
  {
    let ym = 0;
    for (let k = 0; k < NS; k++) {
      const a = (k / NS) * TAU;
      const c = Math.cos(a);
      const s = Math.sin(a);
      TEAR[2 * k] = c;
      TEAR[2 * k + 1] = s * Math.pow(Math.sin(a / 2), 1.3);
      ym = Math.max(ym, Math.abs(TEAR[2 * k + 1]));
      CIRC[2 * k] = c;
      CIRC[2 * k + 1] = s;
      const q = 1 / Math.max(Math.abs(c), Math.abs(s));
      SQR[2 * k] = c * q;
      SQR[2 * k + 1] = s * q;
    }
    for (let k = 0; k < NS; k++) TEAR[2 * k + 1] /= ym;
  }

  // ---- Seeds on the flat faces: r, angle as a fraction of the half-angle, size ----
  const SEEDS = [
    0.635, -0.74, 0.95,
    0.662, -0.37, 1.0,
    0.642, 0.0, 1.03,
    0.656, 0.37, 0.97,
    0.628, 0.74, 0.93,
    0.452, -0.52, 0.86,
    0.462, 0.52, 0.88,
  ];
  const NSEED = SEEDS.length / 3;
  // The travelling seed: on the axis, nearest the apex (the slot side). It becomes the block.
  const TRAVEL_R = 0.405;
  const TRAVEL_SIZE = 0.9;
  // Pale, immature seeds.
  const PALE = [0.545, -0.2, 0.62, 0.56, 0.21, 0.55, 0.33, -0.36, 0.5, 0.35, 0.4, 0.45];
  const NPALE = PALE.length / 3;
  // Seed cross-sections on the radial cut faces: distance from the apex, z (in half thicknesses), size.
  const CUTSEEDS = [0.455, 0.28, 0.8, 0.615, -0.42, 0.95, 0.668, 0.46, 0.7];
  const NCUT = CUTSEEDS.length / 3;

  // Flecks: the granular, glistening texture of the flesh. Deterministic.
  const NFLECK = 90;
  const FLECK = new Float64Array(NFLECK * 3);
  {
    let s = 7;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < NFLECK; i++) {
      FLECK[3 * i] = 0.1 + 0.72 * Math.sqrt(rnd()); //  r
      FLECK[3 * i + 1] = (rnd() * 2 - 1) * 0.86; //     angle fraction
      FLECK[3 * i + 2] = 0.004 + 0.008 * rnd(); //      size
    }
  }

  // Stripes on the rind band: centre angle (rad from the wedge axis), half width, phase.
  const STRIPES = [-0.5, 0.042, 0.3, -0.33, 0.05, 2.1, -0.155, 0.038, 4.0, 0.02, 0.052, 1.2,
    0.195, 0.04, 5.3, 0.36, 0.048, 3.1, 0.525, 0.04, 0.7];
  const NSTRIPE = STRIPES.length / 3;
  const STRIPE_K = 6; //  segments along the thickness

  // ---- Per-frame state shared by the helpers (no per-frame allocation) ----
  // Rotation matrix rows, the face-plane basis on screen, and the local origin on screen.
  let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1;
  let Anx = 0, Any = 0, Bdx = 0, Bdy = 0, Zsx = 0, Zsy = 0, Ox = 0, Oy = 0;
  let Az = 0, Bz = 0, Axc = 0, Ayc = 0, Bxc = 0, Byc = 0;

  // ---- Cached gradients and colour strings, rebuilt when the context or the palette changes ----
  let cCtx = null;
  let cHash = NaN;
  let gFace = null; //   radial, apex-centred, radius 1: heart, flesh, white rind, green rind
  let gCut = null; //    the same layers, linear from the apex (0) to the rind (1)
  let gSheen = null; //  unit radial white highlight
  let gShadow = null; // unit radial soft shadow
  let sInk = '';
  let sPaper = '';
  let sSeed = '';
  let sShade = '';
  let sSkin = '';
  let sFleck = '';
  let sPale = '';

  function hashCol(h, c) {
    return h * 1.618 + c[0] * 0.913 + c[1] * 0.377 + c[2] * 0.151 + c[3] * 17.3;
  }

  function prepare(ctx, C) {
    let h = 0;
    h = hashCol(h, C.flesh);
    h = hashCol(h, C.fleshDeep);
    h = hashCol(h, C.rind);
    h = hashCol(h, C.rindLight);
    h = hashCol(h, C.stripe);
    h = hashCol(h, C.ink);
    h = hashCol(h, C.paper);
    h = hashCol(h, C.seed);
    h = hashCol(h, C.shade);
    if (ctx === cCtx && h === cHash) return;
    cCtx = ctx;
    cHash = h;
    gFace = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gCut = ctx.createLinearGradient(0, 0, 1, 0);
    for (let i = 0; i < 2; i++) {
      const g = i ? gCut : gFace;
      g.addColorStop(0, mix(C.fleshDeep, C.flesh, 0.4));
      g.addColorStop(0.3, mix(C.fleshDeep, C.flesh, 0.78));
      g.addColorStop(0.6, css(C.flesh));
      g.addColorStop(0.79, mix(C.flesh, C.rindLight, 0.16));
      g.addColorStop(0.845, mix(C.flesh, C.rindLight, 0.5));
      g.addColorStop(0.872, mix(C.rindLight, C.paper, 0.25));
      g.addColorStop(0.915, css(C.rindLight));
      g.addColorStop(0.945, mix(C.rindLight, C.stripe, 0.75));
      g.addColorStop(0.958, mix(C.stripe, C.rind, 0.6));
      g.addColorStop(0.966, css(C.rind));
      g.addColorStop(1, mix(C.rind, C.ink, 0.3));
    }
    gSheen = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gSheen.addColorStop(0, 'rgba(255,255,255,0.75)');
    gSheen.addColorStop(0.35, 'rgba(255,255,255,0.32)');
    gSheen.addColorStop(1, 'rgba(255,255,255,0)');
    gShadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gShadow.addColorStop(0, 'rgba(0,0,0,1)');
    gShadow.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    gShadow.addColorStop(1, 'rgba(0,0,0,0)');
    sInk = css(C.ink);
    sPaper = css(C.paper);
    sSeed = css(C.seed);
    sShade = css(C.shade);
    sSkin = mix(C.rind, C.ink, 0.28);
    sFleck = mix(C.flesh, C.paper, 0.55);
    sPale = mix(C.rindLight, C.paper, 0.45);
  }

  // Lambert + ambient for a camera-space normal.
  function lambert(nx, ny, nz) {
    const d = nx * LX + ny * LY + nz * LZ;
    return AMB + DIF * (d > 0 ? d : 0);
  }
  function blinn(nx, ny, nz, p) {
    const d = nx * HX + ny * HY + nz * HZ;
    return d > 0 ? Math.pow(d, p) : 0;
  }
  // 'rgb()' of colour c lit by f, plus a white specular s.
  function lit(c, f, s) {
    let r = c[0] * f + 255 * s;
    let g = c[1] * f + 255 * s;
    let b = c[2] * f + 255 * s;
    r = r > 255 ? 255 : r | 0;
    g = g > 255 ? 255 : g | 0;
    b = b > 255 ? 255 : b | 0;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function a3(v) {
    return ((v * 1000) | 0) / 1000;
  }
  // Darken (f < 1) or lighten (f > 1) whatever path is current, at strength k.
  function shadePath(ctx, f, k) {
    if (f < 0.995) {
      ctx.globalAlpha = k * (1 - f);
      ctx.fillStyle = '#000';
      ctx.fill();
    } else if (f > 1.005) {
      ctx.globalAlpha = k * (f - 1) * 0.7;
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }

  // Screen point of a local face-plane point (lx along n, ly along the wedge axis d) at depth z.
  let PX = 0;
  let PY = 0;
  function proj(lx, ly, z) {
    PX = Ox + lx * Anx + ly * Bdx + z * Zsx;
    PY = Oy + lx * Any + ly * Bdy + z * Zsy;
  }
  // Face-plane coordinates -> screen, at depth z.
  function faceTransform(ctx, z) {
    ctx.transform(Anx, Any, Bdx, Bdy, Ox + z * Zsx, Oy + z * Zsy);
  }

  // Outline of the flat face: radius 1, half-angle al, cut edges starting at +-w on the n axis.
  function facePath(ctx, al, w) {
    const sa = Math.sin(al);
    const ca = Math.cos(al);
    ctx.beginPath();
    ctx.moveTo(w, 0);
    ctx.lineTo(sa, ca);
    ctx.arc(0, 0, 1, HALF_PI - al, HALF_PI + al, false);
    ctx.lineTo(-w, 0);
    ctx.closePath();
  }

  // Adds a morphing seed outline to the current path, in whatever coordinates are current.
  // (cx, cy) centre, (tx, ty) unit axis towards the tip, a / b half length / width,
  // k1: teardrop -> circle, k2: circle -> square.
  function seedShape(ctx, cx, cy, tx, ty, a, b, k1, k2) {
    const px = -ty;
    const py = tx;
    for (let k = 0; k < NS; k++) {
      let x = TEAR[2 * k];
      let y = TEAR[2 * k + 1];
      if (k1 > 0) {
        x += (CIRC[2 * k] - x) * k1;
        y += (CIRC[2 * k + 1] - y) * k1;
      }
      if (k2 > 0) {
        x += (SQR[2 * k] - x) * k2;
        y += (SQR[2 * k + 1] - y) * k2;
      }
      x *= a;
      y *= b;
      const X = cx + x * tx + y * px;
      const Y = cy + x * ty + y * py;
      if (k === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.closePath();
  }

  // Seed highlight: a small ellipse on the fat end, upper side.
  function seedGloss(ctx, cx, cy, tx, ty, a, b) {
    const gx = cx - tx * a * 0.38 - ty * b * 0.32;
    const gy = cy - ty * a * 0.38 + tx * b * 0.32;
    ctx.moveTo(gx + a * 0.3, gy);
    ctx.ellipse(gx, gy, a * 0.3, b * 0.26, Math.atan2(ty, tx), 0, TAU);
  }

  const NO_DASH = [];

  function draw(ctx, m, pose, C, time, opts) {
    m = clamp01(+m || 0);
    const still = !!(opts && opts.still);
    const hover = opts && opts.hover > 0 ? (opts.hover > 1 ? 1 : opts.hover) : 0;
    const t = still ? 0 : +time || 0;
    prepare(ctx, C);

    // ---- Morph schedule (all monotonic, eased in and out) ----
    const idle = still ? 0 : 1 - easeInOut(seg(m, 0, 0.3)); //  idle motion
    const r3d = 1 - easeInOut(seg(m, 0, 0.45)); //            3D pose -> face-on
    const kThick = 1 - easeInOut(seg(m, 0.02, 0.42)); //       thickness -> 0
    const kMove = easeInOut(seg(m, 0.08, 0.7)); //             slice centre / size -> hub / R
    const kRot = easeInOut(seg(m, 0.1, 0.75)); //              wedge axis: up -> -e1
    const kOpen = easeInOut(seg(m, 0.15, 0.9)); //             half-angle 32 deg -> around the hub
    const kWall = easeInOut(seg(m, 0.5, 0.95)); //             cut edges -> parallel walls at +-32
    const fleshA = 1 - easeInOut(seg(m, 0.28, 0.85)); //       flesh -> transparent
    const inkA = easeInOut(seg(m, 0.3, 0.8)); //               rind -> ink outline
    const seedA = 1 - easeInOut(seg(m, 0.12, 0.6)); //         other seeds fade ...
    const seedS = 1 - 0.55 * seg(m, 0.12, 0.6); //             ... and shrink (never to 0)
    const kTravel = easeInOut(seg(m, 0.22, 0.8)); //           centre seed -> block position
    const kRound = easeInOut(seg(m, 0.45, 0.72)); //           teardrop -> round
    const kSquare = easeInOut(seg(m, 0.68, 0.92)); //          round -> square
    const kSize = easeInOut(seg(m, 0.4, 0.9)); //              seed size -> block size
    const kCol = easeInOut(seg(m, 0.6, 0.92)); //              black seed -> grey block, ink border
    const kHub = easeInOut(seg(m, 0.7, 1)); //                 hub rings
    const shadowA = 0.15 * (1 - easeInOut(seg(m, 0, 0.3)));

    // ---- Placement ----
    const R = REEL.R;
    const S = lerp(REEL.sliceR, R, kMove); //                  px per radius
    const bob = idle * BOB_A * Math.sin(BOB_W * t);
    const pcx = lerp(REEL.sliceX, pose.Mx, kMove);
    const pcy0 = lerp(REEL.sliceY, pose.My, kMove);
    const pcy = pcy0 + bob;
    const pv = 0.5 * (1 - kMove); //                          pivot on the axis: mid-slice -> apex
    // Wedge axis d and its normal n in the face plane (object space, y up). At m = 1, d = -e1 and
    // n = e2 on screen: n is +32 px side (top wall), -n the bottom wall with the tick.
    let dl = pose.psi + HALF_PI;
    dl = Math.atan2(Math.sin(dl), Math.cos(dl));
    const thc = HALF_PI + dl * kRot;
    const dx = Math.cos(thc);
    const dy = Math.sin(thc);
    const nx = dy;
    const ny = -dx;
    // Slot: rim centreline radius (the outer edge of the ink sits on R), walls at +-w.
    const rr = 1 - LW_RIM / (2 * R);
    const wEnd = REEL.slotHalf / R;
    const w = wEnd * kWall;
    const alEnd = PI - Math.asin(wEnd / rr);
    const al = lerp(HALF0, alEnd, kOpen);
    const h = HALF_T * kThick;

    // ---- 3D pose: yaw (about the vertical), then pitch, then roll ----
    const yawT = SWAY * Math.sin(SWAY_W * t + SWAY_PH);
    const yawS = SWAY * Math.sin(SWAY_PH);
    const pitchT = PITCH0 + PITCH_A * Math.sin(PITCH_W * t + PITCH_PH);
    const pitchS = PITCH0 + PITCH_A * Math.sin(PITCH_PH);
    const rollT = ROLL0 + ROLL_A * Math.sin(ROLL_W * t + ROLL_PH);
    const rollS = ROLL0 + ROLL_A * Math.sin(ROLL_PH);
    const yaw = r3d * (yawS + idle * (yawT - yawS));
    const pitch = r3d * (pitchS + idle * (pitchT - pitchS));
    const roll = r3d * (rollS + idle * (rollT - rollS));
    {
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const a10 = sp * sy;
      const a12 = -sp * cy;
      r00 = cr * cy - sr * a10;
      r01 = -sr * cp;
      r02 = cr * sy - sr * a12;
      r10 = sr * cy + cr * a10;
      r11 = cr * cp;
      r12 = sr * sy + cr * a12;
      r20 = -cp * sy;
      r21 = sp;
      r22 = cp * cy;
    }
    // Camera-space images of n, d (face plane) and z (face normal); their screen projections.
    Axc = r00 * nx + r01 * ny;
    Ayc = r10 * nx + r11 * ny;
    Az = r20 * nx + r21 * ny;
    Bxc = r00 * dx + r01 * dy;
    Byc = r10 * dx + r11 * dy;
    Bz = r20 * dx + r21 * dy;
    Anx = S * Axc;
    Any = -S * Ayc;
    Bdx = S * Bxc;
    Bdy = -S * Byc;
    Zsx = S * r02;
    Zsy = -S * r12;
    Ox = pcx - pv * Bdx;
    Oy = pcy - pv * Bdy;

    const front = r22 >= 0; //   which flat face looks at the viewer
    const fs = front ? 1 : -1;
    const zf = fs * h; //        its depth
    const eps = 0.6 / S; //      overlap that hides anti-aliasing seams under the flat face
    const z0 = front ? -h : -h - eps;
    const z1 = front ? h + eps : h;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.setLineDash(NO_DASH);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 10;
    ctx.globalCompositeOperation = 'source-over';

    // ---- Soft floor shadow under the floating slice ----
    if (shadowA > 0.003) {
      ctx.save();
      ctx.translate(pcx + 0.05 * S, pcy0 + 0.66 * S);
      const sc = 1 - bob * 0.01;
      ctx.scale(0.42 * S * sc, 0.06 * S * sc);
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.globalAlpha = shadowA * (1 + bob * 0.03);
      ctx.fillStyle = gShadow;
      ctx.fill();
      ctx.restore();
    }

    // ---- Side faces: the curved rind band and the two radial cut faces ----
    if (h > 1e-4) {
      // Rind band. Its normal at angle th from the axis is sin(th) n + cos(th) d; it faces the
      // viewer where sin(th) Az + cos(th) Bz > 0, i.e. within 90 deg of ph0.
      const rho = Math.hypot(Az, Bz);
      if (rho > 1e-6) {
        const ph0 = Math.atan2(Az, Bz);
        const lo = Math.max(-al, ph0 - HALF_PI);
        const hi = Math.min(al, ph0 + HALF_PI);
        if (hi > lo) {
          const n = Math.max(2, Math.ceil(((hi - lo) / (2 * HALF0)) * 28));
          const ov = eps; // angular overlap between strips (radius 1)
          for (let i = 0; i < n; i++) {
            const ta = lo + ((hi - lo) * i) / n;
            const tb = Math.min(hi + ov, lo + ((hi - lo) * (i + 1)) / n + ov);
            const tm = 0.5 * (ta + tb);
            const sm = Math.sin(tm);
            const cm = Math.cos(tm);
            const Nx = sm * Axc + cm * Bxc;
            const Ny = sm * Ayc + cm * Byc;
            const Nz = sm * Az + cm * Bz;
            ctx.fillStyle = lit(C.rind, lambert(Nx, Ny, Nz), 0.3 * blinn(Nx, Ny, Nz, 22));
            const sa = Math.sin(ta);
            const ca = Math.cos(ta);
            const sb = Math.sin(tb);
            const cb = Math.cos(tb);
            ctx.beginPath();
            proj(sa, ca, z0);
            ctx.moveTo(PX, PY);
            proj(sb, cb, z0);
            ctx.lineTo(PX, PY);
            proj(sb, cb, z1);
            ctx.lineTo(PX, PY);
            proj(sa, ca, z1);
            ctx.lineTo(PX, PY);
            ctx.closePath();
            ctx.fill();
          }
          // Lighter stripes, wavy, running across the band (stem to blossom on the whole fruit).
          for (let j = 0; j < NSTRIPE; j++) {
            const tc = STRIPES[3 * j];
            const hw = STRIPES[3 * j + 1];
            const ph = STRIPES[3 * j + 2];
            if (tc + hw + 0.03 < lo || tc - hw - 0.03 > hi) continue;
            const sm = Math.sin(tc);
            const cm = Math.cos(tc);
            const Nx = sm * Axc + cm * Bxc;
            const Ny = sm * Ayc + cm * Byc;
            const Nz = sm * Az + cm * Bz;
            ctx.fillStyle = lit(C.stripe, lambert(Nx, Ny, Nz) * 0.78, 0.22 * blinn(Nx, Ny, Nz, 22));
            ctx.beginPath();
            for (let k = 0; k <= STRIPE_K * 2 + 1; k++) {
              const side = k <= STRIPE_K ? -1 : 1;
              const kk = k <= STRIPE_K ? k : STRIPE_K * 2 + 1 - k;
              const u = kk / STRIPE_K; //          0..1 across the band
              const z = z0 + (z1 - z0) * u;
              const q = u * 2 - 1;
              const wig = 0.016 * Math.sin(5.1 * q + ph) + 0.007 * Math.sin(12.7 * q + 2 * ph);
              const ww = hw * (1 + 0.3 * Math.sin(6.3 * q + 1.7 * ph) * side);
              let th = tc + wig + side * ww;
              th = th < lo ? lo : th > hi ? hi : th;
              proj(Math.sin(th), Math.cos(th), z);
              if (k === 0) ctx.moveTo(PX, PY);
              else ctx.lineTo(PX, PY);
            }
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      // Radial cut faces: flesh with the white and green rind at the far end, cut seeds.
      const sa = Math.sin(al);
      const ca = Math.cos(al);
      for (let side = -1; side <= 1; side += 2) {
        const ix = side * w;
        let ux = side * sa - ix;
        let uy = ca;
        const len = Math.hypot(ux, uy);
        ux /= len;
        uy /= len;
        const ox = side * uy; //  outward normal in the face plane
        const oy = -side * ux;
        const Nx = ox * Axc + oy * Bxc;
        const Ny = ox * Ayc + oy * Byc;
        const Nz = ox * Az + oy * Bz;
        if (Nz <= 1e-4) continue;
        ctx.save();
        ctx.transform(
          ux * Anx + uy * Bdx,
          ux * Any + uy * Bdy,
          Zsx,
          Zsy,
          Ox + ix * Anx,
          Oy + ix * Any
        );
        ctx.beginPath();
        ctx.rect(0, z0, len, z1 - z0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = gCut;
        ctx.fill();
        shadePath(ctx, lambert(Nx, Ny, Nz), 1);
        const sp = blinn(Nx, Ny, Nz, 10);
        if (sp > 0.01) {
          ctx.globalAlpha = 0.16 * sp;
          ctx.fillStyle = '#fff';
          ctx.fill();
        }
        // Seeds cut lengthwise: small teardrops, tip towards the apex.
        ctx.beginPath();
        for (let i = 0; i < NCUT; i++) {
          const sz = CUTSEEDS[3 * i + 2];
          seedShape(ctx, CUTSEEDS[3 * i] * len, CUTSEEDS[3 * i + 1] * h, -1, 0,
            SEED_A * sz, SEED_B * 0.8 * sz, 0, 0);
        }
        ctx.globalAlpha = seedA;
        ctx.fillStyle = sSeed;
        ctx.fill();
        ctx.restore();
      }
    }

    // ---- The flat face (front, or back when the slice is turned away) ----
    {
      const Nx = fs * r02;
      const Ny = fs * r12;
      const Nz = fs * r22;
      ctx.save();
      faceTransform(ctx, zf);
      if (fleshA > 0.002) {
        facePath(ctx, al, w);
        ctx.globalAlpha = fleshA;
        ctx.fillStyle = gFace;
        ctx.fill();
        shadePath(ctx, lambert(Nx, Ny, Nz), fleshA);
        // A juicy sheen that drifts as the slice turns.
        const sp = blinn(Nx, Ny, Nz, 7);
        if (sp > 0.01) {
          ctx.save();
          ctx.translate(-0.12 - 0.5 * Nx, 0.6 + 0.3 * Ny);
          ctx.scale(0.3, 0.24);
          ctx.globalAlpha = 0.55 * sp * fleshA;
          ctx.fillStyle = gSheen;
          ctx.fill();
          ctx.restore();
        }
        // Granular flesh, and a few glints.
        ctx.beginPath();
        for (let i = 0; i < NFLECK; i++) {
          const r = FLECK[3 * i];
          const th = FLECK[3 * i + 1] * al;
          const x = r * Math.sin(th);
          const y = r * Math.cos(th);
          const s = FLECK[3 * i + 2];
          ctx.moveTo(x + s, y);
          ctx.arc(x, y, s, 0, TAU);
        }
        ctx.globalAlpha = 0.32 * fleshA;
        ctx.fillStyle = sFleck;
        ctx.fill();
        if (sp > 0.02) {
          ctx.beginPath();
          for (let i = 0; i < NFLECK; i += 5) {
            const r = FLECK[3 * i];
            const th = FLECK[3 * i + 1] * al;
            const x = r * Math.sin(th);
            const y = r * Math.cos(th);
            const s = FLECK[3 * i + 2] * 0.6;
            ctx.moveTo(x + s, y);
            ctx.arc(x, y, s, 0, TAU);
          }
          ctx.globalAlpha = 0.85 * sp * fleshA;
          ctx.fillStyle = '#fff';
          ctx.fill();
        }
      }
      // Seeds: black teardrops, tip towards the apex.
      if (seedA > 0.002) {
        ctx.beginPath();
        for (let i = 0; i < NSEED; i++) {
          const r = SEEDS[3 * i];
          const th = SEEDS[3 * i + 1] * al;
          const sz = SEEDS[3 * i + 2] * seedS;
          const st = Math.sin(th);
          const ct = Math.cos(th);
          seedShape(ctx, r * st, r * ct, -st, -ct, SEED_A * sz, SEED_B * sz, 0, 0);
        }
        ctx.globalAlpha = seedA;
        ctx.fillStyle = sSeed;
        ctx.fill();
        ctx.beginPath();
        for (let i = 0; i < NSEED; i++) {
          const r = SEEDS[3 * i];
          const th = SEEDS[3 * i + 1] * al;
          const sz = SEEDS[3 * i + 2] * seedS;
          const st = Math.sin(th);
          const ct = Math.cos(th);
          seedGloss(ctx, r * st, r * ct, -st, -ct, SEED_A * sz, SEED_B * sz);
        }
        ctx.globalAlpha = 0.3 * seedA;
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        for (let i = 0; i < NPALE; i++) {
          const r = PALE[3 * i];
          const th = PALE[3 * i + 1] * al;
          const sz = PALE[3 * i + 2] * seedS;
          const st = Math.sin(th);
          const ct = Math.cos(th);
          seedShape(ctx, r * st, r * ct, -st, -ct, SEED_A * sz, SEED_B * 0.8 * sz, 0, 0);
        }
        ctx.globalAlpha = 0.85 * seedA;
        ctx.fillStyle = sPale;
        ctx.fill();
      }
      // The melon stays legible in the figure: seeds sketched as ink outlines and the inner edge of
      // the rind as a thin line, both fading in as the colours drain. Line widths in face units.
      if (inkA > 0.001) {
        ctx.save();
        facePath(ctx, al, w);
        ctx.clip();
        ctx.beginPath();
        ctx.arc(0, 0, RIND_SKETCH, 0, TAU);
        ctx.globalAlpha = 0.75 * inkA;
        ctx.strokeStyle = sInk;
        ctx.lineWidth = LW_SKETCH / S;
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        for (let i = 0; i < NSEED; i++) {
          const r = SEEDS[3 * i];
          const th = SEEDS[3 * i + 1] * al;
          const sz = SEEDS[3 * i + 2] * SEED_SKETCH;
          const st = Math.sin(th);
          const ct = Math.cos(th);
          seedShape(ctx, r * st, r * ct, -st, -ct, SEED_A * sz, SEED_B * sz, 0, 0);
          ctx.closePath();
        }
        ctx.globalAlpha = 0.8 * inkA;
        ctx.strokeStyle = sInk;
        ctx.lineWidth = LW_SKETCH / S;
        ctx.stroke();
      }
      // Dark skin along the rind edge of the face (heavier on hover); fades into the ink outline.
      if (inkA < 0.999) {
        const sw = (SKIN * (1 + 0.6 * hover) * lerp(1, 0.4, inkA));
        ctx.beginPath();
        ctx.arc(0, 0, 1 - sw / 2, HALF_PI - al, HALF_PI + al, false);
        ctx.lineWidth = sw;
        ctx.globalAlpha = 1 - inkA;
        ctx.strokeStyle = sSkin;
        ctx.stroke();
      }
      // The ink outline: wall, rim, wall, and the tick towards the hub. Built in face coordinates,
      // stroked in screen pixels.
      if (inkA > 0.001) {
        const sa = Math.sin(al);
        const ca = Math.cos(al);
        ctx.beginPath();
        if (kHub > 0 && kHub < 1) {
          ctx.moveTo(w * kHub, 0);
          ctx.lineTo(w, 0);
        } else {
          ctx.moveTo(kHub > 0 ? w : 0, 0);
          if (kHub === 0) ctx.lineTo(w, 0);
        }
        ctx.lineTo(rr * sa, rr * ca);
        ctx.arc(0, 0, rr, HALF_PI - al, HALF_PI + al, false);
        ctx.lineTo(-w, 0);
        const te = Math.min(w, (HUB_R1 * kHub) / S);
        if (w - te > 1e-6) ctx.lineTo(-te, 0);
        if (kHub === 0) ctx.closePath();
        ctx.restore();
        ctx.save();
        ctx.lineWidth = LW_RIM * (1 + 0.6 * hover);
        ctx.globalAlpha = inkA;
        ctx.strokeStyle = sInk;
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---- The centre seed: slides tip first through the apex into the slot, becomes m3 ----
    {
      // Block position in face coordinates (n, d) at m = 1.
      const ddx = pose.Bx - pose.Mx;
      const ddy = pose.By - pose.My;
      const lxB = (ddx * pose.e2x + ddy * pose.e2y) / R;
      const lyB = -(ddx * pose.e1x + ddy * pose.e1y) / R;
      const cx = lxB * kTravel;
      const cy = lerp(TRAVEL_R, lyB, kTravel);
      const a = lerp(SEED_A * TRAVEL_SIZE, BLOCK_HALF / R, kSize);
      const b = lerp(SEED_B * TRAVEL_SIZE, BLOCK_HALF / R, kSize);
      ctx.save();
      faceTransform(ctx, zf);
      ctx.beginPath();
      seedShape(ctx, cx, cy, 0, -1, a, b, kRound, kSquare); // tip along -d = e1
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.fillStyle = kCol <= 0 ? sSeed : kCol >= 1 ? sShade : mix(C.seed, C.shade, kCol);
      ctx.fill();
      if (kCol > 0.001) {
        ctx.globalAlpha = kCol;
        ctx.lineWidth = LW_BLOCK;
        ctx.strokeStyle = sInk;
        ctx.stroke();
      }
      const gloss = 0.3 * (1 - kCol) * (1 - kRound);
      if (gloss > 0.002) {
        ctx.save();
        faceTransform(ctx, zf);
        ctx.beginPath();
        seedGloss(ctx, cx, cy, 0, -1, a, b);
        ctx.restore();
        ctx.globalAlpha = gloss;
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
      if (kCol > 0.001) {
        proj(cx, cy, zf);
        ctx.globalAlpha = kCol;
        ctx.beginPath();
        ctx.arc(PX, PY, BLOCK_DOT, 0, TAU);
        ctx.fillStyle = sInk;
        ctx.fill();
      }
    }

    // ---- Hub M: paper inside, two rings and a dot ----
    if (kHub > 0.001) {
      proj(0, 0, 0);
      ctx.globalAlpha = kHub;
      ctx.beginPath();
      ctx.arc(PX, PY, HUB_R1, 0, TAU);
      ctx.fillStyle = sPaper;
      ctx.fill();
      ctx.lineWidth = HUB_W1;
      ctx.strokeStyle = sInk;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(PX, PY, HUB_R2, 0, TAU);
      ctx.lineWidth = HUB_W2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(PX, PY, HUB_DOT, 0, TAU);
      ctx.fillStyle = sInk;
      ctx.fill();
    }

    ctx.restore();
  }

  return { draw };
})();

function drawMelon(ctx, m, pose, C, time, opts) {
  MELON_SLICE.draw(ctx, m, pose, C, time, opts);
}

// ---- reel-draw.js --------------------------------------------------------------------
// The reel's line art: every stroke and label of the "Ballistic Pendulum with Disk and Mass"
// figure except the disk body (outline, slot walls, hub rings, block), which another renderer
// draws before this one. Plain script, concatenated after geometry.js; one public function:
//
//   drawReel(ctx, d, pose, C, opts)
//     ctx   1 unit = 1 reel pixel (1280 x 720, y down). All state changed here is restored.
//     d     build-in progress 0..1 (0 draws nothing, 1 the complete figure).
//     pose  reelPose() output. C: colours ([r,g,b,a]); C.ink for lines and text, C.paper for
//           knock-outs. opts: reserved.
//
// Every offset below was measured on the reel's frames relative to the point it hangs from
// (pivot, platform end, platform centre S1, hub M in the rotating K frame, block S3, ...), so the
// figure follows the pose. Labels translate with their body and never rotate.

// ---- style -------------------------------------------------------------------------------------
const RD_W_THIN = 1.35; //   leaders, extension lines, dashed / dash-dot lines, hatching
const RD_W_MED = 2.7; //     spring k1, damper c1, spring k2, R arrow
const RD_W_THICK = 4; //     ceiling, platform, arrows, dimension lines, pivots
const RD_W_HEAVY = 8; //     links 4 and 5, post
const RD_DASH = [10, 6];
const RD_DASHDOT = [8, 3, 2, 3];
const RD_NODASH = [];

// LaTeX look. Italic needs a family with a real italic face (math fonts have none).
const RD_UP_STACK =
  "'Latin Modern Math','CMU Serif','Latin Modern Roman','STIX Two Text','Cambria Math','Times New Roman',serif";
const RD_IT_STACK = "'Latin Modern Roman','CMU Serif','STIX Two Text','Cambria','Times New Roman',serif";
const RD_FONTS = [
  'italic 27px ' + RD_IT_STACK, //  0 symbol (x, y, k, m, ...)
  '27px ' + RD_UP_STACK, //         1 upright (M, O, S, N. N., digits)
  '19px ' + RD_UP_STACK, //         2 subscript digit
  'italic 19px ' + RD_IT_STACK, //  3 italic subscript (k_phi)
  '18px ' + RD_UP_STACK, //         4 frame letter before a vector (I, Z, K, W)
  'italic 29px ' + RD_IT_STACK, //  5 vector e
  'bold 27px ' + RD_UP_STACK, //    6 bold J
  '18px ' + RD_UP_STACK, //         7 superscript (S
  '13px ' + RD_UP_STACK, //         8 second-level subscript
];
const F_SYM = 0, F_UP = 1, F_SUB = 2, F_SUBI = 3, F_FR = 4, F_VEC = 5, F_BOLD = 6, F_SUP = 7, F_SUB2 = 8;
const F_ARROW = -1; // pseudo run: vector arrow over the previous run

// Labels: runs of [font, text, dx (gap before), dy (baseline shift, + = down), stack]. stack = 1
// starts the run at the previous run's x (a superscript over a subscript). Positions are the
// label's horizontal centre and the baseline of its main symbol.
const RD_LABELS = [
  /*  0 g     */ [[F_SYM, 'g', 0, 0]],
  /*  1 k_phi */ [[F_SYM, 'k', 0, 0], [F_SUBI, 'φ', 1, 5]],
  /*  2 l (4) */ [[F_UP, 'ℓ', 0, 0]],
  /*  3 l (5) */ [[F_UP, 'ℓ', 0, 0]],
  /*  4 N. N. */ [[F_UP, 'N. N.', 0, 0]],
  /*  5 O     */ [[F_UP, 'O', 0, 0]],
  /*  6 phi   */ [[F_SYM, 'φ', 0, 0]],
  /*  7 Ie1   */ [[F_FR, 'I', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '1', 0, 3]],
  /*  8 Ie2   */ [[F_FR, 'I', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '2', 0, 3]],
  /*  9 Ze1   */ [[F_FR, 'Z', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '1', 0, 3]],
  /* 10 Ze2   */ [[F_FR, 'Z', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '2', 0, 3]],
  /* 11 Ie3 = Ze3 */ [
    [F_FR, 'I', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '3', 0, 3],
    [F_UP, '=', 7, 0],
    [F_FR, 'Z', 7, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '3', 0, 3],
  ],
  /* 12 We1   */ [[F_FR, 'W', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '1', 0, 3]],
  /* 13 We2   */ [[F_FR, 'W', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '2', 0, 3]],
  /* 14 We3   */ [[F_FR, 'W', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '3', 0, 3]],
  /* 15 S1    */ [[F_UP, 'S', 0, 0], [F_SUB, '1', 0, 4]],
  /* 16 m1    */ [[F_SYM, 'm', 0, 0], [F_SUB, '1', 0, 5]],
  /* 17 a/2 L */ [[F_SYM, 'a', 0, 0], [F_UP, '/2', 0, 0]],
  /* 18 a/2 R */ [[F_SYM, 'a', 0, 0], [F_UP, '/2', 0, 0]],
  /* 19 h     */ [[F_SYM, 'h', 0, 0]],
  /* 20 k1    */ [[F_SYM, 'k', 0, 0], [F_SUB, '1', 1, 4]],
  /* 21 c1    */ [[F_SYM, 'c', 0, 0], [F_SUB, '1', 1, 4]],
  /* 22 k2    */ [[F_SYM, 'k', 0, 0], [F_SUB, '2', 1, 4]],
  /* 23 x     */ [[F_SYM, 'x', 0, 0]],
  /* 24 psi   */ [[F_SYM, 'ψ', 0, 0]],
  /* 25 y     */ [[F_SYM, 'y', 0, 0]],
  /* 26 b     */ [[F_SYM, 'b', 0, 0]],
  /* 27 R     */ [[F_SYM, 'R', 0, 0]],
  /* 28 M     */ [[F_UP, 'M', 0, 0]],
  /* 29 S2    */ [[F_UP, 'S', 0, 0], [F_SUB, '2', 0, 4]],
  /* 30 S3    */ [[F_UP, 'S', 0, 0], [F_SUB, '3', 0, 4]],
  /* 31 m3    */ [[F_SYM, 'm', 0, 0], [F_SUB, '3', 0, 5]],
  /* 32 Ke1   */ [[F_FR, 'K', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '1', 0, 3]],
  /* 33 Ke2   */ [[F_FR, 'K', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '2', 0, 3]],
  /* 34 Ke3   */ [[F_FR, 'K', 0, 3], [F_VEC, 'e', 1, 0], [F_ARROW], [F_SUB, '3', 0, 3]],
  /* 35 m2, K J2^(S2) */ [
    [F_SYM, 'm', 0, 0], [F_SUB, '2', 0, 6], [F_UP, ',', 1, 0],
    [F_FR, 'K', 6, 3], [F_BOLD, 'J', 1, 0], [F_SUB, '2', 1, 8],
    [F_SUP, '(S', 0, -11, 1], [F_SUB2, '2', 0, -8], [F_SUP, ')', 1, -11],
  ],
  /* 36-40 circled digits */ [[F_UP, '1', 0, 0]], [[F_UP, '2', 0, 0]], [[F_UP, '3', 0, 0]],
  [[F_UP, '4', 0, 0]], [[F_UP, '5', 0, 0]],
];
const RD_NL = RD_LABELS.length;
// Laid-out runs, flat: per run [font, x, dy, w] (w = arrow width for F_ARROW), plus the label width.
const RD_RUNX = [];
const RD_LW = new Float32Array(RD_NL);
let rdLaidOut = -1;
let rdFontGen = 0;
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', () => {
    rdFontGen++;
  });
}

function rdLayout(ctx) {
  RD_RUNX.length = 0;
  for (let i = 0; i < RD_NL; i++) {
    const runs = RD_LABELS[i];
    const xs = [];
    let x = 0;
    let lastX = 0;
    let lastW = 0;
    let right = 0;
    for (let j = 0; j < runs.length; j++) {
      const r = runs[j];
      if (r[0] === F_ARROW) {
        xs.push(lastX, lastW);
        continue;
      }
      ctx.font = RD_FONTS[r[0]];
      const w = ctx.measureText(r[1]).width;
      const x0 = r[4] ? lastX : x + r[2];
      xs.push(x0, w);
      lastX = x0;
      lastW = w;
      x = x0 + w;
      if (x > right) right = x;
    }
    RD_RUNX.push(xs);
    RD_LW[i] = right;
  }
  rdLaidOut = rdFontGen;
}

// ---- per-frame state (module scratch, no allocation in the frame loop) --------------------------
let rdCtx = null;
let rdInkCss = '';
let rdPaperCss = '';
const rdInkKey = [-1, -1, -1, -1];
const rdPaperKey = [-1, -1, -1, -1];
let rdMx = 0, rdMy = 0, rdE1x = 1, rdE1y = 0, rdE2x = 0, rdE2y = -1; //  K frame at the hub
let rdBx = 0, rdBy = 0; //                                                block centre S3
let rdZ1x = 1, rdZ1y = 0, rdZ2x = 0, rdZ2y = -1; //                       Z frame at O
let rdLx = 0, rdLy = 1; //                                                link direction (down)
let rdOutX = 0, rdOutY = 0; //                                            point helpers' output

function rdColor(key, c) {
  if (key[0] === c[0] && key[1] === c[1] && key[2] === c[2] && key[3] === c[3]) return false;
  key[0] = c[0];
  key[1] = c[1];
  key[2] = c[2];
  key[3] = c[3];
  return true;
}

// K-frame point: M + s e1 + n e2 (e2 = e1 turned 90 deg counter-clockwise on screen).
function rdK(s, n) {
  rdOutX = rdMx + s * rdE1x + n * rdE2x;
  rdOutY = rdMy + s * rdE1y + n * rdE2y;
}
// Block-relative point in the K frame.
function rdB(s, n) {
  rdOutX = rdBx + s * rdE1x + n * rdE2x;
  rdOutY = rdBy + s * rdE1y + n * rdE2y;
}
// Link-frame point from pivot (px, py): s along the link (down), n to its right.
function rdL(px, py, s, n) {
  rdOutX = px + s * rdLx + n * rdLy;
  rdOutY = py + s * rdLy - n * rdLx;
}

// ---- primitives ---------------------------------------------------------------------------------
// Straight line from (x0,y0), drawn to fraction t.
function rdLine(x0, y0, x1, y1, t) {
  if (t <= 0) return;
  const c = rdCtx;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  c.stroke();
}

// Open arrowhead (two barbs) with its tip at (x, y), pointing along (ux, uy) (unit).
function rdHead(x, y, ux, uy, len, half, k) {
  if (k <= 0) return;
  const c = rdCtx;
  const l = len * k;
  const h = half * k;
  c.beginPath();
  c.moveTo(x - ux * l - uy * h, y - uy * l + ux * h);
  c.lineTo(x, y);
  c.lineTo(x - ux * l + uy * h, y - uy * l - ux * h);
  c.stroke();
}

// Arrow from (x0,y0) to (x1,y1), grown to fraction t, head riding on the tip.
// both: also a head at the start (dimension line).
function rdArrow(x0, y0, x1, y1, t, len, half, both) {
  if (t <= 0) return;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const tx = x0 + dx * t;
  const ty = y0 + dy * t;
  const c = rdCtx;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(tx - ux * 1.2, ty - uy * 1.2);
  c.stroke();
  const k = t < 0.25 ? t * 4 : 1;
  rdHead(tx, ty, ux, uy, len, half, k);
  if (both) rdHead(x0, y0, -ux, -uy, len, half, k);
}

// Circle arc (canvas angles, y down), drawn from a0 towards a1 to fraction t.
function rdArc(cx, cy, r, a0, a1, t) {
  if (t <= 0) return;
  const c = rdCtx;
  c.beginPath();
  c.arc(cx, cy, r, a0, a0 + (a1 - a0) * t, a1 < a0);
  c.stroke();
}

function rdDot(x, y, r, t) {
  if (t <= 0) return;
  const c = rdCtx;
  c.beginPath();
  c.arc(x, y, r * (t < 1 ? 0.35 + 0.65 * t : 1), 0, TAU);
  c.fill();
}

// Zigzag spring along (ux, uy) from (x0, y0): `half` half-periods of amplitude `amp`
// (first swing to the -normal side), starting and ending on the axis; drawn to fraction t.
function rdZigzag(x0, y0, ux, uy, len, amp, half, t) {
  if (t <= 0) return;
  const c = rdCtx;
  const nx = -uy; // screen normal; first swing goes to +n (see callers)
  const ny = ux;
  const q = len / (2 * half); // quarter period
  const stop = len * t;
  c.beginPath();
  c.moveTo(x0, y0);
  let s = 0;
  let side = 1;
  let ps = 0;
  let pn = 0;
  for (let i = 0; i <= half; i++) {
    const ns = i === 0 ? q : i === half ? len : s + 2 * q;
    const nn = i === half ? 0 : amp * side;
    if (ns >= stop) {
      const f = (stop - ps) / (ns - ps || 1);
      const ss = ps + (ns - ps) * f;
      const sn = pn + (nn - pn) * f;
      c.lineTo(x0 + ux * ss + nx * sn, y0 + uy * ss + ny * sn);
      break;
    }
    c.lineTo(x0 + ux * ns + nx * nn, y0 + uy * ns + ny * nn);
    ps = ns;
    pn = nn;
    s = ns;
    side = -side;
  }
  c.stroke();
}

// Label i, centred at x, baseline y, at opacity a (multiplies the current alpha).
function rdText(i, x, y, a) {
  if (a <= 0) return;
  const c = rdCtx;
  const runs = RD_LABELS[i];
  const xs = RD_RUNX[i];
  const x0 = x - RD_LW[i] / 2;
  const ga = c.globalAlpha;
  c.globalAlpha = ga * (a > 1 ? 1 : a);
  let font = -2;
  for (let j = 0; j < runs.length; j++) {
    const r = runs[j];
    const rx = x0 + xs[2 * j];
    if (r[0] === F_ARROW) {
      // \vec over the e just before: thin shaft and a small barbed head
      const w = xs[2 * j + 1];
      const ay = y - 21;
      const ax0 = rx + w * 0.22;
      const ax1 = rx + w + 4;
      c.lineWidth = 1.1;
      c.beginPath();
      c.moveTo(ax0, ay);
      c.lineTo(ax1, ay);
      c.moveTo(ax1 - 4.5, ay - 3);
      c.lineTo(ax1, ay);
      c.lineTo(ax1 - 4.5, ay + 3);
      c.stroke();
      continue;
    }
    if (r[0] !== font) {
      font = r[0];
      c.font = RD_FONTS[font];
    }
    c.fillText(r[1], rx, y + r[3]);
  }
  c.globalAlpha = ga;
}

// Circled number (label 36 + k - 1) at (x, y): circle draws in, digit fades in.
function rdCircled(k, x, y, t) {
  if (t <= 0) return;
  const c = rdCtx;
  c.lineWidth = RD_W_THIN + 0.1;
  rdArc(x, y, 17.5, -Math.PI / 2, -Math.PI / 2 + TAU, t);
  rdText(35 + k, x, y + 9.5, (t - 0.4) / 0.6);
}

// Leader from the rim of a circled number at (cx, cy) to (x, y).
function rdLeader(cx, cy, x, y, t) {
  if (t <= 0) return;
  const dx = x - cx;
  const dy = y - cy;
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  rdLine(cx + (dx / L) * 17.5, cy + (dy / L) * 17.5, x, y, t);
}

// Archimedean spiral of the torsion spring k_phi round (ax, ay), rigid with the link whose
// direction on screen has math angle `al` (rad, counter-clockwise, y up). Radius r = 23.74 +
// 0.0511 * beta (beta in degrees from the link direction), beta from -300 to +340.
function rdSpiral(ax, ay, al, t) {
  if (t <= 0) return;
  const c = rdCtx;
  const b0 = -300;
  const b1 = 340;
  const bt = b0 + (b1 - b0) * t;
  const DEG = Math.PI / 180;
  c.beginPath();
  for (let b = b0; ; b += 6) {
    const bb = b > bt ? bt : b;
    const r = 23.74 + 0.0511 * bb;
    const a = al + bb * DEG;
    const x = ax + r * Math.cos(a);
    const y = ay - r * Math.sin(a);
    if (bb === b0) c.moveTo(x, y);
    else c.lineTo(x, y);
    if (bb >= bt) break;
  }
  c.stroke();
  if (t >= 1) {
    // filled wedge joining the spiral's outer end to the link
    const ae = al - 20 * DEG;
    const re = 23.74 + 0.0511 * 340;
    const ca = Math.cos(al);
    const sa = Math.sin(al);
    c.beginPath();
    c.moveTo(ax + (re + 1.5) * Math.cos(ae), ay - (re + 1.5) * Math.sin(ae));
    c.lineTo(ax + (re - 2) * Math.cos(ae + 2 * DEG), ay - (re - 2) * Math.sin(ae + 2 * DEG));
    c.lineTo(ax + 27 * ca, ay - 27 * sa);
    c.lineTo(ax + 52 * ca, ay - 52 * sa);
    c.closePath();
    c.fill();
  }
}

// ---- the figure ---------------------------------------------------------------------------------
function drawReel(ctx, d, pose, C, opts) {
  if (!(d > 0)) return;
  if (d > 1) d = 1;
  rdCtx = ctx;
  if (rdLaidOut !== rdFontGen) rdLayout(ctx);
  if (rdColor(rdInkKey, C.ink)) rdInkCss = css(C.ink);
  if (rdColor(rdPaperKey, C.paper)) rdPaperCss = css(C.paper);
  const ink = rdInkCss;
  const paper = rdPaperCss;

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 6;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.setLineDash(RD_NODASH);

  const E = easeOut;
  const PI = Math.PI;
  const R = REEL.R;
  const Ax = REEL.A[0];
  const Ay = REEL.A[1];
  const Ox = REEL.O[0];
  const Oy = REEL.O[1];
  const cy = REEL.ceilingY;
  const phi = pose.phi;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const Wx = pose.Wx;
  const Wy = pose.Wy;
  const Ex = pose.Ex;
  const Ey = pose.Ey;
  const S1x = pose.S1x;
  const S1y = pose.S1y;
  const barT = S1y - REEL.barHalf; //  platform top line
  const barB = S1y + REEL.barHalf;
  rdMx = pose.Mx;
  rdMy = pose.My;
  rdE1x = pose.e1x;
  rdE1y = pose.e1y;
  rdE2x = pose.e2x;
  rdE2y = pose.e2y;
  rdBx = pose.Bx;
  rdBy = pose.By;
  rdZ1x = cp;
  rdZ1y = -sp;
  rdZ2x = -sp;
  rdZ2y = -cp;
  rdLx = sp;
  rdLy = cp;
  const Mx = rdMx;
  const My = rdMy;
  const e1x = rdE1x, e1y = rdE1y, e2x = rdE2x, e2y = rdE2y;
  const psi = pose.psi;
  const yR = pose.y * R;
  let t;

  // ===== 0.00-0.30 ceiling, supports, pivots A and O, k_phi, N. N. line, links 4 and 5 =========
  ctx.lineWidth = RD_W_THICK;
  t = E(seg(d, 0, 0.1));
  rdLine(REEL.ceilingX0, cy, REEL.ceilingX1, cy, t);
  ctx.lineWidth = RD_W_THIN + 0.15;
  for (let k = 0; k < 20; k++) {
    const t0 = 0.03 + 0.004 * k;
    t = E(seg(d, t0, t0 + 0.05));
    const hx = 170 + 49.07 * k;
    rdLine(hx, cy, hx + 19.5, cy - 19.5, t);
  }
  // dash-dot N. N. line through both pivots, pattern anchored at A
  ctx.lineWidth = RD_W_THIN;
  ctx.setLineDash(RD_DASHDOT);
  t = E(seg(d, 0.06, 0.22));
  rdLine(Ax, Ay, Ox, Oy, t);
  ctx.setLineDash(RD_NODASH);
  // V struts from each pivot to the ceiling
  ctx.lineWidth = 3.6;
  t = E(seg(d, 0.08, 0.15));
  rdLine(Ax, Ay, Ax - 23.1, cy, t);
  rdLine(Ax, Ay, Ax + 23.1, cy, t);
  rdLine(Ox, Oy, Ox - 23.9, cy, t);
  rdLine(Ox, Oy, Ox + 23.9, cy, t);
  // links 4 and 5
  ctx.lineWidth = RD_W_HEAVY;
  t = E(seg(d, 0.15, 0.3));
  rdLine(Ax, Ay, Wx, Wy, t);
  rdLine(Ox, Oy, Ex, Ey, t);
  // torsion spring k_phi: rigid with link 4
  ctx.lineWidth = 3.7;
  t = E(seg(d, 0.12, 0.27));
  rdSpiral(Ax, Ay, Math.atan2(-cp, sp), t);
  // pivot A: pin ring with a paper hole
  t = E(seg(d, 0.1, 0.17));
  if (t > 0) {
    ctx.fillStyle = paper;
    ctx.beginPath();
    ctx.arc(Ax, Ay, 6 * t, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.lineWidth = RD_W_THICK;
    rdArc(Ax, Ay, 8, PI, PI + TAU, t);
    // pivot O: double ring
    ctx.lineWidth = 3.5;
    rdArc(Ox, Oy, 14.5, PI, PI + TAU, t);
    ctx.lineWidth = 3;
    rdArc(Ox, Oy, 7, PI, PI + TAU, t);
    if (t >= 1) {
      ctx.strokeStyle = paper;
      ctx.lineWidth = 1.2;
      rdArc(Ox, Oy, 3.2, 0.9, TAU - 0.9, 1);
      ctx.strokeStyle = ink;
    }
  }

  // ===== 0.15-0.45 platform 1, W frame, post ====================================================
  // bar: two lines from the W pivot ring to a chamfer into the pin circle at E
  ctx.lineWidth = RD_W_THICK;
  t = E(seg(d, 0.15, 0.33));
  if (t > 0) {
    const xa = Wx + 9.4;
    const xb = Ex - 10;
    const L = xb - xa;
    const run = (L + 6) * t;
    ctx.beginPath();
    ctx.moveTo(xa, barT);
    ctx.lineTo(xa + (run < L ? run : L), barT);
    if (run > L) ctx.lineTo(xb + (Ex - 4.6 - xb) * ((run - L) / 6), barT + 4.4 * ((run - L) / 6));
    ctx.moveTo(xa, barB);
    ctx.lineTo(xa + (run < L ? run : L), barB);
    if (run > L) ctx.lineTo(xb + (Ex - 4.6 - xb) * ((run - L) / 6), barB - 4.4 * ((run - L) / 6));
    ctx.stroke();
  }
  // W pivot (origin of W, link-4 pivot): double ring
  t = E(seg(d, 0.15, 0.23));
  if (t > 0) {
    ctx.lineWidth = 3.5;
    rdArc(Wx, Wy, 14.5, PI, PI + TAU, t);
    ctx.lineWidth = 3;
    rdArc(Wx, Wy, 7, PI, PI + TAU, t);
    if (t >= 1) {
      ctx.strokeStyle = paper;
      ctx.lineWidth = 1.2;
      rdArc(Wx, Wy, 3.2, 0.9, TAU - 0.9, 1);
      ctx.strokeStyle = ink;
    }
  }
  // E: small open circle
  t = E(seg(d, 0.28, 0.35));
  if (t > 0) {
    ctx.fillStyle = paper;
    ctx.beginPath();
    ctx.arc(Ex, Ey, 7.3 * t, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.lineWidth = 3.5;
    rdArc(Ex, Ey, 7.3, PI, PI + TAU, t);
  }
  // post with its triangular foot
  const postX = S1x + REEL.postX;
  const postTop = barT - REEL.postH;
  t = E(seg(d, 0.22, 0.29));
  if (t > 0) {
    ctx.globalAlpha = t;
    ctx.beginPath();
    ctx.moveTo(postX - 15, barT);
    ctx.lineTo(postX + 15, barT);
    ctx.lineTo(postX, barT - 17);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = RD_W_HEAVY;
  t = E(seg(d, 0.25, 0.37));
  rdLine(postX, barT - 1, postX, postTop, t);
  // W frame arrows
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.33, 0.45));
  rdArrow(Wx, Wy, Wx + 100, Wy, t, 14, 8);
  rdArrow(Wx, Wy, Wx, Wy - 99, t, 14, 8);
  ctx.lineCap = 'butt';

  // ===== 0.30-0.60 spring k1 + damper c1 (post to hub), spring k2 (hub to block) ================
  const cL = postX + 25; //       connector at the post
  const cR = Mx - 74.5; //        connector at the hub
  const yU = My - 38.7; //        upper branch (k1)
  const yD = My + 40.5; //        lower branch (c1)
  const span = cR - cL;
  ctx.lineWidth = RD_W_MED;
  t = E(seg(d, 0.3, 0.35));
  rdLine(postX + 4, My + 0.5, cL, My + 0.5, t);
  t = E(seg(d, 0.34, 0.4));
  rdLine(cL, My + 0.5, cL, yU, t);
  rdLine(cL, My + 0.5, cL, yD, t);
  // k1: lead-in, 4 periods, lead-out (all scale with the connector span)
  const k1a = cL + 0.205 * span;
  const k1b = cL + 0.76 * span;
  t = seg(d, 0.39, 0.55);
  if (t > 0) {
    const L1 = k1a - cL;
    const L2 = k1b - k1a;
    const L3 = cR - k1b;
    const run = (L1 + L2 + L3) * E(t);
    rdLine(cL, yU, k1a, yU, run >= L1 ? 1 : run / L1);
    if (run > L1) rdZigzag(k1a, yU, 1, 0, L2, -12.5, 8, run >= L1 + L2 ? 1 : (run - L1) / L2);
    if (run > L1 + L2) rdLine(k1b, yU, cR, yU, (run - L1 - L2) / L3);
  }
  // c1: piston rod and plate from the post side, cylinder from the hub side
  const pX = cL + 0.5 * span;
  const cyl0 = cL + 0.302 * span;
  const cyl1 = cL + 0.698 * span;
  t = E(seg(d, 0.41, 0.53));
  rdLine(cL, yD, pX, yD, t);
  rdLine(cR, yD, cyl1, yD, t);
  t = E(seg(d, 0.47, 0.57));
  rdLine(pX, yD - 11, pX, yD + 11, t);
  rdLine(cyl1, yD - 20, cyl1, yD + 20, t);
  rdLine(cyl1, yD - 20, cyl0, yD - 20, t);
  rdLine(cyl1, yD + 20, cyl0, yD + 20, t);
  // connector at the hub, and the line to M
  t = E(seg(d, 0.5, 0.56));
  rdLine(cR, My, cR, yU, t);
  rdLine(cR, My, cR, yD, t);
  t = E(seg(d, 0.53, 0.6));
  rdLine(cR, My, Mx - 13, My, t);
  // k2 in the slot: axis line from the hub ring to the block's inner face, zigzag on it
  const sF = yR - REEL.block / 2;
  const k2a = 13 + 0.137 * (sF - 13);
  const k2b = 13 + 0.866 * (sF - 13);
  t = E(seg(d, 0.42, 0.6));
  if (t > 0) {
    ctx.lineWidth = 3.4;
    rdK(13, -1.2);
    const x0 = rdOutX;
    const y0 = rdOutY;
    rdK(sF, -1.2);
    rdLine(x0, y0, rdOutX, rdOutY, t);
    ctx.lineWidth = RD_W_MED;
    const ts = (13 + (sF - 13) * t - k2a) / (k2b - k2a);
    if (ts > 0) {
      rdK(k2a, -1.2);
      // first swing towards -e2; on screen the zigzag normal (-uy, ux) is -e2 for u = e1
      rdZigzag(rdOutX, rdOutY, e1x, e1y, k2b - k2a, 22, 8, ts > 1 ? 1 : ts);
    }
  }

  // ===== 0.45-0.75 frames I and Z at O, phi indicator, g, dashed / dash-dot lines, K arrows =====
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.45, 0.56));
  rdArrow(Ox, Oy, Ox + 101, Oy, t, 14, 8);
  rdArrow(Ox, Oy, Ox, Oy - 101, t, 14, 8);
  t = E(seg(d, 0.5, 0.61));
  rdArrow(Ox, Oy, Ox + 100 * rdZ1x, Oy + 100 * rdZ1y, t, 14, 8);
  rdArrow(Ox, Oy, Ox + 100 * rdZ2x, Oy + 100 * rdZ2y, t, 14, 8);
  ctx.lineCap = 'butt';
  // phi indicator: reference line, ray at phi from O, arc arrow round O from the dot to the ray
  ctx.lineWidth = RD_W_THIN;
  t = E(seg(d, 0.52, 0.58));
  rdLine(Ox + 139.5, Oy, Ox + 247.5, Oy, t);
  t = E(seg(d, 0.55, 0.62));
  rdLine(Ox + 140 * rdZ1x, Oy + 140 * rdZ1y, Ox + 248 * rdZ1x, Oy + 248 * rdZ1y, t);
  t = E(seg(d, 0.57, 0.62));
  rdDot(Ox + 198.5, Oy, 6.5, t);
  t = E(seg(d, 0.6, 0.69));
  if (t > 0) {
    const rA = 198.5;
    ctx.lineWidth = RD_W_THICK;
    const a1 = -phi * t;
    const back = (phi > 0 ? 1 : -1) * Math.min(Math.abs(phi * t), 2.2 / rA);
    rdArc(Ox, Oy, rA, 0, a1 + back, 1);
    ctx.lineCap = 'round';
    const tx = Ox + rA * Math.cos(a1);
    const ty = Oy + rA * Math.sin(a1);
    const sg = phi >= 0 ? -1 : 1; // travel direction of the arc at its end
    const ux = -Math.sin(a1) * sg;
    const uy = Math.cos(a1) * sg;
    const k = Math.min(1, (Math.abs(phi) * rA) / 16);
    rdHead(tx, ty, ux, uy, 13 * k, 7 * k, t < 0.25 ? t * 4 : 1);
    ctx.lineCap = 'butt';
  }
  // g
  t = E(seg(d, 0.45, 0.55));
  if (t > 0) {
    ctx.lineWidth = RD_W_THICK;
    const yt = 161 + (220 - 161) * t;
    rdLine(90.5, 161, 90.5, Math.min(yt, 203), 1);
    ctx.beginPath();
    ctx.moveTo(84, yt - 18);
    ctx.lineTo(97, yt - 18);
    ctx.lineTo(92.6, yt);
    ctx.lineTo(88.4, yt);
    ctx.closePath();
    ctx.fill();
  }
  // dashed verticals through S1 (platform top to y 146) and through M (hub ring to y 141)
  ctx.lineWidth = RD_W_THIN;
  ctx.setLineDash(RD_DASH);
  t = E(seg(d, 0.48, 0.63));
  if (t > 0) {
    let L = barT - 2 - 146;
    ctx.lineDashOffset = 10 - (L % 16);
    rdLine(S1x, barT - 2, S1x, 146, t);
    L = My - 13 - 141;
    ctx.lineDashOffset = 10 - (L % 16);
    rdLine(Mx, My - 13, Mx, 141, t);
    ctx.lineDashOffset = 0;
  }
  // dash-dot: K e1 axis from M back through S2, and M to S1
  ctx.setLineDash(RD_DASHDOT);
  t = E(seg(d, 0.55, 0.68));
  if (t > 0) {
    rdK(-13, -1.2);
    const x0 = rdOutX;
    const y0 = rdOutY;
    rdK(-222, -1.2);
    rdLine(x0, y0, rdOutX, rdOutY, t);
    const dx = S1x - Mx;
    const dy = S1y - My;
    const L = Math.sqrt(dx * dx + dy * dy) || 1;
    rdLine(Mx + (dx / L) * 13, My + (dy / L) * 13, S1x, S1y, t);
  }
  ctx.setLineDash(RD_NODASH);
  // K e2 from the hub ring through P, K e1 from the block centre
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.6, 0.75));
  if (t > 0) {
    rdK(0.5, 13);
    const x0 = rdOutX;
    const y0 = rdOutY;
    rdK(0.5, 222);
    rdArrow(x0, y0, rdOutX, rdOutY, t, 14, 8);
  }
  t = E(seg(d, 0.62, 0.73));
  if (t > 0) {
    rdB(95, -1.2);
    rdArrow(rdBx - 1.2 * e2x, rdBy - 1.2 * e2y, rdOutX, rdOutY, t, 14, 8);
  }
  ctx.lineCap = 'butt';

  // ===== 0.60-0.90 dimensions: a/2 a/2, h, x, psi, y, b, R ======================================
  ctx.lineWidth = RD_W_THIN;
  t = E(seg(d, 0.6, 0.67));
  rdLine(Wx, Wy + 25, Wx, Wy + 108, t);
  rdLine(S1x, Wy + 20, S1x, Wy + 108, t);
  rdLine(Ex, Wy + 15, Ex, Wy + 108, t);
  ctx.lineWidth = 3.1;
  ctx.lineCap = 'round';
  const yDim = Wy + 98;
  t = E(seg(d, 0.63, 0.76));
  if (t > 0) {
    // each half grows out from its middle
    const mL = (Wx + S1x) / 2;
    const mR = (S1x + Ex) / 2;
    rdArrow(mL, yDim, Wx + 1, yDim, t, 12, 6.5);
    rdArrow(mL, yDim, S1x - 1, yDim, t, 12, 6.5);
    rdArrow(mR, yDim, S1x + 1, yDim, t, 12, 6.5);
    rdArrow(mR, yDim, Ex - 1, yDim, t, 12, 6.5);
  }
  // h: thin S1 centre line to the right, two small arrows at the bar top and the centre line
  ctx.lineWidth = RD_W_THIN;
  ctx.lineCap = 'butt';
  t = E(seg(d, 0.66, 0.74));
  rdLine(S1x + 12.5, S1y - 0.5, S1x + 148.5, S1y - 0.5, t);
  const hX = S1x + 123.5;
  rdLine(hX, barT - 22, hX, barB + 11, t);
  t = E(seg(d, 0.7, 0.76));
  if (t > 0) {
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    rdHead(hX, barT, 0, 1, 10, 6.5, t);
    rdHead(hX, S1y, 0, -1, 8, 5.5, t);
    ctx.lineCap = 'butt';
  }
  // x: tick and dot on the S1 line, arrow to the dot on the M line
  const yX = My - 148;
  ctx.lineWidth = RD_W_THICK;
  t = E(seg(d, 0.67, 0.72));
  rdLine(S1x, yX, S1x, yX - 22.5, t);
  rdLine(S1x, yX, S1x, yX + 22.5, t);
  rdDot(S1x, yX, 6, t);
  t = E(seg(d, 0.69, 0.79));
  if (t > 0) {
    ctx.lineCap = 'round';
    const dir = Mx >= S1x ? 1 : -1;
    if (Math.abs(Mx - S1x) > 3) rdArrow(S1x, yX, Mx - dir * 2, yX, t, 13, 7.5);
    ctx.lineCap = 'butt';
    rdDot(Mx, yX, 6.5, t > 0.85 ? (t - 0.85) / 0.15 : 0);
  }
  // psi: arc of radius 148 round M from the vertical to the K e2 axis
  t = E(seg(d, 0.72, 0.81));
  if (t > 0 && Math.abs(psi) > 0.004) {
    const rP = 148;
    const a0 = -PI / 2; // canvas angle of straight up
    const a1 = a0 - psi * t; // psi > 0: counter-clockwise on screen
    const sg = psi > 0 ? -1 : 1;
    const back = sg * Math.min(Math.abs(psi * t), 2 / rP);
    rdArc(Mx, My, rP, a0, a1 - back, 1);
    ctx.lineCap = 'round';
    const k = Math.min(1, (Math.abs(psi) * rP) / 16);
    rdHead(Mx + rP * Math.cos(a1), My + rP * Math.sin(a1), -Math.sin(a1) * sg, Math.cos(a1) * sg, 13 * k, 7.5 * k, t < 0.25 ? t * 4 : 1);
    ctx.lineCap = 'butt';
  }
  // extension lines for b (through S2) and y (at the block's inner face)
  ctx.lineWidth = RD_W_THIN;
  t = E(seg(d, 0.72, 0.8));
  if (t > 0) {
    rdK(-REEL.b * R + 1.5, 9);
    const x0 = rdOutX;
    const y0 = rdOutY;
    rdK(-REEL.b * R + 1.5, 69);
    rdLine(x0, y0, rdOutX, rdOutY, t);
    rdK(sF + 0.5, REEL.block / 2 + 1);
    const x1 = rdOutX;
    const y1 = rdOutY;
    rdK(sF + 0.5, 69);
    rdLine(x1, y1, rdOutX, rdOutY, t);
  }
  // y: from P along e1 to the block-face extension line; b: from the S2 line to P, both heads
  const nP = 0.31 * R;
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.74, 0.84));
  if (t > 0) {
    rdK(sF + 0.5, nP);
    rdArrow(pose.Px, pose.Py, rdOutX, rdOutY, t, 13, 7.5);
  }
  t = E(seg(d, 0.76, 0.86));
  if (t > 0) {
    rdK(-REEL.b * R + 1.5, nP);
    const x0 = rdOutX;
    const y0 = rdOutY;
    const mx = (x0 + pose.Px) / 2;
    const my = (y0 + pose.Py) / 2;
    rdArrow(mx, my, x0, y0, t, 13, 7.5);
    rdArrow(mx, my, pose.Px, pose.Py, t, 13, 7.5);
  }
  ctx.lineCap = 'butt';
  t = E(seg(d, 0.74, 0.8));
  rdDot(pose.Px, pose.Py, 6, t);
  // R: from the hub ring to the rim, rigid with the disk
  ctx.lineWidth = RD_W_MED;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.78, 0.9));
  if (t > 0) {
    const cb = -0.5; // cos 240
    const sb = -0.8660254; // sin 240
    rdK(13 * cb, 13 * sb);
    const x0 = rdOutX;
    const y0 = rdOutY;
    rdK((R - 1.5) * cb, (R - 1.5) * sb);
    rdArrow(x0, y0, rdOutX, rdOutY, t, 14, 7.5);
  }
  ctx.lineCap = 'butt';

  // ===== 0.75-1.00 labels, circled numbers with leaders, S1 / S2 / S3 dots ======================
  if (d > 0.75) {
    const la = (i) => seg(d, 0.75 + 0.2 * (i / 44), 0.8 + 0.2 * (i / 44));
    // leaders (thin), drawn in from the labelled body
    ctx.lineWidth = RD_W_THIN;
    let a;
    // circled numbers
    // 1: platform
    a = seg(d, 0.77, 0.86);
    rdCircled(1, Wx + 165.5, Wy + 44, a);
    rdLeader(Wx + 165.5, Wy + 44, Wx + 208.5, Wy, seg(d, 0.8, 0.88));
    // 4: link 4 (link frame from A)
    rdL(Ax, Ay, 124.3, 74);
    const c4x = rdOutX, c4y = rdOutY;
    rdCircled(4, c4x, c4y, seg(d, 0.78, 0.87));
    rdL(Ax, Ay, 198, 0);
    rdLeader(c4x, c4y, rdOutX, rdOutY, seg(d, 0.81, 0.89));
    // 5: link 5
    rdL(Ox, Oy, 321.6, 75.1);
    const c5x = rdOutX, c5y = rdOutY;
    rdCircled(5, c5x, c5y, seg(d, 0.79, 0.88));
    rdL(Ox, Oy, 394, 0);
    rdLeader(c5x, c5y, rdOutX, rdOutY, seg(d, 0.82, 0.9));
    // 2: disk
    rdK(-186.3, 185.3);
    const c2x = rdOutX, c2y = rdOutY;
    rdCircled(2, c2x, c2y, seg(d, 0.8, 0.89));
    rdK(-86.5, 85.2);
    rdLeader(c2x, c2y, rdOutX, rdOutY, seg(d, 0.83, 0.91));
    // 3: block
    rdB(87.2, -88.7);
    const c3x = rdOutX, c3y = rdOutY;
    rdCircled(3, c3x, c3y, seg(d, 0.81, 0.9));
    rdB(21, -16.9);
    rdLeader(c3x, c3y, rdOutX, rdOutY, seg(d, 0.84, 0.92));

    // plain leaders
    t = seg(d, 0.84, 0.94);
    if (t > 0) {
      // I e3 = Z e3 from O
      rdLine(Ox + 13.7, Oy + 8.3, Ox + 122.5, Oy + 73.5, t);
      // S1
      rdLine(S1x - 7, S1y + 5.5, S1x - 38.5, S1y + 37, t);
      // m1
      rdLine(Ex - 121.5, Ey + 1, Ex - 83.5, Ey + 38, t);
      // M
      rdK(13 * 0.309, -13 * 0.951);
      let x0 = rdOutX, y0 = rdOutY;
      rdK(122.5 * 0.309, -122.5 * 0.951);
      rdLine(x0, y0, rdOutX, rdOutY, t);
      // m2, K J2
      rdK(96.5, 90.6);
      x0 = rdOutX;
      y0 = rdOutY;
      rdK(187, 184.8);
      rdLine(x0, y0, rdOutX, rdOutY, t);
      // S3 from the block centre
      rdB(63, 102.4);
      rdLine(rdBx, rdBy, rdOutX, rdOutY, t);
      // m3 from inside the block
      rdB(30.6, 15.3);
      x0 = rdOutX;
      y0 = rdOutY;
      rdB(144, 41);
      rdLine(x0, y0, rdOutX, rdOutY, t);
    }

    // dots S1, S2, S3
    t = E(seg(d, 0.76, 0.84));
    rdDot(S1x, S1y, 6.5, t);
    rdDot(pose.S2x, pose.S2y, 6.5, t);
    rdDot(rdBx, rdBy, 6.5, t);

    // labels
    let i = 0;
    rdText(0, 115, 192, la(i++)); //                                    g
    rdText(1, 309.5, 172, la(i++)); //                                  k_phi
    rdL(Ax, Ay, 228, -18.5);
    rdText(2, rdOutX, rdOutY + 11, la(i++)); //                         l (link 4)
    rdText(4, 908.5, 128, la(i++)); //                                  N. N.
    rdText(5, 988, 167, la(i++)); //                                    O
    rdText(6, Ox + 229 * Math.cos(phi / 2), Oy - 229 * Math.sin(phi / 2) + 6, la(i++)); // phi
    rdText(7, 1119.5, 162, la(i++)); //                                 I e1
    rdText(8, 973, 42, la(i++)); //                                     I e2
    rdText(9, Ox + 107 * rdZ1x - 26.5 * rdZ2x, Oy + 107 * rdZ1y - 26.5 * rdZ2y, la(i++)); // Z e1
    rdText(10, Ox - 34.7 * rdZ1x + 94.6 * rdZ2x, Oy - 34.7 * rdZ1y + 94.6 * rdZ2y, la(i++)); // Z e2
    rdText(11, 1142.5, 236, la(i++)); //                                I e3 = Z e3
    rdL(Ox, Oy, 223.6, 19.2);
    rdText(3, rdOutX, rdOutY + 11, la(i++)); //                         l (link 5)
    rdText(13, Wx - 34.5, Wy - 90, la(i++)); //                         W e2
    rdText(14, Wx - 30.5, Wy + 34, la(i++)); //                         W e3
    rdText(12, Wx + 106.5, Wy + 34, la(i++)); //                        W e1
    rdText(17, (Wx + S1x) / 2, Wy + 85, la(i++)); //                    a/2
    rdText(18, (S1x + Ex) / 2, Wy + 85, la(i++)); //                    a/2
    rdText(15, S1x - 50.5, S1y + 57, la(i++)); //                       S1
    rdText(16, Ex - 70.5, Ey + 61, la(i++)); //                         m1
    rdText(19, S1x + 136.5, S1y - 17, la(i++)); //                      h
    rdText(20, (k1a + k1b) / 2 - 4, yU - 22, la(i++)); //               k1
    rdText(21, pX, yD + 46, la(i++)); //                                c1
    rdText(23, (S1x + Mx) / 2, My - 161.5, la(i++)); //                 x
    rdText(24, Mx + 166 * Math.cos(PI / 2 + psi / 2), My - 166 * Math.sin(PI / 2 + psi / 2) + 7, la(i++)); // psi
    rdK(57.8, 75.6);
    rdText(25, rdOutX, rdOutY, la(i++)); //                             y
    rdK(-20.9, 65.3);
    rdText(26, rdOutX, rdOutY, la(i++)); //                             b
    rdK(-23, -94);
    rdText(27, rdOutX, rdOutY, la(i++)); //                             R
    rdK(47.9, -141.7);
    rdText(28, rdOutX, rdOutY, la(i++)); //                             M
    rdK(-28.1, -37.2);
    rdText(34, rdOutX, rdOutY, la(i++)); //                             K e3
    rdK(54.2, -65);
    rdText(22, rdOutX, rdOutY, la(i++)); //                             k2
    rdK(-REEL.b * R - 4.4, 14.7);
    rdText(29, rdOutX, rdOutY, la(i++)); //                             S2
    rdB(72.4, 113.2);
    rdText(30, rdOutX, rdOutY, la(i++)); //                             S3
    rdB(154.3, 43.9);
    rdText(31, rdOutX, rdOutY, la(i++)); //                             m3
    rdB(103.8, -35.9);
    rdText(32, rdOutX, rdOutY, la(i++)); //                             K e1
    rdK(0.5 - 35, 222 - 5.5);
    rdText(33, rdOutX, rdOutY, la(i++)); //                             K e2
    rdK(206, 200.2);
    rdText(35, rdOutX, rdOutY, la(i++)); //                             m2, K J2^(S2)
  }

  ctx.restore();
}

// ---- element.js ----------------------------------------------------------------------
// <melon-pendulum>: the custom-element shell.
//
// A sticky full-screen hero. At the top it shows a 3D watermelon slice; as the visitor scrolls,
// the slice morphs into the disk of the "Ballistic Pendulum with Disk and Mass" figure, and once
// the figure is complete the physics runs. Plain script: the build concatenates it last into one
// IIFE, so it sees the top-level names of geometry.js, reel-physics.js, melon-slice.js and
// reel-draw.js (REEL, reelPose, seg, lerp, easeOut, clamp01, css, DEFAULT_COLORS, ReelPhysics,
// drawMelon, drawReel).
//
//   <melon-pendulum hero><h1>Headline</h1></melon-pendulum>
//
// Attributes: hero, scroll-length (default 160vh), progress (0..1, overrides scroll),
//             theme (auto | light | dark), hud ("off" hides it), label (canvas accessible name).
// API:        el.progress (get/set, null = follow scroll), el.paused, el.pause(), el.play(),
//             el.reset().
//
// Everything is defined inside the guard, so loading the bundle in Node (SSR) touches nothing.
// No function declarations at block level: in a sloppy-mode classic script they would leak.

if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof HTMLElement !== 'undefined' &&
  window.customElements &&
  !window.customElements.get('melon-pendulum')
) {
  const DT = 1 / 240; //            physics step
  const MAX_STEPS = 30; //          per frame
  const MAX_DPR = 2;
  const LIVE_AT = 0.999; //         t from which the physics runs
  const RESET_AT = 0.02; //         t at or below which the state returns to the reel's first frame
  const HUD_AT = 0.92;
  // The reel's content, in reel pixels: fitted into the stage.
  const BOX_X0 = 40;
  const BOX_Y0 = 15;
  const BOX_X1 = 1275;
  const BOX_Y1 = 690;
  const BOX_H = BOX_Y1 - BOX_Y0;
  const NARROW_MAX = 640; //         below this width the figure is cropped to the swing's reach
  const FOCUS_X = REEL.sliceX; //     what the camera frames before the morph: the slice...
  const FOCUS_Y = REEL.sliceY - 30;
  const FOCUS_SIZE = 300; //         ...about this many reel pixels across
  const WIDE_MIN = 900; //          stage width from which copy and figure sit side by side
  const PHI_DRAG = 0.55; //         the pointer can pull the platform out to this angle
  const KEY_KICK = 0.6; //          rad/s per arrow key press
  // Reduced motion: extra damping while the figure coasts after a release or a key press, so it
  // settles and stops (about 4 s, within a pixel of rest). Restored once it stops.
  const RM_CPHI = 250;
  const RM_C1 = 150;

  const KEYS = ['paper', 'ink', 'shade', 'accent', 'rind', 'rindLight', 'stripe', 'flesh', 'fleshDeep', 'seed'];
  const VARS = [
    '--melon-paper', '--melon-ink', '--melon-shade', '--melon-accent', '--melon-rind',
    '--melon-rind-light', '--melon-stripe', '--melon-flesh', '--melon-flesh-deep', '--melon-seed',
  ];
  const LIGHT = ['#fafaf8', '#111111', '#bebebe', '#d9435a', '#2c6a2e', '#d6ebb0', '#9cc664', '#ee4a5a', '#c4263a', '#1b1916'];
  const DARK = ['#121212', '#ececec', '#5a5a5a', '#d9435a', '#2c6a2e', '#d6ebb0', '#9cc664', '#ee4a5a', '#c4263a', '#1b1916'];

  const DEFAULT_LABEL =
    'Ballistic pendulum with disk and mass: a platform hung on two parallel links swings, a slotted ' +
    'disk rolls on it tied by a spring and damper, and a block slides in the slot on a spring. ' +
    'Drag the platform, or press the Left and Right arrow keys, to push the swing. Space pauses.';

  const varsCss = (vals, from, to) => {
    let out = '';
    for (let i = from; i < to; i++) out += VARS[i] + ':' + vals[i] + ';';
    return out;
  };

  const TEMPLATE = document.createElement('template');
  TEMPLATE.innerHTML = `
<style>
  :host {
    ${varsCss(LIGHT, 0, VARS.length)}
    display: block;
    position: relative;
    color: var(--melon-ink);
    background: var(--melon-paper);
    -webkit-tap-highlight-color: transparent;
  }
  :host([hidden]) { display: none; }
  @media (prefers-color-scheme: dark) {
    :host(:not([theme="light"])) { ${varsCss(DARK, 0, 3)} }
  }
  :host([theme="dark"]) { ${varsCss(DARK, 0, 3)} color-scheme: dark; }
  :host([theme="light"]) { color-scheme: light; }
  @media (prefers-reduced-motion: no-preference) {
    :host([hero]) {
      height: calc(100vh + var(--melon-scroll, 160vh));
      height: calc(100svh + var(--melon-scroll, 160vh));
    }
  }
  .stage { position: relative; width: 100%; height: 100%; aspect-ratio: 16 / 9; min-height: 240px; overflow: hidden; }
  .stage.stack { aspect-ratio: 3 / 4; }
  :host([hero]) .stage { position: sticky; top: 0; height: 100vh; height: 100svh; aspect-ratio: auto; min-height: 0; }
  canvas {
    position: absolute; inset: 0; width: 100%; height: 100%; display: block;
    touch-action: pan-y; user-select: none; -webkit-user-select: none; outline: none;
  }
  canvas.grab { cursor: grab; }
  canvas.grabbing { cursor: grabbing; }
  canvas:focus-visible { outline: 2px solid var(--melon-accent); outline-offset: -6px; }
  .copy {
    position: absolute; top: 0; left: 0; box-sizing: border-box;
    max-width: min(600px, 100%); padding: clamp(20px, 5vw, 64px); pointer-events: none;
  }
  .wide .copy {
    bottom: 0; max-width: min(600px, 38%);
    display: flex; flex-direction: column; justify-content: center;
  }
  .copy ::slotted(*) { pointer-events: auto; }
  .hud {
    position: absolute; left: clamp(16px, 3vw, 32px); bottom: clamp(16px, 3vw, 32px);
    display: flex; align-items: center; gap: 12px;
    font: inherit; font-size: 13px; line-height: 1.35;
    opacity: 0; transform: translateY(6px); visibility: hidden; pointer-events: none;
    transition: opacity 200ms ease-in, transform 200ms ease-in, visibility 0s linear 200ms;
  }
  .hud.on {
    opacity: 1; transform: none; visibility: visible; pointer-events: auto;
    transition: opacity 300ms ease-out, transform 300ms ease-out, visibility 0s;
  }
  :host([hud="off"]) .hud { display: none; }
  .hint { margin: 0; opacity: 0.72; }
  .pause {
    flex: none; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; margin: 0;
    border-radius: 50%; border: 1px solid var(--melon-ink); background: transparent; color: var(--melon-ink);
    font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: background-color 150ms ease-out, transform 100ms ease-out, opacity 150ms ease-out;
  }
  @media (hover: hover) {
    .pause:hover { background: var(--melon-shade); background: color-mix(in srgb, var(--melon-ink) 12%, transparent); }
  }
  .pause:active { transform: scale(0.94); }
  .pause:focus-visible { outline: 2px solid var(--melon-accent); outline-offset: 2px; }
  .pause:disabled { opacity: 0.4; cursor: default; background: transparent; transform: none; }
  @media (pointer: coarse) { .pause { width: 40px; height: 40px; } }
  .pause svg { width: 12px; height: 12px; fill: currentColor; }
  .pause .i-play, .pause[aria-pressed="true"] .i-pause { display: none; }
  .pause[aria-pressed="true"] .i-play { display: block; }
  @media (prefers-reduced-motion: reduce) {
    .hud, .hud.on { transform: none; }
    .pause, .pause:active { transition: none; transform: none; }
  }
  .probe { display: none; }
</style>
<div class="stage" part="stage">
  <canvas part="canvas" tabindex="0" role="application" aria-roledescription="interactive diagram"></canvas>
  <div class="copy" part="copy"><slot></slot></div>
  <div class="hud" part="hud">
    <button class="pause" type="button" part="pause" aria-pressed="false" aria-label="Pause the simulation" disabled>
      <svg class="i-pause" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="2.6" height="9"/><rect x="7.4" y="1.5" width="2.6" height="9"/></svg>
      <svg class="i-play" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5 L10.5 6 L3 10.5 Z"/></svg>
    </button>
    <p class="hint" part="hint">Drag the swing.</p>
  </div>
  <span class="probe" aria-hidden="true"></span>
</div>`;

  // --- colours ------------------------------------------------------------------------------
  // Any CSS colour: the probe element resolves var(), currentColor, light-dark(), color-mix() and
  // system colours to a computed colour; rgb()/rgba() is read exactly, anything else (oklch(),
  // lab(), color(display-p3 ...)) is painted on a 1x1 canvas and read back as sRGB.

  const RGB_RE = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i;
  let pixel = null;
  const hexToRGBA = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    1,
  ];
  const toRGBA = (probe, raw, fallback) => {
    let v = raw;
    if (!v || (window.CSS && CSS.supports && !CSS.supports('color', v))) v = fallback;
    probe.style.color = v;
    const out = getComputedStyle(probe).color || v;
    const mt = RGB_RE.exec(out);
    if (mt) {
      let a = mt[4] === undefined ? 1 : +mt[4];
      if (mt[5]) a /= 100;
      return [Math.round(+mt[1]), Math.round(+mt[2]), Math.round(+mt[3]), clamp01(a)];
    }
    if (!pixel) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      pixel = c.getContext('2d', { willReadFrequently: true });
    }
    if (!pixel) return hexToRGBA(fallback);
    pixel.globalCompositeOperation = 'copy';
    pixel.fillStyle = fallback;
    pixel.fillStyle = out; //       ignored if the canvas cannot parse it: the fallback stays
    pixel.fillRect(0, 0, 1, 1);
    const d = pixel.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], Math.round((d[3] / 255) * 1000) / 1000];
  };

  const mqOn = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));
  const mqOff = (mq, fn) => (mq.removeEventListener ? mq.removeEventListener('change', fn) : mq.removeListener(fn));
  // Render-skip signature slot: returns 1 if the value changed.
  const put = (g, i, v) => (g[i] !== v ? ((g[i] = v), 1) : 0);

  class MelonPendulum extends HTMLElement {
    static get observedAttributes() {
      return ['hero', 'progress', 'theme', 'scroll-length', 'label', 'hud'];
    }

    constructor() {
      super();
      const ph = (this._phys = new ReelPhysics());
      this._base = { cphi: ph.p.cphi, c1: ph.p.c1 };
      this._damped = false;
      this._pose = reelPose(REEL.start.phi, REEL.start.x, REEL.start.y, {});
      this._colors = {};
      for (let i = 0; i < KEYS.length; i++) this._colors[KEYS[i]] = hexToRGBA(LIGHT[i]);
      this._paperCss = LIGHT[0];
      this._colorV = 0;
      this._colorsDirty = true;
      this._melonOpts = { still: false, hover: 0 };
      this._reelOpts = {};
      this._sig = new Float64Array(13).fill(NaN);
      this._dirty = true;

      this._connected = false;
      this._visible = true;
      this._raf = 0;
      this._last = 0;
      this._acc = 0;
      this._time = 0; //            idle clock of the slice, seconds
      this._t = 0;
      this._live = false;
      this._atStart = false;
      this._paused = false;
      this._reduced = false;
      this._coast = false; //       reduced motion: still settling after a release or a key press
      this._restT = 0;
      this._coastT = 0;
      this._hero = false;
      this._prog = null;
      this._hudOff = false;
      this._hudOn = false;
      this._scrollSet = false;
      this._failed = 0;

      this._w = 0;
      this._h = 0;
      this._dpr = 1;
      this._cw = 0;
      this._ch = 0;
      this._s = 1;
      this._ox = 0;
      this._oy = 0;
      this._mode = 0; //            0 figure only, 1 copy left / figure right, 2 copy above figure
      this._modeShown = 0;
      this._layoutV = 0;
      this._hasCopy = false;

      this._drag = false;
      this._pid = -1;
      this._grab = 0; //            pointer x minus S1x at grab, reel px
      this._targetX = 0; //         where the pointer wants S1x, reel px
      this._K = 0;
      this._D = 0;
      this._ptrIn = false;
      this._plx = 0; //             last pointer position on the canvas, CSS px
      this._ply = 0;
      this._hoverTarget = 0;
      this._hoverLin = 0;
      this._cursor = 0;

      this._resetState();

      const root = this.shadowRoot || this.attachShadow({ mode: 'open' });
      root.innerHTML = '';
      root.appendChild(TEMPLATE.content.cloneNode(true));
      this._stage = root.querySelector('.stage');
      this._canvas = root.querySelector('canvas');
      this._ctx = this._canvas.getContext('2d');
      this._hud = root.querySelector('.hud');
      this._pauseBtn = root.querySelector('.pause');
      this._slot = root.querySelector('slot');
      this._probe = root.querySelector('.probe');
      this._canvas.setAttribute('aria-label', DEFAULT_LABEL);

      this._frame = this._frame.bind(this);
      this._onDown = this._onDown.bind(this);
      this._onMove = this._onMove.bind(this);
      this._onUp = this._onUp.bind(this);
      this._onLeave = this._onLeave.bind(this);
      this._onKey = this._onKey.bind(this);
      this._onPause = this._onPause.bind(this);
      this._onSlot = this._onSlot.bind(this);
      this._onScheme = this._onScheme.bind(this);
      this._onMotionPref = this._onMotionPref.bind(this);
      this._onVisibility = this._onVisibility.bind(this);
      this._onResize = this._onResize.bind(this);
      this._onIntersect = this._onIntersect.bind(this);
      this._onMutate = this._onMutate.bind(this);

      // Listeners on our own shadow nodes live as long as the element; nothing outside is touched
      // until connectedCallback.
      const cv = this._canvas;
      cv.addEventListener('pointerdown', this._onDown);
      cv.addEventListener('pointermove', this._onMove);
      cv.addEventListener('pointerup', this._onUp);
      cv.addEventListener('pointercancel', this._onUp);
      cv.addEventListener('lostpointercapture', this._onUp);
      cv.addEventListener('pointerleave', this._onLeave);
      cv.addEventListener('keydown', this._onKey);
      this._pauseBtn.addEventListener('click', this._onPause);
      this._slot.addEventListener('slotchange', this._onSlot);
    }

    // --- public API ---------------------------------------------------------------------------

    /** Fixed progress 0..1, or null when the scroll position drives it. */
    get progress() {
      return this._prog;
    }
    set progress(v) {
      if (v === null || v === undefined || v === '' || v === false) this.removeAttribute('progress');
      else this.setAttribute('progress', String(v));
    }
    get paused() {
      return this._paused;
    }
    set paused(v) {
      this._setPaused(!!v);
    }
    pause() {
      this._setPaused(true);
    }
    play() {
      this._setPaused(false);
    }
    /** Back to the reel's first frame. */
    reset() {
      this._endDrag();
      this._coast = false;
      this._resetState();
      this._dirty = true;
    }

    // --- lifecycle ----------------------------------------------------------------------------

    connectedCallback() {
      if (this._connected) return;
      this._connected = true;
      this._upgradeProp('progress');
      this._upgradeProp('paused');
      this._applyScrollLength();
      this._applyLabel();

      if (!this._mqDark) {
        this._mqDark = window.matchMedia('(prefers-color-scheme: dark)');
        this._mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      }
      mqOn(this._mqDark, this._onScheme);
      mqOn(this._mqMotion, this._onMotionPref);
      document.addEventListener('visibilitychange', this._onVisibility);
      this._setReduced(this._mqMotion.matches, true);

      if (typeof ResizeObserver === 'function') {
        if (!this._ro) this._ro = new ResizeObserver(this._onResize);
        this._ro.observe(this._stage);
      } else {
        window.addEventListener('resize', this._onResize);
      }
      this._visible = true;
      if (typeof IntersectionObserver === 'function') {
        if (!this._io) this._io = new IntersectionObserver(this._onIntersect, { rootMargin: '64px 0px' });
        this._io.observe(this);
      }
      // Themes toggled from outside (a class or data attribute on <html>, an inline variable).
      if (typeof MutationObserver === 'function') {
        if (!this._mo) this._mo = new MutationObserver(this._onMutate);
        this._mo.observe(this, { attributes: true, attributeFilter: ['class', 'style'] });
        const de = document.documentElement;
        const af = ['class', 'style', 'data-theme', 'data-color-scheme', 'data-mode'];
        if (de) this._mo.observe(de, { attributes: true, attributeFilter: af });
        if (document.body && document.body !== de) {
          this._mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'data-mode'] });
        }
      }

      this._onSlot();
      this._colorsDirty = true;
      this._readColors();
      this._resize(false);
    }

    disconnectedCallback() {
      if (!this._connected) return;
      this._connected = false;
      this._stop();
      this._endDrag();
      this._coast = false;
      this._ptrIn = false;
      this._hoverTarget = 0;
      if (this._mqDark) {
        mqOff(this._mqDark, this._onScheme);
        mqOff(this._mqMotion, this._onMotionPref);
      }
      document.removeEventListener('visibilitychange', this._onVisibility);
      if (this._ro) this._ro.disconnect();
      else window.removeEventListener('resize', this._onResize);
      if (this._io) this._io.disconnect();
      if (this._mo) this._mo.disconnect();
    }

    // moveBefore() keeps the element connected: nothing to tear down or rebuild.
    connectedMoveCallback() {}

    attributeChangedCallback(name, _old, val) {
      // May run before connectedCallback (parser, upgrade): only store, or touch our own nodes.
      switch (name) {
        case 'hero':
          this._hero = val !== null;
          this._dirty = true;
          break;
        case 'progress': {
          const n = parseFloat(val);
          this._prog = val === null || !isFinite(n) ? null : clamp01(n);
          this._dirty = true;
          break;
        }
        case 'theme':
          this._colorsDirty = true;
          break;
        case 'scroll-length':
          if (this._connected) this._applyScrollLength();
          break;
        case 'label':
          this._applyLabel();
          break;
        case 'hud':
          this._hudOff = val === 'off';
          if (this._w) this._layout();
          break;
      }
    }

    _upgradeProp(name) {
      // A value set on the element before the definition loaded shadows the accessor.
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const v = this[name];
        delete this[name];
        this[name] = v;
      }
    }

    _applyScrollLength() {
      let v = this.getAttribute('scroll-length');
      v = v ? v.trim() : '';
      if (v && /^\d*\.?\d+$/.test(v)) v += 'vh';
      const ok = v && (!window.CSS || !CSS.supports || CSS.supports('height', v) || CSS.supports('height', 'calc(' + v + ')'));
      if (ok) {
        this.style.setProperty('--melon-scroll', v);
        this._scrollSet = true;
      } else if (this._scrollSet) {
        this.style.removeProperty('--melon-scroll');
        this._scrollSet = false;
      }
    }

    _applyLabel() {
      this._canvas.setAttribute('aria-label', this.getAttribute('label') || DEFAULT_LABEL);
    }

    _readColors() {
      if (!this._connected) return; // computed style needs the element in a document
      const cs = getComputedStyle(this);
      const th = this.getAttribute('theme');
      const dark = th === 'dark' || (th !== 'light' && !!(this._mqDark && this._mqDark.matches));
      const fb = dark ? DARK : LIGHT;
      const C = this._colors;
      for (let i = 0; i < KEYS.length; i++) {
        C[KEYS[i]] = toRGBA(this._probe, cs.getPropertyValue(VARS[i]).trim(), fb[i]);
      }
      this._probe.style.color = '';
      this._paperCss = css(C.paper);
      this._colorV++;
      this._colorsDirty = false;
    }

    _onScheme() {
      this._colorsDirty = true;
    }
    _onMutate() {
      this._colorsDirty = true;
    }
    _onMotionPref() {
      this._setReduced(this._mqMotion.matches, false);
    }
    _onVisibility() {
      this._sync();
    }
    _onIntersect(entries) {
      this._visible = entries[entries.length - 1].isIntersecting;
      this._sync();
    }
    _onResize() {
      this._resize(false);
    }

    _setReduced(r, init) {
      if (!init && r === this._reduced) return;
      this._reduced = r;
      if (r) {
        // A static, finished diagram at the reel's first frame.
        this._endDrag();
        this._coast = false;
        this._resetState();
      }
      this._setDamping(false);
      this._dirty = true;
    }

    // Raise the swing and disk damping while a reduced-motion figure coasts; restore it after.
    _setDamping(on) {
      if (on === this._damped) return;
      this._damped = on;
      const p = this._phys.p;
      const b = this._base;
      p.cphi = on ? Math.max(b.cphi, RM_CPHI) : b.cphi;
      p.c1 = on ? Math.max(b.c1, RM_C1) : b.c1;
    }

    _onSlot() {
      const nodes = this._slot.assignedNodes({ flatten: true });
      let has = false;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())) has = true;
      }
      if (has !== this._hasCopy) {
        this._hasCopy = has;
        if (this._w) this._layout();
      }
    }

    _sync() {
      if (this._connected && this._visible && !document.hidden && this._w > 0) this._start();
      else this._stop();
    }
    _start() {
      if (this._raf) return;
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._frame);
    }
    _stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    _resize(fromTick) {
      const w = this._stage.clientWidth;
      const h = this._stage.clientHeight;
      if (!w || !h) {
        this._w = 0;
        this._sync();
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const cw = Math.max(1, Math.round(w * dpr));
      const ch = Math.max(1, Math.round(h * dpr));
      const cv = this._canvas;
      if (cv.width !== cw) cv.width = cw; //   resizing clears the canvas...
      if (cv.height !== ch) cv.height = ch;
      this._w = w;
      this._h = h;
      this._dpr = dpr;
      this._cw = cw;
      this._ch = ch;
      this._layout();
      if (!fromTick) {
        this._sync();
        if (this._raf) this._tick(0); //       ...so draw again before this frame is painted
      }
    }

    // Fit the reel's content box into the part of the stage the figure owns.
    _layout() {
      const w = this._w;
      const h = this._h;
      const pad = Math.max(12, Math.min(48, Math.round(Math.min(w, h) * 0.04)));
      const hudRoom = this._hudOff ? 0 : 44;
      let rx = 0;
      let ry = 0;
      let rw = w;
      let rh = h;
      let padB = pad + hudRoom;
      let mode = 0;
      if (this._hasCopy && w >= WIDE_MIN) {
        mode = 1; //                  the right 64%, the HUD sits under the copy
        rx = w * 0.36;
        rw = w - rx;
        padB = pad;
      } else if (this._hasCopy) {
        mode = 2; //                  the lower 60%
        ry = h * 0.4;
        rh = h - ry;
      }
      const aw = Math.max(1, rw - 2 * pad);
      const ah = Math.max(1, rh - pad - padB);
      // On phones, trim the margins the swing never reaches (the platform's left end swings out
      // to x ≈ 106, the phi indicator ends at 1256).
      const x0 = w < NARROW_MAX ? 95 : BOX_X0;
      const x1 = w < NARROW_MAX ? 1180 : BOX_X1;
      const s = Math.min(aw / (x1 - x0), ah / BOX_H);
      const sx = rx + pad + aw / 2; //  screen centre of the figure's area
      const sy = ry + pad + ah / 2;
      // Two cameras: the whole figure, and close on the slice. The scroll eases from one to the other.
      this._fullS = s;
      this._fullX = (x0 + x1) / 2;
      this._fullY = (BOX_Y0 + BOX_Y1) / 2;
      this._zoomS = Math.max(s, (0.62 * Math.min(aw, ah)) / FOCUS_SIZE);
      this._camX = sx;
      this._camY = sy;
      this._mode = mode;
      this._camera(this._t || 0);
      this._layoutV++;
      this._dirty = true;
    }

    // Camera for scroll progress t: log-interpolated zoom, centred point eased from the slice to
    // the figure. Rendering and hit-testing both read _s, _ox, _oy.
    _camera(t) {
      const z = easeInOut(seg(t, 0.06, 0.85));
      const s = Math.exp(lerp(Math.log(this._zoomS), Math.log(this._fullS), z));
      this._s = s;
      this._ox = this._camX - lerp(FOCUS_X, this._fullX, z) * s;
      this._oy = this._camY - lerp(FOCUS_Y, this._fullY, z) * s;
    }

    // Classes that change the stage's own size are applied from requestAnimationFrame, never from
    // the ResizeObserver callback (which would be a resize loop).
    _showMode() {
      const cl = this._stage.classList;
      this._modeShown = this._mode;
      cl.toggle('wide', this._mode === 1);
      cl.toggle('stack', this._mode === 2);
    }

    _resetState() {
      const st = REEL.start;
      const v = REEL.startV;
      const ph = this._phys;
      ph.set(st.phi, st.x, st.y, v ? +v.dphi || 0 : 0, v ? +v.dx || 0 : 0, v ? +v.dy || 0 : 0);
      ph.force = 0;
      this._acc = 0;
      this._atStart = true;
      reelPose(ph.s[0], ph.s[1], ph.s[2], this._pose);
    }

    // --- input --------------------------------------------------------------------------------

    _local(e) {
      const r = this._canvas.getBoundingClientRect();
      this._plx = r.width > 0 ? ((e.clientX - r.left) * this._w) / r.width : 0;
      this._ply = r.height > 0 ? ((e.clientY - r.top) * this._h) / r.height : 0;
    }

    // Is the reel point (x, y) on the platform, its post, or the disk?
    _onFigure(x, y) {
      const P = this._pose;
      const dx = x - P.Mx;
      const dy = y - P.My;
      const rr = REEL.R * 1.06;
      if (dx * dx + dy * dy <= rr * rr) return true;
      const top = P.S1y - REEL.barHalf;
      if (x >= P.Wx - 18 && x <= P.Ex + 18 && y >= top - 22 && y <= P.S1y + REEL.barHalf + 22) return true;
      const px = P.S1x + REEL.postX;
      return x >= px - 20 && x <= px + 20 && y >= top - REEL.postH - 12 && y <= top;
    }

    _hoverTest() {
      const s = this._s;
      const x = (this._plx - this._ox) / s;
      const y = (this._ply - this._oy) / s;
      let inside;
      if (this._live) {
        inside = this._onFigure(x, y);
      } else {
        // The slice, on its way to the disk.
        const k = seg(this._t, 0.05, 0.75);
        const P = this._pose;
        const dx = x - lerp(REEL.sliceX, P.Mx, k);
        const dy = y - lerp(REEL.sliceY, P.My, k);
        const r = lerp(REEL.sliceR, REEL.R, k);
        inside = dx * dx + dy * dy <= r * r;
      }
      this._hoverTarget = inside ? 1 : 0;
      if (!this._drag) this._setCursor(this._live && inside ? 1 : 0);
    }

    _setCursor(c) {
      if (c === this._cursor) return;
      this._cursor = c;
      const cl = this._canvas.classList;
      cl.toggle('grab', c === 1);
      cl.toggle('grabbing', c === 2);
    }

    _onDown(e) {
      if (!this._live || this._drag || !this._w) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this._local(e);
      const x = (this._plx - this._ox) / this._s;
      const y = (this._ply - this._oy) / this._s;
      if (x < BOX_X0 || x > BOX_X1 || y < BOX_Y0 || y > BOX_Y1) return;
      e.preventDefault();
      try {
        this._canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        /* pointer already gone */
      }
      this._canvas.focus({ preventScroll: true });
      const p = this._phys.p;
      const M = p.m1 + p.m2 + p.m3;
      // Stiff enough to beat gravity and k_phi on the fitted mass scale (lag under ~20%).
      this._K = 250 * M;
      this._D = 2 * 0.8 * Math.sqrt(this._K * M);
      this._drag = true;
      this._pid = e.pointerId;
      this._grab = x - this._pose.S1x;
      this._targetX = this._pose.S1x;
      this._coast = false;
      this._setCursor(2);
    }

    _onMove(e) {
      if (this._drag) {
        if (e.pointerId !== this._pid) return;
        this._local(e);
        const x = (this._plx - this._ox) / this._s;
        const c = REEL.A[0] + REEL.a / 2; // S1x with the links hanging straight down
        const lim = REEL.L * Math.sin(PHI_DRAG);
        const tx = x - this._grab;
        this._targetX = tx < c - lim ? c - lim : tx > c + lim ? c + lim : tx;
        return;
      }
      if (e.pointerType === 'touch') return;
      this._local(e);
      this._ptrIn = true;
      this._hoverTest();
    }

    _onUp(e) {
      if (!this._drag || e.pointerId !== this._pid) return;
      this._endDrag();
      if (e.type === 'pointerup' && e.pointerType !== 'touch') {
        this._local(e);
        this._ptrIn = true;
        this._hoverTest();
      }
    }

    _onLeave() {
      if (this._drag) return;
      this._ptrIn = false;
      this._hoverTarget = 0;
      this._setCursor(0);
    }

    _endDrag() {
      if (!this._drag) return;
      const pid = this._pid;
      this._drag = false;
      this._pid = -1;
      this._phys.force = 0;
      this._capSwing(); //               a fast flick must not throw the swing over the top
      try {
        if (this._canvas.hasPointerCapture(pid)) this._canvas.releasePointerCapture(pid);
      } catch (_) {
        /* already released */
      }
      if (this._reduced) this._startCoast();
      this._setCursor(this._live && this._hoverTarget ? 1 : 0);
    }

    // Keep the swing's energy below what reaches PHI_DRAG: limit phi' for the current phi.
    _capSwing() {
      const p = this._phys.p;
      const s = this._phys.s;
      const Mt = p.m1 + p.m2 + p.m3;
      const V = (f) => Mt * p.g * p.l * (1 - Math.cos(f)) + 0.5 * p.kphi * f * f;
      const vmax = Math.sqrt(Math.max(0, (2 * (V(PHI_DRAG) - V(s[0]))) / (Mt * p.l * p.l)));
      if (s[3] > vmax) s[3] = vmax;
      else if (s[3] < -vmax) s[3] = -vmax;
    }

    _startCoast() {
      this._coast = true;
      this._restT = 0;
      this._coastT = 0;
    }

    // Spring-damper from the pointer to the platform centre S1, horizontal, in physics units.
    _applyDrag() {
      const ph = this._phys;
      const s = ph.s;
      const R = REEL.R;
      const S1x = REEL.A[0] + REEL.L * Math.sin(s[0]) + REEL.a / 2;
      const v = ph.p.l * s[3] * Math.cos(s[0]);
      ph.force = (this._K * (this._targetX - S1x)) / R - this._D * v;
    }

    _onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (!this._live) return; //    the page keeps its keys until the figure is live
        e.preventDefault();
        if (e.repeat) return; //       one push per press: holding a key must not pump the swing
        this._phys.s[3] += k === 'ArrowLeft' ? -KEY_KICK : KEY_KICK;
        this._capSwing();
        if (this._reduced) this._startCoast();
      } else if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (!e.repeat) this._setPaused(!this._paused);
      }
    }

    _onPause() {
      this._setPaused(!this._paused);
    }

    _setPaused(p) {
      this._paused = !!p;
      const b = this._pauseBtn;
      b.setAttribute('aria-pressed', this._paused ? 'true' : 'false');
      b.setAttribute('aria-label', this._paused ? 'Resume the simulation' : 'Pause the simulation');
      this._dirty = true;
    }

    // --- loop ---------------------------------------------------------------------------------

    _readProgress() {
      if (this._prog !== null) return this._prog;
      if (this._reduced) return 1;
      const r = this.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      if (this._hero) {
        const span = r.height - vh;
        if (span <= 1) return 1;
        return clamp01(clamp01(-r.top / span) / 0.85);
      }
      return clamp01((vh * 0.9 - r.top) / (vh * 0.6));
    }

    _frame(now) {
      this._raf = requestAnimationFrame(this._frame);
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (!(dt > 0)) dt = 0;
      else if (dt > 0.1) dt = 0.1;
      if (this._mode !== this._modeShown) this._showMode();
      this._tick(dt);
    }

    _tick(dt) {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (dpr !== this._dpr) this._resize(true); // zoom, or a move to another screen
      if (!this._w) return;
      if (this._colorsDirty) this._readColors();

      const t = this._readProgress();
      if (t !== this._t) this._camera(t);
      this._t = t;
      const live = t >= LIVE_AT;
      this._live = live;
      if (!live && this._drag) this._endDrag();
      if (t <= RESET_AT && !this._atStart) this._resetState(); // scroll back up: replay from the start

      const ph = this._phys;
      const s = ph.s;
      const m = seg(t, 0.05, 0.75);
      const d = seg(t, 0.4, 1.0);
      const reduced = this._reduced;

      // Physics: only in the finished figure. Under reduced motion only while moved by hand, and
      // heavily damped while it coasts to rest.
      this._setDamping(reduced && this._coast && !this._drag);
      if (live && !this._paused && (!reduced || this._drag || this._coast)) {
        this._acc += dt;
        let n = 0;
        while (this._acc >= DT && n < MAX_STEPS) {
          if (this._drag) this._applyDrag();
          ph.step(DT);
          this._acc -= DT;
          n++;
        }
        if (n >= MAX_STEPS) this._acc = 0;
        if (n) this._atStart = false;
        if (reduced && this._coast && !this._drag) this._settle(dt);
      } else {
        this._acc = 0;
      }
      if (!this._drag) ph.force = 0;
      reelPose(s[0], s[1], s[2], this._pose);

      const still = reduced;
      if (m < 1 && !this._paused && !still) this._time += dt;

      if (this._ptrIn && !this._drag) this._hoverTest(); // the figure moves under a still pointer
      const hs = dt / 0.15;
      this._hoverLin = this._hoverTarget ? Math.min(1, this._hoverLin + hs) : Math.max(0, this._hoverLin - hs);
      const hover = easeOut(this._hoverLin);

      const on = t >= HUD_AT;
      if (on !== this._hudOn) {
        this._hudOn = on;
        this._hud.classList.toggle('on', on);
        this._pauseBtn.disabled = !on;
      }

      // Render only if something visible changed.
      const g = this._sig;
      const changed =
        put(g, 0, Math.round(t * 1e4)) |
        put(g, 1, Math.round(s[0] * 1e5)) |
        put(g, 2, Math.round(s[1] * 1e5)) |
        put(g, 3, Math.round(s[2] * 1e5)) |
        put(g, 4, Math.round(hover * 1e3)) |
        put(g, 5, m < 1 && !still ? Math.round(this._time * 1e3) : -1) |
        put(g, 6, this._colorV) |
        put(g, 7, this._cw) |
        put(g, 8, this._ch) |
        put(g, 9, this._layoutV) |
        put(g, 10, this._paused ? 1 : 0) |
        put(g, 11, still ? 1 : 0) |
        put(g, 12, this._hasCopy ? 1 : 0);
      if (changed || this._dirty) {
        this._dirty = false;
        this._render(m, d, hover, still);
      }
    }

    // Reduced motion: stop stepping once the hand-moved figure has come to rest.
    _settle(dt) {
      const s = this._phys.s;
      const quiet = Math.abs(s[3]) < 0.006 && Math.abs(s[4]) < 0.015 && Math.abs(s[5]) < 0.04;
      this._restT = quiet ? this._restT + dt : 0;
      this._coastT += dt;
      if (this._restT >= 0.25 || this._coastT > 12) {
        this._coast = false;
        s[3] = s[4] = s[5] = 0;
        this._setDamping(false);
      }
    }

    _render(m, d, hover, still) {
      const ctx = this._ctx;
      const dpr = this._dpr;
      const k = dpr * this._s;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, this._cw, this._ch);
      ctx.fillStyle = this._paperCss;
      ctx.fillRect(0, 0, this._cw, this._ch);
      ctx.setTransform(k, 0, 0, k, dpr * this._ox, dpr * this._oy); // 1 unit = 1 reel pixel
      const C = this._colors;
      const pose = this._pose;
      if (typeof drawMelon === 'function') {
        const o = this._melonOpts;
        o.still = still;
        o.hover = hover;
        ctx.save();
        try {
          drawMelon(ctx, m, pose, C, this._time, o);
        } catch (err) {
          this._fail(1, err);
        }
        ctx.restore();
      }
      if (typeof drawReel === 'function') {
        ctx.save();
        try {
          drawReel(ctx, d, pose, C, this._reelOpts);
        } catch (err) {
          this._fail(2, err);
        }
        ctx.restore();
      }
    }

    // A renderer that throws is reported once, and the loop keeps going.
    _fail(bit, err) {
      if (this._failed & bit) return;
      this._failed |= bit;
      console.error('<melon-pendulum>: ' + (bit === 1 ? 'drawMelon' : 'drawReel') + ' failed', err);
    }
  }

  window.customElements.define('melon-pendulum', MelonPendulum);
}

if (typeof module === 'object' && module && module.exports) module.exports = { ReelPhysics, REEL, reelPose };
})();
