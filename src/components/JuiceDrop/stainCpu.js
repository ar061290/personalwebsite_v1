// Canvas2D fallback for the stain: the same model (stainModel.js) on the CPU,
// on a coarser grid, composited at half resolution and scaled up by CSS.
// Same interface as createGlStain().

import { compositeAt, createCpuStain } from './stainModel.js'

const RES = 0.5 // canvas px per CSS px

function bsw(t, out, o) {
  const t2 = t * t, t3 = t2 * t
  out[o] = (1 - t) * (1 - t) * (1 - t) / 6
  out[o + 1] = (3 * t3 - 6 * t2 + 4) / 6
  out[o + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6
  out[o + 3] = t3 / 6
}

export function createCpuStainRenderer(canvas, paper) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const height = paper
    ? (x, y) => {
        const w = paper.width
        const ix = ((Math.floor(x) % w) + w) % w
        const iy = ((Math.floor(y) % paper.height) + paper.height) % paper.height
        return paper.data[iy * w + ix] / 255
      }
    : () => 141 / 255
  let sim = null
  let cfg = null
  let done = 0
  let image = null

  return {
    kind: 'canvas2d',
    resolution: RES,
    get stepsDone() {
      return done
    },
    get cfg() {
      return cfg
    },
    start(nextCfg, docOrigin) {
      cfg = nextCfg
      sim = createCpuStain(cfg, docOrigin, height)
      done = 0
    },
    step(count) {
      if (!sim) return
      for (let i = 0; i < count; i++) sim.step()
      done += count
    },
    render(dry, docOrigin, _res, milk = false) {
      if (!sim) return
      const W = canvas.width, H = canvas.height
      if (!image || image.width !== W || image.height !== H) image = ctx.createImageData(W, H)
      const px = image.data
      const { s, b, p, d } = sim.state
      const n = cfg.n
      const st = [0, 0, 0, 0]
      const out = new Float32Array(4)
      const wx = new Float32Array(4), wy = new Float32Array(4)
      const scale = 1 / RES
      for (let y = 0; y < H; y++) {
        const cssY = (y + 0.5) * scale
        const gy = cssY / cfg.cellPx - 0.5
        const iy = Math.floor(gy)
        bsw(gy - iy, wy, 0)
        for (let x = 0; x < W; x++) {
          const cssX = (x + 0.5) * scale
          const gx = cssX / cfg.cellPx - 0.5
          const ix = Math.floor(gx)
          bsw(gx - ix, wx, 0)
          st[0] = st[1] = st[2] = st[3] = 0
          for (let j = 0; j < 4; j++) {
            const yy = Math.min(n - 1, Math.max(0, iy - 1 + j))
            for (let i = 0; i < 4; i++) {
              const xx = Math.min(n - 1, Math.max(0, ix - 1 + i))
              const k = yy * n + xx
              const w = wx[i] * wy[j]
              st[0] += s[k] * w
              st[1] += b[k] * w
              st[2] += p[k] * w
              st[3] += d[k] * w
            }
          }
          compositeAt(st, height(docOrigin[0] + cssX, docOrigin[1] + cssY), dry, out, milk)
          const o = (y * W + x) * 4
          if (milk) {
            // straight colour + coverage, screened over the black paper
            px[o] = 255 * out[0]
            px[o + 1] = 255 * out[1]
            px[o + 2] = 255 * out[2]
            px[o + 3] = 255 * out[3]
            continue
          }
          const a = 1 - Math.min(out[0], out[1], out[2])
          // unpremultiplied colour C with paper × (1 − a + a·C) = paper × T
          const inv = a > 1e-4 ? 1 / a : 0
          px[o] = 255 * (1 - (1 - out[0]) * inv)
          px[o + 1] = 255 * (1 - (1 - out[1]) * inv)
          px[o + 2] = 255 * (1 - (1 - out[2]) * inv)
          px[o + 3] = 255 * a
        }
      }
      ctx.putImageData(image, 0, 0)
    },
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    },
    destroy() {
      sim = null
      image = null
    },
  }
}
