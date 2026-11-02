// Home-page scroll choreography, measured in viewport heights scrolled
// (window.scrollY / window.innerHeight). Shared so the drip and the eyes stay
// in step with each other.
export const CHOREO = {
  dripForm: [0, 0.06], // a juice bead swells at the melon's tip
  dripDetach: 0.06, // the bead lets go and starts to fall
  eyesDock: [0, 0.45], // the eyes travel up into the header
}

export const clamp01 = (v) => Math.min(1, Math.max(0, v))

export const scrollVh = () => window.scrollY / Math.max(1, window.innerHeight)

export function rangeProgress([from, to], v = scrollVh()) {
  return clamp01((v - from) / (to - from))
}
