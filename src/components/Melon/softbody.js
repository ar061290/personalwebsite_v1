// ─────────────────────────────────────────────────────────────
//  XPBD tetrahedral soft body (ported from the "Melon Jelly" artifact)
//  · co-rotational tet constraints → elasticity (each tet pulled toward its
//                                    best-fit rotated rest shape)
//  · tet volume constraints        → near-incompressibility
//  · soft, compliant grab of a patch, fed by a damped follower of the hand
//  · relative-velocity damping along edges (internal viscosity)
//  Fixed 60 Hz step, 5 substeps (300 Hz), one iteration per substep.
//
//  Changes for the site (the slice floats in place; no gravity, floor, knife):
//  · Rigid modes are projected out every substep: the centroid stays on its rest
//    position, the rigid spin is removed and the best-fit orientation eases back to
//    rest. Both are rigid motions of the whole body, so they never fight the jelly's
//    shape (the elastic modes carry no net momentum) and they never add energy.
//  · Rest is the unique attractor:
//      – fold guard: a tet's rotation may not tilt its slab normal more than
//        maxTilt (nor twist in-plane more than maxTwist) away from the body. Folded
//        material (a flap turned over the flesh) is always pushed to unfold, so the
//        co-rotational energy has no folded local minima.
//      – a weak, implicit shape-memory spring on every particle toward its rest spot.
//      – the volume constraint stiffens smoothly as a tet is crushed (no switch to a
//        rigid projection, which used to kick particles every substep).
//  · The hand: target displacement soft-clamped (R·tanh(d/R)), followed by a
//    critically damped follower advanced per substep (no per-frame jumps), and a
//    compliant (mass-independent) coupling. No speed clamp is needed; a generous,
//    consistent one remains as a safety net.
//  · advance(dt) runs whole substeps against a real-time accumulator so the cost per
//    display frame is even (no 0/1/2-step lumps), and lerp(alpha) gives the render an
//    in-between pose.
//  · Cost (≈ 0.4× the 10-substep version, same wobble within a few %): 5 substeps per 60 Hz
//    step, Float64 state, cached per-tet shape fractions, edge damping on every 5th substep
//    (it is a slow viscous filter), and extra volume passes only for the few crushed tets.
// ─────────────────────────────────────────────────────────────

export class SoftBody {
  constructor(mesh, opts = {}) {
    const { rest, tets, region } = mesh
    this.n = rest.length / 3
    this.nT = tets.length / 4
    this.tets = tets
    // Float64 state: V8 reads and writes doubles without conversion (measurably faster in the
    // hot loops) and the long Gauss–Seidel sweeps keep more precision
    this.rest = Float64Array.from(rest)
    this.x = new Float64Array(rest.length)
    this.prev = new Float64Array(rest.length) // positions at the start of the last substep
    this.v = new Float64Array(rest.length)
    this.invMass = new Float64Array(this.n)
    this.mass = new Float64Array(this.n)
    this.restVol = new Float64Array(this.nT)

    // masses from rest volumes
    let vol = 0
    for (let t = 0; t < this.nT; t++) {
      const v = this.tetVol(this.rest, t)
      this.restVol[t] = v
      vol += v
      for (let k = 0; k < 4; k++) this.mass[tets[4 * t + k]] += v / 4
    }
    this.totalRestVolume = vol
    this.totalMass = 0
    for (let i = 0; i < this.n; i++) {
      this.invMass[i] = 1 / this.mass[i]
      this.totalMass += this.mass[i]
    }

    // unique edges
    const set = new Map()
    const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]
    for (let t = 0; t < this.nT; t++) {
      for (const [a, b] of pairs) {
        let i = tets[4 * t + a], j = tets[4 * t + b]
        if (i > j) [i, j] = [j, i]
        set.set(i * 65536 + j, [i, j])
      }
    }
    this.nE = set.size
    this.edges = new Uint32Array(this.nE * 2)
    let e = 0
    for (const [i, j] of set.values()) {
      this.edges[2 * e] = i
      this.edges[2 * e + 1] = j
      e++
    }
    // shuffle edge order a little (reduces Gauss–Seidel directional bias)
    for (let k = this.nE - 1; k > 0; k--) {
      const r = (k * 2654435761) % (k + 1)
      const a0 = this.edges[2 * k], a1 = this.edges[2 * k + 1]
      this.edges[2 * k] = this.edges[2 * r]; this.edges[2 * k + 1] = this.edges[2 * r + 1]
      this.edges[2 * r] = a0; this.edges[2 * r + 1] = a1
    }

    // edge damping weights: each end's share of the impulse, wᵢ/(wᵢ + wⱼ)
    this.edgeW = new Float64Array(this.nE * 2)
    for (let k = 0; k < this.nE; k++) {
      const wi = this.invMass[this.edges[2 * k]], wj = this.invMass[this.edges[2 * k + 1]]
      this.edgeW[2 * k] = wi / (wi + wj)
      this.edgeW[2 * k + 1] = wj / (wi + wj)
    }

    // co-rotational tet elasticity: rest shape about the tet centroid, warm-started rotation
    this.tetQ = new Float64Array(this.nT * 12)
    this.tetRot = new Float64Array(this.nT * 4) // quaternion (x, y, z, w)
    this.tetFirm = new Float64Array(this.nT)
    this.tetMass = new Float64Array(this.nT * 5) // corner masses + their sum
    this.tetF = new Float64Array(this.nT) // per-tet shape-projection fraction (cached per dt / firmness)
    this.tetFKey = NaN
    for (let t = 0; t < this.nT; t++) {
      const id = [tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]]
      let cx = 0, cy = 0, cz = 0, M = 0
      for (const v of id) {
        const mv = this.mass[v]
        M += mv; cx += rest[3 * v] * mv; cy += rest[3 * v + 1] * mv; cz += rest[3 * v + 2] * mv
      }
      cx /= M; cy /= M; cz /= M
      for (let k = 0; k < 4; k++) this.tetMass[5 * t + k] = this.mass[id[k]]
      this.tetMass[5 * t + 4] = M
      for (let k = 0; k < 4; k++) {
        this.tetQ[12 * t + 3 * k] = rest[3 * id[k]] - cx
        this.tetQ[12 * t + 3 * k + 1] = rest[3 * id[k] + 1] - cy
        this.tetQ[12 * t + 3 * k + 2] = rest[3 * id[k] + 2] - cz
      }
      this.tetRot[4 * t + 3] = 1
      // the rind is roughly three times stiffer than the flesh
      let rg = 0
      for (const v of id) rg += region[v]
      this.tetFirm[t] = rg >= 6 ? 0.3 : rg >= 3 ? 0.5 : rg >= 1 ? 0.75 : 1.0
    }

    // rigid lock: weights (particle masses), their rest centroid, rest offsets about it
    this.lockW = Float64Array.from(this.mass)
    this.restOff = new Float64Array(rest.length)
    this.c0 = new Float64Array(3)
    {
      let W = 0
      for (let i = 0; i < this.n; i++) {
        const w = this.lockW[i]
        W += w
        for (let k = 0; k < 3; k++) this.c0[k] += this.rest[3 * i + k] * w
      }
      for (let k = 0; k < 3; k++) this.c0[k] /= W
      for (let i = 0; i < this.n; i++) for (let k = 0; k < 3; k++) this.restOff[3 * i + k] = this.rest[3 * i + k] - this.c0[k]
    }
    this.bodyQ = new Float64Array([0, 0, 0, 1]) // best-fit rotation rest → now (warm start)

    // parameters (sim units: metres-ish, seconds)
    this.firmness = opts.firmness ?? 0.42 // 0..1
    this.damping = opts.damping ?? 0.38 // 0..1, edge damping
    // 1/s, mass-proportional drag while free (on the artifact's floor, contact friction did this)
    this.settleRate = opts.settleRate ?? 3
    this.heldDrag = opts.heldDrag ?? 2.5 // 1/s, drag while held (artifact value)
    this.memory = opts.memory ?? 30 // 1/s², shape-memory spring of every particle toward rest
    this.memoryZeta = opts.memoryZeta ?? 0.5 // its damping ratio
    this.returnRate = opts.returnRate ?? 8 // 1/s, how fast a rigid twist of the body eases back
    this.returnHeld = opts.returnHeld ?? 0 // 1/s, the same while held (0: the hand may lean it)
    this.lockRate = opts.lockRate ?? Infinity // 1/s, centroid lock (∞ = exact every substep)
    this.maxTilt = opts.maxTilt ?? 1.2 // rad, fold guard while held: tilt beyond which a target turns back
    this.maxTurn = opts.maxTurn ?? 1.3 // rad, fold guard once let go: turn beyond which a target turns back
    this.volFloor = opts.volFloor ?? 0.2 // volume compliance factor reached when a tet is flat
    this.crushJ = opts.crushJ ?? 0.5 // a tet below this volume ratio gets extra volume passes…
    this.crushPasses = opts.crushPasses ?? 2 // …this many, in the same substep (only those tets)
    this.crushList = new Int32Array(this.nT)
    this.volFold = opts.volFold ?? 1000 // volume compliance factor of a turned-over tet
    this.reach = opts.reach ?? 0.82 // sim units, soft reach of the hand (R·tanh(d/R))
    this.follow = opts.follow ?? 70 // rad/s, critically damped follower of the hand target
    this.grabRate = opts.grabRate ?? 400 // 1/s, compliant coupling of the held patch
    // the hand field: while held, every particle is drawn (implicit spring, per unit mass) toward
    // a smooth goal shape X + φ(X)·D (+ a swirl for the twist), φ = exp(−|X − Xhand|² / 2σ²)
    this.fieldSigma = opts.fieldSigma ?? 0.8 // sim units
    this.holdK = opts.holdK ?? 0 // 1/s², goal spring at the hand (φ = 1)
    this.holdFar = opts.holdFar ?? 0 // its fraction far from the hand (K = holdK·(far + (1 − far)·φ))
    this.holdZeta = opts.holdZeta ?? 0.6 // damping ratio (relative to the goal's own motion)
    this.holdRamp = opts.holdRamp ?? 0.12 // s, the field fades in after a grab (no pop)
    this.twistMax = opts.twistMax ?? 1.0 // rad, soft limit of the twist (θmax·tanh(θ/θmax))
    // goal displacement: a regularized Kelvinlet (de Goes & James 2017) — the response of an
    // incompressible elastic medium to a smooth point load — so the goal shape is one the jelly can
    // take without being crushed (material in front of the hand flows aside instead). 0 = φ·D.
    this.kelvinEps = opts.kelvinEps ?? 0.6 // sim units, its regularization radius
    this.kelvinC = opts.kelvinC ?? 0.5 // 1 / (4(1 − ν)); ν = ½ → 0.5 (incompressible)
    this.maxSpeed = opts.maxSpeed ?? 60 // safety net only (consistent: positions follow)
    // cost knobs (the substep is the hot loop: 300 of them per second)
    this.rotIters = opts.rotIters ?? 2 // warm-started rotation refinements per tet and substep (1 lags: ~15 % deader wobble)
    // edge damping is a slow viscous filter (time constant ≈ 1/dampRate ≈ 0.13 s), so it runs on
    // every n-th substep with the same total rate; the motion is the same, the cost is not
    this.dampEvery = opts.dampEvery ?? 5
    this.dampPhase = 0
    // 5 substeps per 60 Hz step (300 Hz): half the cost of the artifact's 10, the wobble traces
    // within ≈ 3–8 % of it (kick, tip pull, corner pull, whip) and the same robustness
    this.substeps = opts.substeps ?? 5
    this.stepDt = 1 / 60

    // real-time scheduling (advance): substeps run so far in the current step, time owed
    this.subIndex = 0
    this.acc = 0
    this.lastKE = 0 // KE/M at the end of the last full step (-1 while grabbing)
    this.onStep = null // optional callback after each full step: (ke) => void

    // grab state
    this.grabIdx = new Int32Array(this.n)
    this.grabW = new Float64Array(this.n)
    this.grabOff = new Float64Array(this.n * 3)
    this.grabN = 0
    this.grabStart = new Float64Array(3) // where the hand took hold
    this.grabGoal = new Float64Array(3) // soft-clamped hand target
    this.grabTarget = new Float64Array(3) // followed target (what the patch is pulled to)
    this.grabVel = new Float64Array(3)
    this.goalQ = new Float64Array([0, 0, 0, 1]) // hand twist (goal / followed)
    this.curQ = new Float64Array([0, 0, 0, 1])
    this.grabRot = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
    this.fieldW = new Float64Array(this.n) // φ per particle (grip profile, swirl)
    this.kelA = new Float64Array(this.n) // Kelvinlet goal: u = a·D + b·r (r·D), r = X − Xhand
    this.kelB = new Float64Array(this.n)
    this.goal = new Float64Array(rest.length) // goal shape while held
    this.goalV = new Float64Array(rest.length) // its velocity
    this.handRest = new Float64Array(3) // the hand's rest-space point Xhand
    this.grabAge = 0
    this.grabbing = false
    this.maxReach = this.reach // legacy name

    this.reset()
  }

  tetVol(p, t) {
    const T = this.tets
    const a = T[4 * t], b = T[4 * t + 1], c = T[4 * t + 2], d = T[4 * t + 3]
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2]
    const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az
    const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az
    const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az
    return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6
  }

  reset() {
    this.x.set(this.rest)
    this.prev.set(this.x)
    this.v.fill(0)
    this.bodyQ[0] = this.bodyQ[1] = this.bodyQ[2] = 0
    this.bodyQ[3] = 1
    for (let t = 0; t < this.nT; t++) {
      this.tetRot[4 * t] = this.tetRot[4 * t + 1] = this.tetRot[4 * t + 2] = 0
      this.tetRot[4 * t + 3] = 1
    }
    this.subIndex = 0
    this.acc = 0
    this.dampPhase = 0
    this.endGrab()
  }

  // stiffness mapping: firmness 0..1 → shape compliance (log scale)
  shapeCompliance() { return Math.exp(Math.log(3.0) + (Math.log(0.05) - Math.log(3.0)) * this.firmness) }
  volCompliance() { return 1e-4 * (1 - 0.7 * this.firmness) }
  // damping 0..1 → rate (1/s) of relative-velocity decay along edges
  dampRate() { return 2 + 40 * this.damping * this.damping }

  // ── grabbing ──
  beginGrab(hit, radius = 0.4) {
    this.grabN = 0
    let nearest = -1, nd = Infinity
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[3 * i] - hit[0], dy = this.x[3 * i + 1] - hit[1], dz = this.x[3 * i + 2] - hit[2]
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d < nd) { nd = d; nearest = i }
      if (d < radius) {
        const f = 1 - d / radius
        const k = this.grabN++
        this.grabIdx[k] = i
        this.grabW[k] = f * f * (3 - 2 * f)
        this.grabOff[3 * k] = dx; this.grabOff[3 * k + 1] = dy; this.grabOff[3 * k + 2] = dz
      }
    }
    if (this.grabN === 0 && nearest >= 0) {
      this.grabIdx[0] = nearest
      this.grabW[0] = 1
      this.grabOff[0] = this.x[3 * nearest] - hit[0]
      this.grabOff[1] = this.x[3 * nearest + 1] - hit[1]
      this.grabOff[2] = this.x[3 * nearest + 2] - hit[2]
      this.grabN = 1
    }
    for (let k = 0; k < 3; k++) {
      this.grabStart[k] = this.grabGoal[k] = this.grabTarget[k] = hit[k]
      this.grabVel[k] = 0
    }
    this.goalQ[0] = this.goalQ[1] = this.goalQ[2] = 0; this.goalQ[3] = 1
    this.curQ[0] = this.curQ[1] = this.curQ[2] = 0; this.curQ[3] = 1
    this.grabRot.set(IDENTITY3)
    // the hand's rest-space point: the hit less the patch's present displacement from rest, so the
    // goal shape agrees with the body where it was taken even if it was still wobbling
    {
      const { x, rest } = this
      let ux = 0, uy = 0, uz = 0, W = 0
      for (let k = 0; k < this.grabN; k++) {
        const i = 3 * this.grabIdx[k], w = this.grabW[k]
        ux += (x[i] - rest[i]) * w; uy += (x[i + 1] - rest[i + 1]) * w; uz += (x[i + 2] - rest[i + 2]) * w; W += w
      }
      const H = this.handRest, iW = W > 0 ? 1 / W : 0
      H[0] = hit[0] - ux * iW; H[1] = hit[1] - uy * iW; H[2] = hit[2] - uz * iW
      const k2 = 1 / (2 * this.fieldSigma * this.fieldSigma)
      const e = this.kelvinEps, c = this.kelvinC, kn = 1 / (1.5 - c)
      for (let i = 0; i < this.n; i++) {
        const dx = rest[3 * i] - H[0], dy = rest[3 * i + 1] - H[1], dz = rest[3 * i + 2] - H[2]
        const r2 = dx * dx + dy * dy + dz * dz
        const phi = Math.exp(-r2 * k2)
        this.fieldW[i] = phi
        if (e > 0) {
          const re2 = r2 + e * e, re = Math.sqrt(re2), re3 = re2 * re
          this.kelA[i] = e * ((1 - c) / re + (e * e) / (2 * re3)) * kn
          this.kelB[i] = ((e * c) / re3) * kn
        } else {
          this.kelA[i] = phi
          this.kelB[i] = 0
        }
      }
    }
    this.grabAge = 0
    this.grabbing = true
    this.updateGoal(0)
  }

  // goal shape while held: X + φ·D + swirl, D = followed hand target − Xhand; the twist turns
  // (X − Xhand) by φ·θ about its axis (a swirl, det = 1). goalV = its velocity over the substep.
  updateGoal(dt) {
    const { rest, fieldW: f, kelA, kelB, goal: g, goalV: gv, n } = this
    const H = this.handRest, T = this.grabTarget
    const Dx = T[0] - H[0], Dy = T[1] - H[1], Dz = T[2] - H[2]
    const q = this.curQ
    let qx = q[0], qy = q[1], qz = q[2], qw = q[3]
    if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw }
    const sn = Math.sqrt(qx * qx + qy * qy + qz * qz)
    let th = 2 * Math.atan2(sn, qw)
    const tm = this.twistMax
    th = tm * Math.tanh(th / tm)
    const ax = sn > 1e-9 ? qx / sn : 0, ay = sn > 1e-9 ? qy / sn : 0, az = sn > 1e-9 ? qz / sn : 1
    const twist = th > 1e-5
    const iv = dt > 0 ? 1 / dt : 0
    for (let i = 0; i < n; i++) {
      const k = 3 * i, w = f[i]
      let rx = rest[k] - H[0], ry = rest[k + 1] - H[1], rz = rest[k + 2] - H[2]
      const ka = kelA[i], kb = kelB[i] * (rx * Dx + ry * Dy + rz * Dz)
      const ux = ka * Dx + kb * rx, uy = ka * Dy + kb * ry, uz = ka * Dz + kb * rz
      if (twist) {
        const b = w * th, c = Math.cos(b), s = Math.sin(b), d = (ax * rx + ay * ry + az * rz) * (1 - c)
        const cx = ay * rz - az * ry, cy = az * rx - ax * rz, cz = ax * ry - ay * rx
        rx = rx * c + cx * s + ax * d; ry = ry * c + cy * s + ay * d; rz = rz * c + cz * s + az * d
      }
      const gx = H[0] + rx + ux, gy = H[1] + ry + uy, gz = H[2] + rz + uz
      gv[k] = (gx - g[k]) * iv; gv[k + 1] = (gy - g[k + 1]) * iv; gv[k + 2] = (gz - g[k + 2]) * iv
      g[k] = gx; g[k + 1] = gy; g[k + 2] = gz
    }
  }

  // target: world point under the hand; rot: optional 3×3 row-major twist of the held patch
  moveGrab(target, rot) {
    // soft reach: the patch follows the hand 1:1 at first, then ever more reluctantly,
    // never further than `reach` from where it was taken (rubbery, no hard wall)
    const dx = target[0] - this.grabStart[0], dy = target[1] - this.grabStart[1], dz = target[2] - this.grabStart[2]
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz), R = this.reach
    const k = d > 1e-9 ? (R * Math.tanh(d / R)) / d : 1
    this.grabGoal[0] = this.grabStart[0] + dx * k
    this.grabGoal[1] = this.grabStart[1] + dy * k
    this.grabGoal[2] = this.grabStart[2] + dz * k
    if (rot) matToQuat(rot, this.goalQ)
  }

  endGrab() {
    this.grabbing = false
    this.grabN = 0
  }

  // ── simulation ──
  // one fixed 60 Hz step (`substeps` substeps); returns KE/M (0 while grabbing)
  step() {
    const sub = this.substeps
    const dt = this.stepDt / sub
    for (let s = 0; s < sub; s++) this.substep(dt)
    this.subIndex = 0
    return this.endStep()
  }

  // real-time driver: runs whole substeps for `dt` seconds of wall time, at most maxSub,
  // and stops early once budgetMs of CPU has been spent (a machine that cannot keep up
  // gets smooth slow motion instead of a spiral). Returns the number of substeps run.
  advance(dt, maxSub = 30, budgetMs = Infinity) {
    const h = this.stepDt / this.substeps
    this.acc += dt
    let n = 0
    const timed = budgetMs < Infinity && typeof performance !== 'undefined'
    const t0 = timed ? performance.now() : 0
    while (this.acc >= h && n < maxSub) {
      this.substep(h)
      this.acc -= h
      n++
      if (++this.subIndex >= this.substeps) {
        this.subIndex = 0
        const ke = this.endStep()
        this.onStep?.(ke)
      }
      if (timed && performance.now() - t0 > budgetMs) break
    }
    if (this.acc >= h) this.acc = 0.999 * h // dropped time: never owe more than one substep
    return n
  }

  // fraction of the next substep already elapsed (for render interpolation, 0..1)
  get alpha() { return Math.min(1, this.acc / (this.stepDt / this.substeps)) }

  // pose between the start and the end of the last substep: out = prev + a·(x − prev)
  lerp(a, out) {
    const { x, prev } = this
    if (a >= 1) { out.set(x); return out }
    for (let i = 0; i < x.length; i++) out[i] = prev[i] + (x[i] - prev[i]) * a
    return out
  }

  endStep() {
    // settling: once the jelly is nearly still, bleed off the last residual jitter
    let ke = 0
    if (!this.grabbing) {
      ke = this.kineticEnergy() / this.totalMass // ≈ ½ v²
      if (ke < 2e-3) {
        const f = Math.max(0.86, 1 - 0.14 * (1 - ke / 2e-3))
        for (let i = 0; i < this.v.length; i++) this.v[i] *= f
      }
    }
    // safety: any non-finite value → back to rest
    for (let i = 0; i < this.x.length; i += 97) {
      if (!Number.isFinite(this.x[i]) || !Number.isFinite(this.v[i])) { this.reset(); break }
    }
    this.lastKE = ke
    return ke
  }

  substep(dt) {
    const { x, prev, v, n, rest } = this
    // light air drag; while held, the hand steadies the slice a little more
    const air = Math.exp(-(this.grabbing ? this.heldDrag : 0.08 + this.settleRate) * dt)
    // shape memory, implicit (unconditionally stable): v ← (v + dt·k·(X − x)) / (1 + dt·c + dt²·k)
    const K = this.memory
    const mk = dt * K, mc = 2 * this.memoryZeta * Math.sqrt(K)
    if (this.grabbing && this.holdK > 0) {
      // held: the shape memory plus the hand field's goal spring, damped relative to the goal's motion
      this.followHand(dt)
      this.grabAge += dt
      this.updateGoal(dt)
      const u = Math.min(1, this.grabAge / this.holdRamp), ramp = u * u * (3 - 2 * u)
      const { goal: g, goalV: gv, fieldW: f } = this
      const K0 = this.holdK * ramp, far = this.holdFar, zh = 2 * this.holdZeta
      for (let i = 0; i < n; i++) {
        const Kh = K0 * (far + (1 - far) * f[i]), ch = zh * Math.sqrt(Kh)
        const den = 1 / (1 + dt * (mc + ch) + dt * dt * (K + Kh)), hk = dt * Kh, hc = dt * ch
        for (let k = 3 * i; k < 3 * i + 3; k++) {
          const vk = (v[k] * air + mk * (rest[k] - x[k]) + hk * (g[k] - x[k]) + hc * gv[k]) * den
          v[k] = vk
          prev[k] = x[k]
          x[k] += vk * dt
        }
      }
      if (this.grabRate > 0) this.solveGrab(dt)
    } else {
      const md = 1 / (1 + dt * mc + dt * dt * K)
      for (let k = 0; k < 3 * n; k++) {
        const vk = (v[k] * air + mk * (rest[k] - x[k])) * md
        v[k] = vk
        prev[k] = x[k]
        x[k] += vk * dt
      }
      if (this.grabbing) {
        this.followHand(dt)
        this.solveGrab(dt)
      }
    }
    this.solveTets(dt)
    this.solveVolumes(dt)
    const inv = 1 / dt, vmax = this.maxSpeed, vmax2 = vmax * vmax
    for (let i = 0; i < 3 * n; i += 3) {
      let vx = (x[i] - prev[i]) * inv, vy = (x[i + 1] - prev[i + 1]) * inv, vz = (x[i + 2] - prev[i + 2]) * inv
      const s2 = vx * vx + vy * vy + vz * vz
      if (s2 > vmax2) {
        // safety net, consistent: the position agrees with the clamped velocity
        const f = vmax / Math.sqrt(s2)
        vx *= f; vy *= f; vz *= f
        x[i] = prev[i] + vx * dt; x[i + 1] = prev[i + 1] + vy * dt; x[i + 2] = prev[i + 2] + vz * dt
      }
      v[i] = vx; v[i + 1] = vy; v[i + 2] = vz
    }
    this.lockRigid(dt)
    if (++this.dampPhase >= this.dampEvery) {
      this.dampPhase = 0
      this.dampEdges(dt * this.dampEvery)
    }
  }

  // the hand target, followed per substep by a critically damped spring (ω = follow);
  // the twist eases toward its goal at the same rate
  followHand(dt) {
    const G = this.grabGoal, T = this.grabTarget, V = this.grabVel, w = this.follow
    if (w === Infinity) {
      T.set(G)
    } else {
      const w2 = w * w, c = 2 * w
      for (let k = 0; k < 3; k++) {
        V[k] += (w2 * (G[k] - T[k]) - c * V[k]) * dt
        T[k] += V[k] * dt
      }
    }
    const a = this.curQ, b = this.goalQ
    let bx = b[0], by = b[1], bz = b[2], bw = b[3]
    if (a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw }
    const f = w === Infinity ? 1 : 1 - Math.exp(-w * dt)
    let qx = a[0] + (bx - a[0]) * f, qy = a[1] + (by - a[1]) * f, qz = a[2] + (bz - a[2]) * f, qw = a[3] + (bw - a[3]) * f
    const l = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
    qx *= l; qy *= l; qz *= l; qw *= l
    a[0] = qx; a[1] = qy; a[2] = qz; a[3] = qw
    const R = this.grabRot
    R[0] = 1 - 2 * (qy * qy + qz * qz); R[1] = 2 * (qx * qy - qw * qz); R[2] = 2 * (qx * qz + qw * qy)
    R[3] = 2 * (qx * qy + qw * qz); R[4] = 1 - 2 * (qx * qx + qz * qz); R[5] = 2 * (qy * qz - qw * qx)
    R[6] = 2 * (qx * qz - qw * qy); R[7] = 2 * (qy * qz + qw * qx); R[8] = 1 - 2 * (qx * qx + qy * qy)
  }

  // compliant hold: each held particle moves a fixed, mass-independent fraction of the way
  // to its target per substep (rate grabRate), weighted by its place in the patch
  solveGrab(dt) {
    const { x } = this
    const fr = 1 - Math.exp(-this.grabRate * dt)
    const R = this.grabRot, T = this.grabTarget, g = this.goal, field = this.holdK > 0
    for (let k = 0; k < this.grabN; k++) {
      const i = 3 * this.grabIdx[k]
      const ox = this.grabOff[3 * k], oy = this.grabOff[3 * k + 1], oz = this.grabOff[3 * k + 2]
      // with the hand field the patch is held to its goal shape (no rigid patch, no crushing)
      const tx = field ? g[i] : T[0] + R[0] * ox + R[1] * oy + R[2] * oz
      const ty = field ? g[i + 1] : T[1] + R[3] * ox + R[4] * oy + R[5] * oz
      const tz = field ? g[i + 2] : T[2] + R[6] * ox + R[7] * oy + R[8] * oz
      const f = this.grabW[k] * fr
      x[i] += (tx - x[i]) * f
      x[i + 1] += (ty - x[i + 1]) * f
      x[i + 2] += (tz - x[i + 2]) * f
    }
  }

  // Per-tet co-rotational shape matching: find the rotation that best maps the rest tet onto the
  // current one (Müller et al. 2016, warm-started quaternion), then pull the four corners toward the
  // rotated rest shape with XPBD compliance. Fold guard: a tet turned further than maxTurn from the
  // body (whose orientation is held at rest) is given a target that turns back toward rest, the more
  // so the further it is turned, so folded or inverted material is always pushed back the unfolded
  // way and the elastic energy has no folded local minima.
  solveTets(dt) {
    const { x, tets, tetQ, tetRot: Q, tetMass } = this
    const F = this.tetFractions(dt)
    const iters = this.rotIters
    const free = !this.grabbing
    const cosTilt = Math.cos(this.maxTilt), tiltK = this.maxTilt / (Math.PI - this.maxTilt)
    const cosHalfTurn = Math.cos(0.5 * this.maxTurn), turnK = this.maxTurn / (Math.PI - this.maxTurn)
    for (let t = 0; t < this.nT; t++) {
      const a = 3 * tets[4 * t], b = 3 * tets[4 * t + 1], c = 3 * tets[4 * t + 2], d = 3 * tets[4 * t + 3]
      const ma = tetMass[5 * t], mb = tetMass[5 * t + 1], mc = tetMass[5 * t + 2], md = tetMass[5 * t + 3]
      const iM = 1 / tetMass[5 * t + 4]
      const cx = (x[a] * ma + x[b] * mb + x[c] * mc + x[d] * md) * iM
      const cy = (x[a + 1] * ma + x[b + 1] * mb + x[c + 1] * mc + x[d + 1] * md) * iM
      const cz = (x[a + 2] * ma + x[b + 2] * mb + x[c + 2] * mc + x[d + 2] * md) * iM
      const T = 12 * t
      // A = Σ m p qᵀ (mass-weighted covariance of current vs rest, both about their centroids)
      let f00 = 0, f01 = 0, f02 = 0, f10 = 0, f11 = 0, f12 = 0, f20 = 0, f21 = 0, f22 = 0
      {
        let px = (x[a] - cx) * ma, py = (x[a + 1] - cy) * ma, pz = (x[a + 2] - cz) * ma
        let q0 = tetQ[T], q1 = tetQ[T + 1], q2 = tetQ[T + 2]
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2
        px = (x[b] - cx) * mb; py = (x[b + 1] - cy) * mb; pz = (x[b + 2] - cz) * mb; q0 = tetQ[T + 3]; q1 = tetQ[T + 4]; q2 = tetQ[T + 5]
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2
        px = (x[c] - cx) * mc; py = (x[c + 1] - cy) * mc; pz = (x[c + 2] - cz) * mc; q0 = tetQ[T + 6]; q1 = tetQ[T + 7]; q2 = tetQ[T + 8]
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2
        px = (x[d] - cx) * md; py = (x[d + 1] - cy) * md; pz = (x[d + 2] - cz) * md; q0 = tetQ[T + 9]; q1 = tetQ[T + 10]; q2 = tetQ[T + 11]
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2
      }
      let qx = Q[4 * t], qy = Q[4 * t + 1], qz = Q[4 * t + 2], qw = Q[4 * t + 3]
      let r00, r01, r02, r10, r11, r12, r20, r21, r22
      for (let it = 0; it < iters; it++) {
        r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy)
        r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx)
        r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy)
        const ox = (r10 * f20 - r20 * f10) + (r11 * f21 - r21 * f11) + (r12 * f22 - r22 * f12)
        const oy = (r20 * f00 - r00 * f20) + (r21 * f01 - r01 * f21) + (r22 * f02 - r02 * f22)
        const oz = (r00 * f10 - r10 * f00) + (r01 * f11 - r11 * f01) + (r02 * f12 - r12 * f02)
        const den = Math.abs(r00 * f00 + r10 * f10 + r20 * f20 + r01 * f01 + r11 * f11 + r21 * f21 + r02 * f02 + r12 * f12 + r22 * f22) + 1e-12
        const wx = ox / den, wy = oy / den, wz = oz / den
        const w2 = wx * wx + wy * wy + wz * wz
        if (w2 < 1e-12) break
        // small-angle quaternion step (renormalised below); large jumps are clamped
        const sc = w2 > 1 ? 0.5 / Math.sqrt(w2) : 0.5
        const ax = wx * sc, ay = wy * sc, az = wz * sc
        const nx = qx + ax * qw + ay * qz - az * qy
        const ny = qy - ax * qz + ay * qw + az * qx
        const nz = qz + ax * qy - ay * qx + az * qw
        const nw = qw - ax * qx - ay * qy - az * qz
        const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw)
        qx = nx * nl; qy = ny * nl; qz = nz * nl; qw = nw * nl
      }
      Q[4 * t] = qx; Q[4 * t + 1] = qy; Q[4 * t + 2] = qz; Q[4 * t + 3] = qw // tracking stays true
      // Fold guard (targets only; the tracked rotation above stays true). The body itself is held
      // at its rest orientation, so a tet's rotation is its turn relative to the body.
      if (free) {
        // let go: a tet turned further than maxTurn gets a target turned back toward rest,
        // reaching rest at 180°: θ' = maxTurn·(π − θ)/(π − maxTurn); |qw| = cos(θ/2)
        const aw = qw < 0 ? -qw : qw
        if (aw < cosHalfTurn) {
          const sn = Math.sqrt(qx * qx + qy * qy + qz * qz)
          const h = 0.5 * turnK * (Math.PI - 2 * Math.atan2(sn, aw))
          const k = Math.sin(h) / sn // keeps the sign of q (same hemisphere)
          qx *= k; qy *= k; qz *= k; qw = qw < 0 ? -Math.cos(h) : Math.cos(h)
        }
      } else if (1 - 2 * (qx * qx + qz * qz) < cosTilt) {
        // held: only the tilt of the slab normal ŷ (material turning face-over) is guarded, so the
        // hand can still bend the jelly in-plane. Swing–twist split q = swing · twist about ŷ,
        // cos(tilt) = 1 − 2(qx² + qz²); beyond maxTilt the swing turns back the same way.
        const tl2 = qy * qy + qw * qw
        let ty = 0, tw = 1, sx = qx, sz = qz, Sw = 0
        if (tl2 > 1e-12) {
          const tl = Math.sqrt(tl2)
          ty = qy / tl; tw = qw / tl
          sx = (qx * qw + qz * qy) / tl; sz = (qz * qw - qx * qy) / tl; Sw = tl
        }
        const sl = Math.sqrt(sx * sx + sz * sz)
        const h = 0.5 * tiltK * (Math.PI - 2 * Math.atan2(sl, Sw))
        const k = Math.sin(h) / sl
        sx *= k; sz *= k; Sw = Math.cos(h)
        qx = sx * tw - sz * ty; qy = Sw * ty; qz = sx * ty + sz * tw; qw = Sw * tw
      }
      r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy)
      r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx)
      r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy)
      // the same fraction for all four corners keeps linear and angular momentum intact
      const f = F[t]
      let q0 = tetQ[T], q1 = tetQ[T + 1], q2 = tetQ[T + 2]
      x[a] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[a]) * f; x[a + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[a + 1]) * f; x[a + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[a + 2]) * f
      q0 = tetQ[T + 3]; q1 = tetQ[T + 4]; q2 = tetQ[T + 5]
      x[b] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[b]) * f; x[b + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[b + 1]) * f; x[b + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[b + 2]) * f
      q0 = tetQ[T + 6]; q1 = tetQ[T + 7]; q2 = tetQ[T + 8]
      x[c] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[c]) * f; x[c + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[c + 1]) * f; x[c + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[c + 2]) * f
      q0 = tetQ[T + 9]; q1 = tetQ[T + 10]; q2 = tetQ[T + 11]
      x[d] += (cx + r00 * q0 + r01 * q1 + r02 * q2 - x[d]) * f; x[d + 1] += (cy + r10 * q0 + r11 * q1 + r12 * q2 - x[d + 1]) * f; x[d + 2] += (cz + r20 * q0 + r21 * q1 + r22 * q2 - x[d + 2]) * f
    }
  }

  // per-tet XPBD shape fraction 1 / (1 + α̃·m/4), α̃ = compliance·firm / dt²; cached (dt and
  // firmness rarely change)
  tetFractions(dt) {
    const key = this.shapeCompliance() / (dt * dt)
    if (key !== this.tetFKey) {
      const { tetF, tetFirm, tetMass } = this
      for (let t = 0; t < this.nT; t++) tetF[t] = 1 / (1 + key * tetFirm[t] * tetMass[5 * t + 4] * 0.25)
      this.tetFKey = key
    }
    return this.tetF
  }

  // XPBD volume constraint. Its compliance falls smoothly as a tet is crushed (J = V/V₀ from
  // 0.6 down to 0 → compliance × volFloor), so crushed tets push back harder without the
  // old switch to a rigid, one-shot projection.
  solveVolumes(dt) {
    let nc = this.volumePass(dt, null, this.nT)
    // crushed tets (J < crushJ) get a few more passes right away: one Gauss–Seidel pass per substep
    // can't stop a fast squeeze from turning a small tet inside out, and these are a handful
    // (with 5 substeps this brings transient inversions under a fast hand back to the 10-substep level)
    for (let k = 0; k < this.crushPasses && nc > 0; k++) nc = this.volumePass(dt, this.crushList, nc)
  }

  // one XPBD pass over all tets (list = null) or over list[0..count); returns the number of tets
  // still crushed, compacted into crushList (in place: safe when list === crushList)
  volumePass(dt, list, count) {
    const { x, invMass, tets, restVol, tetRot: Q, crushList } = this
    const crushJ = this.crushJ
    let nc = 0
    const alpha0 = this.volCompliance() / (dt * dt)
    const alphaFold = alpha0 * this.volFold
    const floor = this.volFloor
    const cosHalfTurn = Math.cos(0.5 * this.maxTurn), free = !this.grabbing
    for (let it = 0; it < count; it++) {
      const t = list ? list[it] : it
      const a = tets[4 * t], b = tets[4 * t + 1], c = tets[4 * t + 2], d = tets[4 * t + 3]
      const A = 3 * a, B = 3 * b, Cc = 3 * c, D = 3 * d
      // gradients (Müller): g_a = (d-b)×(c-b), g_b = (c-a)×(d-a), g_c = (d-a)×(b-a), g_d = (b-a)×(c-a)
      const bax = x[B] - x[A], bay = x[B + 1] - x[A + 1], baz = x[B + 2] - x[A + 2]
      const cax = x[Cc] - x[A], cay = x[Cc + 1] - x[A + 1], caz = x[Cc + 2] - x[A + 2]
      const dax = x[D] - x[A], day = x[D + 1] - x[A + 1], daz = x[D + 2] - x[A + 2]
      const dbx = x[D] - x[B], dby = x[D + 1] - x[B + 1], dbz = x[D + 2] - x[B + 2]
      const cbx = x[Cc] - x[B], cby = x[Cc + 1] - x[B + 1], cbz = x[Cc + 2] - x[B + 2]
      const gax = dby * cbz - dbz * cby, gay = dbz * cbx - dbx * cbz, gaz = dbx * cby - dby * cbx
      const gbx = cay * daz - caz * day, gby = caz * dax - cax * daz, gbz = cax * day - cay * dax
      const gcx = day * baz - daz * bay, gcy = daz * bax - dax * baz, gcz = dax * bay - day * bax
      const gdx = bay * caz - baz * cay, gdy = baz * cax - bax * caz, gdz = bax * cay - bay * cax
      const V = (dax * gdx + day * gdy + daz * gdz) / 6
      const wa = invMass[a], wb = invMass[b], wc = invMass[c], wd = invMass[d]
      const wsum = wa * (gax * gax + gay * gay + gaz * gaz) + wb * (gbx * gbx + gby * gby + gbz * gbz)
        + wc * (gcx * gcx + gcy * gcy + gcz * gcz) + wd * (gdx * gdx + gdy * gdy + gdz * gdz)
      if (wsum < 1e-12) continue
      const r0 = restVol[t]
      const J = V / r0
      if (J < crushJ) crushList[nc++] = t
      let alpha = alpha0
      const qw = Q[4 * t + 3]
      if (free && (qw < 0 ? -qw : qw) < cosHalfTurn) {
        // turned over (see the fold guard): unfolding it means passing through a flat shape,
        // which near-incompressibility would block, so once the hand has let go it gets out
        // of the way
        alpha = alphaFold
      } else if (J < 0.6) {
        const u = J <= 0 ? 0 : J / 0.6
        alpha = alpha0 * (floor + (1 - floor) * u * u * (3 - 2 * u))
      }
      const s = (-6 * (V - r0)) / (wsum + alpha)
      x[A] += gax * s * wa; x[A + 1] += gay * s * wa; x[A + 2] += gaz * s * wa
      x[B] += gbx * s * wb; x[B + 1] += gby * s * wb; x[B + 2] += gbz * s * wb
      x[Cc] += gcx * s * wc; x[Cc + 1] += gcy * s * wc; x[Cc + 2] += gcz * s * wc
      x[D] += gdx * s * wd; x[D + 1] += gdy * s * wd; x[D + 2] += gdz * s * wd
    }
    return nc
  }

  // Keeps the slice where it is, after the velocity update of every substep:
  //  · translation: the centroid is put back on its rest position and the net momentum removed;
  //  · rotation: the rigid angular velocity (I⁻¹L about the centroid) is removed, and the body's
  //    best-fit orientation (rest → now) is turned back toward rest by a fraction
  //    1 − e^(−returnRate·dt) per substep.
  // Both are rigid motions of the whole body, applied to positions after the velocities were
  // taken, so they add no energy and leave the jelly's deformation (and its wobble) alone.
  lockRigid(dt) {
    const { x, v, n, restOff, c0, lockW: wt } = this
    let M = 0, cx = 0, cy = 0, cz = 0, px = 0, py = 0, pz = 0
    for (let i = 0; i < n; i++) {
      const m = wt[i], k = 3 * i
      M += m
      cx += x[k] * m; cy += x[k + 1] * m; cz += x[k + 2] * m
      px += v[k] * m; py += v[k + 1] * m; pz += v[k + 2] * m
    }
    const iM = 1 / M
    cx *= iM; cy *= iM; cz *= iM
    px *= iM; py *= iM; pz *= iM
    const lock = this.lockRate === Infinity ? 1 : 1 - Math.exp(-this.lockRate * dt)
    const sx = (c0[0] - cx) * lock, sy = (c0[1] - cy) * lock, sz = (c0[2] - cz) * lock
    const ox0 = cx + sx, oy0 = cy + sy, oz0 = cz + sz // the centroid after the shift
    // A = Σ w (x − c)(X − c0)ᵀ, plus angular momentum L and inertia I about c
    let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0
    let Lx = 0, Ly = 0, Lz = 0
    let i00 = 0, i01 = 0, i02 = 0, i11 = 0, i12 = 0, i22 = 0
    for (let i = 0; i < n; i++) {
      const k = 3 * i, m = wt[i]
      x[k] += sx; x[k + 1] += sy; x[k + 2] += sz
      const vx = (v[k] -= px), vy = (v[k + 1] -= py), vz = (v[k + 2] -= pz)
      const rx = x[k] - ox0, ry = x[k + 1] - oy0, rz = x[k + 2] - oz0
      const qx = restOff[k], qy = restOff[k + 1], qz = restOff[k + 2]
      const mrx = m * rx, mry = m * ry, mrz = m * rz
      a00 += mrx * qx; a01 += mrx * qy; a02 += mrx * qz
      a10 += mry * qx; a11 += mry * qy; a12 += mry * qz
      a20 += mrz * qx; a21 += mrz * qy; a22 += mrz * qz
      Lx += mry * vz - mrz * vy
      Ly += mrz * vx - mrx * vz
      Lz += mrx * vy - mry * vx
      i00 += m * (ry * ry + rz * rz); i11 += m * (rx * rx + rz * rz); i22 += m * (rx * rx + ry * ry)
      i01 -= m * rx * ry; i02 -= m * rx * rz; i12 -= m * ry * rz
    }
    // best-fit rotation, warm-started (Müller et al. 2016)
    const B = this.bodyQ
    let qx = B[0], qy = B[1], qz = B[2], qw = B[3]
    for (let it = 0; it < 3; it++) {
      const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy)
      const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx)
      const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy)
      const ox = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12)
      const oy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22)
      const oz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02)
      const den = Math.abs(r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22) + 1e-12
      const wx = ox / den, wy = oy / den, wz = oz / den
      const w = Math.sqrt(wx * wx + wy * wy + wz * wz)
      if (w < 1e-9) break
      const h = Math.min(w, 2) / 2, sn = Math.sin(h) / w, cs = Math.cos(h)
      const ax = wx * sn, ay = wy * sn, az = wz * sn
      const nx = cs * qx + ax * qw + ay * qz - az * qy
      const ny = cs * qy - ax * qz + ay * qw + az * qx
      const nz = cs * qz + ax * qy - ay * qx + az * qw
      const nw = cs * qw - ax * qx - ay * qy - az * qz
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw)
      qx = nx * l; qy = ny * l; qz = nz * l; qw = nw * l
    }
    if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw }
    // rigid angular velocity ω = I⁻¹ L, removed from every particle
    let ox = 0, oy = 0, oz = 0
    {
      const A = i11 * i22 - i12 * i12, Bc = i02 * i12 - i01 * i22, C = i01 * i12 - i02 * i11
      const det = i00 * A + i01 * Bc + i02 * C
      if (Math.abs(det) > 1e-20) {
        const k = 1 / det
        const j00 = A * k, j01 = Bc * k, j02 = C * k
        const j11 = (i00 * i22 - i02 * i02) * k, j12 = (i01 * i02 - i00 * i12) * k, j22 = (i00 * i11 - i01 * i01) * k
        ox = j00 * Lx + j01 * Ly + j02 * Lz
        oy = j01 * Lx + j11 * Ly + j12 * Lz
        oz = j02 * Lx + j12 * Ly + j22 * Lz
      }
    }
    // turn back a fraction of the best-fit rotation: R(−φ) about its axis, φ = f·angle
    const s = Math.sqrt(qx * qx + qy * qy + qz * qz)
    const ang = 2 * Math.atan2(s, qw)
    const phi = ang * (1 - Math.exp(-(this.grabbing ? this.returnHeld : this.returnRate) * dt))
    let m00 = 1, m01 = 0, m02 = 0, m10 = 0, m11 = 1, m12 = 0, m20 = 0, m21 = 0, m22 = 1
    if (s > 1e-9 && phi > 1e-9) {
      const ux = qx / s, uy = qy / s, uz = qz / s
      const c = Math.cos(phi), sn = -Math.sin(phi), t = 1 - c
      m00 = t * ux * ux + c; m01 = t * ux * uy - sn * uz; m02 = t * ux * uz + sn * uy
      m10 = t * ux * uy + sn * uz; m11 = t * uy * uy + c; m12 = t * uy * uz - sn * ux
      m20 = t * ux * uz - sn * uy; m21 = t * uy * uz + sn * ux; m22 = t * uz * uz + c
      // the warm start follows: bodyQ ← q(−φ) · bodyQ
      const hs = Math.sin(-phi / 2), hc = Math.cos(phi / 2)
      const ax = ux * hs, ay = uy * hs, az = uz * hs
      const nx = hc * qx + ax * qw + ay * qz - az * qy
      const ny = hc * qy - ax * qz + ay * qw + az * qx
      const nz = hc * qz + ax * qy - ay * qx + az * qw
      const nw = hc * qw - ax * qx - ay * qy - az * qz
      qx = nx; qy = ny; qz = nz; qw = nw
    }
    B[0] = qx; B[1] = qy; B[2] = qz; B[3] = qw
    for (let i = 0; i < n; i++) {
      const j = 3 * i
      const rx = x[j] - ox0, ry = x[j + 1] - oy0, rz = x[j + 2] - oz0
      v[j] -= oy * rz - oz * ry
      v[j + 1] -= oz * rx - ox * rz
      v[j + 2] -= ox * ry - oy * rx
      x[j] = ox0 + m00 * rx + m01 * ry + m02 * rz
      x[j + 1] = oy0 + m10 * rx + m11 * ry + m12 * rz
      x[j + 2] = oz0 + m20 * rx + m21 * ry + m22 * rz
    }
  }

  // relative-velocity damping along every edge over a time `dt`: a fraction 1 − e^(−rate·dt) of
  // each edge's closing speed is removed, shared by inverse mass (momentum is kept)
  dampEdges(dt) {
    const { x, v, edges, edgeW } = this
    const k = 1 - Math.exp(-this.dampRate() * dt)
    for (let e = 0; e < this.nE; e++) {
      const I = 3 * edges[2 * e], J = 3 * edges[2 * e + 1]
      const nx = x[J] - x[I], ny = x[J + 1] - x[I + 1], nz = x[J + 2] - x[I + 2]
      const l2 = nx * nx + ny * ny + nz * nz
      if (l2 < 1e-18) continue
      // impulse along n̂ = n/|n|: (rv·k) n̂ = n · (n·Δv) k / |n|²  (no square root needed)
      const s = (((v[J] - v[I]) * nx + (v[J + 1] - v[I + 1]) * ny + (v[J + 2] - v[I + 2]) * nz) * k) / l2
      const si = s * edgeW[2 * e], sj = s * edgeW[2 * e + 1]
      v[I] += nx * si; v[I + 1] += ny * si; v[I + 2] += nz * si
      v[J] -= nx * sj; v[J + 1] -= ny * sj; v[J + 2] -= nz * sj
    }
  }

  kineticEnergy() {
    let e = 0
    const v = this.v, m = this.mass
    for (let i = 0; i < this.n; i++) {
      const k = 3 * i
      e += 0.5 * m[i] * (v[k] * v[k] + v[k + 1] * v[k + 1] + v[k + 2] * v[k + 2])
    }
    return e
  }

  // how far the body is from its rest shape (max particle offset, sim units)
  maxOffset() {
    let m = 0
    const x = this.x, r = this.rest
    for (let i = 0; i < x.length; i += 3) {
      const dx = x[i] - r[i], dy = x[i + 1] - r[i + 1], dz = x[i + 2] - r[i + 2]
      const d = dx * dx + dy * dy + dz * dz
      if (d > m) m = d
    }
    return Math.sqrt(m)
  }

  centroid() {
    let x = 0, y = 0, z = 0, m = 0
    for (let i = 0; i < this.n; i++) {
      const w = this.mass[i]
      m += w; x += this.x[3 * i] * w; y += this.x[3 * i + 1] * w; z += this.x[3 * i + 2] * w
    }
    return [x / m, y / m, z / m]
  }
}

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

// row-major 3×3 rotation → quaternion (x, y, z, w), written into out
function matToQuat(m, out) {
  const tr = m[0] + m[4] + m[8]
  let x, y, z, w
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1)
    w = 0.25 / s; x = (m[7] - m[5]) * s; y = (m[2] - m[6]) * s; z = (m[3] - m[1]) * s
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8])
    w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8])
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4])
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s
  }
  const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w)
  out[0] = x * l; out[1] = y * l; out[2] = z * l; out[3] = w * l
  return out
}
