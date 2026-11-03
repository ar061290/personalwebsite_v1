// Where the slice sits in the hero, shared by the WebGPU camera and the SVG fallback.
import { smoothstep } from './math.js'

// The slice stands upright facing the viewer like a held-up pizza slice: rind arc on
// top, tip down, its top face (slice +y) toward the camera. Basis of that upright
// frame expressed in the slice's rest coordinates:
export const UPRIGHT = {
  right: [-1, 0, 0], // screen right
  up: [0, 0, 1], // screen up = from the tip toward the rind
  out: [0, 1, 0], // toward the viewer = the slice's top face
}

// Slight 3/4 view so the thickness and the rind depth read as 3D:
// the camera sits a little to the right of and above the slice.
export const VIEW = {
  yaw: 0.4, // rad, around the upright axis
  pitch: 0.3, // rad, above the slice's mid-plane (shows the top of the rind)
  fov: (27 * Math.PI) / 180, // the artifact's lens
}

// Target size and position of the rest-pose slice in a W×H (CSS px) hero.
export function layoutTarget(W, H) {
  const base = Math.min(W, 1.4 * H)
  // ≈37% of the base on desktop, most of the width on phones
  const frac = 0.78 + (0.37 - 0.78) * smoothstep(420, 900, W)
  return {
    width: frac * base,
    maxHeight: 0.58 * H, // keep room above the rind for the googly eyes
    cx: 0.5 * W,
    cy: 0.545 * H,
  }
}

// gap (CSS px) between the top of the rind and the eyes anchor
export const eyesGap = (H) => Math.round(Math.max(6, 0.012 * H))

// camera direction (from the slice toward the eye) in rest coordinates
export function eyeDirection(view = VIEW) {
  const { right: X, up: Y, out: Z } = UPRIGHT
  const sy = Math.sin(view.yaw) * Math.cos(view.pitch)
  const sp = Math.sin(view.pitch)
  const so = Math.cos(view.yaw) * Math.cos(view.pitch)
  return [0, 1, 2].map((k) => X[k] * sy + Y[k] * sp + Z[k] * so)
}

// ── the chocolate bar (dark theme, the user's GLB: barModel.js) ──
// A product shot: the bar lies on its back as in the file (its top, the pieces and grooves, is rest
// +y; its length runs along x, the end showing the filling at −x) and the camera looks down on it from
// the front right (−z, −x) and above, its up the bar's own up (+y), the melon's lens. The grooves read
// as valleys, the front wall and the filled end show. A long low box: the bar is wide and thin.
export const BAR_VIEW = { yaw: 0.5, pitch: -0.79, up: [0, 1, 0], fov: VIEW.fov }

export function barLayoutTarget(W, H) {
  const base = Math.min(W, 1.4 * H)
  // ≈50% of the base on desktop, nearly the full width on phones
  const frac = 0.9 + (0.5 - 0.9) * smoothstep(420, 900, W)
  return {
    width: frac * base,
    maxHeight: 0.4 * H,
    cx: 0.5 * W,
    cy: 0.55 * H,
  }
}
