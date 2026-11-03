// ─────────────────────────────────────────────────────────────
//  The dark theme's hero: the chocolate bar from the user's own GLB.
//  src/assets/models/chocolate-bar.glb is a web-optimised copy of their file (same mesh, simplified
//  where it doesn't show; its own base colour, metal-roughness and normal maps as WebP). It is only
//  fetched when the bar is wanted (dark theme) or prefetched once the page is idle.
//
//  loadBar() → the same mesh format as buildMelon() (geometry.js), plus the GLB's own surface:
//    sim:    a soft body fitted to the GLB's shape: a structured slab of hexahedra (6 tets each) whose
//            every layer spans the bar's cross-section at that height (its walls are sloped)
//    render: the GLB's own triangles, vertices, normals and UVs, in the rest frame below
//            (rest, normal, uv, index, body; no seeds / bubbles), and its textures
//            (textures.src: the encoded images, textures.bitmaps: decoded mip chains, see decodeTextureSet);
//            it is skinned on the GPU, so it carries skinIdx / skinW and nParticles too
//    skinIdx / skinW: every render vertex's tet and barycentric weights (geometry.js embed)
//
//  Rest frame: y is the slab's thickness (the solver's slab normal, softbody.js), the bar's top (its
//  pieces and grooves) at +y and its flat back at y = 0; it runs along x, across z. That is the file's own
//  pose (it lies flat, y up, length along x) turned 180° about y, so with the camera of framing.js
//  BAR_VIEW (in front at −z, to the right at −x, above) the end that shows the milky filling is on the
//  right, where the milk drop forms. Scaled to BAR_LENGTH long (the solver's tuning is in these units).
// ─────────────────────────────────────────────────────────────
import barUrl from '../../assets/models/chocolate-bar.glb?url'
import { parseGLB } from './glb.js'
import { embed, surfaceFaces, tetVolume } from './geometry.js'

export const BAR_URL = barUrl
export const BAR_LENGTH = 2.5

// the soft body: columns along the bar, rows across it, layers through it (≈ the melon's 600 particles)
const NX = 22, NZ = 7, NL = 3

/** fetch, parse and fit the bar (in the mesh worker, or on the main thread as a fallback) */
export async function loadBar({ url = barUrl, priority = 'auto' } = {}) {
  const res = await fetch(url, { priority })
  if (!res.ok) throw new Error(`bar model: HTTP ${res.status}`)
  const mesh = buildBarMesh(parseGLB(await res.arrayBuffer()))
  mesh.render.textures.bitmaps = await decodeTextureSet(mesh.render.textures.src)
  return mesh
}

/** everything the engine and the renderer need, from a parsed GLB (its first mesh primitive) */
export function buildBarMesh(glb) {
  const { json } = glb
  const prim = json.meshes?.[0]?.primitives?.[0]
  if (!prim || (prim.mode ?? 4) !== 4) throw new Error('bar model: no triangle mesh')
  const A = prim.attributes || {}
  if (A.POSITION === undefined || A.NORMAL === undefined || A.TEXCOORD_0 === undefined) throw new Error('bar model: needs positions, normals and UVs')
  const P = glb.accessor(A.POSITION), N = glb.accessor(A.NORMAL), UV = glb.accessor(A.TEXCOORD_0)
  const nV = P.length / 3
  if (N.length !== nV * 3 || UV.length !== nV * 2) throw new Error('bar model: attribute counts differ')
  const index = prim.indices === undefined ? Uint32Array.from({ length: nV }, (_, i) => i) : glb.accessor(prim.indices)
  if (index.length % 3) throw new Error('bar model: bad index count')
  for (let i = 0; i < index.length; i++) if (index[i] >= nV) throw new Error('bar model: index out of range')

  // ── into the rest frame: centred on x and z, back face at y = 0, turned 180° about y, scaled ──
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (let v = 0; v < nV; v++) {
    for (let k = 0; k < 3; k++) {
      const c = P[3 * v + k]
      if (!Number.isFinite(c)) throw new Error('bar model: bad position')
      if (c < mn[k]) mn[k] = c
      if (c > mx[k]) mx[k] = c
    }
  }
  const S = BAR_LENGTH / (mx[0] - mn[0])
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2
  const rest = new Float32Array(nV * 3), normal = new Float32Array(nV * 3)
  for (let v = 0; v < nV; v++) {
    const o = 3 * v
    rest[o] = -(P[o] - cx) * S
    rest[o + 1] = (P[o + 1] - mn[1]) * S
    rest[o + 2] = -(P[o + 2] - cz) * S
    const nx = -N[o], ny = N[o + 1], nz = -N[o + 2]
    const l = Math.hypot(nx, ny, nz) || 1
    normal[o] = nx / l; normal[o + 1] = ny / l; normal[o + 2] = nz / l
  }
  // the few triangles wound against their own normals are turned round (the bar is drawn back-face culled)
  for (let t = 0; t < index.length; t += 3) {
    const a = 3 * index[t], b = 3 * index[t + 1], c = 3 * index[t + 2]
    const e1x = rest[b] - rest[a], e1y = rest[b + 1] - rest[a + 1], e1z = rest[b + 2] - rest[a + 2]
    const e2x = rest[c] - rest[a], e2y = rest[c + 1] - rest[a + 1], e2z = rest[c + 2] - rest[a + 2]
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x
    let d = 0
    for (const o of [a, b, c]) d += fx * normal[o] + fy * normal[o + 1] + fz * normal[o + 2]
    if (d < 0) { const tmp = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = tmp }
  }
  const size = { L: (mx[0] - mn[0]) * S, H: (mx[2] - mn[2]) * S, T: (mx[1] - mn[1]) * S }

  const sim = buildSimMesh(rest, size.T)
  const emb = embed(sim.rest, sim.tets, rest)
  const skinIdx = new Uint32Array(nV * 4), skinW = new Float32Array(nV * 4)
  for (let v = 0; v < nV; v++) {
    for (let j = 0; j < 4; j++) {
      skinIdx[v * 4 + j] = sim.tets[4 * emb.tetOf[v] + j]
      skinW[v * 4 + j] = emb.w[4 * v + j]
    }
  }

  const mat = json.materials?.[prim.material ?? 0] || {}
  const pbr = mat.pbrMetallicRoughness || {}
  const num = (v, d) => (Number.isFinite(v) ? v : d)
  const bcf = Array.isArray(pbr.baseColorFactor) && pbr.baseColorFactor.length === 4 ? pbr.baseColorFactor.map((v) => num(v, 1)) : [1, 1, 1, 1]
  const image = (info) => {
    if (!info) return null
    if ((info.texCoord ?? 0) !== 0) throw new Error('bar model: only TEXCOORD_0 is supported')
    const tex = json.textures?.[info.index]
    const src = tex?.extensions?.EXT_texture_webp?.source ?? tex?.source
    if (src === undefined) return null
    const im = glb.image(src)
    if (!/^image\/(webp|png|jpeg)$/.test(im.mimeType)) throw new Error(`bar model: unsupported image ${im.mimeType}`)
    return { bytes: im.bytes.slice(), mimeType: im.mimeType } // a copy: the GLB's buffer can go
  }

  return {
    sim: { ...sim, surface: surfaceFaces(sim.tets, sim.rest.length / 3) },
    render: {
      rest,
      normal,
      uv: UV,
      index,
      body: { first: 0, count: index.length },
      seeds: { first: index.length, count: 0 },
      bubbles: { first: index.length, count: 0 },
      size,
      skinIdx,
      skinW,
      nParticles: sim.rest.length / 3,
      material: {
        baseColorFactor: bcf,
        metallic: num(pbr.metallicFactor, 1),
        roughness: num(pbr.roughnessFactor, 1),
        normalScale: num(mat.normalTexture?.scale, 1),
      },
      textures: {
        src: { base: image(pbr.baseColorTexture), mr: image(pbr.metallicRoughnessTexture), normal: image(mat.normalTexture) },
        bitmaps: null,
      },
    },
    skinIdx,
    skinW,
  }
}

// ── the soft body: NX × NZ columns in NL layers, each layer spanning the bar's cross-section at its
//    height (rest verts within half a layer of it), every hexahedron split into 6 tets along its diagonal ──
function buildSimMesh(verts, T) {
  const nV = verts.length / 3
  const levels = []
  for (let l = 0; l <= NL; l++) {
    const y = (T * l) / NL, band = T / (2 * NL) + 1e-6
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let v = 0; v < nV; v++) {
      if (Math.abs(verts[3 * v + 1] - y) > band) continue
      const x = verts[3 * v], z = verts[3 * v + 2]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (z < z0) z0 = z
      if (z > z1) z1 = z
    }
    if (!(x1 > x0 && z1 > z0)) throw new Error('bar model: degenerate shape')
    const m = 0.004 // a hair outside the surface, so its vertices sit inside the tets
    levels.push({ y, x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m })
  }
  const id = (i, l, j) => (l * NZ + j) * NX + i
  const nP = NX * NZ * (NL + 1)
  const rest = new Float32Array(nP * 3), region = new Uint8Array(nP)
  for (let l = 0; l <= NL; l++) {
    const L = levels[l]
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const k = 3 * id(i, l, j)
        rest[k] = L.x0 + ((L.x1 - L.x0) * i) / (NX - 1)
        rest[k + 1] = L.y
        rest[k + 2] = L.z0 + ((L.z1 - L.z0) * j) / (NZ - 1)
        // the outer columns are a little firmer, like a shell (softbody.js region)
        region[id(i, l, j)] = i === 0 || i === NX - 1 || j === 0 || j === NZ - 1 ? 1 : 0
      }
    }
  }
  // Freudenthal split: the 6 monotone paths from corner (0,0,0) to (1,1,1) (conforming across cells)
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  const tets = []
  for (let l = 0; l < NL; l++) {
    for (let j = 0; j < NZ - 1; j++) {
      for (let i = 0; i < NX - 1; i++) {
        for (const p of perms) {
          const c = [i, l, j]
          const path = [id(...c)]
          for (const ax of p) {
            c[ax]++
            path.push(id(...c))
          }
          tets.push(...path)
        }
      }
    }
  }
  for (let t = 0; t < tets.length; t += 4) {
    if (tetVolume(rest, tets[t], tets[t + 1], tets[t + 2], tets[t + 3]) < 0) {
      const tmp = tets[t + 2]; tets[t + 2] = tets[t + 3]; tets[t + 3] = tmp
    }
  }
  return { rest, tets: new Uint32Array(tets), region }
}

// ── textures: decoded off the main thread into full mip chains (ImageBitmaps, transferable) ──
// Bitmaps are taken as stored (no colour management or premultiplication: the normal and
// metal-roughness maps are data, the base colour is uploaded to an sRGB texture). Each mip level is
// the previous one halved. The renderer uploads and closes them; it keeps `src` to decode again
// after a lost device.
const RAW = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }
async function decodeMips({ bytes, mimeType }) {
  const levels = [await createImageBitmap(new Blob([bytes], { type: mimeType }), RAW)]
  let w = levels[0].width, h = levels[0].height
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
    levels.push(await createImageBitmap(levels[levels.length - 1], { ...RAW, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }))
  }
  return levels
}

export async function decodeTextureSet(src) {
  const [base, mr, normal] = await Promise.all([src.base, src.mr, src.normal].map((s) => (s ? decodeMips(s) : null)))
  return { base, mr, normal }
}

/** every transferable buffer and bitmap of a bar mesh (for postMessage) */
export function barTransfers(m) {
  const R = m.render, b = R.textures.bitmaps, s = R.textures.src
  const list = [
    m.sim.rest.buffer, m.sim.tets.buffer, m.sim.region.buffer, m.sim.surface.buffer,
    R.rest.buffer, R.normal.buffer, R.uv.buffer, R.index.buffer, m.skinIdx.buffer, m.skinW.buffer,
  ]
  for (const k of ['base', 'mr', 'normal']) {
    if (s[k]) list.push(s[k].bytes.buffer)
    if (b?.[k]) list.push(...b[k])
  }
  return list
}
