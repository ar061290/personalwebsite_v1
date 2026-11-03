// ─────────────────────────────────────────────────────────────
//  A small GLB reader (glTF 2.0 binary container) for the hero's chocolate bar: just what a static,
//  single-buffer GLB needs. No three.js, no loaders.
//    GLB = 12-byte header ('glTF', version 2, total length), then chunks of
//    [u32 length, u32 type, bytes]: the JSON chunk first, then the BIN chunk.
//  The file is treated as untrusted data: every offset and count is checked against the chunk
//  it points into, and nothing in it is ever evaluated.
//
//  parseGLB(arrayBuffer) → { json, accessor(i), image(i) }
//    accessor(i) → a fresh, tightly packed typed array (Float32Array for floats, Uint32Array for
//                  integer indices; normalized integers come back as Float32Array in [0, 1] / [−1, 1])
//    image(i)    → { bytes: Uint8Array (a view into the BIN chunk), mimeType }
// ─────────────────────────────────────────────────────────────

const MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a // 'JSON'
const CHUNK_BIN = 0x004e4942 // 'BIN\0'

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
// componentType → [byte size, DataView getter, normalisation divisor]
const TYPES = {
  5120: [1, 'getInt8', 127],
  5121: [1, 'getUint8', 255],
  5122: [2, 'getInt16', 32767],
  5123: [2, 'getUint16', 65535],
  5125: [4, 'getUint32', 0],
  5126: [4, 'getFloat32', 0],
}

const fail = (msg) => {
  throw new Error(`GLB: ${msg}`)
}

export function parseGLB(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) fail('not a GLB file')
  const dv = new DataView(buffer)
  if (dv.getUint32(0, true) !== MAGIC) fail('bad magic')
  if (dv.getUint32(4, true) !== 2) fail('unsupported version')
  const total = Math.min(dv.getUint32(8, true), buffer.byteLength)

  let json = null, bin = null
  for (let o = 12; o + 8 <= total; ) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true), start = o + 8
    if (start + len > total) fail('truncated chunk')
    if (type === CHUNK_JSON && !json) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, len)))
    else if (type === CHUNK_BIN && !bin) bin = new Uint8Array(buffer, start, len)
    o = start + len + ((4 - (len % 4)) % 4)
  }
  if (!json || typeof json !== 'object') fail('no JSON chunk')
  if (!bin) fail('no BIN chunk')
  const binView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)

  const list = (k) => (Array.isArray(json[k]) ? json[k] : [])
  const at = (k, i) => {
    const v = list(k)[i]
    if (!v || typeof v !== 'object') fail(`missing ${k}[${i}]`)
    return v
  }
  // a buffer view's bytes inside the BIN chunk (only the GLB's own buffer 0 is supported)
  const viewRange = (i) => {
    const bv = at('bufferViews', i)
    if ((bv.buffer ?? 0) !== 0) fail('external buffers are not supported')
    const off = bv.byteOffset ?? 0, len = bv.byteLength
    if (!Number.isInteger(off) || !Number.isInteger(len) || off < 0 || len < 0 || off + len > bin.byteLength) fail(`bufferView ${i} out of range`)
    return { off, len, stride: bv.byteStride ?? 0 }
  }

  function accessor(i) {
    const a = at('accessors', i)
    const nc = COMPONENTS[a.type], T = TYPES[a.componentType]
    if (!nc || !T) fail(`accessor ${i}: unsupported type`)
    const count = a.count
    if (!Number.isInteger(count) || count < 0 || count > 1 << 24) fail(`accessor ${i}: bad count`)
    if (a.sparse) fail('sparse accessors are not supported')
    const [size, get, norm] = T
    const isFloat = a.componentType === 5126
    const out = isFloat || a.normalized ? new Float32Array(count * nc) : new Uint32Array(count * nc)
    if (a.bufferView === undefined) return out // all zeros (spec)
    const { off, len, stride } = viewRange(a.bufferView)
    const elem = size * nc
    const step = stride || elem
    const base = off + (a.byteOffset ?? 0)
    if (step < elem || (count > 0 && base - off + step * (count - 1) + elem > len)) fail(`accessor ${i} out of range`)
    const scale = a.normalized && norm ? 1 / norm : 0
    for (let v = 0, o = base; v < count; v++, o += step) {
      for (let c = 0; c < nc; c++) {
        const x = binView[get](o + c * size, true)
        out[v * nc + c] = scale ? Math.max(x * scale, -1) : x
      }
    }
    return out
  }

  function image(i) {
    const im = at('images', i)
    if (im.bufferView === undefined) fail('only embedded images are supported')
    const { off, len } = viewRange(im.bufferView)
    return { bytes: bin.subarray(off, off + len), mimeType: String(im.mimeType || '') }
  }

  return { json, accessor, image }
}
