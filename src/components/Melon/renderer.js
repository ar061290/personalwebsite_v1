// ─────────────────────────────────────────────────────────────
//  WebGPU renderer for the jelly slice (structure from the artifact).
//  Only the screen rectangle around the slice is rendered ("crop"):
//    scene (seeds + bubbles over the backing) · back-face depth ·
//    jelly (MSAA ×4, tone mapped per sample, premultiplied) ·
//    composite into the transparent canvas at the crop position.
// ─────────────────────────────────────────────────────────────
import { UBO_FLOATS, WGSL_BACK, WGSL_COMPOSITE, WGSL_JELLY, WGSL_SCENE } from './shaders.js'

const MSAA = 4

export class Renderer {
  static async create(device, context, format, mesh) {
    const r = new Renderer(device, context, format, mesh)
    await r.buildPipelines()
    return r
  }

  constructor(device, context, format, mesh) {
    this.device = device
    this.context = context
    this.format = format
    this.mesh = mesh
    this.nV = mesh.rest.length / 3
    context.configure({ device, format, alphaMode: 'premultiplied' })

    const buf = (data, usage) => {
      const b = device.createBuffer({ size: Math.max(4, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(b, 0, data)
      return b
    }
    // dynamic: skinned position + normal (6 floats / vertex), written every frame
    this.dyn = new Float32Array(this.nV * 6)
    this.dynBuf = device.createBuffer({ size: this.dyn.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    // static: rest position + material id
    const st = new Float32Array(this.nV * 4)
    for (let i = 0; i < this.nV; i++) {
      st[4 * i] = mesh.rest[3 * i]; st[4 * i + 1] = mesh.rest[3 * i + 1]; st[4 * i + 2] = mesh.rest[3 * i + 2]; st[4 * i + 3] = mesh.mat[i]
    }
    this.staticBuf = buf(st, GPUBufferUsage.VERTEX)
    this.indexBuf = buf(mesh.index, GPUBufferUsage.INDEX)

    this.uboData = new Float32Array(UBO_FLOATS)
    this.ubo = device.createBuffer({ size: UBO_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.compData = new Float32Array(4)
    this.compUbo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })

    this.capW = 0
    this.capH = 0
    this.backing = [0, 0, 0]
  }

  async buildPipelines() {
    const d = this.device
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT
    const modules = {
      scene: d.createShaderModule({ label: 'melon-scene', code: WGSL_SCENE }),
      back: d.createShaderModule({ label: 'melon-back', code: WGSL_BACK }),
      jelly: d.createShaderModule({ label: 'melon-jelly', code: WGSL_JELLY }),
      comp: d.createShaderModule({ label: 'melon-composite', code: WGSL_COMPOSITE }),
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

    const [pProps, pBack, pJelly, pComp] = await Promise.all([
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
    ])
    Object.assign(this, { pProps, pBack, pJelly, pComp })
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
    const d = this.device, m = this.mesh, v = this.views
    d.queue.writeBuffer(this.dynBuf, 0, this.dyn)
    this.compData[0] = crop.x
    this.compData[1] = crop.y
    this.compData[2] = iw / crop.w / this.capW
    this.compData[3] = ih / crop.h / this.capH
    d.queue.writeBuffer(this.compUbo, 0, this.compData)

    const enc = d.createCommandEncoder()
    const area = (p) => { p.setViewport(0, 0, iw, ih, 0, 1); p.setScissorRect(0, 0, iw, ih) }
    const [br, bg, bb] = this.backing
    // what lies behind / inside the jelly: the backing (clear colour, depth "far") + seeds + bubbles
    {
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: v.scene, clearValue: { r: br, g: bg, b: bb, a: 1000 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: v.sceneDepth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      })
      area(p)
      p.setPipeline(this.pProps); p.setBindGroup(0, this.bgU)
      p.setVertexBuffer(0, this.dynBuf); p.setVertexBuffer(1, this.staticBuf); p.setIndexBuffer(this.indexBuf, 'uint32')
      if (m.seeds.count) p.drawIndexed(m.seeds.count, 1, m.seeds.first, 0, 0)
      if (m.bubbles.count) p.drawIndexed(m.bubbles.count, 1, m.bubbles.first, 0, 0)
      p.end()
    }
    // farthest back face depth
    {
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: v.back, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: v.backDepth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      })
      area(p)
      p.setPipeline(this.pBack); p.setBindGroup(0, this.bgU)
      p.setVertexBuffer(0, this.dynBuf); p.setIndexBuffer(this.indexBuf, 'uint32')
      p.drawIndexed(m.body.count, 1, m.body.first, 0, 0)
      p.end()
    }
    // the jelly, on transparent black
    {
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: v.msColor, resolveTarget: v.jelly, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'discard' }],
        depthStencilAttachment: { view: v.msDepth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      })
      area(p)
      p.setPipeline(this.pJelly); p.setBindGroup(0, this.bgJelly)
      p.setVertexBuffer(0, this.dynBuf); p.setVertexBuffer(1, this.staticBuf); p.setIndexBuffer(this.indexBuf, 'uint32')
      p.drawIndexed(m.body.count, 1, m.body.first, 0, 0)
      p.end()
    }
    // into the canvas: transparent everywhere except the crop
    {
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      })
      p.setViewport(crop.x, crop.y, crop.w, crop.h, 0, 1)
      p.setScissorRect(crop.x, crop.y, crop.w, crop.h)
      p.setPipeline(this.pComp); p.setBindGroup(0, this.bgComp)
      p.draw(3)
      p.end()
    }
    d.queue.submit([enc.finish()])
  }

  destroy() {
    this.destroyTargets()
    for (const b of [this.dynBuf, this.staticBuf, this.indexBuf, this.ubo, this.compUbo]) b?.destroy()
    try { this.context.unconfigure() } catch { /* already gone */ }
  }
}
