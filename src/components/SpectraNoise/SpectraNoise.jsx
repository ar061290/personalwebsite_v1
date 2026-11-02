import { useEffect, useRef } from 'react'
import { CPPN_GLSL } from './cppn.js'
import './SpectraNoise.css'

// Port of the Framer "Spectra Noise" component (a CPPN "neural noise" field).
// The network, its time inputs and the uv mapping are the original's, so the
// pattern keeps its proportions and is stretched to whatever box it fills.
// Instead of its rainbow output, the field is inked in the fluid's rose with a
// faint hint of rind green, and light areas are transparent so the paper shows.

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

const FRAGMENT = `
precision mediump float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uWarp;
uniform float uNoise;
uniform float uStrength;
uniform vec3 uDeep;
uniform vec3 uRose;
uniform vec3 uLight;
uniform vec3 uGreen;

${CPPN_GLSL}

float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  // Same mapping as the original mainImage().
  vec2 uv = gl_FragCoord.xy / uResolution.xy * 2.0 - 1.0;
  uv.y *= -1.0;
  uv += uWarp * vec2(sin(uv.y * 6.283 + uTime * 0.5), cos(uv.x * 6.283 + uTime * 0.5)) * 0.05;
  vec3 base = cppn_fn(uv, 0.1 * sin(0.3 * uTime), 0.1 * sin(0.69 * uTime), 0.1 * sin(0.44 * uTime)).rgb;

  // The field is mostly near-black with luminous veils (luminance ≲ 0.3). On
  // paper the veils become the ink: the brighter the veil, the denser and deeper
  // the rose; the dark background stays clear.
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 ink = mix(uLight, uRose, smoothstep(0.03, 0.14, lum));
  ink = mix(ink, uDeep, smoothstep(0.16, 0.3, lum));

  // Where the veils turn blue, let a little rind green through instead.
  float cool = clamp(base.b - base.r, 0.0, 1.0);
  ink = mix(ink, uGreen, smoothstep(0.04, 0.2, cool) * 0.3);

  float alpha = smoothstep(0.01, 0.16, lum) * uStrength;
  alpha = clamp(alpha + (rand(gl_FragCoord.xy + uTime) - 0.5) * uNoise, 0.0, 1.0);
  gl_FragColor = vec4(ink * alpha, alpha);
}
`

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

// Saturated rose ink (kept clear of greys so it doesn't go dusty on the paper).
const COLORS = {
  uDeep: '#E23A62',
  uRose: '#F9617F',
  uLight: '#FF8AA3',
  uGreen: '#457C59',
}

export default function SpectraNoise({
  className = '',
  speed = 1.4,
  warpAmount = 0.9,
  noiseIntensity = 0.03,
  strength = 0.95,
  resolutionScale = 0.6,
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    let gl = null
    try {
      gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false })
    } catch {
      gl = null
    }
    if (!gl) return undefined

    const compile = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[spectra] shader:', gl.getShaderInfoLog(shader))
        return null
      }
      return shader
    }
    const vs = compile(gl.VERTEX_SHADER, VERTEX)
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT)
    if (!vs || !fs) return undefined
    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[spectra] link:', gl.getProgramInfoLog(program))
      return undefined
    }
    gl.useProgram(program)

    // Full-screen triangle, as in the original.
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const u = (name) => gl.getUniformLocation(program, name)
    const uResolution = u('uResolution')
    const uTime = u('uTime')
    gl.uniform1f(u('uWarp'), warpAmount)
    gl.uniform1f(u('uNoise'), noiseIntensity)
    gl.uniform1f(u('uStrength'), strength)
    for (const [name, hex] of Object.entries(COLORS)) gl.uniform3fv(u(name), hexToRgb(hex))

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2) * resolutionScale
      const w = Math.max(1, Math.round(canvas.clientWidth * scale))
      const h = Math.max(1, Math.round(canvas.clientHeight * scale))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.uniform2f(uResolution, w, h)
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    let raf = 0
    let inView = false

    const draw = () => {
      resize()
      gl.uniform1f(uTime, ((performance.now() - start) / 1000) * speed)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }

    const sync = () => {
      const run = inView && !document.hidden && !reduced
      if (run && !raf) raf = requestAnimationFrame(loop)
      if (!run && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      if (inView && reduced) draw()
      sync()
    })
    io.observe(canvas)
    const ro = new ResizeObserver(() => {
      if (!raf) draw()
    })
    ro.observe(canvas)
    document.addEventListener('visibilitychange', sync)
    draw()

    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      document.removeEventListener('visibilitychange', sync)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [speed, warpAmount, noiseIntensity, strength, resolutionScale])

  return <canvas ref={canvasRef} className={`spectra-noise ${className}`} aria-hidden="true" />
}
