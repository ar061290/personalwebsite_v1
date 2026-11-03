// ─────────────────────────────────────────────────────────────
//  WebGPU renderer for the jelly slice (structure from the artifact).
//  Only the screen rectangle around the slice is rendered ("crop"):
//    scene (seeds + bubbles over the backing) · back-face depth ·
//    jelly (MSAA ×4, tone mapped per sample, premultiplied) ·
//    composite into the transparent canvas at the crop position.
//
//  Two models share the device, the pipelines and the targets: the melon ('melon', the passes
//  above) and the dark theme's chocolate bar ('bar': the user's GLB, barModel.js, drawn in one opaque
//  MSAA pass with its own textures, barShaders.js, then the same composite). Each model's buffers and
//  textures are made once (addModel) and kept until destroy(), so switching (setModel) allocates
//  nothing and can be drawn on the very next frame.
//  The melon is skinned on the CPU (the engine writes `dyn`: position + normal per vertex). The bar is
//  skinned in its vertex shader: the engine writes `parts` (per particle: position and the cofactor
//  of the local deformation, 16 floats), the static buffer holds each vertex's rest data, UV, the
//  file's normal and its four particles and weights; `dyn` stays on the CPU for picking.
// ─────────────────────────────────────────────────────────────
import { UBO_FLOATS, WGSL_BACK, WGSL_COMPOSITE, WGSL_JELLY, WGSL_SCENE } from './shaders.js'
import { WGSL_BAR } from './barShaders.js'
import { decodeTextureSet } from './barModel.js'

const MSAA = 4

const closeBitmaps = (bm) => {
  if (bm) for (const levels of Object.values(bm)) if (levels) for (const b of levels) b.close?.()
}

export class Renderer {
  // models: { melon?: renderMesh, bar?: renderMesh }; `kind` is the one drawn first
  static async create(device, context, format, models, kind) {
    // a textured model whose decoded images were already uploaded (and closed) by an earlier
    // renderer (a lost device) decodes them again from the encoded bytes it keeps
    for (const mesh of Object.values(models)) {
      const tx = mesh?.textures
      if (tx && !tx.bitmaps) tx.bitmaps = await decodeTextureSet(tx.src)
    }
    const r = new Renderer(device, context, format)
    for (const [k, mesh] of Object.entries(models)) if (mesh) r.addModel(k, mesh)
    await r.buildPipelines()
    r.setModel(kind)
    return r
  }

  constructor(device, context, format) {
    this.device = device
    this.context = context
    this.format = format
    this.models = {}
    this.kind = null
    context.configure({ device, format, alphaMode: 'premultiplied' })

    this.uboData = new Float32Array(UBO_FLOATS)
    this.ubo = device.createBuffer({ size: UBO_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.compData = new Float32Array(4)
    this.compUbo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
    // the bar's own textures (glTF sampler: linear, mipmapped, repeat) and their bind group layout
    this.texSampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8,
      addressModeU: 'repeat', addressModeV: 'repeat',
    })
    const F = GPUShaderStage.FRAGMENT, tex = { visibility: F, texture: { sampleType: 'float' } }
    this.layoutBar = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | F, buffer: { type: 'uniform' } },
        { ...tex, binding: 1 }, { ...tex, binding: 2 }, { ...tex, binding: 3 },
        { binding: 4, visibility: F, sampler: { type: 'filtering' } },
        { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
    })
    this.onTextures = null // called when textures decoded late (see addModel) have arrived

    this.capW = 0
    this.capH = 0
    this.backing = [0, 0, 0]
    // draw() reuses these every frame (no per-frame garbage); built for each target set
    this.sceneClear = { r: 0, g: 0, b: 0, a: 1000 }
    this.canvasAttachment = { view: null, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }
    this.passCanvas = { colorAttachments: [this.canvasAttachment] }
    this.submitList = [null]
  }

  // one model's buffers (render mesh from geometry.js / barModel.js), kept until destroy()
  addModel(kind, mesh) {
    if (this.models[kind]) return
    const device = this.device
    const buf = (data, usage) => {
      const b = device.createBuffer({ size: Math.max(4, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(b, 0, data)
      return b
    }
    const nV = mesh.rest.length / 3
    if (mesh.textures) {
      // the bar, skinned in its vertex shader (see the header): per vertex rest position, UV, the
      // file's normal, its four particles (u32) and their weights: 16 × 4 bytes
      const st = new ArrayBuffer(nV * 64), sf = new Float32Array(st), su = new Uint32Array(st)
      for (let i = 0; i < nV; i++) {
        const o = 16 * i
        sf[o] = mesh.rest[3 * i]; sf[o + 1] = mesh.rest[3 * i + 1]; sf[o + 2] = mesh.rest[3 * i + 2]
        sf[o + 3] = mesh.uv[2 * i]; sf[o + 4] = mesh.uv[2 * i + 1]
        sf[o + 5] = mesh.normal[3 * i]; sf[o + 6] = mesh.normal[3 * i + 1]; sf[o + 7] = mesh.normal[3 * i + 2]
        for (let k = 0; k < 4; k++) {
          su[o + 8 + k] = mesh.skinIdx[4 * i + k]
          sf[o + 12 + k] = mesh.skinW[4 * i + k]
        }
      }
      const parts = new Float32Array(mesh.nParticles * 16)
      const partsBuf = device.createBuffer({ size: parts.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      const m = {
        mesh, nV, dyn: new Float32Array(nV * 6), upload: parts, uploadBuf: partsBuf, parts,
        staticBuf: buf(sf, GPUBufferUsage.VERTEX), indexBuf: buf(mesh.index, GPUBufferUsage.INDEX), tex: null, bg: null,
      }
      this.models[kind] = m
      const bm = mesh.textures.bitmaps
      mesh.textures.bitmaps = null // consumed here (closed after the upload)
      this.setTextures(m, bm)
      if (!bm) {
        // only after a lost device raced a model build: neutral stand-ins until decoded again
        decodeTextureSet(mesh.textures.src).then((b) => {
          if (this.models[kind] === m) {
            this.setTextures(m, b)
            if (this.kind === kind) this.bgModel = m.bg
            this.onTextures?.()
          } else closeBitmaps(b)
        }, (err) => console.warn('[melon] bar textures:', err?.message || err))
      }
      return
    }
    // dynamic: skinned position + normal (6 floats / vertex), written every frame
    const dyn = new Float32Array(nV * 6)
    const dynBuf = device.createBuffer({ size: dyn.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    // static: rest position + material id
    const st = new Float32Array(nV * 4)
    for (let i = 0; i < nV; i++) {
      st[4 * i] = mesh.rest[3 * i]; st[4 * i + 1] = mesh.rest[3 * i + 1]; st[4 * i + 2] = mesh.rest[3 * i + 2]; st[4 * i + 3] = mesh.mat[i]
    }
    this.models[kind] = {
      mesh, nV, dyn, dynBuf, upload: dyn, uploadBuf: dynBuf,
      staticBuf: buf(st, GPUBufferUsage.VERTEX), indexBuf: buf(mesh.index, GPUBufferUsage.INDEX),
    }
  }

  // a textured model's GPU textures (full mip chains) and bind group; null bitmaps → 1×1 stand-ins
  setTextures(m, bm) {
    const d = this.device
    const TB = GPUTextureUsage.TEXTURE_BINDING, CD = GPUTextureUsage.COPY_DST, RA = GPUTextureUsage.RENDER_ATTACHMENT
    const make = (levels, format, rgba) => {
      if (!levels?.length) {
        const t = d.createTexture({ size: [1, 1], format, usage: TB | CD })
        d.queue.writeTexture({ texture: t }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1])
        return t
      }
      const t = d.createTexture({ size: [levels[0].width, levels[0].height], format, mipLevelCount: levels.length, usage: TB | CD | RA })
      levels.forEach((b, i) => d.queue.copyExternalImageToTexture({ source: b }, { texture: t, mipLevel: i }, [b.width, b.height]))
      return t
    }
    const old = m.tex
    m.tex = [
      make(bm?.base, 'rgba8unorm-srgb', [128, 128, 128, 255]),
      make(bm?.mr, 'rgba8unorm', [255, 255, 0, 255]),
      make(bm?.normal, 'rgba8unorm', [128, 128, 255, 255]),
    ]
    closeBitmaps(bm)
    m.bg = d.createBindGroup({
      layout: this.layoutBar,
      entries: [
        { binding: 0, resource: { buffer: this.ubo } },
        { binding: 1, resource: m.tex[0].createView() },
        { binding: 2, resource: m.tex[1].createView() },
        { binding: 3, resource: m.tex[2].createView() },
        { binding: 4, resource: this.texSampler },
        { binding: 5, resource: { buffer: m.uploadBuf } }],
    })
    if (old) for (const t of old) t.destroy()
  }

  hasModel(kind) {
    return !!this.models[kind]
  }

  // the model draw() shows; its dyn is the one the engine skins into
  setModel(kind) {
    const m = this.models[kind]
    if (!m) throw new Error(`no ${kind} model`)
    this.kind = kind
    this.mesh = m.mesh
    this.nV = m.nV
    this.dyn = m.dyn
    this.dynBuf = m.dynBuf
    this.staticBuf = m.staticBuf
    this.indexBuf = m.indexBuf
    this.upload = m.upload // what draw() sends when dynDirty: dyn (melon) or parts (bar)
    this.uploadBuf = m.uploadBuf
    this.parts = m.parts ?? null // the bar's per-particle skinning data, written by the engine
    this.bgModel = m.bg ?? null // the bar's textures and particles
    this.dynDirty = true // set by the engine after it rewrote dyn; draw() uploads only then
  }

  async buildPipelines() {
    const d = this.device
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT
    const modules = {
      scene: d.createShaderModule({ label: 'melon-scene', code: WGSL_SCENE }),
      back: d.createShaderModule({ label: 'melon-back', code: WGSL_BACK }),
      jelly: d.createShaderModule({ label: 'melon-jelly', code: WGSL_JELLY }),
      comp: d.createShaderModule({ label: 'melon-composite', code: WGSL_COMPOSITE }),
      bar: d.createShaderModule({ label: 'bar', code: WGSL_BAR }),
    }
    // surface WGSL errors as a failure (→ static fallback) instead of a blank canvas
    const problems = []
    for (const [name, m] of Object.entries(modules)) {
      if (!m.getCompilationInfo) continue
      const info = await m.getCompilationInfo()
      for (const msg of info.messages) if (msg.type === 'error') problems.push(`${name}:${msg.lineNum}:${msg.linePos} ${msg.message}`)
    }
    if (problems.length) throw new Error('WGSL compile error\n' + problems.join('\n'))

    const uboEntry = { binding: 0, visibility: V | F, buffer: { type: 'uniform' } }
    this.layoutU = d.createBindGroupLayout({ entries: [uboEntry] })
    this.layoutJelly = d.createBindGroupLayout({
      entries: [uboEntry,
        { binding: 1, visibility: F, texture: { sampleType: 'float' } },
        { binding: 2, visibility: F, texture: { sampleType: 'unfilterable-float' } },
        { binding: 3, visibility: F, sampler: { type: 'filtering' } }],
    })
    this.layoutComp = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: F, texture: { sampleType: 'float' } },
        { binding: 1, visibility: F, sampler: { type: 'filtering' } },
        { binding: 2, visibility: F, buffer: { type: 'uniform' } }],
    })
    const pl = (l) => d.createPipelineLayout({ bindGroupLayouts: [l] })
    const posOnly = { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }
    const meshVB = [
      { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] },
      { arrayStride: 16, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }, { shaderLocation: 3, offset: 12, format: 'float32' }] },
    ]
    // the bar: one static buffer (see addModel)
    const barVB = [{
      arrayStride: 64,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, // rest position
        { shaderLocation: 1, offset: 12, format: 'float32x2' }, // UV
        { shaderLocation: 2, offset: 20, format: 'float32x3' }, // the file's normal
        { shaderLocation: 3, offset: 32, format: 'uint32x4' }, // its four particles
        { shaderLocation: 4, offset: 48, format: 'float32x4' }], // and their weights
    }]

    const [pProps, pBack, pJelly, pComp, pBar] = await Promise.all([
      d.createRenderPipelineAsync({
        label: 'melon-props', layout: pl(this.layoutU),
        vertex: { module: modules.scene, entryPoint: 'vsMesh', buffers: meshVB },
        fragment: { module: modules.scene, entryPoint: 'fsProps', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      }),
      d.createRenderPipelineAsync({
        label: 'melon-back', layout: pl(this.layoutU),
        vertex: { module: modules.back, entryPoint: 'vs', buffers: [posOnly] },
        fragment: { module: modules.back, entryPoint: 'fs', targets: [{ format: 'r32float' }] },
        primitive: { topology: 'triangle-list', cullMode: 'front' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
      }),
      d.createRenderPipelineAsync({
        label: 'melon-jelly', layout: pl(this.layoutJelly),
        vertex: { module: modules.jelly, entryPoint: 'vsJelly', buffers: meshVB },
        fragment: { module: modules.jelly, entryPoint: 'fsJelly', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: MSAA },
      }),
      d.createRenderPipelineAsync({
        label: 'melon-composite', layout: pl(this.layoutComp),
        vertex: { module: modules.comp, entryPoint: 'vs' },
        fragment: { module: modules.comp, entryPoint: 'fs', targets: [{ format: this.format }] },
      }),
      // the chocolate bar: opaque, into the jelly's MSAA target (same depth / resolve / composite)
      d.createRenderPipelineAsync({
        label: 'bar', layout: pl(this.layoutBar),
        vertex: { module: modules.bar, entryPoint: 'vsBar', buffers: barVB },
        fragment: { module: modules.bar, entryPoint: 'fsBar', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: MSAA },
      }),
    ])
    Object.assign(this, { pProps, pBack, pJelly, pComp, pBar })
    this.bgU = d.createBindGroup({ layout: this.layoutU, entries: [{ binding: 0, resource: { buffer: this.ubo } }] })
  }

  // (re)allocate the off-screen targets so they can hold a w×h crop
  ensureTargets(w, h, maxW, maxH) {
    if (w <= this.capW && h <= this.capH) return
    const lim = this.device.limits.maxTextureDimension2D
    const grow = (need, have, max) => Math.min(lim, Math.max(have, Math.min(max, Math.ceil((need * 1.15) / 64) * 64), need))
    const cw = grow(w, this.capW, maxW), ch = grow(h, this.capH, maxH)
    this.destroyTargets()
    this.capW = cw
    this.capH = ch
    const d = this.device
    const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING
    const tex = (format, usage, sampleCount = 1) => d.createTexture({ size: [cw, ch], format, usage, sampleCount })
    this.sceneTex = tex('rgba16float', RA | TB)
    this.sceneDepth = tex('depth24plus', RA)
    this.backTex = tex('r32float', RA | TB)
    this.backDepth = tex('depth32float', RA)
    this.msColor = tex('rgba8unorm', RA, MSAA)
    this.msDepth = tex('depth24plus', RA, MSAA)
    this.jellyTex = tex('rgba8unorm', RA | TB)
    this.views = {
      scene: this.sceneTex.createView(), sceneDepth: this.sceneDepth.createView(),
      back: this.backTex.createView(), backDepth: this.backDepth.createView(),
      msColor: this.msColor.createView(), msDepth: this.msDepth.createView(), jelly: this.jellyTex.createView(),
    }
    this.bgJelly = d.createBindGroup({
      layout: this.layoutJelly,
      entries: [
        { binding: 0, resource: { buffer: this.ubo } },
        { binding: 1, resource: this.views.scene },
        { binding: 2, resource: this.views.back },
        { binding: 3, resource: this.linSampler }],
    })
    this.bgComp = d.createBindGroup({
      layout: this.layoutComp,
      entries: [
        { binding: 0, resource: this.views.jelly },
        { binding: 1, resource: this.linSampler },
        { binding: 2, resource: { buffer: this.compUbo } }],
    })
    this.passScene = {
      colorAttachments: [{ view: this.views.scene, clearValue: this.sceneClear, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.views.sceneDepth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    }
    this.passBack = {
      colorAttachments: [{ view: this.views.back, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.views.backDepth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    }
    this.passJelly = {
      colorAttachments: [{ view: this.views.msColor, resolveTarget: this.views.jelly, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: this.views.msDepth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    }
  }

  destroyTargets() {
    for (const k of ['sceneTex', 'sceneDepth', 'backTex', 'backDepth', 'msColor', 'msDepth', 'jellyTex']) {
      this[k]?.destroy()
      this[k] = null
    }
  }

  writeUniforms(u) {
    this.device.queue.writeBuffer(this.ubo, 0, u)
  }

  // crop: {x, y, w, h} in canvas pixels; iw × ih: the rendered size of that crop
  draw(crop, iw, ih) {
    const d = this.device, m = this.mesh
    if (this.dynDirty) {
      d.queue.writeBuffer(this.uploadBuf, 0, this.upload)
      this.dynDirty = false
    }
    this.compData[0] = crop.x
    this.compData[1] = crop.y
    this.compData[2] = iw / crop.w / this.capW
    this.compData[3] = ih / crop.h / this.capH
    d.queue.writeBuffer(this.compUbo, 0, this.compData)
    if (this.kind === 'bar') return this.drawBar(crop, iw, ih)
    // what lies behind / inside the jelly: the backing (clear colour, depth "far") + seeds + bubbles
    const bk = this.backing
    this.sceneClear.r = bk[0]; this.sceneClear.g = bk[1]; this.sceneClear.b = bk[2]

    const enc = d.createCommandEncoder()
    let p = enc.beginRenderPass(this.passScene)
    p.setViewport(0, 0, iw, ih, 0, 1); p.setScissorRect(0, 0, iw, ih)
    p.setPipeline(this.pProps); p.setBindGroup(0, this.bgU)
    p.setVertexBuffer(0, this.dynBuf); p.setVertexBuffer(1, this.staticBuf); p.setIndexBuffer(this.indexBuf, 'uint32')
    if (m.seeds.count) p.drawIndexed(m.seeds.count, 1, m.seeds.first, 0, 0)
    if (m.bubbles.count) p.drawIndexed(m.bubbles.count, 1, m.bubbles.first, 0, 0)
    p.end()
    // farthest back face depth
    p = enc.beginRenderPass(this.passBack)
    p.setViewport(0, 0, iw, ih, 0, 1); p.setScissorRect(0, 0, iw, ih)
    p.setPipeline(this.pBack); p.setBindGroup(0, this.bgU)
    p.setVertexBuffer(0, this.dynBuf); p.setIndexBuffer(this.indexBuf, 'uint32')
    p.drawIndexed(m.body.count, 1, m.body.first, 0, 0)
    p.end()
    // the jelly, on transparent black
    p = enc.beginRenderPass(this.passJelly)
    p.setViewport(0, 0, iw, ih, 0, 1); p.setScissorRect(0, 0, iw, ih)
    p.setPipeline(this.pJelly); p.setBindGroup(0, this.bgJelly)
    p.setVertexBuffer(0, this.dynBuf); p.setVertexBuffer(1, this.staticBuf); p.setIndexBuffer(this.indexBuf, 'uint32')
    p.drawIndexed(m.body.count, 1, m.body.first, 0, 0)
    p.end()
    this.composite(enc, crop)
  }

  // the chocolate bar: one opaque MSAA pass on transparent black, then the same composite
  drawBar(crop, iw, ih) {
    const m = this.mesh
    const enc = this.device.createCommandEncoder()
    const p = enc.beginRenderPass(this.passJelly)
    p.setViewport(0, 0, iw, ih, 0, 1); p.setScissorRect(0, 0, iw, ih)
    p.setPipeline(this.pBar); p.setBindGroup(0, this.bgModel)
    p.setVertexBuffer(0, this.staticBuf); p.setIndexBuffer(this.indexBuf, 'uint32')
    p.drawIndexed(m.body.count, 1, m.body.first, 0, 0)
    p.end()
    this.composite(enc, crop)
  }

  // into the canvas: transparent everywhere except the crop
  composite(enc, crop) {
    const d = this.device
    this.canvasAttachment.view = this.context.getCurrentTexture().createView()
    const p = enc.beginRenderPass(this.passCanvas)
    p.setViewport(crop.x, crop.y, crop.w, crop.h, 0, 1)
    p.setScissorRect(crop.x, crop.y, crop.w, crop.h)
    p.setPipeline(this.pComp); p.setBindGroup(0, this.bgComp)
    p.draw(3)
    p.end()
    this.submitList[0] = enc.finish()
    d.queue.submit(this.submitList)
    // don't keep this frame's canvas texture or command buffer alive
    this.canvasAttachment.view = null
    this.submitList[0] = null
  }

  destroy() {
    this.destroyTargets()
    for (const m of Object.values(this.models)) {
      for (const b of [m.uploadBuf, m.staticBuf, m.indexBuf]) b.destroy()
      if (m.tex) for (const t of m.tex) t.destroy()
    }
    this.models = {}
    for (const b of [this.ubo, this.compUbo]) b?.destroy()
    try { this.context.unconfigure() } catch { /* already gone */ }
  }
}
