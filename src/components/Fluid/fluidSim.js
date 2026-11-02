// Imperative WebGL fluid engine behind <FluidBackground>. The solver (curl,
// vorticity, divergence, pressure, gradient subtract, advection) and its
// update order are the ones from lumina-cursor's SplashCursor, itself a port
// of Pavel Dobryakov's WebGL-Fluid-Simulation (both MIT). What changed:
// rose/rind palette instead of rainbow HSV (dye channels carry rose, tone and
// green densities, see shaders.js), an ink-on-white display pass, a single
// rAF loop that sleeps when idle (the original accidentally ran two), and
// real teardown.

import * as SRC from './shaders.js'

const DPR_CAP = 2
// Simulated seconds without input after which dye and velocity have fully
// dissipated (≈1e-8 of their peak); stop burning GPU. Counted in sim time,
// not wall time, so a hidden tab or a slow device never clears visible ink.
const IDLE_SLEEP_S = 6
// Per-splat dye strength, same as the original's `generateColor() * 0.15`.
const BASE_INK = 0.15

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)

// Rosé melon palette (sRGB, 0..1).
export const PALETTE = {
  flesh: hexToRgb('#F97C95'),
  deep: hexToRgb('#CB506C'),
  light: hexToRgb('#FF9EB0'),
  rind: hexToRgb('#457C59'),
}

function getWebGLContext(canvas) {
  const params = {
    alpha: true,
    premultipliedAlpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  }
  let gl = canvas.getContext('webgl2', params)
  const isWebGL2 = !!gl
  if (!gl) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params)
  if (!gl) return { error: 'unsupported' }
  if (gl.isContextLost()) return { error: 'lost' }

  let halfFloat
  let supportLinearFiltering
  if (isWebGL2) {
    gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('EXT_color_buffer_half_float')
    // Half-float textures are filterable in core WebGL2. (The original keyed
    // this on OES_texture_float_linear, which needlessly dropped many phones
    // to the low-res, unshaded fallback.)
    supportLinearFiltering = true
  } else {
    halfFloat = gl.getExtension('OES_texture_half_float')
    supportLinearFiltering = !!gl.getExtension('OES_texture_half_float_linear')
  }
  // Transparent clear: render targets start empty, including dye density (a).
  gl.clearColor(0.0, 0.0, 0.0, 0.0)

  const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat && halfFloat.HALF_FLOAT_OES
  if (!halfFloatTexType) return { error: 'unsupported' }

  let formatRGBA
  let formatRG
  let formatR
  if (isWebGL2) {
    formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType)
    formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType)
    formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType)
  } else {
    formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType)
    formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType)
    formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType)
  }
  if (!formatRGBA || !formatRG || !formatR) return { error: 'unsupported' }

  return {
    gl,
    ext: { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering },
  }
}

function getSupportedFormat(gl, internalFormat, format, type) {
  if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
    switch (internalFormat) {
      case gl.R16F:
        return getSupportedFormat(gl, gl.RG16F, gl.RG, type)
      case gl.RG16F:
        return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type)
      default:
        return null
    }
  }
  return { internalFormat, format }
}

function supportRenderTextureFormat(gl, internalFormat, format, type) {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null)
  const fbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteFramebuffer(fbo)
  gl.deleteTexture(texture)
  return ok
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {() => object} getConfig  live config (read every frame)
 * @returns {{ sim?: object, error?: 'unsupported' | 'lost' }}
 */
export function createFluidSim(canvas, getConfig) {
  const context = getWebGLContext(canvas)
  if (context.error) return { error: context.error }
  const { gl, ext } = context

  // ---- shaders & programs -------------------------------------------------

  function compileShader(type, source, keywords) {
    const header = keywords ? keywords.map((k) => `#define ${k}\n`).join('') : ''
    const shader = gl.createShader(type)
    gl.shaderSource(shader, header + source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      console.warn('[fluid] shader:', gl.getShaderInfoLog(shader))
    }
    return shader
  }

  function createProgram(vertexShader, fragmentShader) {
    const program = gl.createProgram()
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.bindAttribLocation(program, 0, 'aPosition')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      console.warn('[fluid] program:', gl.getProgramInfoLog(program))
    }
    const uniforms = {}
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) || 0
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(program, i).name
      uniforms[name] = gl.getUniformLocation(program, name)
    }
    return { program, uniforms, bind: () => gl.useProgram(program) }
  }

  const baseVertex = compileShader(gl.VERTEX_SHADER, SRC.baseVertex)
  const frag = (src, keywords) => compileShader(gl.FRAGMENT_SHADER, src, keywords)

  const copyProgram = createProgram(baseVertex, frag(SRC.copyFrag))
  const clearProgram = createProgram(baseVertex, frag(SRC.clearFrag))
  const splatProgram = createProgram(baseVertex, frag(SRC.splatFrag))
  const advectionProgram = createProgram(
    baseVertex,
    frag(SRC.advectionFrag, ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']),
  )
  const divergenceProgram = createProgram(baseVertex, frag(SRC.divergenceFrag))
  const curlProgram = createProgram(baseVertex, frag(SRC.curlFrag))
  const vorticityProgram = createProgram(baseVertex, frag(SRC.vorticityFrag))
  const pressureProgram = createProgram(baseVertex, frag(SRC.pressureFrag))
  const gradientSubtractProgram = createProgram(baseVertex, frag(SRC.gradientSubtractFrag))

  // Display variants are compiled on demand, like the original Material class.
  const displayPrograms = {}
  function getDisplayProgram(shading) {
    const key = shading ? 'shaded' : 'flat'
    if (!displayPrograms[key]) {
      displayPrograms[key] = createProgram(baseVertex, frag(SRC.displayFrag, shading ? ['SHADING'] : null))
    }
    return displayPrograms[key]
  }

  // ---- full-screen quad ---------------------------------------------------

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.enableVertexAttribArray(0)

  function blit(target) {
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    } else {
      gl.viewport(0, 0, target.width, target.height)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
  }

  // ---- framebuffers -------------------------------------------------------

  let dye
  let velocity
  let divergence
  let curl
  let pressure

  function createFBO(w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)

    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.viewport(0, 0, w, h)
    gl.clear(gl.COLOR_BUFFER_BIT)

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1.0 / w,
      texelSizeY: 1.0 / h,
      attach(id) {
        gl.activeTexture(gl.TEXTURE0 + id)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        return id
      },
    }
  }

  function deleteFBO(target) {
    if (!target) return
    gl.deleteFramebuffer(target.fbo)
    gl.deleteTexture(target.texture)
  }

  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    let fbo1 = createFBO(w, h, internalFormat, format, type, param)
    let fbo2 = createFBO(w, h, internalFormat, format, type, param)
    return {
      width: w,
      height: h,
      texelSizeX: fbo1.texelSizeX,
      texelSizeY: fbo1.texelSizeY,
      get read() {
        return fbo1
      },
      set read(value) {
        fbo1 = value
      },
      get write() {
        return fbo2
      },
      set write(value) {
        fbo2 = value
      },
      swap() {
        const temp = fbo1
        fbo1 = fbo2
        fbo2 = temp
      },
    }
  }

  function deleteDoubleFBO(target) {
    if (!target) return
    deleteFBO(target.read)
    deleteFBO(target.write)
  }

  function resizeFBO(target, w, h, internalFormat, format, type, param) {
    const newFBO = createFBO(w, h, internalFormat, format, type, param)
    copyProgram.bind()
    gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0))
    blit(newFBO)
    deleteFBO(target)
    return newFBO
  }

  function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
    if (target.width === w && target.height === h) return target
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param)
    deleteFBO(target.write)
    target.write = createFBO(w, h, internalFormat, format, type, param)
    target.width = w
    target.height = h
    target.texelSizeX = 1.0 / w
    target.texelSizeY = 1.0 / h
    return target
  }

  function getResolution(resolution) {
    let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight
    if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio
    const min = Math.round(resolution)
    const max = Math.round(resolution * aspectRatio)
    if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min }
    return { width: min, height: max }
  }

  function initFramebuffers() {
    const config = getConfig()
    const simRes = getResolution(config.SIM_RESOLUTION)
    // Original fallback: without linear filtering, drop to a cheap dye grid.
    const dyeRes = getResolution(ext.supportLinearFiltering ? config.DYE_RESOLUTION : 256)
    const texType = ext.halfFloatTexType
    const rgba = ext.formatRGBA
    const rg = ext.formatRG
    const r = ext.formatR
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST
    gl.disable(gl.BLEND)

    if (!dye) dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
    else dye = resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)

    if (!velocity) velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
    else velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)

    deleteFBO(divergence)
    deleteFBO(curl)
    deleteDoubleFBO(pressure)
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
    curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
    pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
  }

  // ---- canvas sizing & coordinates ---------------------------------------

  let rect = null

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    const width = Math.max(1, Math.floor(canvas.clientWidth * ratio))
    const height = Math.max(1, Math.floor(canvas.clientHeight * ratio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      rect = null
      return true
    }
    return false
  }

  // Cached client rect, invalidated on resize/scroll by the owner. The canvas
  // is pointer-events: none, so input arrives in client space from window.
  function toTexcoord(clientX, clientY) {
    if (!rect) rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const u = (clientX - rect.left) / rect.width
    const v = (clientY - rect.top) / rect.height
    // Only the canvas's own area takes ink, so the fluid stops where its section ends.
    if (u < 0 || u > 1 || v < 0 || v > 1) return null
    return [u, 1.0 - v]
  }

  const aspect = () => canvas.width / canvas.height

  function correctRadius(radius) {
    const aspectRatio = aspect()
    if (aspectRatio > 1) radius *= aspectRatio
    return radius
  }

  function correctDeltaX(delta) {
    const aspectRatio = aspect()
    if (aspectRatio < 1) delta *= aspectRatio
    return delta
  }

  function correctDeltaY(delta) {
    const aspectRatio = aspect()
    if (aspectRatio > 1) delta /= aspectRatio
    return delta
  }

  // ---- colour -------------------------------------------------------------

  // Small variations around the rosé flesh (tone −1 deep … +1 light) and, once
  // in a while, a muted rind green at reduced strength. Encoded per the dye
  // convention in shaders.js: r rose, g rose × tone, b green, a total.
  function generateColor() {
    const config = getConfig()
    if (Math.random() < config.GREEN_CHANCE) {
      const density = BASE_INK * config.GREEN_STRENGTH
      return { r: 0, g: 0, b: density, a: density }
    }
    const density = BASE_INK * (0.85 + Math.random() * 0.3)
    const tone = Math.random() * 2 - 1
    return { r: density, g: density * tone, b: 0, a: density }
  }

  const scaleInk = (c, k) => ({ r: c.r * k, g: c.g * k, b: c.b * k, a: c.a * k })

  // ---- simulation ---------------------------------------------------------

  const pointer = {
    texcoordX: 0,
    texcoordY: 0,
    prevTexcoordX: 0,
    prevTexcoordY: 0,
    deltaX: 0,
    deltaY: 0,
    down: false,
    moved: false,
    // True until we have a real position, so the first move (or a re-entry
    // into the window) does not fire a screen-wide streak from a stale point.
    fresh: true,
    color: generateColor(),
  }

  function splat(x, y, dx, dy, color) {
    splatProgram.bind()
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0))
    gl.uniform1f(splatProgram.uniforms.aspectRatio, aspect())
    gl.uniform2f(splatProgram.uniforms.point, x, y)
    gl.uniform4f(splatProgram.uniforms.color, dx, dy, 0.0, 0.0)
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(getConfig().SPLAT_RADIUS / 100.0))
    blit(velocity.write)
    velocity.swap()

    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0))
    gl.uniform4f(splatProgram.uniforms.color, color.r, color.g, color.b, color.a)
    blit(dye.write)
    dye.swap()
  }

  function splatPointer(p) {
    const force = getConfig().SPLAT_FORCE
    splat(p.texcoordX, p.texcoordY, p.deltaX * force, p.deltaY * force, p.color)
  }

  // Original click burst: ten heavy splats pushed outward in a ring.
  function clickSplat(p) {
    const intensity = getConfig().CLICK_INTENSITY
    for (let i = 0; i < 10; i++) {
      const color = scaleInk(generateColor(), intensity)
      const angle = (i / 10) * Math.PI * 2
      splat(p.texcoordX, p.texcoordY, Math.cos(angle) * 150, Math.sin(angle) * 150, color)
    }
  }

  // WebGL-Fluid-Simulation's opening flourish (lumina dropped it).
  function multipleSplats(amount) {
    for (let i = 0; i < amount; i++) {
      const color = scaleInk(generateColor(), 10.0)
      const x = Math.random()
      const y = Math.random()
      const dx = 1000 * (Math.random() - 0.5)
      const dy = 1000 * (Math.random() - 0.5)
      splat(x, y, dx, dy, color)
    }
  }

  function step(dt) {
    const config = getConfig()
    gl.disable(gl.BLEND)

    curlProgram.bind()
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(curl)

    vorticityProgram.bind()
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0))
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1))
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL)
    gl.uniform1f(vorticityProgram.uniforms.dt, dt)
    blit(velocity.write)
    velocity.swap()

    divergenceProgram.bind()
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0))
    blit(divergence)

    clearProgram.bind()
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0))
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE)
    blit(pressure.write)
    pressure.swap()

    pressureProgram.bind()
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0))
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1))
      blit(pressure.write)
      pressure.swap()
    }

    gradientSubtractProgram.bind()
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0))
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1))
    blit(velocity.write)
    velocity.swap()

    advectionProgram.bind()
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
    if (!ext.supportLinearFiltering) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY)
    }
    const velocityId = velocity.read.attach(0)
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId)
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId)
    gl.uniform1f(advectionProgram.uniforms.dt, dt)
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION)
    blit(velocity.write)
    velocity.swap()

    if (!ext.supportLinearFiltering) {
      gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY)
    }
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0))
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1))
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION)
    blit(dye.write)
    dye.swap()
  }

  function render() {
    const config = getConfig()
    // The display pass writes every pixel with premultiplied ink; no blending.
    gl.disable(gl.BLEND)
    const program = getDisplayProgram(config.SHADING && ext.supportLinearFiltering)
    program.bind()
    gl.uniform2f(program.uniforms.texelSize, 1.0 / gl.drawingBufferWidth, 1.0 / gl.drawingBufferHeight)
    gl.uniform1i(program.uniforms.uTexture, dye.read.attach(0))
    gl.uniform3f(program.uniforms.fleshColor, ...PALETTE.flesh)
    gl.uniform3f(program.uniforms.deepColor, ...PALETTE.deep)
    gl.uniform3f(program.uniforms.lightColor, ...PALETTE.light)
    gl.uniform3f(program.uniforms.rindColor, ...PALETTE.rind)
    gl.uniform1f(program.uniforms.inkGain, config.INK_GAIN)
    gl.uniform1f(program.uniforms.inkMaxAlpha, config.INK_MAX_ALPHA)
    gl.uniform1f(program.uniforms.shadeAmount, config.SHADE_AMOUNT)
    gl.uniform1f(program.uniforms.greenOpacity, config.GREEN_OPACITY)
    blit(null)
  }

  function clearScreen() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  // ---- loop ---------------------------------------------------------------

  let rafId = 0
  let active = false
  let destroyed = false
  let lastUpdateTime = performance.now()
  let idleTime = 0
  let colorUpdateTimer = 0.0

  const canRun = () => active && !destroyed && !document.hidden && !gl.isContextLost()

  function calcDeltaTime() {
    const now = performance.now()
    const dt = Math.min((now - lastUpdateTime) / 1000, 0.016666)
    lastUpdateTime = now
    return dt
  }

  function updateColors(dt) {
    colorUpdateTimer += dt * getConfig().COLOR_UPDATE_SPEED
    if (colorUpdateTimer >= 1) {
      colorUpdateTimer %= 1
      pointer.color = generateColor()
    }
  }

  function frame() {
    rafId = 0
    if (!canRun()) return
    if (idleTime > IDLE_SLEEP_S) {
      clearScreen()
      return // asleep until the next input or splat
    }
    const dt = calcDeltaTime()
    idleTime += dt
    if (resizeCanvas()) initFramebuffers()
    updateColors(dt)
    if (pointer.moved) {
      pointer.moved = false
      splatPointer(pointer)
    }
    step(dt)
    render()
    rafId = requestAnimationFrame(frame)
  }

  function wake() {
    idleTime = 0
    if (!rafId && canRun()) {
      lastUpdateTime = performance.now()
      rafId = requestAnimationFrame(frame)
    }
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
  }

  resizeCanvas()
  initFramebuffers()

  // ---- public API ---------------------------------------------------------

  const sim = {
    setActive(next) {
      if (next === active) return
      active = next
      if (active) {
        wake()
      } else {
        stop()
        // Moves are ignored while paused; re-anchor instead of streaking from
        // the last known position on resume.
        pointer.fresh = true
        if (!gl.isContextLost()) clearScreen()
      }
    },

    /** Call on visibilitychange; the loop also checks document.hidden itself. */
    syncVisibility() {
      if (document.hidden) {
        stop()
        pointer.fresh = true
      } else if (active) {
        lastUpdateTime = performance.now()
        if (!rafId && canRun()) rafId = requestAnimationFrame(frame)
      }
    },

    invalidateRect() {
      rect = null
    },

    pointerDown(clientX, clientY, { burst = false } = {}) {
      if (!canRun()) return
      const pos = toTexcoord(clientX, clientY)
      if (!pos) return
      pointer.down = true
      pointer.moved = false
      pointer.fresh = false
      pointer.texcoordX = pointer.prevTexcoordX = pos[0]
      pointer.texcoordY = pointer.prevTexcoordY = pos[1]
      pointer.deltaX = 0
      pointer.deltaY = 0
      pointer.color = generateColor()
      if (burst) clickSplat(pointer)
      wake()
    },

    pointerMove(clientX, clientY) {
      if (!canRun()) return
      const pos = toTexcoord(clientX, clientY)
      if (!pos) {
        // Outside the canvas: re-anchor on the way back in instead of streaking.
        pointer.fresh = true
        pointer.moved = false
        return
      }
      if (pointer.fresh) {
        pointer.fresh = false
        pointer.texcoordX = pos[0]
        pointer.texcoordY = pos[1]
        return
      }
      pointer.prevTexcoordX = pointer.texcoordX
      pointer.prevTexcoordY = pointer.texcoordY
      pointer.texcoordX = pos[0]
      pointer.texcoordY = pos[1]
      pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX)
      pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY)
      pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0
      if (pointer.moved) wake()
    },

    /** Burst at the pointer's current position (used for touch taps). */
    burst() {
      if (!canRun() || pointer.fresh) return
      clickSplat(pointer)
      wake()
    },

    pointerUp() {
      pointer.down = false
    },

    /** Pointer left the window: the next move re-anchors instead of streaking. */
    pointerLeave() {
      pointer.fresh = true
      pointer.moved = false
    },

    randomSplats(amount) {
      if (!canRun() || amount <= 0) return false
      multipleSplats(amount)
      wake()
      return true
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      stop()
      if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }

  return { sim }
}
