// ─────────────────────────────────────────────────────────────
//  XPBD tetrahedral soft body (ported from the "Melon Jelly" artifact)
//  · co-rotational tet constraints → elasticity (each tet pulled toward its
//                                    best-fit rotated rest shape; recovers inversions)
//  · tet volume constraints        → near-incompressibility
//  · soft grab attachment
//  · relative-velocity damping along edges (internal viscosity)
//  Fixed 60 Hz step, 10 substeps, one iteration per substep.
//
//  Changes for the site: no gravity, no floor, no knife/pieces. Instead the
//  slice floats in place — an anchor removes the rigid-body modes every
//  substep (centroid locked, rigid spin replaced by a damped return to the
//  rest orientation), so a grab can only stretch and wobble the jelly.
// ─────────────────────────────────────────────────────────────

export class SoftBody {
  constructor(mesh, opts = {}) {
    const { rest, tets, region } = mesh
    this.n = rest.length / 3
    this.nT = tets.length / 4
    this.tets = tets
    this.rest = Float32Array.from(rest)
    this.x = new Float32Array(rest.length)
    this.prev = new Float32Array(rest.length)
    this.v = new Float32Array(rest.length)
    this.invMass = new Float32Array(this.n)
    this.mass = new Float32Array(this.n)
    this.restVol = new Float32Array(this.nT)

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

    // co-rotational tet elasticity: rest shape about the tet centroid, warm-started rotation
    this.tetQ = new Float32Array(this.nT * 12)
    this.tetRot = new Float32Array(this.nT * 4) // quaternion (x, y, z, w)
    this.tetFirm = new Float32Array(this.nT)
    this.tetMass = new Float32Array(this.nT * 5) // corner masses + their sum
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

    // anchor: which particles hold the slice in place (weights), their rest centroid and offsets
    this.anchorW = new Float32Array(this.n)
    this.pinW = new Float32Array(this.n) // 0..1, soft pins to rest (none until the first grab)
    this.restOff = new Float32Array(rest.length)
    this.c0 = [0, 0, 0]
    this.setAnchorWeights(this.mass)
    this.bodyRot = [0, 0, 0, 1] // best-fit rotation of the anchor set, rest → current (warm start)

    // parameters (sim units: metres-ish, seconds)
    this.firmness = opts.firmness ?? 0.5 // 0..1
    this.damping = opts.damping ?? 0.45 // 0..1
    this.returnRate = opts.returnRate ?? 7 // 1/s, how fast a rigid twist eases back to rest
    this.lockRate = opts.lockRate ?? 60 // 1/s, how hard the anchor set is held on its rest position
    this.pinStiffness = opts.pinStiffness ?? 600 // 1/s², per unit mass (≈4 Hz), critically damped
    // 1/s, mass-proportional drag on the (elastic-only, see anchor) motion while free.
    // On the artifact's floor, contact friction bled the wobble off; floating, the slow
    // bending modes need this or they ring for many seconds.
    this.settleRate = opts.settleRate ?? 3.8
    this.substeps = 10
    this.stepDt = 1 / 60
    this.maxSpeed = 12

    // grab state
    this.grabIdx = new Int32Array(this.n)
    this.grabW = new Float32Array(this.n)
    this.grabOff = new Float32Array(this.n * 3)
    this.grabN = 0
    this.grabTarget = new Float32Array(3)
    this.grabStart = new Float32Array(3)
    this.grabRot = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
    this.grabbing = false
    this.maxReach = opts.maxReach ?? 2.2

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
    this.bodyRot = [0, 0, 0, 1]
    for (let t = 0; t < this.nT; t++) {
      this.tetRot[4 * t] = this.tetRot[4 * t + 1] = this.tetRot[4 * t + 2] = 0
      this.tetRot[4 * t + 3] = 1
    }
    this.endGrab()
  }

  // stiffness mapping: firmness 0..1 → shape compliance (log scale)
  shapeCompliance() { return Math.exp(Math.log(3.0) + (Math.log(0.05) - Math.log(3.0)) * this.firmness) }
  volCompliance() { return 1e-4 * (1 - 0.7 * this.firmness) }
  // damping 0..1 → rate (1/s) of relative-velocity decay along edges
  dampRate() { return 2 + 40 * this.damping * this.damping }

  setAnchorWeights(w) {
    const { rest, n } = this
    let W = 0
    const c = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      this.anchorW[i] = w[i]
      W += w[i]
      for (let k = 0; k < 3; k++) c[k] += rest[3 * i + k] * w[i]
    }
    for (let k = 0; k < 3; k++) c[k] /= W
    this.c0 = c
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) this.restOff[3 * i + k] = rest[3 * i + k] - c[k]
  }

  // The part of the slice far from the hand holds it in place. Particles within ~0.6 of
  // the grab (rest space) are free; beyond that they ramp up to full weight at ~1.8, both
  // in the rigid anchor set and in soft, critically damped pins to their rest positions.
  // So pulling the tip leaves the rind where it was, and vice versa; only the part you
  // hold stretches. The weights stay after release, holding the far side while the
  // stretched part snaps back.
  anchorAwayFrom(i0) {
    const { rest, mass, n } = this
    const px = rest[3 * i0], py = rest[3 * i0 + 1], pz = rest[3 * i0 + 2]
    const w = new Float32Array(n)
    let W = 0
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(rest[3 * i] - px, rest[3 * i + 1] - py, rest[3 * i + 2] - pz)
      const t = Math.min(1, Math.max(0, (d - 0.6) / 1.2))
      const s = t * t * (3 - 2 * t)
      this.pinW[i] = s * s
      w[i] = mass[i] * s * s
      W += w[i]
    }
    this.setAnchorWeights(W > 0.05 * this.totalMass ? w : mass)
  }

  // ── grabbing ──
  beginGrab(hit, radius = 0.4) {
    this.grabN = 0
    let nearest = -1, nd = Infinity
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[3 * i] - hit[0], dy = this.x[3 * i + 1] - hit[1], dz = this.x[3 * i + 2] - hit[2]
      const d = Math.hypot(dx, dy, dz)
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
    if (nearest >= 0) this.anchorAwayFrom(nearest)
    this.grabTarget.set(hit)
    this.grabStart.set(hit)
    this.grabRot.set([1, 0, 0, 0, 1, 0, 0, 0, 1])
    this.grabbing = true
  }

  moveGrab(target, rot) {
    this.grabTarget.set(target)
    // bounded reach: a strong stretch, never an unbounded one
    const dx = target[0] - this.grabStart[0], dy = target[1] - this.grabStart[1], dz = target[2] - this.grabStart[2]
    const d = Math.hypot(dx, dy, dz), maxReach = this.maxReach
    if (d > maxReach) {
      const k = maxReach / d
      this.grabTarget[0] = this.grabStart[0] + dx * k
      this.grabTarget[1] = this.grabStart[1] + dy * k
      this.grabTarget[2] = this.grabStart[2] + dz * k
    }
    if (rot) this.grabRot.set(rot)
  }

  endGrab() {
    this.grabbing = false
    this.grabN = 0
  }

  // ── simulation ──
  step() {
    const sub = this.substeps
    const dt = this.stepDt / sub
    for (let s = 0; s < sub; s++) this.substep(dt)
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
      if (!Number.isFinite(this.x[i])) { this.reset(); break }
    }
    return ke
  }

  substep(dt) {
    const { x, prev, v, n } = this
    // light air drag; while held, the hand steadies the slice a little more
    const air = Math.exp(-(this.grabbing ? 2.5 : 0.08 + this.settleRate) * dt)
    const { rest, pinW } = this, K = this.pinStiffness
    for (let i = 0; i < n; i++) {
      const k = 3 * i
      v[k] *= air; v[k + 1] *= air; v[k + 2] *= air
      const pw = pinW[i]
      if (pw) {
        // soft pin: damped spring toward the rest position (explicit; stable at these rates)
        const ks = K * pw, cs = 2 * Math.sqrt(ks)
        v[k] += (ks * (rest[k] - x[k]) - cs * v[k]) * dt
        v[k + 1] += (ks * (rest[k + 1] - x[k + 1]) - cs * v[k + 1]) * dt
        v[k + 2] += (ks * (rest[k + 2] - x[k + 2]) - cs * v[k + 2]) * dt
      }
      prev[k] = x[k]; prev[k + 1] = x[k + 1]; prev[k + 2] = x[k + 2]
      x[k] += v[k] * dt; x[k + 1] += v[k + 1] * dt; x[k + 2] += v[k + 2] * dt
    }
    if (this.grabbing) this.solveGrab(dt)
    this.solveTets(dt)
    this.solveVolumes(dt)
    const inv = 1 / dt, vmax = this.maxSpeed
    for (let i = 0; i < 3 * n; i += 3) {
      let vx = (x[i] - prev[i]) * inv, vy = (x[i + 1] - prev[i + 1]) * inv, vz = (x[i + 2] - prev[i + 2]) * inv
      const sp = Math.hypot(vx, vy, vz)
      if (sp > vmax) { const f = vmax / sp; vx *= f; vy *= f; vz *= f }
      v[i] = vx; v[i + 1] = vy; v[i + 2] = vz
    }
    this.anchor(dt)
    this.dampEdges(dt)
  }

  solveGrab(dt) {
    const { x, invMass } = this
    const a = 2e-6 / (dt * dt)
    const R = this.grabRot, T = this.grabTarget
    for (let k = 0; k < this.grabN; k++) {
      const i = this.grabIdx[k], w = invMass[i]
      const ox = this.grabOff[3 * k], oy = this.grabOff[3 * k + 1], oz = this.grabOff[3 * k + 2]
      const tx = T[0] + R[0] * ox + R[1] * oy + R[2] * oz
      const ty = T[1] + R[3] * ox + R[4] * oy + R[5] * oz
      const tz = T[2] + R[6] * ox + R[7] * oy + R[8] * oz
      const f = (this.grabW[k] * w) / (w + a)
      x[3 * i] += (tx - x[3 * i]) * f
      x[3 * i + 1] += (ty - x[3 * i + 1]) * f
      x[3 * i + 2] += (tz - x[3 * i + 2]) * f
    }
  }

  // Per-tet co-rotational shape matching: find the rotation that best maps the rest tet onto the
  // current one (Müller et al. 2016, warm-started quaternion), then pull the four corners toward the
  // rotated rest shape with XPBD compliance. Inverted tets are always pushed back to a proper shape.
  solveTets(dt) {
    const { x, tets, tetQ, tetRot: Q, tetFirm, tetMass } = this
    const base = this.shapeCompliance() / (dt * dt)
    for (let t = 0; t < this.nT; t++) {
      const a = 3 * tets[4 * t], b = 3 * tets[4 * t + 1], c = 3 * tets[4 * t + 2], d = 3 * tets[4 * t + 3]
      const ma = tetMass[5 * t], mb = tetMass[5 * t + 1], mc = tetMass[5 * t + 2], md = tetMass[5 * t + 3]
      const M = tetMass[5 * t + 4]
      const cx = (x[a] * ma + x[b] * mb + x[c] * mc + x[d] * md) / M
      const cy = (x[a + 1] * ma + x[b + 1] * mb + x[c + 1] * mc + x[d + 1] * md) / M
      const cz = (x[a + 2] * ma + x[b + 2] * mb + x[c + 2] * mc + x[d + 2] * md) / M
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
      for (let it = 0; it < 2; it++) {
        r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy)
        r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx)
        r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy)
        const ox = (r10 * f20 - r20 * f10) + (r11 * f21 - r21 * f11) + (r12 * f22 - r22 * f12)
        const oy = (r20 * f00 - r00 * f20) + (r21 * f01 - r01 * f21) + (r22 * f02 - r02 * f22)
        const oz = (r00 * f10 - r10 * f00) + (r01 * f11 - r11 * f01) + (r02 * f12 - r12 * f02)
        const den = Math.abs(r00 * f00 + r10 * f10 + r20 * f20 + r01 * f01 + r11 * f11 + r21 * f21 + r02 * f02 + r12 * f12 + r22 * f22) + 1e-12
        const wx = ox / den, wy = oy / den, wz = oz / den
        const w = Math.sqrt(wx * wx + wy * wy + wz * wz)
        if (w < 1e-6) break
        // small-angle quaternion step (renormalised below); large jumps are clamped
        const sc = w > 1 ? 0.5 / w : 0.5
        const ax = wx * sc, ay = wy * sc, az = wz * sc
        const nx = qx + ax * qw + ay * qz - az * qy
        const ny = qy - ax * qz + ay * qw + az * qx
        const nz = qz + ax * qy - ay * qx + az * qw
        const nw = qw - ax * qx - ay * qy - az * qz
        const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw)
        qx = nx * nl; qy = ny * nl; qz = nz * nl; qw = nw * nl
      }
      r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy)
      r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx)
      r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy)
      Q[4 * t] = qx; Q[4 * t + 1] = qy; Q[4 * t + 2] = qz; Q[4 * t + 3] = qw
      // the same fraction for all four corners keeps linear and angular momentum intact
      const f = 1 / (1 + base * tetFirm[t] * M * 0.25)
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

  solveVolumes(dt) {
    const { x, invMass, tets, restVol } = this
    const alpha0 = this.volCompliance() / (dt * dt)
    for (let t = 0; t < this.nT; t++) {
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
      // anti-inversion: elements far below rest volume get a rigid (compliance-free) correction
      const alpha = V < 0.25 * r0 ? 0 : alpha0
      const C = 6 * (V - r0)
      const s = -C / (wsum + alpha)
      x[A] += gax * s * wa; x[A + 1] += gay * s * wa; x[A + 2] += gaz * s * wa
      x[B] += gbx * s * wb; x[B + 1] += gby * s * wb; x[B + 2] += gbz * s * wb
      x[Cc] += gcx * s * wc; x[Cc + 1] += gcy * s * wc; x[Cc + 2] += gcz * s * wc
      x[D] += gdx * s * wd; x[D + 1] += gdy * s * wd; x[D + 2] += gdz * s * wd
    }
  }

  // Keeps the slice where it is. Runs after the velocity update of every substep, on the
  // anchor set (anchorW: the whole body at first, after a grab the part far from the hand):
  //  · translation: the set's centroid is pulled back onto its rest position (τ ≈ 17 ms,
  //    so a change of anchor set never pops) and its net linear momentum removed;
  //  · rotation: the set's best-fit rigid rotation (rest → now) is tracked, and its rigid
  //    angular velocity is replaced by an exponential return toward the rest orientation
  //    (rate = returnRate).
  // Both corrections are rigid motions of the whole body, so they never fight the
  // deformation: the jelly stretches and wobbles freely, the slice just doesn't go anywhere.
  anchor(dt) {
    const { x, v, n, restOff, c0, anchorW: wt } = this
    let M = 0, cx = 0, cy = 0, cz = 0, px = 0, py = 0, pz = 0
    for (let i = 0; i < n; i++) {
      const m = wt[i], k = 3 * i
      if (!m) continue
      M += m
      cx += x[k] * m; cy += x[k + 1] * m; cz += x[k + 2] * m
      px += v[k] * m; py += v[k + 1] * m; pz += v[k + 2] * m
    }
    cx /= M; cy /= M; cz /= M
    px /= M; py /= M; pz /= M
    const lock = 1 - Math.exp(-this.lockRate * dt)
    const sx = (c0[0] - cx) * lock, sy = (c0[1] - cy) * lock, sz = (c0[2] - cz) * lock
    const ox0 = cx + sx, oy0 = cy + sy, oz0 = cz + sz // the set's centroid after the shift
    // A = Σ w (x − c)(X − c0)ᵀ, plus angular momentum L and inertia I about c
    let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0
    let Lx = 0, Ly = 0, Lz = 0
    let i00 = 0, i01 = 0, i02 = 0, i11 = 0, i12 = 0, i22 = 0
    for (let i = 0; i < n; i++) {
      const k = 3 * i, m = wt[i]
      x[k] += sx; x[k + 1] += sy; x[k + 2] += sz
      v[k] -= px; v[k + 1] -= py; v[k + 2] -= pz
      if (!m) continue
      const rx = x[k] - ox0, ry = x[k + 1] - oy0, rz = x[k + 2] - oz0
      const qx = restOff[k], qy = restOff[k + 1], qz = restOff[k + 2]
      const mrx = m * rx, mry = m * ry, mrz = m * rz
      a00 += mrx * qx; a01 += mrx * qy; a02 += mrx * qz
      a10 += mry * qx; a11 += mry * qy; a12 += mry * qz
      a20 += mrz * qx; a21 += mrz * qy; a22 += mrz * qz
      Lx += mry * v[k + 2] - mrz * v[k + 1]
      Ly += mrz * v[k] - mrx * v[k + 2]
      Lz += mrx * v[k + 1] - mry * v[k]
      i00 += m * (ry * ry + rz * rz); i11 += m * (rx * rx + rz * rz); i22 += m * (rx * rx + ry * ry)
      i01 -= m * rx * ry; i02 -= m * rx * rz; i12 -= m * ry * rz
    }
    // best-fit rotation, warm-started (Müller et al. 2016)
    let [qx, qy, qz, qw] = this.bodyRot
    for (let it = 0; it < 3; it++) {
      const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy)
      const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx)
      const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy)
      const ox = (r10 * a20 - r20 * a10) + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12)
      const oy = (r20 * a00 - r00 * a20) + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22)
      const oz = (r00 * a10 - r10 * a00) + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02)
      const den = Math.abs(r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22) + 1e-12
      const wx = ox / den, wy = oy / den, wz = oz / den
      const w = Math.hypot(wx, wy, wz)
      if (w < 1e-9) break
      const h = Math.min(w, 2) / 2, sn = Math.sin(h) / w, cs = Math.cos(h)
      const ax = wx * sn, ay = wy * sn, az = wz * sn
      const nx = cs * qx + ax * qw + ay * qz - az * qy
      const ny = cs * qy - ax * qz + ay * qw + az * qx
      const nz = cs * qz + ax * qy - ay * qx + az * qw
      const nw = cs * qw - ax * qx - ay * qy - az * qz
      const l = Math.hypot(nx, ny, nz, nw)
      qx = nx / l; qy = ny / l; qz = nz / l; qw = nw / l
    }
    if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw }
    this.bodyRot = [qx, qy, qz, qw]
    // rotation vector of the current pose (angle × axis)
    const s = Math.hypot(qx, qy, qz)
    const ang = 2 * Math.atan2(s, qw)
    const k = s > 1e-9 ? ang / s : 2
    // rigid angular velocity ω = I⁻¹ L, replaced by −returnRate · (angle · axis)
    const inv = inv3sym(i00, i01, i02, i11, i12, i22)
    if (!inv) return
    const ox = inv[0] * Lx + inv[1] * Ly + inv[2] * Lz
    const oy = inv[1] * Lx + inv[3] * Ly + inv[4] * Lz
    const oz = inv[2] * Lx + inv[4] * Ly + inv[5] * Lz
    const rate = this.returnRate
    const dx = -rate * qx * k - ox, dy = -rate * qy * k - oy, dz = -rate * qz * k - oz
    for (let i = 0; i < n; i++) {
      const j = 3 * i
      const rx = x[j] - ox0, ry = x[j + 1] - oy0, rz = x[j + 2] - oz0
      v[j] += dy * rz - dz * ry
      v[j + 1] += dz * rx - dx * rz
      v[j + 2] += dx * ry - dy * rx
    }
  }

  dampEdges(dt) {
    const { x, v, invMass, edges } = this
    const k = 1 - Math.exp(-this.dampRate() * dt)
    for (let e = 0; e < this.nE; e++) {
      const i = edges[2 * e], j = edges[2 * e + 1]
      const I = 3 * i, J = 3 * j
      let nx = x[J] - x[I], ny = x[J + 1] - x[I + 1], nz = x[J + 2] - x[I + 2]
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (l < 1e-9) continue
      nx /= l; ny /= l; nz /= l
      const rv = (v[J] - v[I]) * nx + (v[J + 1] - v[I + 1]) * ny + (v[J + 2] - v[I + 2]) * nz
      const wi = invMass[i], wj = invMass[j], ws = wi + wj
      const imp = (rv * k) / ws
      v[I] += nx * imp * wi; v[I + 1] += ny * imp * wi; v[I + 2] += nz * imp * wi
      v[J] -= nx * imp * wj; v[J + 1] -= ny * imp * wj; v[J + 2] -= nz * imp * wj
    }
  }

  kineticEnergy() {
    let e = 0
    for (let i = 0; i < this.n; i++) {
      const k = 3 * i
      e += 0.5 * this.mass[i] * (this.v[k] ** 2 + this.v[k + 1] ** 2 + this.v[k + 2] ** 2)
    }
    return e
  }

  // how far the body is from its rest shape (max particle offset, sim units)
  maxOffset() {
    let m = 0
    for (let i = 0; i < this.x.length; i += 3) {
      const d = (this.x[i] - this.rest[i]) ** 2 + (this.x[i + 1] - this.rest[i + 1]) ** 2 + (this.x[i + 2] - this.rest[i + 2]) ** 2
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

// inverse of a symmetric 3×3 [a b c; b d e; c e f] → [a' b' c' d' e' f']
function inv3sym(a, b, c, d, e, f) {
  const A = d * f - e * e, B = c * e - b * f, C = b * e - c * d
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-20) return null
  const k = 1 / det
  return [A * k, B * k, C * k, (a * f - c * c) * k, (b * c - a * e) * k, (a * d - b * b) * k]
}
