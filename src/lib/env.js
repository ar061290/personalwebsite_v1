// Capability and preference checks (ported from the Drama Collective site's src/util/env.js, for the
// theme switch and its earrings).

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Probe WebGL once; returns { ok, renderer } where renderer is the unmasked GPU string if exposed.
 * WebGL 2 only: three.js (0.170) draws with nothing less, so a browser offering WebGL 1 alone gets
 * nothing rather than downloading a scene it cannot draw.
 */
export function probeWebGL() {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return { ok: false, renderer: '' }
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return { ok: true, renderer }
  } catch {
    return { ok: false, renderer: '' }
  }
}

/**
 * Low-power heuristic: software rasterisers, data-saver, or very small devices get no live scene.
 * `?static` forces that, `?live` forces WebGL.
 */
export function prefersStatic(rendererString) {
  const query = new URLSearchParams(location.search)
  if (query.has('static')) return true
  if (query.has('live')) return false
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererString || '')
  const saveData = navigator.connection?.saveData === true
  const cores = navigator.hardwareConcurrency || 4
  const memory = navigator.deviceMemory || 4
  return software || saveData || cores <= 2 || memory <= 2
}

/** Read a design token from :root (e.g. readToken('--accent')). */
export function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
