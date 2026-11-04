/*! <kinder-pendulum> - a 3D chocolate bar that becomes a ballistic pendulum. No dependencies. */
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


// ---- kinder-profile.js ---------------------------------------------------------------
// Generated by tools/extract-profile.py from the bar model. Do not edit by hand.
const KINDER_PROFILE = {"note":"Side profile of chocolate_bar_model.glb, model units, x along the bar, y up.","x0":-0.95189,"x1":0.95111,"bottom":-0.11685,"plateau":0.10887,"x":[-0.95189,-0.94793,-0.94396,-0.94,-0.93603,-0.93207,-0.9281,-0.92414,-0.92017,-0.91621,-0.91224,-0.90828,-0.90431,-0.90035,-0.89639,-0.89242,-0.88846,-0.88449,-0.88053,-0.87656,-0.8726,-0.86863,-0.86467,-0.8607,-0.85674,-0.85278,-0.84881,-0.84485,-0.84088,-0.83692,-0.83295,-0.82899,-0.82502,-0.82106,-0.81709,-0.81313,-0.80916,-0.8052,-0.80124,-0.79727,-0.79331,-0.78934,-0.78538,-0.78141,-0.77745,-0.77348,-0.76952,-0.76555,-0.76159,-0.75763,-0.75366,-0.7497,-0.74573,-0.74177,-0.7378,-0.73384,-0.72987,-0.72591,-0.72194,-0.71798,-0.71401,-0.71005,-0.70609,-0.70212,-0.69816,-0.69419,-0.69023,-0.68626,-0.6823,-0.67833,-0.67437,-0.6704,-0.66644,-0.66248,-0.65851,-0.65455,-0.65058,-0.64662,-0.64265,-0.63869,-0.63472,-0.63076,-0.62679,-0.62283,-0.61886,-0.6149,-0.61094,-0.60697,-0.60301,-0.59904,-0.59508,-0.59111,-0.58715,-0.58318,-0.57922,-0.57525,-0.57129,-0.56733,-0.56336,-0.5594,-0.55543,-0.55147,-0.5475,-0.54354,-0.53957,-0.53561,-0.53164,-0.52768,-0.52371,-0.51975,-0.51579,-0.51182,-0.50786,-0.50389,-0.49993,-0.49596,-0.492,-0.48803,-0.48407,-0.4801,-0.47614,-0.47218,-0.46821,-0.46425,-0.46028,-0.45632,-0.45235,-0.44839,-0.44442,-0.44046,-0.43649,-0.43253,-0.42856,-0.4246,-0.42064,-0.41667,-0.41271,-0.40874,-0.40478,-0.40081,-0.39685,-0.39288,-0.38892,-0.38495,-0.38099,-0.37703,-0.37306,-0.3691,-0.36513,-0.36117,-0.3572,-0.35324,-0.34927,-0.34531,-0.34134,-0.33738,-0.33341,-0.32945,-0.32549,-0.32152,-0.31756,-0.31359,-0.30963,-0.30566,-0.3017,-0.29773,-0.29377,-0.2898,-0.28584,-0.28188,-0.27791,-0.27395,-0.26998,-0.26602,-0.26205,-0.25809,-0.25412,-0.25016,-0.24619,-0.24223,-0.23826,-0.2343,-0.23034,-0.22637,-0.22241,-0.21844,-0.21448,-0.21051,-0.20655,-0.20258,-0.19862,-0.19465,-0.19069,-0.18673,-0.18276,-0.1788,-0.17483,-0.17087,-0.1669,-0.16294,-0.15897,-0.15501,-0.15104,-0.14708,-0.14311,-0.13915,-0.13519,-0.13122,-0.12726,-0.12329,-0.11933,-0.11536,-0.1114,-0.10743,-0.10347,-0.0995,-0.09554,-0.09158,-0.08761,-0.08365,-0.07968,-0.07572,-0.07175,-0.06779,-0.06382,-0.05986,-0.05589,-0.05193,-0.04796,-0.044,-0.04004,-0.03607,-0.03211,-0.02814,-0.02418,-0.02021,-0.01625,-0.01228,-0.00832,-0.00435,-0.00039,0.00357,0.00754,0.0115,0.01547,0.01943,0.0234,0.02736,0.03133,0.03529,0.03926,0.04322,0.04719,0.05115,0.05511,0.05908,0.06304,0.06701,0.07097,0.07494,0.0789,0.08287,0.08683,0.0908,0.09476,0.09872,0.10269,0.10665,0.11062,0.11458,0.11855,0.12251,0.12648,0.13044,0.13441,0.13837,0.14234,0.1463,0.15026,0.15423,0.15819,0.16216,0.16612,0.17009,0.17405,0.17802,0.18198,0.18595,0.18991,0.19387,0.19784,0.2018,0.20577,0.20973,0.2137,0.21766,0.22163,0.22559,0.22956,0.23352,0.23749,0.24145,0.24541,0.24938,0.25334,0.25731,0.26127,0.26524,0.2692,0.27317,0.27713,0.2811,0.28506,0.28902,0.29299,0.29695,0.30092,0.30488,0.30885,0.31281,0.31678,0.32074,0.32471,0.32867,0.33264,0.3366,0.34056,0.34453,0.34849,0.35246,0.35642,0.36039,0.36435,0.36832,0.37228,0.37625,0.38021,0.38417,0.38814,0.3921,0.39607,0.40003,0.404,0.40796,0.41193,0.41589,0.41986,0.42382,0.42779,0.43175,0.43571,0.43968,0.44364,0.44761,0.45157,0.45554,0.4595,0.46347,0.46743,0.4714,0.47536,0.47932,0.48329,0.48725,0.49122,0.49518,0.49915,0.50311,0.50708,0.51104,0.51501,0.51897,0.52294,0.5269,0.53086,0.53483,0.53879,0.54276,0.54672,0.55069,0.55465,0.55862,0.56258,0.56655,0.57051,0.57447,0.57844,0.5824,0.58637,0.59033,0.5943,0.59826,0.60223,0.60619,0.61016,0.61412,0.61809,0.62205,0.62601,0.62998,0.63394,0.63791,0.64187,0.64584,0.6498,0.65377,0.65773,0.6617,0.66566,0.66962,0.67359,0.67755,0.68152,0.68548,0.68945,0.69341,0.69738,0.70134,0.70531,0.70927,0.71324,0.7172,0.72116,0.72513,0.72909,0.73306,0.73702,0.74099,0.74495,0.74892,0.75288,0.75685,0.76081,0.76477,0.76874,0.7727,0.77667,0.78063,0.7846,0.78856,0.79253,0.79649,0.80046,0.80442,0.80839,0.81235,0.81631,0.82028,0.82424,0.82821,0.83217,0.83614,0.8401,0.84407,0.84803,0.852,0.85596,0.85992,0.86389,0.86785,0.87182,0.87578,0.87975,0.88371,0.88768,0.89164,0.89561,0.89957,0.90354,0.9075,0.91146,0.91543,0.91939,0.92336,0.92732,0.93129,0.93525,0.93922,0.94318,0.94715,0.95111],"top":[-0.03031,-0.02081,-0.01099,-0.00418,0.00288,0.01329,0.02455,0.03698,0.0511,0.06588,0.07913,0.0938,0.10325,0.10697,0.10782,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10787,0.10745,0.10615,0.10389,0.10096,0.09752,0.09377,0.08969,0.08529,0.08062,0.07582,0.07099,0.0662,0.06137,0.05657,0.05175,0.04695,0.04225,0.03756,0.03292,0.02831,0.02393,0.01967,0.01571,0.01205,0.00843,0.00505,0.00189,-0.00108,-0.00366,-0.00582,-0.00761,-0.00907,-0.01015,-0.01085,-0.01102,-0.01076,-0.01011,-0.00913,-0.00765,-0.00576,-0.00346,-0.00084,0.00211,0.0054,0.00894,0.01274,0.0168,0.02117,0.02551,0.02992,0.03451,0.03915,0.04384,0.04849,0.05315,0.05783,0.06247,0.06715,0.07181,0.07646,0.08115,0.08579,0.09038,0.09471,0.09862,0.10207,0.10511,0.10741,0.10858,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10886,0.1084,0.1069,0.10436,0.10136,0.09808,0.09441,0.09025,0.08577,0.08109,0.07629,0.07145,0.06656,0.06168,0.05683,0.05195,0.04707,0.04222,0.03747,0.03293,0.02852,0.02419,0.01986,0.01583,0.01196,0.00832,0.00484,0.00161,-0.00135,-0.00397,-0.00621,-0.00811,-0.00968,-0.01083,-0.01156,-0.01187,-0.01178,-0.01131,-0.01061,-0.00944,-0.00791,-0.00604,-0.00371,-0.00101,0.00186,0.00502,0.00841,0.01201,0.01579,0.01977,0.02396,0.02836,0.03287,0.0375,0.04229,0.04713,0.05198,0.05686,0.06171,0.06659,0.07147,0.07634,0.08125,0.08607,0.09057,0.09468,0.09838,0.10169,0.10453,0.10684,0.10808,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10832,0.10772,0.10627,0.10396,0.10088,0.09732,0.09342,0.08912,0.08439,0.07956,0.07471,0.06986,0.06501,0.06018,0.05538,0.05064,0.04589,0.04121,0.03657,0.03204,0.02758,0.02315,0.01888,0.015,0.0113,0.00773,0.00441,0.00128,-0.00157,-0.00403,-0.00617,-0.00801,-0.00954,-0.01064,-0.01131,-0.01159,-0.01152,-0.0112,-0.01043,-0.00928,-0.00769,-0.00568,-0.00337,-0.0007,0.00231,0.00562,0.00906,0.01271,0.01635,0.0203,0.0244,0.02871,0.0332,0.03792,0.04262,0.04734,0.05206,0.05683,0.06158,0.06637,0.07117,0.07595,0.08072,0.08543,0.08999,0.09429,0.09821,0.10157,0.10444,0.10674,0.10822,0.10876,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.1086,0.10738,0.10503,0.102,0.09857,0.09476,0.09051,0.0859,0.0812,0.07641,0.07161,0.06682,0.06211,0.05741,0.05267,0.04796,0.04326,0.0386,0.03403,0.02949,0.02496,0.0206,0.01652,0.01276,0.00901,0.00532,0.00198,-0.00089,-0.00345,-0.00571,-0.0076,-0.00916,-0.01035,-0.01105,-0.01139,-0.01132,-0.01076,-0.0099,-0.00867,-0.00694,-0.00482,-0.00243,0.00025,0.00337,0.00682,0.0105,0.01424,0.01823,0.02256,0.02697,0.03137,0.03591,0.04057,0.04534,0.05009,0.05489,0.05969,0.06449,0.06928,0.07411,0.07891,0.08368,0.08822,0.09258,0.09665,0.10031,0.10346,0.10614,0.10798,0.10879,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10887,0.10878,0.10857,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10837,0.10833,0.10728,0.10153,0.08525,0.05933,0.03425,0.0145,0.00309,-0.0045,-0.01404,-0.02318],"dips":[{"x":-0.61886,"bottom":-0.01102,"depth":0.11989,"rho":0.03797},{"x":-0.21051,"bottom":-0.01187,"depth":0.12074,"rho":0.04123},{"x":0.20577,"bottom":-0.01159,"depth":0.12046,"rho":0.0418},{"x":0.61809,"bottom":-0.01139,"depth":0.12026,"rho":0.03903}]};

// ---- kinder-geometry.js --------------------------------------------------------------
// The Kinder-bar figure: the reel's swing (geometry.js REEL) with platform 1 replaced by the bar's
// side profile (kinder-profile.js), and the disk replaced by a rigid "spider": the hub M with the
// slot, spring k2 and block m3, and branches out to small circles seated in some of the bar's dips.
// The circles turn on axles in the dips; every branch ends on a crank pin at the same distance e
// from its circle's centre, so the circles turn together and the spider translates without
// turning, like the coupling rods of a locomotive (a parallel-crank linkage).
//
// Two coordinate systems:
//   physics: lengths in R (REEL.R = 188 reel px), y UP, in the platform frame: origin at S1 (the
//            middle of the link pivots), axes fixed (the platform only translates).
//   screen:  reel pixels, y DOWN (what the renderer draws in).

const KINDER = (() => {
  const P = KINDER_PROFILE;
  const R = REEL.R;
  const PIV_X = 0.875; //  link pivots at model x = +-0.875 ...
  const PIV_Y = -0.08; //  ... and model y = -0.08, a pin through the bar near its bottom
  const SB = REEL.a / (2 * PIV_X); //  reel px per model unit (427.4)
  const k = SB / R; //                  R per model unit

  // Top of the bar, in physics units, uniformly sampled in x.
  const n = P.x.length;
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    X[i] = P.x[i] * k;
    Y[i] = (P.top[i] - PIV_Y) * k;
  }
  const dx = (X[n - 1] - X[0]) / (n - 1);
  const bottom = (P.bottom - PIV_Y) * k;
  const plateau = (P.plateau - PIV_Y) * k;
  const dips = P.dips.map((d) => ({ x: d.x * k, y: (d.bottom - PIV_Y) * k, depth: d.depth * k }));

  // Lowest centre height at which a circle of radius r at x = cx clears the profile.
  function restHeight(cx, r) {
    let h = -Infinity;
    const i0 = Math.max(0, Math.floor((cx - r - X[0]) / dx));
    const i1 = Math.min(n - 1, Math.ceil((cx + r - X[0]) / dx));
    for (let i = i0; i <= i1; i++) {
      const ddx = X[i] - cx;
      if (Math.abs(ddx) <= r) h = Math.max(h, Y[i] + Math.sqrt(r * r - ddx * ddx));
    }
    return h;
  }

  // The circles: [dip, offset from the dip centre (reel px), radius (reel px)]. One in the first
  // dip, two in the second, three in the third; the fourth stays empty, under the slot (as in the
  // sketch this is drawn from).
  const WHEELS_PX = [
    [0, 0, 30],
    [1, -24, 21],
    [1, 24, 21],
    [2, -36, 17.5],
    [2, 0, 17.5],
    [2, 36, 17.5],
  ];
  const GAP = 1.5 / R; //   clearance between a circle and the bar: it turns freely on its axle
  const e = 12.5 / R; //    crank radius: axle to crank pin, the same on every circle

  // Rest pose of the spider (platform frame): the hub where the reel's disk centre was, 357 px
  // down the screen with the links hanging straight. At rest every crank pin hangs straight
  // below its axle.
  const hub = { x: 20 / R, y: (REEL.A[1] + REEL.L - 357) / R };

  // The slot points down to the right. Branches to the first two dips leave the hub itself; those
  // to the third dip would cross the slot's lower wall and k2 near the hub, so they leave from a
  // joint on the outside of that wall instead (still one rigid frame).
  const slotDir = -20 * (Math.PI / 180); // slot direction K e1 (maths angle), fixed
  const slotLen = 0.88; //                  hub to the closed end of the slot, in R
  const slotHalf = REEL.slotHalf / R;
  const cs = Math.cos(slotDir);
  const ss = Math.sin(slotDir);
  const jS = 84.5 / R; //                   joint: along the slot...
  const jN = slotHalf + 1.4 / R; //         ...and just outside its lower wall
  const joint = { x: jS * cs + jN * ss, y: jS * ss - jN * cs };

  const wheels = WHEELS_PX.map(([di, off, rp]) => {
    const cx = dips[di].x + off / R;
    const r = rp / R;
    const cy = restHeight(cx, r) + GAP;
    const b = di === 2 ? joint : { x: 0, y: 0 }; // where the branch starts, relative to the hub
    // dx, dy: hub to the crank pin at rest
    return { dip: di, r, x: cx, y: cy, bx: b.x, by: b.y, dx: cx - hub.x, dy: cy - e - hub.y };
  });

  // The spider (hub, slot and its frame, branches) only translates, so only its centre of mass
  // S2 matters, for the label: 45 % in the hub and slot frame, 55 % spread along the branches.
  let mx = 0.12 * 0.5 * slotLen * cs;
  let my = 0.12 * 0.5 * slotLen * ss;
  for (const w of wheels) {
    mx += (0.55 / wheels.length) * ((w.bx + w.dx) / 2);
    my += (0.55 / wheels.length) * ((w.by + w.dy) / 2);
  }
  // Circle inertias are set in the physics; their relative share goes by r^4 (solid disks).
  let r4 = 0;
  for (const w of wheels) r4 += w.r ** 4;
  for (const w of wheels) w.share = w.r ** 4 / r4;

  return {
    k, //            R per model unit
    SB, //           reel px per model unit
    PIV_X,
    PIV_Y,
    n,
    X, //            profile top, physics units
    Y,
    dx,
    x0: X[0],
    x1: X[n - 1],
    bottom,
    plateau,
    dips,
    wheels,
    e, //            crank radius
    hub, //          rest position of the hub M (platform frame)
    S2: { x: mx, y: my }, // spider centre of mass, relative to the hub
    slotDir,
    slotLen,
    slotHalf,
    joint, //        branch joint under the slot, relative to the hub
    postX: -355 / R, //               damper post on the first plateau
    post: { x: -355 / R, y: (REEL.A[1] + REEL.L - 357) / R }, // damper anchor, at hub height
    O: { x: REEL.a / 2 / R, y: REEL.L / R }, // pivot O relative to S1 at phi = 0 (k1 anchor)
    restHeight,
  };
})();

const KD_YDIM = 0.42; // offset of the y dimension above the slot axis, in R (room for k2's label)

// Screen positions for a physics state s = [phi, psi, y, ...]. Writes `o`.
//   phi: swing angle (> 0: platform displaced right). psi: angle all circles have turned
//   (maths convention, counter-clockwise > 0). y: block centre from M along the slot.
function kinderPose(s, o) {
  const R = REEL.R;
  const K = KINDER;
  const phi = s[0];
  const psi = s[1];
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  o.phi = phi;
  o.psi = psi;
  o.S1x = (REEL.A[0] + REEL.O[0]) / 2 + REEL.L * sp; // platform frame origin on screen
  o.S1y = REEL.A[1] + REEL.L * cp;
  o.Wx = o.S1x - REEL.a / 2; //                          link 4 pivot (W origin)
  o.Wy = o.S1y;
  o.Ex = o.S1x + REEL.a / 2; //                          link 5 pivot
  o.Ey = o.S1y;
  // Crank pins sit at e (sin psi, -cos psi) from their axles; the spider moves with them.
  const ex = K.e * Math.sin(psi);
  const ey = -K.e * Math.cos(psi);
  o.Mx = o.S1x + (K.hub.x + ex) * R; //                  hub M
  o.My = o.S1y - (K.hub.y + ey + K.e) * R;
  o.e1x = Math.cos(K.slotDir); //                        K e1 (slot direction), fixed
  o.e1y = -Math.sin(K.slotDir);
  o.e2x = -Math.sin(K.slotDir); //                       K e2
  o.e2y = -Math.cos(K.slotDir);
  o.y = s[2];
  o.Bx = o.Mx + s[2] * R * o.e1x; //                     block centre S3
  o.By = o.My + s[2] * R * o.e1y;
  o.S2x = o.Mx + K.S2.x * R; //                          spider centre of mass S2
  o.S2y = o.My - K.S2.y * R;
  o.Px = o.Mx + KD_YDIM * R * o.e2x; //                  where the y dimension starts
  o.Py = o.My + KD_YDIM * R * o.e2y;
  const W = K.wheels;
  if (!o.cx) {
    o.cx = new Float64Array(W.length); //                circle centres (axles)
    o.cy = new Float64Array(W.length);
    o.px = new Float64Array(W.length); //                crank pins
    o.py = new Float64Array(W.length);
    o.bx = new Float64Array(W.length); //                where each branch starts
    o.by = new Float64Array(W.length);
  }
  for (let i = 0; i < W.length; i++) {
    o.cx[i] = o.S1x + W[i].x * R;
    o.cy[i] = o.S1y - W[i].y * R;
    o.px[i] = o.cx[i] + ex * R;
    o.py[i] = o.cy[i] - ey * R;
    o.bx[i] = o.Mx + W[i].bx * R;
    o.by[i] = o.My - W[i].by * R;
  }
  o.Jx = o.Mx + K.joint.x * R; //                        the branch joint under the slot
  o.Jy = o.My - K.joint.y * R;
  o.postX = o.S1x + K.postX * R;
  o.postAnchorY = o.S1y - K.post.y * R;
  return o;
}

// ---- kinder-physics.js ---------------------------------------------------------------
// Physics of the Kinder-bar figure (see kinder-geometry.js for the coordinates).
//
// The platform (the bar, mass m1, circles included) hangs from two parallel links of length l and
// swings by phi, with the torsion spring k_phi at the left pivot: the reel's swing, the reel's
// fitted parameters. The circles turn together by psi on axles in the dips (inertia Jc in total).
// The spider (hub, slot frame and branches, mass m2) rides on their crank pins, so it translates
// by e (sin psi, 1 - cos psi) relative to the bar: a pendulum of length e, carried by flywheels.
// It is tied to the fixed pivot O by the spring k1 and to the post on the bar by the damper c1.
// The block m3 slides in the slot at distance y from M on the spring k2.
//
// Generalised coordinates q = [phi, psi, y]; state s = [q, q']. Kane's method as in
// reel-physics.js: for every body, velocity = J(q) q' and acceleration = J q'' + bias(q, q'), so
//   sum m J^T J q'' = sum J^T (F - m bias) + Q.

const KINDER_DEFAULTS = {
  l: 2.378, //    link length (as the reel)
  g: 40.16, //    g / R, as fitted to the reel: a 1.53 s swing
  m1: 15.81, //   platform with its circles, relative to the spider m2 = 1
  m2: 1,
  m3: 0.08,
  Jc: 0.2, //     all circles together. Sets their own rhythm (3.75 rad/s) just under the swing's
  //              (4.1 rad/s): released like the reel, they turn about +-50 deg, beating with it
  kphi: 24.51,
  cphi: 0,
  k1: 15, //      hub to pivot O
  c1: 0.4, //     post to hub
  cpsi: 0.01, //  axle friction
  k2: 98, //      block spring (35 rad/s), as the reel
  c2: 0.84,
  L0: 0.6553,
  yMin: 0.3, //   block stops in the slot
  yMax: 0.75,
  e: 0.3,
};

class KinderPhysics {
  constructor(params) {
    this.p = Object.assign({}, KINDER_DEFAULTS, params);
    this.s = new Float64Array(6); // phi, psi, y, phi', psi', y'
    this._k = [new Float64Array(6), new Float64Array(6), new Float64Array(6), new Float64Array(6)];
    this._tmp = new Float64Array(6);
    this._M = new Float64Array(9);
    this._r = new Float64Array(3);
    this.force = 0; // horizontal force on the platform (pointer drag)
    // k1 rest length: unstretched with the links hanging straight and the spider at rest
    // (the same expression as in _deriv at phi = psi = 0).
    const ox = KINDER.hub.x - KINDER.O.x;
    const oy = KINDER.hub.y - this.p.l;
    this.p.L1 = Math.sqrt(ox * ox + oy * oy);
    this.set(0, 0, this.restY());
  }

  // Block position at rest: the spring balances the weight's component along the slot.
  restY() {
    const p = this.p;
    return p.L0 - (p.m3 * p.g * Math.sin(KINDER.slotDir)) / p.k2;
  }

  set(phi, psi, y, dphi, dpsi, dy) {
    const s = this.s;
    s[0] = phi;
    s[1] = psi;
    s[2] = y;
    s[3] = dphi || 0;
    s[4] = dpsi || 0;
    s[5] = dy || 0;
  }

  _deriv(s, out) {
    const p = this.p;
    const K = KINDER;
    const M = this._M;
    const r = this._r;
    const phi = s[0];
    const psi = s[1];
    const y = s[2];
    const dp = s[3];
    const dq = s[4];
    const dy = s[5];
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    const cq = Math.cos(psi);
    const sq = Math.sin(psi);
    const ax = p.l * c; //                 platform velocity per phi'
    const ay = p.l * sn;
    const bx = -p.l * dp * dp * sn; //     platform bias acceleration
    const by = p.l * dp * dp * c;
    const qx = K.e * cq; //                spider velocity per psi'
    const qy = K.e * sq;
    const sbx = bx - K.e * dq * dq * sq; // spider bias acceleration
    const sby = by + K.e * dq * dq * cq;
    const e1x = Math.cos(K.slotDir);
    const e1y = Math.sin(K.slotDir);

    // Platform m1: J = [a, 0, 0].
    let m = p.m1;
    M[0] = m * (ax * ax + ay * ay);
    r[0] = ax * (-m * bx) + ay * (-m * p.g - m * by);
    M[1] = M[2] = M[4] = M[5] = M[8] = 0;
    r[1] = r[2] = 0;
    // Spider m2 at M: J = [a, q, 0].
    m = p.m2;
    let fx = -m * sbx;
    let fy = -m * p.g - m * sby;
    M[0] += m * (ax * ax + ay * ay);
    M[1] += m * (ax * qx + ay * qy);
    M[4] += m * (qx * qx + qy * qy);
    r[0] += ax * fx + ay * fy;
    r[1] += qx * fx + qy * fy;
    // Block m3 at M + y e1: J = [a, q, e1]; the slot does not turn, so no extra bias.
    m = p.m3;
    fx = -m * sbx;
    fy = -m * p.g - m * sby;
    M[0] += m * (ax * ax + ay * ay);
    M[1] += m * (ax * qx + ay * qy);
    M[2] += m * (ax * e1x + ay * e1y);
    M[4] += m * (qx * qx + qy * qy);
    M[5] += m * (qx * e1x + qy * e1y);
    M[8] += m * (e1x * e1x + e1y * e1y);
    r[0] += ax * fx + ay * fy;
    r[1] += qx * fx + qy * fy;
    r[2] += e1x * fx + e1y * fy;
    // The circles turning on their axles.
    M[4] += p.Jc;

    // Spring k1 from the hub to the fixed pivot O (positions relative to the pivots' midpoint).
    {
      const hx = p.l * sn + K.hub.x + K.e * sq - K.O.x;
      const hy = -p.l * c + K.hub.y + K.e * (1 - cq);
      const L = Math.sqrt(hx * hx + hy * hy) || 1e-9;
      const f = (-p.k1 * (L - p.L1)) / L;
      r[0] += f * (ax * hx + ay * hy);
      r[1] += f * (qx * hx + qy * hy);
    }
    // Damper c1 from the post to the hub, along the line between them.
    {
      const nx0 = K.hub.x + K.e * sq - K.post.x;
      const ny0 = K.hub.y + K.e * (1 - cq) - K.post.y;
      const L = Math.sqrt(nx0 * nx0 + ny0 * ny0) || 1e-9;
      const nx = nx0 / L;
      const ny = ny0 / L;
      const vn = dq * (qx * nx + qy * ny);
      r[1] += -p.c1 * vn * (qx * nx + qy * ny);
    }
    // Axle friction, block spring, the swing's torsion spring, the pointer.
    r[1] += -p.cpsi * dq;
    r[2] += -p.k2 * (y - p.L0) - p.c2 * dy;
    r[0] += -p.kphi * phi - p.cphi * dp + ax * this.force;

    M[3] = M[1];
    M[6] = M[2];
    M[7] = M[5];
    solve3(M, r);
    out[0] = dp;
    out[1] = dq;
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
    const p = this.p;
    if (s[2] < p.yMin) {
      s[2] = p.yMin;
      if (s[5] < 0) s[5] = -s[5] * p.e;
    } else if (s[2] > p.yMax) {
      s[2] = p.yMax;
      if (s[5] > 0) s[5] = -s[5] * p.e;
    }
  }

  // Total mechanical energy, from the bodies' velocities and heights directly (for the tests).
  energy() {
    const p = this.p;
    const K = KINDER;
    const s = this.s;
    const c = Math.cos(s[0]);
    const sn = Math.sin(s[0]);
    const cq = Math.cos(s[1]);
    const sq = Math.sin(s[1]);
    const vpx = p.l * s[3] * c;
    const vpy = p.l * s[3] * sn;
    const vhx = vpx + K.e * s[4] * cq;
    const vhy = vpy + K.e * s[4] * sq;
    const e1x = Math.cos(K.slotDir);
    const e1y = Math.sin(K.slotDir);
    const v3x = vhx + s[5] * e1x;
    const v3y = vhy + s[5] * e1y;
    const T =
      0.5 * p.m1 * (vpx * vpx + vpy * vpy) +
      0.5 * p.m2 * (vhx * vhx + vhy * vhy) +
      0.5 * p.m3 * (v3x * v3x + v3y * v3y) +
      0.5 * p.Jc * s[4] * s[4];
    const yp = -p.l * c;
    const yh = yp + K.hub.y + K.e * (1 - cq);
    const hx = p.l * sn + K.hub.x + K.e * sq - K.O.x;
    const L = Math.sqrt(hx * hx + yh * yh);
    const V =
      p.g * (p.m1 * yp + p.m2 * yh + p.m3 * (yh + s[2] * e1y)) +
      0.5 * p.kphi * s[0] * s[0] +
      0.5 * p.k1 * (L - p.L1) * (L - p.L1) +
      0.5 * p.k2 * (s[2] - p.L0) * (s[2] - p.L0);
    return T + V;
  }
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

// ---- kinder-draw.js ------------------------------------------------------------------
// The Kinder-bar figure in the reel's line-art language. Plain script, loaded after reel-draw.js
// (whose primitives, fonts and labels it reuses) and kinder-geometry.js. One public function:
//
//   drawKinder(ctx, d, pose, C)
//     ctx   1 unit = 1 reel pixel (1280 x 720, y down). All state changed here is restored.
//     d     build-in progress 0..1 (0 draws nothing, 1 the complete figure).
//     pose  kinderPose() output. C: colours ([r,g,b,a]); C.ink for lines and text, C.paper for
//           knock-outs, C.shade for the block.

const KD_HUB = 13; //     hub ring radius
// The crank radius is only 12.5 px: axle ring and pin stay small so the crank arm between them
// shows, and the pin (out to 15.5 px) clears the rim of the smallest circles (from 16.1 px).
const KD_AXLE = 4.5; //   circle axle ring radius
const KD_PIN = 3; //      crank pin dot radius
const KD_PSI = 1; //      the circle that carries the psi arc (left one in the second dip)
const KD_MLEAD = (106 * Math.PI) / 180; // canvas angle of M's leader: down the gap in the fan
let kdShade = '';
const kdShadeKey = [-1, -1, -1, -1];
let kdBarPath = null; //  the bar's outline relative to S1 (screen px), built once
let kdBarCum = null; //   cumulative length along it, closing edge included
let kdBarLen = 0;

function kdBuildBar() {
  const K = KINDER;
  const R = REEL.R;
  const pts = [];
  for (let i = 0; i < K.n; i++) pts.push(K.X[i] * R, -K.Y[i] * R);
  pts.push(K.x1 * R, -K.bottom * R, K.x0 * R, -K.bottom * R);
  kdBarPath = new Float32Array(pts);
  const n = pts.length / 2;
  kdBarCum = new Float32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const j = i % n; //   vertex n is vertex 0 again: the closing edge
    kdBarCum[i] = kdBarCum[i - 1] + Math.hypot(pts[2 * j] - pts[2 * i - 2], pts[2 * j + 1] - pts[2 * i - 1]);
  }
  kdBarLen = kdBarCum[n];
}

// Symbol with an upright subscript (labels the reel's table does not have); italic unless `up`.
function kdSym(main, sub, x, y, a, up) {
  if (a <= 0) return;
  const c = rdCtx;
  const ga = c.globalAlpha;
  c.globalAlpha = ga * (a > 1 ? 1 : a);
  const f = RD_FONTS[up ? F_UP : F_SYM];
  c.font = f;
  const w0 = c.measureText(main).width;
  let w1 = 0;
  if (sub) {
    c.font = RD_FONTS[F_SUB];
    w1 = c.measureText(sub).width;
  }
  const x0 = x - (w0 + w1) / 2;
  c.font = f;
  c.fillText(main, x0, y);
  if (sub) {
    c.font = RD_FONTS[F_SUB];
    c.fillText(sub, x0 + w0, y + 5);
  }
  c.globalAlpha = ga;
}

// Spring along the straight line from (x0, y0) to (x1, y1): lead-in, zigzag, lead-out.
function kdSpring(x0, y0, x1, y1, amp, half, t) {
  if (t <= 0) return;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const a = 0.16 * L;
  const b = 0.84 * L;
  const run = L * t;
  rdLine(x0, y0, x0 + ux * a, y0 + uy * a, run >= a ? 1 : run / a);
  if (run > a) rdZigzag(x0 + ux * a, y0 + uy * a, ux, uy, b - a, amp, half, run >= b ? 1 : (run - a) / (b - a));
  if (run > b) rdLine(x0 + ux * b, y0 + uy * b, x1, y1, (run - b) / (L - b));
}

function drawKinder(ctx, d, pose, C) {
  if (!(d > 0)) return;
  if (d > 1) d = 1;
  rdCtx = ctx;
  if (!kdBarPath) kdBuildBar();
  if (rdLaidOut !== rdFontGen) rdLayout(ctx);
  if (rdColor(rdInkKey, C.ink)) rdInkCss = css(C.ink);
  if (rdColor(rdPaperKey, C.paper)) rdPaperCss = css(C.paper);
  if (rdColor(kdShadeKey, C.shade)) kdShade = css(C.shade);
  const ink = rdInkCss;
  const paper = rdPaperCss;
  const K = KINDER;
  const R = REEL.R;
  const E = easeOut;
  const PI = Math.PI;

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 6;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.setLineDash(RD_NODASH);

  const Ax = REEL.A[0];
  const Ay = REEL.A[1];
  const Ox = REEL.O[0];
  const Oy = REEL.O[1];
  const cyl = REEL.ceilingY;
  const phi = pose.phi;
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const S1x = pose.S1x;
  const S1y = pose.S1y;
  const Wx = pose.Wx;
  const Wy = pose.Wy;
  const Ex = pose.Ex;
  const Ey = pose.Ey;
  const Mx = pose.Mx;
  const My = pose.My;
  const e1x = pose.e1x, e1y = pose.e1y, e2x = pose.e2x, e2y = pose.e2y;
  rdMx = Mx;
  rdMy = My;
  rdE1x = e1x;
  rdE1y = e1y;
  rdE2x = e2x;
  rdE2y = e2y;
  rdBx = pose.Bx;
  rdBy = pose.By;
  rdZ1x = cp;
  rdZ1y = -sp;
  rdZ2x = -sp;
  rdZ2y = -cp;
  rdLx = sp;
  rdLy = cp;
  const barTop = S1y - K.plateau * R; //  plateau line
  const barBot = S1y - K.bottom * R;
  const yR = pose.y * R;
  const nW = K.wheels.length;
  let t;

  // ===== ceiling, hatching, N. N. line, supports ================================================
  ctx.lineWidth = RD_W_THICK;
  rdLine(REEL.ceilingX0, cyl, REEL.ceilingX1, cyl, E(seg(d, 0, 0.1)));
  ctx.lineWidth = RD_W_THIN + 0.15;
  for (let k = 0; k < 20; k++) {
    const t0 = 0.03 + 0.004 * k;
    const hx = 170 + 49.07 * k;
    rdLine(hx, cyl, hx + 19.5, cyl - 19.5, E(seg(d, t0, t0 + 0.05)));
  }
  ctx.lineWidth = RD_W_THIN;
  ctx.setLineDash(RD_DASHDOT);
  rdLine(Ax, Ay, Ox, Oy, E(seg(d, 0.06, 0.22)));
  ctx.setLineDash(RD_NODASH);
  ctx.lineWidth = 3.6;
  t = E(seg(d, 0.08, 0.15));
  rdLine(Ax, Ay, Ax - 23.1, cyl, t);
  rdLine(Ax, Ay, Ax + 23.1, cyl, t);
  rdLine(Ox, Oy, Ox - 23.9, cyl, t);
  rdLine(Ox, Oy, Ox + 23.9, cyl, t);

  // ===== the bar (platform 1): the model's side profile ===========================================
  t = E(seg(d, 0.12, 0.34));
  if (t > 0) {
    const P = kdBarPath;
    const n = P.length / 2;
    ctx.beginPath();
    ctx.moveTo(S1x + P[0], S1y + P[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(S1x + P[2 * i], S1y + P[2 * i + 1]);
    ctx.closePath();
    ctx.globalAlpha = t;
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.lineWidth = RD_W_THICK;
    // the stroke draws in at an even speed along the outline
    const target = t * kdBarLen;
    const cum = kdBarCum;
    ctx.beginPath();
    ctx.moveTo(S1x + P[0], S1y + P[1]);
    if (t >= 1) {
      for (let i = 1; i < n; i++) ctx.lineTo(S1x + P[2 * i], S1y + P[2 * i + 1]);
      ctx.closePath();
    } else {
      for (let i = 1; i <= n; i++) {
        const j = i % n;
        if (cum[i] <= target) {
          ctx.lineTo(S1x + P[2 * j], S1y + P[2 * j + 1]);
          continue;
        }
        const f = (target - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        ctx.lineTo(S1x + P[2 * i - 2] + (P[2 * j] - P[2 * i - 2]) * f, S1y + P[2 * i - 1] + (P[2 * j + 1] - P[2 * i - 1]) * f);
        break;
      }
    }
    ctx.stroke();
  }

  // ===== links 4 and 5, k_phi, pivots ===========================================================
  ctx.lineWidth = RD_W_HEAVY;
  t = E(seg(d, 0.15, 0.3));
  rdLine(Ax, Ay, Wx, Wy, t);
  rdLine(Ox, Oy, Ex, Ey, t);
  ctx.lineWidth = 3.7;
  rdSpiral(Ax, Ay, Math.atan2(-cp, sp), E(seg(d, 0.12, 0.27)));
  t = E(seg(d, 0.1, 0.17));
  if (t > 0) {
    ctx.fillStyle = paper;
    ctx.beginPath();
    ctx.arc(Ax, Ay, 6 * t, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.lineWidth = RD_W_THICK;
    rdArc(Ax, Ay, 8, PI, PI + TAU, t);
  }
  // double rings at O and W (pin joints), open circle at E
  t = E(seg(d, 0.15, 0.23));
  for (let k = 0; k < 2; k++) {
    if (t <= 0) break;
    const x = k ? Wx : Ox;
    const y = k ? Wy : Oy;
    ctx.fillStyle = paper;
    ctx.beginPath();
    ctx.arc(x, y, 14.5 * t, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.lineWidth = 3.5;
    rdArc(x, y, 14.5, PI, PI + TAU, t);
    ctx.lineWidth = 3;
    rdArc(x, y, 7, PI, PI + TAU, t);
  }
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

  // ===== post on the first plateau ===============================================================
  const postX = pose.postX;
  const postTop = barTop - REEL.postH;
  t = E(seg(d, 0.22, 0.29));
  if (t > 0) {
    ctx.globalAlpha = t;
    ctx.beginPath();
    ctx.moveTo(postX - 15, barTop);
    ctx.lineTo(postX + 15, barTop);
    ctx.lineTo(postX, barTop - 17);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = RD_W_HEAVY;
  rdLine(postX, barTop - 1, postX, postTop, E(seg(d, 0.25, 0.37)));

  // ===== circles in the dips: outline, crank arm, axle =============================================
  t = E(seg(d, 0.3, 0.45));
  if (t > 0) {
    const a0 = -PI / 2;
    for (let i = 0; i < nW; i++) {
      const cx = pose.cx[i];
      const cy = pose.cy[i];
      ctx.lineWidth = 2.8;
      rdArc(cx, cy, K.wheels[i].r * R, a0, a0 + TAU, t);
      ctx.lineWidth = RD_W_MED;
      const dx = pose.px[i] - cx;
      const dy = pose.py[i] - cy;
      const L = Math.sqrt(dx * dx + dy * dy) || 1;
      rdLine(cx + (dx / L) * KD_AXLE, cy + (dy / L) * KD_AXLE, pose.px[i] - (dx / L) * KD_PIN, pose.py[i] - (dy / L) * KD_PIN, t);
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.arc(cx, cy, KD_AXLE * t, 0, TAU);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.lineWidth = 2;
      rdArc(cx, cy, KD_AXLE, PI, PI + TAU, t);
      rdDot(cx, cy, 1.6, t);
    }
  }

  // ===== damper c1 from the post to the hub =======================================================
  {
    const x0 = postX + 4;
    const y0 = pose.postAnchorY;
    const dx = Mx - x0;
    const dy = My - y0;
    const L = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
    const nx = -uy;
    const ny = ux;
    const at = (s, n) => {
      rdOutX = x0 + ux * s + nx * n;
      rdOutY = y0 + uy * s + ny * n;
    };
    ctx.lineWidth = RD_W_MED;
    const sP = 0.47 * L; //  piston plate
    const sC0 = 0.33 * L; // cylinder, open end
    const sC1 = 0.64 * L; // cylinder, closed end
    t = E(seg(d, 0.36, 0.48));
    rdLine(x0, y0, x0 + ux * sP, y0 + uy * sP, t);
    at(L - KD_HUB, 0);
    rdLine(rdOutX, rdOutY, x0 + ux * sC1, y0 + uy * sC1, t);
    t = E(seg(d, 0.44, 0.54));
    if (t > 0) {
      at(sP, -11);
      let ax = rdOutX, ay = rdOutY;
      at(sP, 11);
      rdLine(ax, ay, rdOutX, rdOutY, t);
      at(sC1, -20);
      ax = rdOutX;
      ay = rdOutY;
      at(sC1, 20);
      rdLine(ax, ay, rdOutX, rdOutY, t);
      at(sC1, -20);
      ax = rdOutX;
      ay = rdOutY;
      at(sC0, -20);
      rdLine(ax, ay, rdOutX, rdOutY, t);
      at(sC1, 20);
      ax = rdOutX;
      ay = rdOutY;
      at(sC0, 20);
      rdLine(ax, ay, rdOutX, rdOutY, t);
    }
    at(0.5 * L, -40); //  above the cylinder (n is to the left of the travel direction)
    pose._c1x = rdOutX;
    pose._c1y = rdOutY + 9;
  }

  // ===== spring k1 from the hub up to pivot O =====================================================
  {
    const dx = Ox - Mx;
    const dy = Oy - My;
    const L = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
    ctx.lineWidth = RD_W_MED;
    kdSpring(Mx + ux * KD_HUB, My + uy * KD_HUB, Ox - ux * 14.5, Oy - uy * 14.5, 12.5, 12, E(seg(d, 0.4, 0.6)));
    pose._k1x = (Mx + Ox) / 2 - uy * 34;
    pose._k1y = (My + Oy) / 2 + ux * 34 + 9;
  }

  // ===== spider: branches to the crank pins, slot, spring k2, block, hub ===========================
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'round';
  for (let i = 0; i < nW; i++) {
    // from the hub ring, or from the joint under the slot (third dip)
    const sx = pose.bx[i];
    const sy = pose.by[i];
    const r0 = K.wheels[i].bx === 0 && K.wheels[i].by === 0 ? KD_HUB : 0;
    const dx = pose.px[i] - sx;
    const dy = pose.py[i] - sy;
    const L = Math.sqrt(dx * dx + dy * dy) || 1;
    const t0 = 0.34 + 0.02 * i;
    rdLine(sx + (dx / L) * r0, sy + (dy / L) * r0, pose.px[i], pose.py[i], E(seg(d, t0, t0 + 0.14)));
  }
  ctx.lineCap = 'butt';
  t = E(seg(d, 0.42, 0.5));
  for (let i = 0; i < nW; i++) rdDot(pose.px[i], pose.py[i], KD_PIN, t); // crank pins
  // slot: two walls and the closed end
  const sw = REEL.slotHalf;
  const sEnd = K.slotLen * R;
  ctx.lineWidth = 2.8;
  t = E(seg(d, 0.4, 0.52));
  if (t > 0) {
    rdK(KD_HUB + 2, sw);
    let x0 = rdOutX, y0 = rdOutY;
    rdK(sEnd, sw);
    rdLine(x0, y0, rdOutX, rdOutY, t);
    rdK(KD_HUB + 2, -sw);
    x0 = rdOutX;
    y0 = rdOutY;
    rdK(sEnd, -sw);
    rdLine(x0, y0, rdOutX, rdOutY, t);
    rdK(sEnd, -sw - 1.4);
    x0 = rdOutX;
    y0 = rdOutY;
    rdK(sEnd, sw + 1.4);
    rdLine(x0, y0, rdOutX, rdOutY, t > 0.9 ? (t - 0.9) / 0.1 : 0);
    // the slot frame joins the hub
    rdK(KD_HUB * 0.7, sw);
    x0 = rdOutX;
    y0 = rdOutY;
    rdK(KD_HUB * 0.7, -sw);
    rdLine(x0, y0, rdOutX, rdOutY, t);
  }
  rdDot(pose.Jx, pose.Jy, 4, E(seg(d, 0.44, 0.5))); // joint of the third dip's branches
  // k2 from the hub ring to the block's inner face: lead-in, zigzag, lead-out, drawn as one run
  const sF = yR - REEL.block / 2;
  t = E(seg(d, 0.46, 0.62));
  if (t > 0) {
    const k2a = KD_HUB + 0.137 * (sF - KD_HUB);
    const k2b = KD_HUB + 0.866 * (sF - KD_HUB);
    const run = (sF - KD_HUB) * t;
    ctx.lineWidth = 3.4;
    rdK(KD_HUB, -1.2);
    const x0 = rdOutX;
    const y0 = rdOutY;
    rdK(k2a, -1.2);
    rdLine(x0, y0, rdOutX, rdOutY, Math.min(1, run / (k2a - KD_HUB)));
    const ts = (run - (k2a - KD_HUB)) / (k2b - k2a);
    if (ts > 0) {
      ctx.lineWidth = RD_W_MED;
      rdZigzag(rdOutX, rdOutY, e1x, e1y, k2b - k2a, 20, 8, ts > 1 ? 1 : ts);
    }
    const tl = (run - (k2b - KD_HUB)) / (sF - k2b);
    if (tl > 0) {
      ctx.lineWidth = 3.4;
      rdK(k2b, -1.2);
      const x1 = rdOutX;
      const y1 = rdOutY;
      rdK(sF, -1.2);
      rdLine(x1, y1, rdOutX, rdOutY, Math.min(1, tl));
    }
  }
  // block m3
  t = E(seg(d, 0.5, 0.6));
  if (t > 0) {
    const h = (REEL.block / 2) * (0.6 + 0.4 * t);
    ctx.globalAlpha = t;
    ctx.beginPath();
    rdB(-h, -h);
    ctx.moveTo(rdOutX, rdOutY);
    rdB(h, -h);
    ctx.lineTo(rdOutX, rdOutY);
    rdB(h, h);
    ctx.lineTo(rdOutX, rdOutY);
    rdB(-h, h);
    ctx.lineTo(rdOutX, rdOutY);
    ctx.closePath();
    ctx.fillStyle = kdShade;
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.lineWidth = 3.4;
    ctx.lineJoin = 'miter';
    ctx.stroke();
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 1;
  }
  // hub M: three marks, as the reel's
  t = E(seg(d, 0.36, 0.46));
  if (t > 0) {
    ctx.fillStyle = paper;
    ctx.beginPath();
    ctx.arc(Mx, My, KD_HUB * t, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.lineWidth = 3;
    rdArc(Mx, My, KD_HUB, PI, PI + TAU, t);
    ctx.lineWidth = 2.5;
    rdArc(Mx, My, 7, PI, PI + TAU, t);
    rdDot(Mx, My, 2.5, t);
  }

  // ===== frames I and Z at O, phi indicator, g, W frame ===========================================
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.45, 0.56));
  rdArrow(Ox, Oy, Ox + 101, Oy, t, 14, 8);
  rdArrow(Ox, Oy, Ox, Oy - 101, t, 14, 8);
  t = E(seg(d, 0.5, 0.61));
  rdArrow(Ox, Oy, Ox + 100 * rdZ1x, Oy + 100 * rdZ1y, t, 14, 8);
  rdArrow(Ox, Oy, Ox + 100 * rdZ2x, Oy + 100 * rdZ2y, t, 14, 8);
  ctx.lineCap = 'butt';
  ctx.lineWidth = RD_W_THIN;
  rdLine(Ox + 139.5, Oy, Ox + 247.5, Oy, E(seg(d, 0.52, 0.58)));
  rdLine(Ox + 140 * rdZ1x, Oy + 140 * rdZ1y, Ox + 248 * rdZ1x, Oy + 248 * rdZ1y, E(seg(d, 0.55, 0.62)));
  rdDot(Ox + 198.5, Oy, 6.5, E(seg(d, 0.57, 0.62)));
  t = E(seg(d, 0.6, 0.69));
  if (t > 0) {
    const rA = 198.5;
    ctx.lineWidth = RD_W_THICK;
    const a1 = -phi * t;
    const back = (phi > 0 ? 1 : -1) * Math.min(Math.abs(phi * t), 2.2 / rA);
    rdArc(Ox, Oy, rA, 0, a1 + back, 1);
    ctx.lineCap = 'round';
    const sg = phi >= 0 ? -1 : 1;
    const k = Math.min(1, (Math.abs(phi) * rA) / 16);
    rdHead(Ox + rA * Math.cos(a1), Oy + rA * Math.sin(a1), -Math.sin(a1) * sg, Math.cos(a1) * sg, 13 * k, 7 * k, t < 0.25 ? t * 4 : 1);
    ctx.lineCap = 'butt';
  }
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
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.33, 0.45));
  rdArrow(Wx, Wy, Wx + 100, Wy, t, 14, 8);
  rdArrow(Wx, Wy, Wx, Wy - 99, t, 14, 8);
  ctx.lineCap = 'butt';

  // ===== dashed lines, K frame, dimensions ========================================================
  ctx.lineWidth = RD_W_THIN;
  ctx.setLineDash(RD_DASH);
  t = E(seg(d, 0.48, 0.63));
  if (t > 0) {
    let L = barTop - 2 - 146;
    ctx.lineDashOffset = 10 - (L % 16);
    rdLine(S1x, barTop - 2, S1x, 146, t);
    L = My - KD_HUB - 141;
    ctx.lineDashOffset = 10 - (L % 16);
    rdLine(Mx, My - KD_HUB, Mx, 141, t);
    ctx.lineDashOffset = 0;
    // psi reference: straight down from the axle of the circle that carries the psi arc
    rdLine(pose.cx[KD_PSI], pose.cy[KD_PSI] + KD_AXLE, pose.cx[KD_PSI], pose.cy[KD_PSI] + 58, t);
  }
  ctx.setLineDash(RD_DASHDOT);
  t = E(seg(d, 0.55, 0.68));
  if (t > 0) {
    const dx = S1x - Mx;
    const dy = S1y - My;
    const L = Math.sqrt(dx * dx + dy * dy) || 1;
    rdLine(Mx + (dx / L) * KD_HUB, My + (dy / L) * KD_HUB, S1x, S1y, t);
  }
  ctx.setLineDash(RD_NODASH);
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.6, 0.75));
  if (t > 0) {
    rdK(0.5, KD_HUB);
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
  // a/2 a/2 under the bar
  const yDim = barBot + 48;
  ctx.lineWidth = RD_W_THIN;
  t = E(seg(d, 0.6, 0.67));
  rdLine(Wx, barBot + 8, Wx, yDim + 10, t);
  rdLine(S1x, barBot + 8, S1x, yDim + 10, t);
  rdLine(Ex, barBot + 8, Ex, yDim + 10, t);
  ctx.lineWidth = 3.1;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.63, 0.76));
  if (t > 0) {
    const mL = (Wx + S1x) / 2;
    const mR = (S1x + Ex) / 2;
    rdArrow(mL, yDim, Wx + 1, yDim, t, 12, 6.5);
    rdArrow(mL, yDim, S1x - 1, yDim, t, 12, 6.5);
    rdArrow(mR, yDim, S1x + 1, yDim, t, 12, 6.5);
    rdArrow(mR, yDim, Ex - 1, yDim, t, 12, 6.5);
  }
  // x: from the S1 line to the M line, above the hub
  const yX = My - 148;
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'butt';
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
  // psi: on one circle, from straight down to its crank arm
  t = E(seg(d, 0.72, 0.81));
  const psi = pose.psi;
  if (t > 0 && Math.abs(psi) > 0.004) {
    const rP = 40;
    const cx = pose.cx[KD_PSI];
    const cy = pose.cy[KD_PSI];
    const a0 = PI / 2; //          canvas angle of straight down
    const a1 = a0 - psi * t; //    psi > 0: counter-clockwise on screen
    const sg = psi > 0 ? -1 : 1;
    const back = sg * Math.min(Math.abs(psi * t), 2 / rP);
    ctx.lineWidth = RD_W_THICK;
    rdArc(cx, cy, rP, a0, a1 - back, 1);
    ctx.lineCap = 'round';
    const k = Math.min(1, (Math.abs(psi) * rP) / 16);
    rdHead(cx + rP * Math.cos(a1), cy + rP * Math.sin(a1), -Math.sin(a1) * sg, Math.cos(a1) * sg, 13 * k, 7.5 * k, t < 0.25 ? t * 4 : 1);
    ctx.lineCap = 'butt';
  }
  // y: from P along e1 to the block-face extension line
  ctx.lineWidth = RD_W_THIN;
  t = E(seg(d, 0.72, 0.8));
  if (t > 0) {
    rdK(sF + 0.5, REEL.block / 2 + 1);
    const x1 = rdOutX;
    const y1 = rdOutY;
    rdK(sF + 0.5, KD_YDIM * R + 11);
    rdLine(x1, y1, rdOutX, rdOutY, t);
  }
  ctx.lineWidth = RD_W_THICK;
  ctx.lineCap = 'round';
  t = E(seg(d, 0.74, 0.84));
  if (t > 0) {
    rdK(sF + 0.5, KD_YDIM * R);
    rdArrow(pose.Px, pose.Py, rdOutX, rdOutY, t, 13, 7.5);
  }
  ctx.lineCap = 'butt';
  rdDot(pose.Px, pose.Py, 6, E(seg(d, 0.74, 0.8)));

  // ===== labels, circled numbers, dots =============================================================
  if (d > 0.75) {
    const la = (i) => seg(d, 0.75 + 0.2 * (i / 40), 0.8 + 0.2 * (i / 40));
    ctx.lineWidth = RD_W_THIN;
    // 1: the bar
    rdCircled(1, Wx + 258, barBot + 30, seg(d, 0.77, 0.86));
    rdLeader(Wx + 258, barBot + 30, Wx + 272, barBot - 4, seg(d, 0.8, 0.88));
    // 4, 5: links
    rdL(Ax, Ay, 124.3, 74);
    const c4x = rdOutX, c4y = rdOutY;
    rdCircled(4, c4x, c4y, seg(d, 0.78, 0.87));
    rdL(Ax, Ay, 198, 0);
    rdLeader(c4x, c4y, rdOutX, rdOutY, seg(d, 0.81, 0.89));
    rdL(Ox, Oy, 321.6, 75.1);
    const c5x = rdOutX, c5y = rdOutY;
    rdCircled(5, c5x, c5y, seg(d, 0.79, 0.88));
    rdL(Ox, Oy, 394, 0);
    rdLeader(c5x, c5y, rdOutX, rdOutY, seg(d, 0.82, 0.9));
    // 2: the spider, on its second branch; its mass m2 written beside it
    const b0x = (Mx + pose.px[1]) / 2;
    const b0y = (My + pose.py[1]) / 2;
    const c2x = b0x - 70;
    const c2y = b0y - 30;
    rdCircled(2, c2x, c2y, seg(d, 0.8, 0.89));
    rdLeader(c2x, c2y, b0x - 3, b0y - 2, seg(d, 0.83, 0.91));
    // 3: block
    rdB(87.2, -88.7);
    const c3x = rdOutX, c3y = rdOutY;
    rdCircled(3, c3x, c3y, seg(d, 0.81, 0.9));
    rdB(21, -16.9);
    rdLeader(c3x, c3y, rdOutX, rdOutY, seg(d, 0.84, 0.92));
    // 6: the circles; numbered on the single one in the first dip, from inside the bar
    {
      const cx = pose.cx[0];
      const cy = pose.cy[0];
      const r = K.wheels[0].r * R;
      const nx = cx - 44;
      const ny = cy + 42;
      ctx.lineWidth = RD_W_THIN + 0.1;
      const a = seg(d, 0.82, 0.9);
      rdArc(nx, ny, 17.5, -PI / 2, -PI / 2 + TAU, a);
      kdSym('6', '', nx, ny + 9.5, (a - 0.4) / 0.6, true);
      ctx.lineWidth = RD_W_THIN;
      rdLeader(nx, ny, cx - r * 0.7, cy + r * 0.7, seg(d, 0.85, 0.93));
    }

    t = seg(d, 0.84, 0.94);
    if (t > 0) {
      rdLine(Ox + 13.7, Oy + 8.3, Ox + 122.5, Oy + 73.5, t); //            I e3 = Z e3
      rdLine(S1x - 7, S1y + 5.5, S1x - 38.5, barBot + 26, t); //          S1
      rdLine(Ex - 121.5, barTop + 30, Ex - 83.5, barBot + 26, t); //      m1
      // M: leader straight down the gap between the branch fans
      const mc = Math.cos(KD_MLEAD);
      const ms = Math.sin(KD_MLEAD);
      rdLine(Mx + KD_HUB * mc, My + KD_HUB * ms, Mx + 104 * mc, My + 104 * ms, t);
      let x0, y0;
      rdB(122, 12); //                                                     S3, to the right
      rdLine(rdBx, rdBy, rdOutX, rdOutY, t);
      rdB(30.6, 15.3); //                                                  m3
      x0 = rdOutX;
      y0 = rdOutY;
      rdB(144, 41);
      rdLine(x0, y0, rdOutX, rdOutY, t);
    }
    t = E(seg(d, 0.76, 0.84));
    rdDot(S1x, S1y, 6.5, t);
    rdDot(pose.S2x, pose.S2y, 6.5, t);
    rdDot(rdBx, rdBy, 6.5, t);

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
    rdText(12, Wx + 106.5, barBot + 26, la(i++)); //                    W e1
    rdText(17, (Wx + S1x) / 2, yDim - 13, la(i++)); //                  a/2
    rdText(18, (S1x + Ex) / 2, yDim - 13, la(i++)); //                  a/2
    rdText(15, S1x - 50.5, barBot + 47, la(i++)); //                    S1
    rdText(16, Ex - 70.5, barBot + 47, la(i++)); //                     m1
    rdText(20, pose._k1x, pose._k1y, la(i++)); //                       k1
    rdText(21, pose._c1x, pose._c1y, la(i++)); //                       c1
    rdText(23, (S1x + Mx) / 2, My - 161.5, la(i++)); //                 x
    {
      const am = PI / 2 - psi / 2; //                                   middle of the psi arc
      rdText(24, pose.cx[KD_PSI] + 58 * Math.cos(am), pose.cy[KD_PSI] + 58 * Math.sin(am) + 9, la(i++)); // psi
    }
    rdK(57.8, KD_YDIM * R + 17.5);
    rdText(25, rdOutX, rdOutY, la(i++)); //                             y
    rdText(28, Mx + 118 * Math.cos(KD_MLEAD), My + 118 * Math.sin(KD_MLEAD) + 18, la(i++)); // M
    rdK(-28.1, -37.2);
    rdText(34, rdOutX, rdOutY, la(i++)); //                             K e3
    rdK(58, 46);
    rdText(22, rdOutX, rdOutY + 9, la(i++)); //                         k2, above its spring
    rdText(29, pose.S2x + 25, pose.S2y + 7, la(i++)); //                S2
    rdB(140, 6);
    rdText(30, rdOutX, rdOutY + 9, la(i++)); //                         S3
    rdB(154.3, 43.9);
    rdText(31, rdOutX, rdOutY, la(i++)); //                             m3
    rdB(103.8, -35.9);
    rdText(32, rdOutX, rdOutY, la(i++)); //                             K e1
    rdK(0.5 - 35, 222 - 5.5);
    rdText(33, rdOutX, rdOutY, la(i++)); //                             K e2
    kdSym('m', '2', c2x - 44, c2y + 9, la(i++)); //                    m2, beside its circled 2
    kdSym('e', '', (pose.cx[0] + pose.px[0]) / 2 + 13, (pose.cy[0] + pose.py[0]) / 2 + 4, la(i++)); // e
  }

  ctx.restore();
}

// ---- kinder-gl.js --------------------------------------------------------------------
// The bar model in 3D: a minimal GLB reader and a WebGL2 renderer, no dependencies.
//
// The renderer works in the figure's own space, reel pixels (y down): the element hands it the
// same camera (scale s and offset ox, oy, CSS px, times dpr) that the line-art canvas uses. The
// model is placed by a centre (reel px), a scale (reel px per model unit) and three angles; with
// the angles at zero and the perspective at zero it is an exact orthographic side view, whose
// outline is the profile the line art draws (both come from this mesh, kinder-profile.js).

// Read a .glb (ArrayBuffer): the first mesh primitive's positions, normals, UVs and indices, and
// the base colour and normal map images as { mime, bytes }. Throws on anything else.
function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  const view = (i) => {
    const v = json.bufferViews[i];
    return { off: binStart + (v.byteOffset || 0), len: v.byteLength, stride: v.byteStride || 0 };
  };
  const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const accessor = (i) => {
    const a = json.accessors[i];
    const v = view(a.bufferView);
    const n = NCOMP[a.type];
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
    if (!T) throw new Error('unsupported accessor type ' + a.componentType);
    const off = v.off + (a.byteOffset || 0);
    const item = n * T.BYTES_PER_ELEMENT;
    if (v.stride && v.stride !== item) {
      const out = new T(a.count * n);
      const src = new DataView(buf);
      for (let k = 0; k < a.count; k++) {
        for (let c = 0; c < n; c++) {
          const o = off + k * v.stride + c * T.BYTES_PER_ELEMENT;
          out[k * n + c] =
            T === Float32Array ? src.getFloat32(o, true) : T === Uint32Array ? src.getUint32(o, true) : src.getUint16(o, true);
        }
      }
      return out;
    }
    return new T(buf.slice(off, off + a.count * item));
  };
  const prim = json.meshes[0].primitives[0];
  const at = prim.attributes;
  const mat = json.materials ? json.materials[prim.material || 0] : null;
  const image = (texRef) => {
    if (!texRef || !json.textures) return null;
    const img = json.images[json.textures[texRef.index].source];
    if (img.bufferView === undefined) return null;
    const v = view(img.bufferView);
    return { mime: img.mimeType || 'image/jpeg', bytes: new Uint8Array(buf, v.off, v.len) };
  };
  return {
    pos: accessor(at.POSITION),
    nrm: accessor(at.NORMAL),
    uv: at.TEXCOORD_0 !== undefined ? accessor(at.TEXCOORD_0) : null,
    idx: accessor(prim.indices),
    base: mat && mat.pbrMetallicRoughness ? image(mat.pbrMetallicRoughness.baseColorTexture) : null,
    normal: mat ? image(mat.normalTexture) : null,
  };
}

const BAR_VS = `#version 300 es
in vec3 aPos;
in vec3 aNrm;
in vec2 aUv;
uniform mat3 uRot;     // model rotation (y up, z towards the viewer)
uniform vec3 uPivot;   // model point placed at uCenter
uniform float uScale;  // reel px per model unit
uniform vec2 uCenter;  // reel px
uniform vec4 uCam;     // s, ox, oy (CSS px), dpr
uniform vec2 uView;    // canvas size, device px
uniform float uPersp;  // 0 orthographic .. 1 perspective
uniform float uFocal;  // reel px
out vec3 vN;
out vec2 vUv;
out vec3 vP;
void main() {
  vec3 m = uRot * ((aPos - uPivot) * uScale);
  vN = uRot * aNrm;
  vUv = aUv;
  vP = m;
  // Perspective about the centre, written homogeneously so the divide happens on the GPU:
  // reel = centre + (m.xy, flipped to y down) / w.
  float w = 1.0 - uPersp * m.z / uFocal;
  vec2 reel = uCenter * w + vec2(m.x, -m.y);
  vec2 dev = (uCam.yz * w + uCam.x * reel) * uCam.w;
  gl_Position = vec4(2.0 * dev.x / uView.x - w, w - 2.0 * dev.y / uView.y, -m.z / 6000.0 * w, w);
}`;

const BAR_FS = `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uNormal;
uniform bool uHasNormal;
uniform vec3 uPaper;   // linear
uniform float uFade;   // 0 the bar, 1 paper
uniform vec3 uLight;
in vec3 vN;
in vec2 vUv;
in vec3 vP;
out vec4 outColor;
// Normal mapping without tangents: a cotangent frame from screen-space derivatives.
vec3 perturb(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 du1 = dFdx(uv);
  vec2 du2 = dFdy(uv);
  vec3 dp2p = cross(dp2, N);
  vec3 dp1p = cross(N, dp1);
  vec3 T = dp2p * du1.x + dp1p * du2.x;
  vec3 B = dp2p * du1.y + dp1p * du2.y;
  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  vec3 mapN = texture(uNormal, uv).xyz * 2.0 - 1.0;
  return normalize(mat3(T * im, B * im, N) * mapN);
}
void main() {
  vec3 N = normalize(vN);
  if (N.z < 0.0) N = -N; //            double-sided: face the viewer
  if (uHasNormal) N = perturb(N, vP, vUv);
  vec3 albedo = texture(uBase, vUv).rgb; // sRGB texture: sampled as linear
  vec3 L = normalize(uLight);
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float wrap = max((dot(N, L) + 0.35) / 1.35, 0.0); // a little light round the edges
  float spec = pow(max(dot(N, H), 0.0), 48.0) * 0.32 * step(0.0, dot(N, L));
  float rim = pow(1.0 - max(N.z, 0.0), 3.0) * 0.18;
  vec3 sky = mix(vec3(0.55), uPaper, 0.5);
  vec3 col = albedo * (0.22 * sky + 0.95 * mix(wrap, ndl, 0.6)) + vec3(spec) + rim * uPaper;
  col = mix(col, uPaper, uFade);
  outColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;

// A soft contact shadow: one quad, a Gaussian falloff, blended over the paper.
const SHADOW_VS = `#version 300 es
in vec2 aCorner;
uniform vec4 uRect; // centre x, y and radii x, y, in clip space
out vec2 vQ;
void main() {
  vQ = aCorner;
  gl_Position = vec4(uRect.xy + aCorner * uRect.zw, 0.999, 1.0);
}`;
const SHADOW_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor; // linear rgb, peak alpha
in vec2 vQ;
out vec4 outColor;
void main() {
  float a = uColor.a * exp(-3.2 * dot(vQ, vQ));
  outColor = vec4(pow(uColor.rgb, vec3(1.0 / 2.2)), a);
}`;

class BarGL {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this.failed = false;
    this.mesh = null;
    this._imgs = null;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false });
    this.gl = gl;
    if (!gl) {
      this.failed = true;
      return;
    }
    this._rot = new Float32Array(9);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ready = false;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      if (this.mesh) this._upload();
    });
  }

  // Fetch and parse a .glb, then upload it. Resolves once it can be drawn.
  async load(url) {
    if (this.failed) throw new Error('WebGL2 is not available');
    const res = await fetch(url);
    if (!res.ok) throw new Error('could not load ' + url + ' (' + res.status + ')');
    this.mesh = parseGLB(await res.arrayBuffer());
    const bitmap = async (img) =>
      img && typeof createImageBitmap === 'function' ? createImageBitmap(new Blob([img.bytes], { type: img.mime })) : null;
    this._imgs = await Promise.all([bitmap(this.mesh.base), bitmap(this.mesh.normal)]);
    this._upload();
  }

  _upload() {
    const gl = this.gl;
    const M = this.mesh;
    const prog = this._program(BAR_VS, BAR_FS);
    this.shadowProg = this._program(SHADOW_VS, SHADOW_FS);
    this.uS = {
      uRect: gl.getUniformLocation(this.shadowProg, 'uRect'),
      uColor: gl.getUniformLocation(this.shadowProg, 'uColor'),
    };
    this.shadowVao = gl.createVertexArray();
    gl.bindVertexArray(this.shadowVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const ql = gl.getAttribLocation(this.shadowProg, 'aCorner');
    gl.enableVertexAttribArray(ql);
    gl.vertexAttribPointer(ql, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.prog = prog;
    this.u = {};
    for (const n of ['uRot', 'uPivot', 'uScale', 'uCenter', 'uCam', 'uView', 'uPersp', 'uFocal', 'uBase', 'uNormal', 'uHasNormal', 'uPaper', 'uFade', 'uLight']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const attr = (name, data, size) => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0 || !data) return;
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr('aPos', M.pos, 3);
    attr('aNrm', M.nrm, 3);
    attr('aUv', M.uv || new Float32Array((M.pos.length / 3) * 2), 2);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, M.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.count = M.idx.length;
    this.idxType = M.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const tex = (bm, srgb) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (bm) {
        gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      } else {
        // no image: a flat chocolate brown (or a flat normal)
        const px = srgb ? new Uint8Array([92, 52, 30, 255]) : new Uint8Array([128, 128, 255, 255]);
        gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    this.texBase = tex(this._imgs[0], true);
    this.texNormal = tex(this._imgs[1], false);
    this.hasNormal = !!this._imgs[1];
    this.ready = true;
  }

  _program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  // Draw one frame. o: { paper: [r,g,b,a] (sRGB 0..255), s, ox, oy, dpr, cx, cy (reel px),
  //   pivot: [x,y,z] (model), scale, yaw, pitch, roll (rad), persp (0..1), focal, fade (0..1),
  //   shadow: { x, y, rx, ry (reel px), a (peak alpha) } }.
  render(o) {
    const gl = this.gl;
    if (!gl) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    const lin = (v) => Math.pow(v / 255, 2.2);
    gl.clearColor(o.paper[0] / 255, o.paper[1] / 255, o.paper[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.ready || o.fade >= 1) return;
    const sd = o.shadow;
    if (sd && sd.a > 0.002) {
      // reel px -> device px -> clip
      const k = o.s * o.dpr;
      const x = (o.ox + o.s * sd.x) * o.dpr;
      const y = (o.oy + o.s * sd.y) * o.dpr;
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.shadowProg);
      gl.uniform4f(this.uS.uRect, (2 * x) / cw - 1, 1 - (2 * y) / ch, (2 * sd.rx * k) / cw, (2 * sd.ry * k) / ch);
      // a shade of the paper towards black: soft on light paper, still visible on dark
      const dark = (o.paper[0] + o.paper[1] + o.paper[2]) / 765 < 0.5;
      gl.uniform4f(this.uS.uColor, 0, 0, 0, sd.a * (dark ? 1.6 : 1));
      gl.bindVertexArray(this.shadowVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.prog);
    // R = Rz(roll) Rx(pitch) Ry(yaw), column-major for uniformMatrix3fv
    const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
    const cx = Math.cos(o.pitch), sx = Math.sin(o.pitch);
    const cz = Math.cos(o.roll), sz = Math.sin(o.roll);
    // Rx * Ry
    const a00 = cy, a01 = 0, a02 = sy;
    const a10 = sx * sy, a11 = cx, a12 = -sx * cy;
    const a20 = -cx * sy, a21 = sx, a22 = cx * cy;
    // Rz * (Rx Ry)
    const r = this._rot;
    r[0] = cz * a00 - sz * a10; r[3] = cz * a01 - sz * a11; r[6] = cz * a02 - sz * a12;
    r[1] = sz * a00 + cz * a10; r[4] = sz * a01 + cz * a11; r[7] = sz * a02 + cz * a12;
    r[2] = a20; r[5] = a21; r[8] = a22;
    const u = this.u;
    gl.uniformMatrix3fv(u.uRot, false, r);
    gl.uniform3f(u.uPivot, o.pivot[0], o.pivot[1], o.pivot[2]);
    gl.uniform1f(u.uScale, o.scale);
    gl.uniform2f(u.uCenter, o.cx, o.cy);
    gl.uniform4f(u.uCam, o.s, o.ox, o.oy, o.dpr);
    gl.uniform2f(u.uView, cw, ch);
    gl.uniform1f(u.uPersp, o.persp);
    gl.uniform1f(u.uFocal, o.focal);
    gl.uniform3f(u.uPaper, lin(o.paper[0]), lin(o.paper[1]), lin(o.paper[2]));
    gl.uniform1f(u.uFade, o.fade);
    gl.uniform3f(u.uLight, -0.45, 0.75, 0.55);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texBase);
    gl.uniform1i(u.uBase, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texNormal);
    gl.uniform1i(u.uNormal, 1);
    gl.uniform1i(u.uHasNormal, this.hasNormal ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, this.idxType, 0);
    gl.bindVertexArray(null);
  }
}

// ---- kinder-element.js ---------------------------------------------------------------
// <kinder-pendulum>: the custom-element shell (generated from element.js by
// tools/make-kinder-element.py; edit that script, not this file).
//
// A sticky full-screen hero. At the top it shows the 3D chocolate bar (the GLB named by `src`,
// drawn by kinder-gl.js); as the visitor scrolls, the bar turns to its side view and settles,
// exactly, onto the platform of the line-art figure, which then draws itself in around it. Once
// the figure is complete the physics runs (kinder-physics.js). Plain script, concatenated last
// into one IIFE by tools/build-kinder.js.
//
//   <kinder-pendulum hero src="kinder-bar.glb"><h1>Headline</h1></kinder-pendulum>
//
// Attributes: src (the .glb; without it, or without WebGL2, the sketch draws in on its own),
//             hero, scroll-length (default 160vh), progress (0..1, overrides scroll),
//             theme (auto | light | dark), hud ("off" hides it), label (canvas accessible name).
// API:        el.progress (get/set, null = follow scroll), el.paused, el.pause(), el.play(),
//             el.reset().
//
// Everything is defined inside the guard, so loading the bundle in Node (SSR) touches nothing.

if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  typeof HTMLElement !== 'undefined' &&
  window.customElements &&
  !window.customElements.get('kinder-pendulum')
) {
  const DT = 1 / 240; //            physics step
  const MAX_STEPS = 30; //          per frame
  const MAX_DPR = 2;
  const LIVE_AT = 0.999; //         t from which the physics runs
  const RESET_AT = 0.02; //         t at or below which the state returns to the reel's first frame
  const HUD_AT = 0.92;
  // The reel's content, in reel pixels: fitted into the stage.
  // wide enough for the swing at its +-35 deg drag limit (bar ends, W labels, the phi ray)
  const BOX_X0 = -52;
  const BOX_Y0 = -8;
  const BOX_X1 = 1303;
  const BOX_Y1 = 690;
  const BOX_H = BOX_Y1 - BOX_Y0;
  const NARROW_MAX = 0; //           the whole figure always fits (no crop on phones)
  const FOCUS_X = (BOX_X0 + BOX_X1) / 2; // the camera stays on the whole figure: the 3D bar
  const FOCUS_Y = (BOX_Y0 + BOX_Y1) / 2; // frames itself
  // Timeline, as fractions of the scroll progress t.
  const BAR0 = 0.04; //              the bar starts turning towards its side view...
  const BAR1 = 0.62; //              ...and lands on the platform
  const FADE0 = 0.5; //              its colour drains to paper while the ink outline draws in
  const FADE1 = 0.66;
  const DRAW0 = 0.44; //             the line art draws in from here to t = 1
  // The bar before the morph: where it floats (reel px), how big, how it is turned.
  const BAR_X = 625;
  const BAR_Y = 330;
  const BAR_SCALE = 1.38;
  const BAR_YAW = -0.5;
  const BAR_PITCH = 0.42;
  const BAR_ROLL = -0.07;
  const BAR_FOCAL = 1800; //         reel px; the perspective goes to zero as it lands
  const WIDE_MIN = 900; //          stage width from which copy and figure sit side by side
  const PHI_DRAG = 0.55; //         the pointer can pull the platform out to this angle
  const KEY_KICK = 0.6; //          rad/s per arrow key press
  // Reduced motion: extra damping while the figure coasts after a release or a key press, so it
  // settles and stops (about 4 s, within a pixel of rest). Restored once it stops.
  const RM_CPHI = 250;
  const RM_C1 = 150;

  const KEYS = ['paper', 'ink', 'shade', 'accent'];
  const VARS = ['--kinder-paper', '--kinder-ink', '--kinder-shade', '--kinder-accent'];
  const LIGHT = ['#fafaf8', '#111111', '#bebebe', '#d9435a'];
  const DARK = ['#121212', '#ececec', '#5a5a5a', '#d9435a'];

  const DEFAULT_LABEL =
    'Ballistic pendulum with a chocolate-bar platform: the bar swings on two parallel links; circles ' +
    'in its dips turn together and carry a frame with a slot, in which a block slides on a spring. ' +
    'Drag the bar, or press the Left and Right arrow keys, to push the swing. Space pauses.';

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
    color: var(--kinder-ink);
    background: var(--kinder-paper);
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
      height: calc(100vh + var(--kinder-scroll, 160vh));
      height: calc(100svh + var(--kinder-scroll, 160vh));
    }
  }
  .stage { position: relative; width: 100%; height: 100%; aspect-ratio: 16 / 9; min-height: 240px; overflow: hidden; }
  .stage.stack { aspect-ratio: 3 / 4; }
  :host([hero]) .stage { position: sticky; top: 0; height: 100vh; height: 100svh; aspect-ratio: auto; min-height: 0; }
  canvas {
    position: absolute; inset: 0; width: 100%; height: 100%; display: block;
    touch-action: pan-y; user-select: none; -webkit-user-select: none; outline: none;
  }
  canvas.gl { pointer-events: none; }
  canvas.gl.off { visibility: hidden; }
  canvas.grab { cursor: grab; }
  canvas.grabbing { cursor: grabbing; }
  canvas:focus-visible { outline: 2px solid var(--kinder-accent); outline-offset: -6px; }
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
    border-radius: 50%; border: 1px solid var(--kinder-ink); background: transparent; color: var(--kinder-ink);
    font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: background-color 150ms ease-out, transform 100ms ease-out, opacity 150ms ease-out;
  }
  @media (hover: hover) {
    .pause:hover { background: var(--kinder-shade); background: color-mix(in srgb, var(--kinder-ink) 12%, transparent); }
  }
  .pause:active { transform: scale(0.94); }
  .pause:focus-visible { outline: 2px solid var(--kinder-accent); outline-offset: 2px; }
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
  <canvas class="gl" part="gl" aria-hidden="true"></canvas>
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

  class KinderPendulum extends HTMLElement {
    static get observedAttributes() {
      return ['hero', 'progress', 'theme', 'scroll-length', 'label', 'hud', 'src'];
    }

    constructor() {
      super();
      const ph = (this._phys = new KinderPhysics());
      this._base = { cphi: ph.p.cphi, c1: ph.p.c1 };
      this._damped = false;
      this._pose = kinderPose(ph.s, {});
      this._colors = {};
      for (let i = 0; i < KEYS.length; i++) this._colors[KEYS[i]] = hexToRGBA(LIGHT[i]);
      this._paperCss = LIGHT[0];
      this._colorV = 0;
      this._colorsDirty = true;
      this._gl = null; //            the 3D bar (kinder-gl.js)
      this._glState = 0; //          0 none, 1 loading, 2 ready, 3 unavailable
      this._glSrc = null;
      this._src = null;
      this._glOpts = { paper: null, pivot: [0, KINDER.PIV_Y, 0], shadow: { x: 0, y: 0, rx: 0, ry: 0, a: 0 } };
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
      this._canvas = root.querySelector('canvas[part="canvas"]');
      this._glCanvas = root.querySelector('canvas.gl');
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
      this._loadModel();
      this._resize(false);
    }

    // Load the .glb named by src into the WebGL layer. Without WebGL2 or the file, the line art
    // simply draws in on its own.
    _loadModel() {
      const src = this._src;
      if (!src || src === this._glSrc) return;
      this._glSrc = src;
      if (!this._gl) this._gl = new BarGL(this._glCanvas);
      if (this._gl.failed) {
        this._glState = 3;
        return;
      }
      this._glState = 1;
      let url = src;
      try {
        url = new URL(src, document.baseURI).href;
      } catch (_) {
        /* keep it as written */
      }
      this._gl.load(url).then(
        () => {
          if (this._glSrc !== src) return;
          this._glState = 2;
          this._dirty = true;
        },
        (err) => {
          if (this._glSrc !== src) return;
          this._glState = 3;
          this._dirty = true;
          console.warn('<kinder-pendulum>: no 3D bar (' + (err && err.message ? err.message : err) + ')');
        }
      );
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
        case 'src':
          this._src = val;
          if (this._connected) this._loadModel();
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
        this.style.setProperty('--kinder-scroll', v);
        this._scrollSet = true;
      } else if (this._scrollSet) {
        this.style.removeProperty('--kinder-scroll');
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
      const gc = this._glCanvas;
      if (gc.width !== cw) gc.width = cw;
      if (gc.height !== ch) gc.height = ch;
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
      this._zoomS = s; //               no zoom: the 3D bar frames itself
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
      ph.set(st.phi, 0, ph.restY(), v ? +v.dphi || 0 : 0, 0, 0);
      ph.force = 0;
      this._acc = 0;
      this._atStart = true;
      kinderPose(ph.s, this._pose);
    }

    // --- input --------------------------------------------------------------------------------

    _local(e) {
      const r = this._canvas.getBoundingClientRect();
      this._plx = r.width > 0 ? ((e.clientX - r.left) * this._w) / r.width : 0;
      this._ply = r.height > 0 ? ((e.clientY - r.top) * this._h) / r.height : 0;
    }

    // Is the reel point (x, y) on the bar, its post, or the spider round the hub?
    _onFigure(x, y) {
      const P = this._pose;
      const R = REEL.R;
      const top = P.S1y - KINDER.plateau * R;
      const bot = P.S1y - KINDER.bottom * R;
      if (x >= P.S1x + KINDER.x0 * R - 12 && x <= P.S1x + KINDER.x1 * R + 12 && y >= top - 70 && y <= bot + 16) return true;
      const dx = x - P.Mx;
      const dy = y - P.My;
      if (dx * dx + dy * dy <= 90 * 90) return true;
      return x >= P.postX - 20 && x <= P.postX + 20 && y >= top - REEL.postH - 12 && y <= top;
    }

    _hoverTest() {
      const s = this._s;
      const x = (this._plx - this._ox) / s;
      const y = (this._ply - this._oy) / s;
      let inside;
      if (this._live) {
        inside = this._onFigure(x, y);
      } else {
        inside = false; //            nothing to grab before the figure is live
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
      const m = seg(t, BAR0, BAR1);
      const d = seg(t, DRAW0, 1.0);
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
      kinderPose(s, this._pose);

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
        put(g, 12, (this._hasCopy ? 1 : 0) + 2 * this._glState);
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
      const fade = seg(this._t, FADE0, FADE1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, this._cw, this._ch);
      const gl = this._glState === 2;
      this._glCanvas.classList.toggle('off', !gl);
      if (gl) {
        try {
          this._renderBar(m, fade, still); //  paints the paper background as well
        } catch (err) {
          this._fail(1, err);
        }
      } else {
        ctx.fillStyle = this._paperCss;
        ctx.fillRect(0, 0, this._cw, this._ch);
      }
      ctx.setTransform(k, 0, 0, k, dpr * this._ox, dpr * this._oy); // 1 unit = 1 reel pixel
      ctx.save();
      try {
        drawKinder(ctx, d, this._pose, this._colors);
      } catch (err) {
        this._fail(2, err);
      }
      ctx.restore();
    }

    // The 3D bar: from floating, turned, in perspective, to the platform's exact side view.
    _renderBar(m, fade, still) {
      const P = this._pose;
      const e = easeInOut(m);
      const idle = still ? 0 : 1 - e;
      const tt = this._time;
      const o = this._glOpts;
      o.paper = this._colors.paper;
      o.s = this._s;
      o.ox = this._ox;
      o.oy = this._oy;
      o.dpr = this._dpr;
      o.cx = lerp(BAR_X, P.S1x, e);
      o.cy = lerp(BAR_Y, P.S1y, e) + idle * 7 * Math.sin(tt * 1.4);
      o.scale = KINDER.SB * lerp(BAR_SCALE, 1, e);
      o.yaw = lerp(BAR_YAW, 0, e) + idle * 0.16 * Math.sin(tt * 0.85);
      o.pitch = lerp(BAR_PITCH, 0, e) + idle * 0.05 * Math.sin(tt * 1.13);
      o.roll = lerp(BAR_ROLL, 0, e);
      o.persp = 1 - e;
      o.focal = BAR_FOCAL;
      o.fade = fade;
      // a soft shadow on the "floor" below the floating bar, gone by the time it lands
      const sd = o.shadow;
      sd.x = o.cx;
      sd.y = lerp(BAR_Y, P.S1y, e) + 0.2 * o.scale;
      sd.rx = 0.95 * o.scale;
      sd.ry = 0.085 * o.scale;
      sd.a = 0.24 * (1 - e) * (1 - 0.25 * idle * (1 + Math.sin(tt * 1.4)) * 0.5);
      this._gl.render(o);
    }

    // A renderer that throws is reported once, and the loop keeps going.
    _fail(bit, err) {
      if (this._failed & bit) return;
      this._failed |= bit;
      console.error('<kinder-pendulum>: ' + (bit === 1 ? 'the 3D bar' : 'drawKinder') + ' failed', err);
    }
  }

  window.customElements.define('kinder-pendulum', KinderPendulum);
}

if (typeof module === 'object' && module && module.exports) module.exports = { KinderPhysics, KINDER, kinderPose, parseGLB };
})();
