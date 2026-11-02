// Colours and light rig, from the artifact. Only the Rosé variety is used.

export const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
export const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

// Rosé (linear RGB)
export const ROSE = {
  flesh: [0.95, 0.2, 0.3],
  fleshDeep: [0.6, 0.08, 0.15],
  pale: [0.84, 0.9, 0.72],
  skin: [0.06, 0.2, 0.1],
  stripe: [0.012, 0.06, 0.03],
  seed: [0.014, 0.009, 0.007],
  shadowTint: [0.64, 0.5, 0.52],
}

// The artifact's studio sweep #E2DFDA. The tone mapper subtracts a small toe offset,
// so the artifact lifted the backdrop by 0.04 to land on the page colour. It still
// lights the slice (ambient + reflections), exactly as in the artifact.
const BG_SRGB = [0.886, 0.875, 0.855]
export const STUDIO = BG_SRGB.map((c) => srgbToLin(c) + 0.04)

// What the jelly refracts. In the artifact the slice lay on its floor, so every view ray
// through it ended on the floor right under it — in the slice's own soft shadow
// (tinted by the jelly) and fully in contact occlusion (×0.28). Reproducing that
// backing keeps the flesh exactly as rich as in the artifact; the neutral share that
// would reach it is handed to the real page through alpha instead (see toDisplay).
export const BACKING = STUDIO.map((c, i) => c * 0.99 * ROSE.shadowTint[i] * 0.28)

// key light: from behind-left and above the slice's top face (slice frame), as in the artifact
export const KEY_DIR = (() => {
  const d = [-0.45, 0.86, -0.36]
  const l = Math.hypot(...d)
  return d.map((v) => v / l)
})()
export const KEY_INTENSITY = 2.3
export const EXPOSURE = 1.0

// the artifact's post chain (Khronos PBR Neutral + sRGB), for colours computed on the CPU
export function toneMap(rgb, exposure = EXPOSURE) {
  const c0 = rgb.map((v) => Math.max(0, v * exposure))
  const startC = 0.8 - 0.04, desat = 0.15
  const x = Math.min(...c0)
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04
  let c = c0.map((v) => v - off)
  const peak = Math.max(...c)
  if (peak >= startC) {
    const d = 1 - startC
    const np = 1 - (d * d) / (peak + d - startC)
    c = c.map((v) => (v * np) / peak)
    const g = 1 - 1 / (desat * (peak - np) + 1)
    c = c.map((v) => v + (np - v) * g)
  }
  return c.map((v) => linToSrgb(Math.min(1, Math.max(0, v))))
}

export const BACKING_DISPLAY = toneMap(BACKING)
