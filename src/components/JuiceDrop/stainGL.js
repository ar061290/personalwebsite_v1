// WebGL ping-pong implementation of the wicking model in stainModel.js
// (WebGL2, or WebGL1 with float / half-float render targets). The shaders are
// GLSL ES 1.00 so the same code runs on both. One canvas, multiply-blended
// over the paper by its parent: it outputs the stain's transmittance as
// premultiplied colour, transparent wherever there is no stain. In the dark
// theme (uMilk) it outputs premultiplied milk instead, screened over the paper.

import { LOOK, MILK, PAPER_MEAN, STAIN } from './stainModel.js'

const A_FLESH = '0.034, 1.0, 0.746'
const A_DEEP = '0.197, 1.0, 0.741'
const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`)
const v3 = (a) => `vec3(${a.map(f).join(', ')})`

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const NOISE = `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 q = p - i;
  vec2 u = q * q * (3.0 - 2.0 * q);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
`

// Paper properties of each cell (once per stain): kappa, theta, bcap, gran.
const PROPS = `
precision highp float;
uniform sampler2D uPaper;
uniform vec2 uOrigin;
uniform float uCell;
${NOISE}
void main() {
  vec2 doc = uOrigin + gl_FragCoord.xy * uCell;
  float h = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
      h += texture2D(uPaper, (doc + o * uCell) / 512.0).r;
    }
  }
  h /= 16.0;
  float n1 = (vnoise(doc / 72.0) * 0.5 + vnoise(doc / 31.0 + vec2(7.3, 1.7)) * 0.3 + vnoise(doc / 13.0 + vec2(2.1, 4.4)) * 0.2 - 0.5) * 2.0;
  float n2 = (vnoise(doc / 15.0 + vec2(3.1, 9.2)) - 0.5) * 2.0;
  vec2 r = vec2(doc.x * 0.94 + doc.y * 0.34, -doc.x * 0.34 + doc.y * 0.94);
  float fib = (vnoise(vec2(r.x / 26.0 + 5.5, r.y / 3.2)) - 0.5) * 2.0;
  float dh = (h - ${f(PAPER_MEAN)}) * 2.0;
  float kappa = clamp(exp(-0.45 * dh + 0.75 * n1 + 0.45 * fib), 0.15, 1.5);
  float theta = clamp(0.12 + 0.1 * dh + 0.06 * n2 - 0.1 * n1 - 0.05 * fib, 0.01, 0.6);
  float bcap = ${f(STAIN.bcapMean)} * (1.0 - 0.25 * dh + 0.06 * n1);
  float gran = clamp(1.0 - 0.9 * dh + 0.25 * n2, 0.25, 2.5);
  gl_FragColor = vec4(kappa, theta, bcap, gran);
}
`

const INIT = `
precision highp float;
uniform vec2 uCenter;
uniform float uR0;
uniform float uS0;
uniform float uPigment;
void main() {
  float r = length(gl_FragCoord.xy - uCenter);
  float w = 1.0 - smoothstep(uR0 - 0.8, uR0 + 0.8, r);
  gl_FragColor = vec4(uS0 * w, 0.0, uS0 * w * uPigment, 0.0);
}
`

// One explicit step; state = (s mobile water, b bound water, p suspended, d deposited).
const STEP = `
precision highp float;
uniform sampler2D uState;
uniform sampler2D uProps;
uniform float uTexel;
uniform float uKMax;
uniform float uAbsorb;
uniform float uEvap;
uniform float uPhi;
uniform float uChi;
uniform float uBeta;

float dfun(float v) { float t = clamp(v, 0.0, 1.0); return uKMax * t * t; }
float psi(float v) { return v < 1.0 ? v : 1.0 + 0.004 * (v - 1.0); }

void nb(vec2 off, float w, vec4 c, vec4 pc, bool cWet, float kc, float psc, inout float ds, inout float dp) {
  vec2 uv = (gl_FragCoord.xy + off) * uTexel;
  vec4 n = texture2D(uState, uv);
  vec4 pn = texture2D(uProps, uv);
  bool nWet = n.y > 1e-3 || n.x > 1e-3;
  if (!cWet && !nWet) return;
  float gate = 1.0;
  if (!cWet) gate = smoothstep(pc.y, pc.y * 1.5 + 0.03, n.x);
  else if (!nWet) gate = smoothstep(pn.y, pn.y * 1.5 + 0.03, c.x);
  float K = w * gate * 0.5 * (kc + dfun(n.x) * pn.x);
  float fl = K * (psi(n.x) - psc);
  ds += fl;
  dp += fl > 0.0 ? uChi * fl * n.z / max(n.x, 1e-5) : uChi * fl * c.z / max(c.x, 1e-5);
}

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec4 c = texture2D(uState, uv);
  vec4 pc = texture2D(uProps, uv);
  bool cWet = c.y > 1e-3 || c.x > 1e-3;
  float kc = dfun(c.x) * pc.x;
  float psc = psi(c.x);
  float ds = 0.0;
  float dp = 0.0;
  nb(vec2(1.0, 0.0), 1.0, c, pc, cWet, kc, psc, ds, dp);
  nb(vec2(-1.0, 0.0), 1.0, c, pc, cWet, kc, psc, ds, dp);
  nb(vec2(0.0, 1.0), 1.0, c, pc, cWet, kc, psc, ds, dp);
  nb(vec2(0.0, -1.0), 1.0, c, pc, cWet, kc, psc, ds, dp);
  nb(vec2(1.0, 1.0), 0.5, c, pc, cWet, kc, psc, ds, dp);
  nb(vec2(-1.0, 1.0), 0.5, c, pc, cWet, kc, psc, ds, dp);
  nb(vec2(1.0, -1.0), 0.5, c, pc, cWet, kc, psc, ds, dp);
  nb(vec2(-1.0, -1.0), 0.5, c, pc, cWet, kc, psc, ds, dp);

  float s1 = max(0.0, c.x + ds);
  float p1 = max(0.0, c.z + dp);
  float water = s1;
  float a = min(s1, uAbsorb * max(0.0, pc.z - c.y));
  s1 -= a;
  float b1 = c.y + a;
  float e = cWet ? min(s1, uEvap) : 0.0;
  s1 -= e;
  float conc = p1 / max(water, 1e-5);
  float dep = uPhi * a * conc + uBeta * pc.w * p1 / max(1.0, water);
  if (s1 < 1e-4 && b1 > 1e-3) dep = p1;
  dep = min(dep, p1);
  gl_FragColor = vec4(s1, b1, p1 - dep, c.w + dep);
}
`

// Display: B-spline upsampling of the sim, crisp edge bent by the full-res
// paper height, granulation, wet → dry. Twin of compositeAt() in stainModel.js.
const COMPOSITE = `
precision highp float;
uniform sampler2D uState;
uniform sampler2D uPaper;
uniform vec2 uOrigin;
uniform vec2 uCanvasPx;
uniform float uDpr;
uniform float uCell;
uniform float uN;
uniform float uDry;
uniform float uMilk;

vec4 cellAt(vec2 i) { return texture2D(uState, (clamp(i, 0.0, uN - 1.0) + 0.5) / uN); }
vec4 bsw(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4((1.0 - t) * (1.0 - t) * (1.0 - t), 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}
vec4 rowAt(vec2 i, vec4 wx) {
  return cellAt(i + vec2(-1.0, 0.0)) * wx.x + cellAt(i) * wx.y + cellAt(i + vec2(1.0, 0.0)) * wx.z + cellAt(i + vec2(2.0, 0.0)) * wx.w;
}
vec4 bspline(vec2 g) {
  vec2 i = floor(g);
  vec2 q = g - i;
  vec4 wx = bsw(q.x), wy = bsw(q.y);
  return rowAt(i + vec2(0.0, -1.0), wx) * wy.x + rowAt(i, wx) * wy.y + rowAt(i + vec2(0.0, 1.0), wx) * wy.z + rowAt(i + vec2(0.0, 2.0), wx) * wy.w;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uCanvasPx.y - gl_FragCoord.y) / uDpr;
  vec2 doc = uOrigin + css;
  vec4 st = bspline(css / uCell - 0.5);
  float h = texture2D(uPaper, doc / 512.0).r;

  float wetted = min(1.0, st.y / ${f(STAIN.bcapMean)} + st.x * 0.8);
  float dh = (h - ${f(PAPER_MEAN)}) * 2.0;
  float edge = 0.5 + ${f(LOOK.edgeGrain)} * 0.5 * dh;
  float mask = smoothstep(edge - 0.12, edge + 0.12, wetted);
  float band = mask * (1.0 - smoothstep(edge + 0.04, edge + ${f(LOOK.edgeWidth)}, wetted));
  float dens = (st.w + st.z / max(1.0, st.x)) * ${f(LOOK.density)} * mask + ${f(LOOK.edgeLine)} * band;
  dens *= max(0.2, 1.0 - ${f(LOOK.granulation)} * dh);
  float wet = mask * smoothstep(0.0, 0.55, (1.0 - uDry) * (0.55 + min(1.0, st.x * 2.0)));
  dens *= 1.0 + ${f(LOOK.wetBoost)} * wet;
  float k = smoothstep(0.45, 1.35, dens);
  if (uMilk > 0.5) {
    // dark theme: milk on black paper, screened over it (premultiplied cream)
    float ma = min(${f(MILK.maxAlpha)}, mask * (${f(MILK.film)} + ${f(MILK.solids)} * (1.0 - exp(-dens * ${f(MILK.density)}))) * (1.0 + ${f(MILK.wetAlpha)} * wet));
    gl_FragColor = vec4(mix(${v3(MILK.cream)}, ${v3(MILK.bright)}, k) * ma, ma);
    return;
  }
  vec3 A = mix(vec3(${A_FLESH}), vec3(${A_DEEP}), k) * dens;
  vec3 T = exp(-A) * (1.0 - ${f(LOOK.wetDarken)} * wet);
  float alpha = 1.0 - min(T.r, min(T.g, T.b));
  // premultiplied: multiply-blended this gives paper × T
  gl_FragColor = vec4(T - (1.0 - alpha), alpha);
}
`

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`juice shader: ${log}`)
  }
  return sh
}

function program(gl, vs, fsSrc) {
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc)
  const p = gl.createProgram()
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.bindAttribLocation(p, 0, 'aPos')
  gl.linkProgram(p)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`juice link: ${gl.getProgramInfoLog(p)}`)
  const uniforms = {}
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i)
    uniforms[info.name] = gl.getUniformLocation(p, info.name)
  }
  return { p, u: uniforms }
}

// Picks a float format we can render to: 32F, then 16F.
function pickFormat(gl, isGL2) {
  const candidates = []
  if (isGL2) {
    if (gl.getExtension('EXT_color_buffer_float')) {
      candidates.push({ internal: gl.RGBA32F, type: gl.FLOAT })
      candidates.push({ internal: gl.RGBA16F, type: gl.HALF_FLOAT })
    } else if (gl.getExtension('EXT_color_buffer_half_float')) {
      candidates.push({ internal: gl.RGBA16F, type: gl.HALF_FLOAT })
    }
  } else {
    if (gl.getExtension('OES_texture_float')) {
      gl.getExtension('WEBGL_color_buffer_float')
      candidates.push({ internal: gl.RGBA, type: gl.FLOAT })
    }
    const half = gl.getExtension('OES_texture_half_float')
    if (half) {
      gl.getExtension('EXT_color_buffer_half_float')
      candidates.push({ internal: gl.RGBA, type: half.HALF_FLOAT_OES })
    }
  }
  for (const c of candidates) {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, c.internal, 4, 4, 0, gl.RGBA, c.type, null)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(fb)
    gl.deleteTexture(tex)
    if (ok) return c
  }
  return null
}

/**
 * Creates the GPU stain on `canvas`. Returns null when this device can't run
 * it (no WebGL, no float render targets, no highp) so the caller can fall back.
 *
 * @param paper  { width, height, data: Uint8Array } from loadPaperHeight(), or null
 */
export function createGlStain(canvas, paper) {
  const attrs = { alpha: true, premultipliedAlpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
  let gl = canvas.getContext('webgl2', attrs)
  const isGL2 = !!gl
  if (!gl) gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs)
  if (!gl || gl.isContextLost()) return null
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
  if (!hp || hp.precision < 16) return null
  const fmt = pickFormat(gl, isGL2)
  if (!fmt) return null

  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const progs = {
    props: program(gl, vs, PROPS),
    init: program(gl, vs, INIT),
    step: program(gl, vs, STEP),
    composite: program(gl, vs, COMPOSITE),
  }
  gl.deleteShader(vs)

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.disable(gl.BLEND)
  gl.disable(gl.DEPTH_TEST)

  // Paper height: one tile, 1 texel per CSS px, repeating from document (0, 0).
  const paperTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, paperTex)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  if (paper) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, paper.width, paper.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, paper.data)
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([141]))
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)

  let targets = null // { props, a, b } each { tex, fb }
  let cfg = null
  let origin = [0, 0]
  let done = 0

  const makeTarget = (n) => {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, n, n, 0, gl.RGBA, fmt.type, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { tex, fb }
  }
  const freeTargets = () => {
    if (!targets) return
    for (const t of [targets.props, targets.a, targets.b]) {
      gl.deleteTexture(t.tex)
      gl.deleteFramebuffer(t.fb)
    }
    targets = null
  }
  const bindTex = (unit, tex) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }
  const draw = (fb, w, h) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.viewport(0, 0, w, h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  return {
    kind: isGL2 ? 'webgl2' : 'webgl1',
    gl,
    get stepsDone() {
      return done
    },
    get cfg() {
      return cfg
    },
    /** New stain: grid `nextCfg` whose top-left cell corner sits at document `docOrigin`. */
    start(nextCfg, docOrigin) {
      if (gl.isContextLost()) return
      if (!targets || !cfg || cfg.n !== nextCfg.n) {
        freeTargets()
        targets = { props: makeTarget(nextCfg.n), a: makeTarget(nextCfg.n), b: makeTarget(nextCfg.n) }
      }
      cfg = nextCfg
      origin = docOrigin
      done = 0
      const { n } = cfg
      gl.useProgram(progs.props.p)
      bindTex(0, paperTex)
      gl.uniform1i(progs.props.u.uPaper, 0)
      gl.uniform2f(progs.props.u.uOrigin, origin[0], origin[1])
      gl.uniform1f(progs.props.u.uCell, cfg.cellPx)
      draw(targets.props.fb, n, n)
      gl.useProgram(progs.init.p)
      gl.uniform2f(progs.init.u.uCenter, n / 2, n / 2)
      gl.uniform1f(progs.init.u.uR0, cfg.r0)
      gl.uniform1f(progs.init.u.uS0, cfg.s0)
      gl.uniform1f(progs.init.u.uPigment, cfg.pigment)
      draw(targets.a.fb, n, n)
    },
    /** Runs up to `count` more steps. */
    step(count) {
      if (!targets || gl.isContextLost()) return
      const { n } = cfg
      const P = progs.step
      gl.useProgram(P.p)
      gl.uniform1i(P.u.uState, 0)
      gl.uniform1i(P.u.uProps, 1)
      gl.uniform1f(P.u.uTexel, 1 / n)
      gl.uniform1f(P.u.uKMax, cfg.kMax)
      gl.uniform1f(P.u.uAbsorb, cfg.absorb)
      gl.uniform1f(P.u.uEvap, cfg.evap)
      gl.uniform1f(P.u.uPhi, cfg.phi)
      gl.uniform1f(P.u.uChi, cfg.chi)
      gl.uniform1f(P.u.uBeta, cfg.beta)
      bindTex(1, targets.props.tex)
      for (let i = 0; i < count; i++) {
        bindTex(0, targets.a.tex)
        draw(targets.b.fb, n, n)
        const t = targets.a
        targets.a = targets.b
        targets.b = t
      }
      done += count
    },
    /** Draws the stain into the canvas (backing size must already be set). */
    render(dry, docOrigin = origin, dpr = 1, milk = false) {
      if (!targets || gl.isContextLost()) return
      const P = progs.composite
      gl.useProgram(P.p)
      bindTex(0, targets.a.tex)
      bindTex(1, paperTex)
      gl.uniform1i(P.u.uState, 0)
      gl.uniform1i(P.u.uPaper, 1)
      gl.uniform2f(P.u.uOrigin, docOrigin[0], docOrigin[1])
      gl.uniform2f(P.u.uCanvasPx, canvas.width, canvas.height)
      gl.uniform1f(P.u.uDpr, dpr)
      gl.uniform1f(P.u.uCell, cfg.cellPx)
      gl.uniform1f(P.u.uN, cfg.n)
      gl.uniform1f(P.u.uDry, dry)
      gl.uniform1f(P.u.uMilk, milk ? 1 : 0)
      draw(null, canvas.width, canvas.height)
    },
    clear() {
      if (gl.isContextLost()) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    },
    reset() {
      done = 0
      cfg = cfg && { ...cfg }
    },
    destroy() {
      try {
        if (!gl.isContextLost()) {
          freeTargets()
          for (const k of Object.keys(progs)) gl.deleteProgram(progs[k].p)
          gl.deleteBuffer(quad)
          gl.deleteTexture(paperTex)
          gl.getExtension('WEBGL_lose_context')?.loseContext()
        }
      } catch {
        // already gone
      }
    },
  }
}
