// Tiny registry so the cursor and sticker code can ask the watermelon
// whether a point is over it without prop-drilling through the tree.
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

// Client-space point just above the top-centre of the rind, at rest pose.
export function getMelonEyesAnchor() {
  return melon?.getEyesAnchor?.() ?? null
}

// Client-space position of the slice's tip at rest pose (where juice drips from).
export function getMelonTipAnchor() {
  return melon?.getTipAnchor?.() ?? null
}
