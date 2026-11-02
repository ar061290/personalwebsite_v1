// ─────────────────────────────────────────────────────────────
//  Geometry: the rounded watermelon wedge, its tetrahedral sim mesh,
//  the smooth render surface (+ seeds and air bubbles) and the
//  barycentric embedding that ties every render vertex to a tet.
//
//  Ported from the "Melon Jelly" artifact (single, uncut piece).
//  Rest frame: the wedge profile lies in the x/z plane (u = x lateral,
//  w = z from the tip towards the rind), y is the slab thickness.
// ─────────────────────────────────────────────────────────────

export const SHAPE = {
  alpha: (32 * Math.PI) / 180, // half angle of the wedge
  Ri: 1.62, // inner sector radius (before rounding)
  rho: 0.17, // in-plane corner rounding
  T: 0.58, // thickness
  bevel: 0.13, // rounding of the top / bottom edges
  skin: 0.075, // green skin band depth
  pale: 0.25, // skin + pale layer depth
}
SHAPE.Ro = SHAPE.Ri + SHAPE.rho

const RC = SHAPE.rho // corner radius of the outline

// seeded PRNG so the specimen is identical on each load
export function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Bowyer–Watson Delaunay (convex point sets, a few thousand points) ──
function delaunay(pts) {
  const n = pts.length / 2
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, pts[2 * i]); maxX = Math.max(maxX, pts[2 * i])
    minY = Math.min(minY, pts[2 * i + 1]); maxY = Math.max(maxY, pts[2 * i + 1])
  }
  const d = Math.max(maxX - minX, maxY - minY) * 20
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2
  const P = Array.from(pts)
  P.push(mx - d, my - d, mx + d, my - d, mx, my + d)
  let tris = []
  const mk = (a, b, c) => {
    const ax = P[2 * a], ay = P[2 * a + 1], bx = P[2 * b], by = P[2 * b + 1], cx = P[2 * c], cy = P[2 * c + 1]
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D
    return { a, b, c, x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 }
  }
  tris.push(mk(n, n + 1, n + 2))
  for (let i = 0; i < n; i++) {
    const px = P[2 * i], py = P[2 * i + 1]
    const bad = [], keep = []
    for (const t of tris) ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r2 * (1 + 1e-9) ? bad : keep).push(t)
    const edges = new Map()
    for (const t of bad) {
      for (const [e0, e1] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const k = e0 < e1 ? e0 * 100003 + e1 : e1 * 100003 + e0
        const ex = edges.get(k)
        if (ex) ex.count++
        else edges.set(k, { e0, e1, count: 1 })
      }
    }
    tris = keep
    for (const e of edges.values()) if (e.count === 1) tris.push(mk(e.e0, e.e1, i))
  }
  const res = []
  for (const t of tris) {
    if (t.a >= n || t.b >= n || t.c >= n) continue
    // CCW orientation
    const ax = P[2 * t.a], ay = P[2 * t.a + 1]
    const cr = (P[2 * t.b] - ax) * (P[2 * t.c + 1] - ay) - (P[2 * t.b + 1] - ay) * (P[2 * t.c] - ax)
    if (cr > 0) res.push(t.a, t.b, t.c)
    else res.push(t.a, t.c, t.b)
  }
  return res
}

export function tetVolume(p, a, b, c, d) {
  const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2]
  const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az
  const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az
  const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az
  return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6
}

// The whole slice as a convex "inner polygon" I in the rest plane (u, w);
// its real outline is I grown by RC, so every corner is rounded.
export function slicePolygon() {
  const { alpha: a, Ri } = SHAPE
  const I = [[0, 0]]
  const a0 = Math.PI / 2 - a, a1 = Math.PI / 2 + a, n = 40
  for (let k = 0; k <= n; k++) {
    const t = a0 + ((a1 - a0) * k) / n
    I.push([Math.cos(t) * Ri, Math.sin(t) * Ri])
  }
  return I
}

// signed distance to the polygon outline (negative inside)
function sdInner(I, u, w) {
  let d = -Infinity
  for (let i = 0; i < I.length; i++) {
    const p = I[i], q = I[(i + 1) % I.length]
    const ex = q[0] - p[0], ew = q[1] - p[1], l = Math.hypot(ex, ew) || 1
    const nx = ew / l, nw = -ex / l
    d = Math.max(d, nx * (u - p[0]) + nw * (w - p[1]))
  }
  return d
}
function sdPiece(I, u, w, inset = 0) {
  return sdInner(I, u, w) - RC + inset
}

// outline samples: base point q on I and outward normal n; the outline at offset d is q + n·d
function pieceSamples(I, spacing, maxAngleStep) {
  const out = [], N = I.length
  const edgeN = []
  for (let i = 0; i < N; i++) {
    const p = I[i], q = I[(i + 1) % N]
    const ex = q[0] - p[0], ew = q[1] - p[1], l = Math.hypot(ex, ew) || 1
    edgeN.push([ew / l, -ex / l, l])
  }
  for (let i = 0; i < N; i++) {
    const n0 = edgeN[(i - 1 + N) % N], n1 = edgeN[i]
    const a0 = Math.atan2(n0[1], n0[0]), a1 = Math.atan2(n1[1], n1[0])
    let da = a1 - a0
    while (da < 0) da += Math.PI * 2
    if (da > Math.PI * 1.5) da = 0
    const na = Math.max(1, Math.ceil(Math.max((RC * da) / spacing, da / maxAngleStep)))
    for (let k = 0; k < na; k++) {
      const t = a0 + (da * k) / na
      out.push({ q: I[i], n: [Math.cos(t), Math.sin(t)] })
    }
    const nl = Math.max(1, Math.ceil(n1[2] / spacing))
    for (let k = 1; k < nl; k++) {
      const t = k / nl, p = I[i], q = I[(i + 1) % N]
      out.push({ q: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], n: [n1[0], n1[1]] })
    }
  }
  return out
}

function bboxLattice(I, pad, spacing, keep) {
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity
  for (const p of I) {
    u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0])
    w0 = Math.min(w0, p[1]); w1 = Math.max(w1, p[1])
  }
  u0 -= pad; u1 += pad; w0 -= pad; w1 += pad
  const pts = [], dy = (spacing * Math.sqrt(3)) / 2
  let row = 0
  for (let w = w0; w <= w1; w += dy, row++) {
    for (let u = u0 + ((row % 2) * spacing) / 2; u <= u1; u += spacing) if (keep(u, w)) pts.push(u, w)
  }
  return pts
}

// ── simulation mesh: Delaunay of the outline, extruded into prisms → tets ──
function buildSimMesh(I, h = 0.15, layers = 3) {
  const { T, Ro, skin, pale } = SHAPE
  const bs = pieceSamples(I, h, 0.5)
  const P2 = []
  for (const s of bs) {
    const x = s.q[0] + s.n[0] * RC, z = s.q[1] + s.n[1] * RC
    let dup = false
    for (let j = 0; j < P2.length; j += 2) {
      if (Math.hypot(P2[j] - x, P2[j + 1] - z) < h * 0.45) { dup = true; break }
    }
    if (!dup) P2.push(x, z)
  }
  const all = P2.concat(bboxLattice(I, RC, h, (u, w) => sdPiece(I, u, w) < -h * 0.55))
  const tri2 = delaunay(all)
  // drop sliver hull triangles (nearly collinear boundary triples)
  const t2 = []
  for (let i = 0; i < tri2.length; i += 3) {
    const a = tri2[i], b = tri2[i + 1], c = tri2[i + 2]
    const ax = all[2 * a], ay = all[2 * a + 1], bx = all[2 * b], by = all[2 * b + 1], cx = all[2 * c], cy = all[2 * c + 1]
    const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2
    const l2 = Math.max((bx - ax) ** 2 + (by - ay) ** 2, (cx - bx) ** 2 + (cy - by) ** 2, (ax - cx) ** 2 + (ay - cy) ** 2)
    if (area / l2 > 0.1) t2.push(a, b, c)
  }
  const used = new Int32Array(all.length / 2).fill(-1)
  const v2 = []
  for (const v of t2) {
    if (used[v] < 0) { used[v] = v2.length / 2; v2.push(all[2 * v], all[2 * v + 1]) }
  }
  const tris = t2.map((v) => used[v])
  const n2 = v2.length / 2, nL = layers + 1
  const rest = new Float32Array(n2 * nL * 3)
  for (let l = 0; l < nL; l++) {
    for (let i = 0; i < n2; i++) {
      const k = (l * n2 + i) * 3
      rest[k] = v2[2 * i]; rest[k + 1] = (T * l) / layers; rest[k + 2] = v2[2 * i + 1]
    }
  }
  const tets = []
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < tris.length; i += 3) {
      const s = [tris[i], tris[i + 1], tris[i + 2]].sort((x, y) => x - y)
      const a = l * n2 + s[0], b = l * n2 + s[1], c = l * n2 + s[2]
      tets.push(a, b, c, a + n2, b, c, a + n2, b + n2, c, a + n2, b + n2, c + n2)
    }
  }
  // orient every tet to positive volume
  for (let t = 0; t < tets.length; t += 4) {
    if (tetVolume(rest, tets[t], tets[t + 1], tets[t + 2], tets[t + 3]) < 0) {
      const tmp = tets[t + 2]; tets[t + 2] = tets[t + 3]; tets[t + 3] = tmp
    }
  }
  // per-particle material region: 0 flesh, 1 pale, 2 rind
  const nP = n2 * nL, region = new Uint8Array(nP)
  for (let i = 0; i < nP; i++) {
    const depth = Ro - Math.hypot(rest[3 * i], rest[3 * i + 2])
    region[i] = depth < skin + 0.03 ? 2 : depth < pale ? 1 : 0
  }
  return { rest, tets: new Uint32Array(tets), region }
}

// seed placement (polar r, th in the rest plane; face +1 top cap, -1 bottom cap, 0 inside)
function seedParams(R) {
  const seeds = []
  const rows = [{ r: 0.46, n: 2 }, { r: 0.68, n: 3 }, { r: 0.9, n: 4 }, { r: 1.12, n: 5 }, { r: 1.33, n: 5 }]
  for (const face of [1, -1]) {
    for (const row of rows) {
      const maxTh = SHAPE.alpha - (0.12 + 0.07) / row.r - 0.02
      for (let i = 0; i < row.n; i++) {
        const t = row.n === 1 ? 0 : (i / (row.n - 1)) * 2 - 1
        seeds.push({
          r: row.r + (R() - 0.5) * 0.08,
          th: t * maxTh * 0.88 + (R() - 0.5) * 0.06 + (face < 0 ? 0.05 : 0),
          face,
          s: 0.85 + R() * 0.3,
        })
      }
    }
  }
  // two seeds suspended deep inside, glimpsed through the jelly
  seeds.push({ r: 0.9, th: 0.12, face: 0, s: 0.9 }, { r: 1.12, th: -0.2, face: 0, s: 0.8 })
  return seeds
}

// the same seed layout without building any mesh (for the static fallback)
export function seedLayout() {
  return seedParams(rng(9))
}

// ── seeds and bubbles in the rest frame ──
function buildProps() {
  const { T } = SHAPE
  const R = rng(9)
  const list = []
  const seeds = seedParams(R)
  const nt = 10, nph = 12
  for (const sd of seeds) {
    const L = 0.15 * sd.s, W = 0.088 * sd.s, H = 0.042 * sd.s
    const cx = Math.sin(sd.th) * sd.r, cz = Math.cos(sd.th) * sd.r
    const ax = [Math.sin(sd.th), 0, Math.cos(sd.th)], lx = [Math.cos(sd.th), 0, -Math.sin(sd.th)]
    const tilt = (R() - 0.5) * 0.25
    const cy = sd.face > 0 ? T - H * 0.64 : sd.face < 0 ? H * 0.64 : T * (0.35 + R() * 0.25)
    const pos = [], nrm = [], idx = []
    for (let i = 0; i <= nt; i++) {
      const t = (Math.PI * i) / nt, s = (1 - Math.cos(t)) / 2
      const prof = Math.pow(Math.sin(t), 0.9) * (0.38 + 0.62 * Math.pow(s, 0.7))
      for (let j = 0; j < nph; j++) {
        const ph = (2 * Math.PI * j) / nph
        const la = (Math.cos(ph) * prof * W) / 2, up = (Math.sin(ph) * prof * H) / 2, al = (s - 0.5) * L, upT = up + al * tilt * 0.3
        pos.push(cx + ax[0] * al + lx[0] * la, cy + upT, cz + ax[2] * al + lx[2] * la)
        nrm.push((ax[0] * al) / L + (lx[0] * la) / W, upT / H, (ax[2] * al) / L + (lx[2] * la) / W)
      }
    }
    for (let i = 0; i < nt; i++) {
      for (let j = 0; j < nph; j++) {
        const a = i * nph + j, bb = i * nph + ((j + 1) % nph), c = a + nph, d = bb + nph
        idx.push(a, bb, c, bb, d, c)
      }
    }
    list.push({ mat: 1, cx, cz, rad: L * 0.5, pos, nrm, idx })
  }
  const bub = []
  for (let i = 0; i < 9; i++) {
    const r = 0.45 + R() * 0.85, th = (R() * 2 - 1) * (SHAPE.alpha - 0.14 / r) * 0.9
    const rad = 0.009 + R() * R() * 0.02, y = R() < 0.6 ? T - 0.035 - R() * 0.16 : 0.05 + R() * 0.14
    bub.push([Math.sin(th) * r, y, Math.cos(th) * r, rad])
  }
  bub.push([0.22, T - 0.06, 0.45, 0.012], [-0.2, T - 0.09, 1.05, 0.016])
  const bs = 8, bp = 12
  for (const [x, y, z, r] of bub) {
    const pos = [], nrm = [], idx = []
    for (let i = 0; i <= bs; i++) {
      const t = (Math.PI * i) / bs
      for (let j = 0; j < bp; j++) {
        const ph = (2 * Math.PI * j) / bp
        const nx = Math.sin(t) * Math.cos(ph), ny = Math.cos(t), nz = Math.sin(t) * Math.sin(ph)
        pos.push(x + nx * r, y + ny * r, z + nz * r); nrm.push(nx, ny, nz)
      }
    }
    for (let i = 0; i < bs; i++) {
      for (let j = 0; j < bp; j++) {
        const a = i * bp + j, bb = i * bp + ((j + 1) % bp), c = a + bp, d = bb + bp
        idx.push(a, bb, c, bb, d, c)
      }
    }
    list.push({ mat: 2, cx: x, cz: z, rad: r, pos, nrm, idx })
  }
  return list
}

// ── render mesh: rounded walls, two caps, and the seeds/bubbles inside ──
// material ids: 0 body, 1 seed, 2 bubble
function buildRenderMesh(I, props) {
  const { T, bevel: b } = SHAPE
  const pos = [], nrm = [], mat = [], body = [], seeds = [], bubbles = []
  const add = (x, y, z, m, nx, ny, nz) => {
    pos.push(x, y, z); nrm.push(nx, ny, nz); mat.push(m)
    return pos.length / 3 - 1
  }
  const samples = pieceSamples(I, 0.03, 0.1)
  const N = samples.length
  // wall rings: bottom bevel quarter, straight band, top bevel quarter
  const qb = 8, qs = 3, rings = []
  for (let j = 0; j <= qb; j++) {
    const ps = -Math.PI / 2 + ((Math.PI / 2) * j) / qb
    rings.push({ d: RC - b + b * Math.cos(ps), y: b + b * Math.sin(ps), ny: Math.sin(ps), nr: Math.cos(ps) })
  }
  for (let j = 1; j < qs; j++) rings.push({ d: RC, y: b + ((T - 2 * b) * j) / qs, ny: 0, nr: 1 })
  for (let j = 0; j <= qb; j++) {
    const ps = ((Math.PI / 2) * j) / qb
    rings.push({ d: RC - b + b * Math.cos(ps), y: T - b + b * Math.sin(ps), ny: Math.sin(ps), nr: Math.cos(ps) })
  }
  const ringStart = []
  for (const r of rings) {
    ringStart.push(pos.length / 3)
    for (const s of samples) add(s.q[0] + s.n[0] * r.d, r.y, s.q[1] + s.n[1] * r.d, 0, s.n[0] * r.nr, r.ny, s.n[1] * r.nr)
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let k = 0; k < N; k++) {
      const a = ringStart[j] + k, bb = ringStart[j] + ((k + 1) % N), c = ringStart[j + 1] + k, d = ringStart[j + 1] + ((k + 1) % N)
      body.push(a, c, bb, bb, c, d)
    }
  }
  // caps: Delaunay on the inset outline + a fine hex lattice
  const inset = RC - b, capPts = []
  for (const s of samples) capPts.push(s.q[0] + s.n[0] * inset, s.q[1] + s.n[1] * inset)
  const sp = 0.048
  const cp = capPts.concat(bboxLattice(I, RC, sp, (u, w) => sdPiece(I, u, w, b) < -sp * 0.6))
  const ctri = delaunay(cp)
  const topRing = ringStart[rings.length - 1], botRing = ringStart[0]
  const topMap = [], botMap = []
  for (let i = 0; i < cp.length / 2; i++) {
    if (i < N) { topMap.push(topRing + i); botMap.push(botRing + i) }
    else {
      topMap.push(add(cp[2 * i], T, cp[2 * i + 1], 0, 0, 1, 0))
      botMap.push(add(cp[2 * i], 0, cp[2 * i + 1], 0, 0, -1, 0))
    }
  }
  for (let i = 0; i < ctri.length; i += 3) {
    const a = ctri[i], c1 = ctri[i + 1], c2 = ctri[i + 2]
    body.push(topMap[a], topMap[c2], topMap[c1])
    body.push(botMap[a], botMap[c1], botMap[c2])
  }
  // seeds and bubbles that sit wholly inside the slice
  for (const pr of props) {
    if (sdPiece(I, pr.cx, pr.cz) + pr.rad > -0.02) continue
    const base = pos.length / 3
    for (let k = 0; k < pr.pos.length; k += 3) add(pr.pos[k], pr.pos[k + 1], pr.pos[k + 2], pr.mat, pr.nrm[k], pr.nrm[k + 1], pr.nrm[k + 2])
    const dst = pr.mat === 1 ? seeds : bubbles
    for (const v of pr.idx) dst.push(base + v)
  }
  // windings agree with analytic outward normals (CCW = front)
  for (const idx of [body, seeds, bubbles]) {
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b1 = idx[i + 1], c = idx[i + 2]
      const e1x = pos[3 * b1] - pos[3 * a], e1y = pos[3 * b1 + 1] - pos[3 * a + 1], e1z = pos[3 * b1 + 2] - pos[3 * a + 2]
      const e2x = pos[3 * c] - pos[3 * a], e2y = pos[3 * c + 1] - pos[3 * a + 1], e2z = pos[3 * c + 2] - pos[3 * a + 2]
      const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x
      let d = 0
      for (const v of [a, b1, c]) d += fx * nrm[3 * v] + fy * nrm[3 * v + 1] + fz * nrm[3 * v + 2]
      if (d < 0) { idx[i + 1] = c; idx[i + 2] = b1 }
    }
  }
  return { rest: new Float32Array(pos), mat: new Float32Array(mat), body, seeds, bubbles }
}

// ── barycentric embedding of points into sim tets ──
function embed(simRest, tets, verts) {
  const nT = tets.length / 4, nV = verts.length / 3
  const cell = 0.2
  const grid = new Map()
  const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512)
  const inv = new Float64Array(nT * 9)
  for (let t = 0; t < nT; t++) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
    const id = [tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]]
    for (const v of id) {
      for (let c = 0; c < 3; c++) {
        mn[c] = Math.min(mn[c], simRest[3 * v + c]); mx[c] = Math.max(mx[c], simRest[3 * v + c])
      }
    }
    for (let i = Math.floor(mn[0] / cell); i <= Math.floor(mx[0] / cell); i++) {
      for (let j = Math.floor(mn[1] / cell); j <= Math.floor(mx[1] / cell); j++) {
        for (let k = Math.floor(mn[2] / cell); k <= Math.floor(mx[2] / cell); k++) {
          const K = key(i, j, k)
          let l = grid.get(K)
          if (!l) grid.set(K, (l = []))
          l.push(t)
        }
      }
    }
    // inverse of [b-a, c-a, d-a]
    const a = id[0]
    const m = []
    for (let c = 1; c < 4; c++) for (let r = 0; r < 3; r++) m.push(simRest[3 * id[c] + r] - simRest[3 * a + r])
    const M = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6])
    const id2 = 1 / det
    inv[9 * t + 0] = (M[4] * M[8] - M[5] * M[7]) * id2; inv[9 * t + 1] = (M[2] * M[7] - M[1] * M[8]) * id2; inv[9 * t + 2] = (M[1] * M[5] - M[2] * M[4]) * id2
    inv[9 * t + 3] = (M[5] * M[6] - M[3] * M[8]) * id2; inv[9 * t + 4] = (M[0] * M[8] - M[2] * M[6]) * id2; inv[9 * t + 5] = (M[2] * M[3] - M[0] * M[5]) * id2
    inv[9 * t + 6] = (M[3] * M[7] - M[4] * M[6]) * id2; inv[9 * t + 7] = (M[1] * M[6] - M[0] * M[7]) * id2; inv[9 * t + 8] = (M[0] * M[4] - M[1] * M[3]) * id2
  }
  const bary = (t, x, y, z) => {
    const a = tets[4 * t]
    const dx = x - simRest[3 * a], dy = y - simRest[3 * a + 1], dz = z - simRest[3 * a + 2]
    const I = 9 * t
    const b1 = inv[I] * dx + inv[I + 1] * dy + inv[I + 2] * dz
    const b2 = inv[I + 3] * dx + inv[I + 4] * dy + inv[I + 5] * dz
    const b3 = inv[I + 6] * dx + inv[I + 7] * dy + inv[I + 8] * dz
    return [1 - b1 - b2 - b3, b1, b2, b3]
  }
  const tetOf = new Uint32Array(nV)
  const w = new Float32Array(nV * 4)
  for (let v = 0; v < nV; v++) {
    const x = verts[3 * v], y = verts[3 * v + 1], z = verts[3 * v + 2]
    let best = -1, bestScore = -Infinity, bestB = null
    const tryT = (t) => {
      const bb = bary(t, x, y, z)
      const s = Math.min(bb[0], bb[1], bb[2], bb[3])
      if (s > bestScore) { bestScore = s; best = t; bestB = bb }
    }
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell)
    for (let r = 0; r <= 2 && bestScore < -1e-4; r++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          for (let k = ck - r; k <= ck + r; k++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue
            const l = grid.get(key(i, j, k))
            if (l) for (const t of l) tryT(t)
          }
        }
      }
    }
    if (best < 0) for (let t = 0; t < nT; t++) tryT(t)
    tetOf[v] = best
    w.set(bestB, 4 * v)
  }
  return { tetOf, w }
}

// boundary triangles of the tet mesh (each appears in exactly one tet) — used for cheap 2D hit tests
function surfaceFaces(tets, nP) {
  const count = new Map()
  const faces = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]
  for (let t = 0; t < tets.length; t += 4) {
    for (const f of faces) {
      const v = [tets[t + f[0]], tets[t + f[1]], tets[t + f[2]]].sort((a, b) => a - b)
      const k = (v[0] * nP + v[1]) * nP + v[2]
      const e = count.get(k)
      if (e) e.n++
      else count.set(k, { n: 1, v })
    }
  }
  const out = []
  for (const e of count.values()) if (e.n === 1) out.push(e.v[0], e.v[1], e.v[2])
  return new Uint32Array(out)
}

// ── everything the engine needs, built once ──
export function buildMelon() {
  const I = slicePolygon()
  const sim = buildSimMesh(I)
  const ren = buildRenderMesh(I, buildProps())
  const emb = embed(sim.rest, sim.tets, ren.rest)
  const nV = ren.rest.length / 3
  const skinIdx = new Uint32Array(nV * 4), skinW = new Float32Array(nV * 4)
  for (let v = 0; v < nV; v++) {
    for (let j = 0; j < 4; j++) {
      skinIdx[v * 4 + j] = sim.tets[4 * emb.tetOf[v] + j]
      skinW[v * 4 + j] = emb.w[4 * v + j]
    }
  }
  const nB = ren.body.length, nS = ren.seeds.length, nU = ren.bubbles.length
  const index = new Uint32Array(nB + nS + nU)
  index.set(ren.body, 0)
  index.set(ren.seeds, nB)
  index.set(ren.bubbles, nB + nS)
  return {
    sim: { ...sim, surface: surfaceFaces(sim.tets, sim.rest.length / 3) },
    render: {
      rest: ren.rest,
      mat: ren.mat,
      index,
      body: { first: 0, count: nB },
      seeds: { first: nB, count: nS },
      bubbles: { first: nB + nS, count: nU },
    },
    skinIdx,
    skinW,
  }
}
