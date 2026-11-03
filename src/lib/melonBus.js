// Tiny registry so the cursor, stickers, eyes and juice drop can ask the hero model about itself
// without prop-drilling through the tree. The registered instance is the WebGPU engine
// (components/Melon/engine.js) or its static SVG fallback (MelonFallback.jsx); both implement:
//   hitTest(clientX, clientY) → bool, isGrabbing() → bool,
//   getEyesAnchor() → {x, y} | null, getTipAnchor() → {x, y} | null
// Anchors are CLIENT px (viewport coords, like getBoundingClientRect), measured on the REST pose:
// they never follow a grab / wobble, only layout, so callers can build scroll choreography on them.
// They are read live from the canvas rect, so they move with scroll and resize; add scrollX/Y for
// page coords. null while no model is mounted (or before its first layout).
// The hero model follows the theme (src/lib/theme.js): the watermelon slice in light, the
// milk-chocolate bar in dark. A theme change swaps it at once, and the anchors with it (read them
// again after an 'aadi:themechange'; `model` on the instance says which one is shown).
let melon = null

export function setMelon(instance) {
  melon = instance
}

export function isOverMelon(clientX, clientY) {
  return !!melon?.hitTest?.(clientX, clientY)
}

export function isMelonGrabbing() {
  return !!melon?.isGrabbing?.()
}

// Just above the top-centre of the rind (eyesGap(viewport height) above its highest point), rest pose.
// The bar: just above its top edge, over the middle of the bar.
export function getMelonEyesAnchor() {
  return melon?.getEyesAnchor?.() ?? null
}

// The slice's tip: the lowest point of the rest silhouette (where the juice drips from), rest pose.
// The bar: the lowest point of its bottom-right corner (under the end that shows the filling), where
// the milk drop forms.
export function getMelonTipAnchor() {
  return melon?.getTipAnchor?.() ?? null
}
