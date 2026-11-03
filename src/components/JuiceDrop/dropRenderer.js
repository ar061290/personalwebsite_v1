// Canvas2D painter for the juice drop: the bead swelling at the melon tip,
// the falling teardrop, and the squashed puddle that soaks into the paper.
// Light comes from the top left. Juice is translucent and rosy:
// lighter where light focuses through it (bottom), a darker refractive rim,
// a crisp specular highlight and a faint secondary glint.

const TAU = Math.PI * 2

// Colours: rosy watermelon juice (light theme) and milk (dark theme, on black
// paper: an opaque creamy white, shaded cool grey toward the rim, no shadow).
export const JUICE = {
  body: [[0, 'rgba(255, 176, 190, 0.66)'], [0.42, 'rgba(249, 124, 149, 0.8)'], [0.78, 'rgba(214, 82, 111, 0.9)'], [1, 'rgba(150, 36, 64, 0.96)']],
  edge: 'rgba(122, 22, 50, 0.5)',
  band: 'rgba(140, 28, 58, 0.26)',
  caustic: ['rgba(255, 222, 228, 0.62)', 'rgba(255, 190, 204, 0)'],
  shadow: ['150, 40, 66', '196, 70, 98'],
  shadowA: 0.26,
  thread: '214, 82, 111',
  threadA: 0.85,
  lens: [[0, 'rgba(232, 92, 122, 0.62)'], [0.7, 'rgba(242, 112, 140, 0.52)'], [0.92, 'rgba(206, 74, 104, 0.62)'], [1, 'rgba(168, 44, 74, 0.7)']],
  lensLight: ['rgba(255, 214, 222, 0.5)', 'rgba(255, 214, 222, 0)'],
  lensRim: 'rgba(140, 30, 60, 0.45)',
}
export const MILK = {
  body: [[0, 'rgba(247, 245, 239, 0.95)'], [0.42, 'rgba(238, 236, 230, 0.96)'], [0.78, 'rgba(214, 215, 218, 0.97)'], [1, 'rgba(150, 156, 170, 0.98)']],
  edge: 'rgba(120, 126, 140, 0.55)',
  band: 'rgba(150, 156, 170, 0.22)',
  caustic: ['rgba(255, 255, 252, 0.55)', 'rgba(255, 255, 252, 0)'],
  shadow: ['0, 0, 0', '0, 0, 0'],
  shadowA: 0,
  thread: '236, 234, 228',
  threadA: 0.92,
  lens: [[0, 'rgba(246, 244, 238, 0.8)'], [0.7, 'rgba(240, 238, 232, 0.74)'], [0.92, 'rgba(214, 214, 216, 0.82)'], [1, 'rgba(170, 176, 188, 0.86)']],
  lensLight: ['rgba(255, 255, 255, 0.5)', 'rgba(255, 255, 255, 0)'],
  lensRim: 'rgba(130, 136, 150, 0.5)',
}

// Teardrop outline, tail up: m = 0 is an ellipse, larger m sharpens the tail.
function teardrop(ctx, cx, cy, R, sx, sy, m) {
  const N = 44
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * TAU
    const w = m > 0 ? Math.pow(Math.abs(Math.sin(t / 2)), m) : 1
    const x = cx + Math.sin(t) * w * R * sx
    const y = cy - Math.cos(t) * R * sy
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

// Liquid bridge from a point (tip of the melon) down into the top of a body.
function bridge(ctx, tx, ty, topW, bx, by, botW) {
  const L = by - ty
  ctx.moveTo(tx - topW / 2, ty)
  ctx.bezierCurveTo(tx - topW / 2, ty + L * 0.55, bx - botW / 2, by - L * 0.45, bx - botW / 2, by)
  ctx.lineTo(bx + botW / 2, by)
  ctx.bezierCurveTo(bx + botW / 2, by - L * 0.45, tx + topW / 2, ty + L * 0.55, tx + topW / 2, ty)
  ctx.closePath()
}

// Fills the current path as juice. Uses (and then discards) the current path.
function shadeDrop(ctx, pal, cx, cy, R, sx, sy, alpha, edge = 0.8) {
  const rx = R * sx, ry = R * sy
  const rr = Math.max(rx, ry)
  ctx.globalAlpha = alpha

  // body: deeper and denser toward the rim, light focused low in the drop
  const g = ctx.createRadialGradient(cx + 0.12 * rx, cy + 0.3 * ry, 0, cx, cy, rr * 1.12)
  for (const [o, c] of pal.body) g.addColorStop(o, c)
  ctx.fillStyle = g
  ctx.fill()
  if (edge > 0) {
    ctx.globalAlpha = alpha * edge
    ctx.lineWidth = 0.7
    ctx.strokeStyle = pal.edge
    ctx.stroke()
    ctx.globalAlpha = alpha
  }

  // darker refractive band just inside the outline
  ctx.save()
  ctx.clip()
  ctx.lineWidth = rr * 0.42
  ctx.strokeStyle = pal.band
  ctx.stroke()

  // caustic: light gathered at the bottom of the drop
  const c = ctx.createRadialGradient(cx + 0.14 * rx, cy + 0.5 * ry, 0, cx + 0.14 * rx, cy + 0.5 * ry, rr * 0.62)
  c.addColorStop(0, pal.caustic[0])
  c.addColorStop(1, pal.caustic[1])
  ctx.fillStyle = c
  ctx.fillRect(cx - rr * 2, cy - rr * 2, rr * 4, rr * 4)

  // specular highlight + a small secondary glint
  ctx.translate(cx - 0.36 * rx, cy - 0.34 * ry)
  ctx.rotate(-0.62)
  ctx.scale(1, 0.62)
  const hr = rr * 0.34
  const s = ctx.createRadialGradient(0, 0, 0, 0, 0, hr)
  s.addColorStop(0, 'rgba(255, 255, 255, 0.98)')
  s.addColorStop(0.42, 'rgba(255, 255, 255, 0.85)')
  s.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = s
  ctx.beginPath()
  ctx.arc(0, 0, hr, 0, TAU)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = alpha * 0.55
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(cx + 0.36 * rx, cy + 0.42 * ry, Math.max(0.5, rr * 0.075), 0, TAU)
  ctx.fill()
  ctx.restore()
  ctx.globalAlpha = 1
}

function contactShadow(ctx, pal, cx, cy, R, near) {
  if (near <= 0.01 || pal.shadowA <= 0) return
  const far = 1 - near
  const ox = cx + R * 0.3 * (0.4 + 1.6 * far)
  const oy = cy + R * 0.55 * (0.5 + 2.2 * far)
  const r = R * (1.05 + 0.6 * far)
  const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r)
  const a = pal.shadowA * near
  g.addColorStop(0, `rgba(${pal.shadow[0]}, ${a})`)
  g.addColorStop(0.35, `rgba(${pal.shadow[1]}, ${a * 0.55})`)
  g.addColorStop(1, `rgba(${pal.shadow[1]}, 0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(ox, oy, r, r * 0.86, 0, 0, TAU)
  ctx.fill()
}

// The squashed drop seen from above: a shallow lens of juice with a meniscus
// rim and a wet highlight, fading as it soaks in.
function lens(ctx, pal, cx, cy, Rp, alpha) {
  if (alpha <= 0.01) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(cx, cy, Rp, 0, TAU)
  const g = ctx.createRadialGradient(cx + Rp * 0.1, cy + Rp * 0.12, 0, cx, cy, Rp)
  for (const [o, c] of pal.lens) g.addColorStop(o, c)
  ctx.fillStyle = g
  ctx.fill()
  ctx.clip()
  // light pooled on the far side of the lens
  const c = ctx.createRadialGradient(cx + Rp * 0.32, cy + Rp * 0.36, 0, cx + Rp * 0.32, cy + Rp * 0.36, Rp * 0.7)
  c.addColorStop(0, pal.lensLight[0])
  c.addColorStop(1, pal.lensLight[1])
  ctx.fillStyle = c
  ctx.fillRect(cx - Rp, cy - Rp, Rp * 2, Rp * 2)
  // wet highlight
  ctx.translate(cx - Rp * 0.38, cy - Rp * 0.4)
  ctx.rotate(-0.7)
  ctx.scale(1, 0.4)
  const s = ctx.createRadialGradient(0, 0, 0, 0, 0, Rp * 0.42)
  s.addColorStop(0, 'rgba(255, 255, 255, 0.9)')
  s.addColorStop(0.5, 'rgba(255, 255, 255, 0.6)')
  s.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = s
  ctx.beginPath()
  ctx.arc(0, 0, Rp * 0.42, 0, TAU)
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.globalAlpha = alpha * 0.8
  ctx.beginPath()
  ctx.arc(cx, cy, Rp - 0.4, 0, TAU)
  ctx.lineWidth = 0.8
  ctx.strokeStyle = pal.lensRim
  ctx.stroke()
  ctx.restore()
}

/**
 * Paints one frame. Coordinates are CSS px in the canvas.
 * @param {CanvasRenderingContext2D} ctx  (transform already scaled by DPR)
 * @param {object} d  see juiceController's updateDrop() for the fields
 * @param {object} [pal]  JUICE (default) or MILK
 */
export function paintDrop(ctx, d, pal = JUICE) {
  const { R } = d
  if (d.mode === 'bead') {
    const Rb = R * d.grow
    if (Rb < 0.4) return
    const sx = d.sx, sy = d.sy
    ctx.beginPath()
    teardrop(ctx, d.x, d.y, Rb, sx, sy, d.m)
    // the neck reaches up into the melon's tip
    const topY = d.y - Rb * sy * 0.55
    bridge(ctx, d.tipX, d.tipY, d.neckW, d.x, topY, Rb * sx * 1.1)
    shadeDrop(ctx, pal, d.x, d.y, Rb, sx, sy, d.alpha)
    return
  }
  if (d.mode === 'fall') {
    contactShadow(ctx, pal, d.x, d.y, R, d.near)
    // thread still joining the drop to the tip, then the bead left behind
    if (d.thread > 0) {
      ctx.beginPath()
      bridge(ctx, d.tipX, d.tipY, d.thread * R * 0.32, d.x, d.y - R * d.sy * 0.7, Math.max(0.6, d.thread * R * 0.5))
      ctx.fillStyle = `rgba(${pal.thread}, ${pal.threadA * d.alpha})`
      ctx.fill()
    }
    if (d.remnant > 0.3) {
      ctx.beginPath()
      teardrop(ctx, d.tipX, d.tipY + d.remnant * 0.75, d.remnant, 1, 1.1, 0.4)
      shadeDrop(ctx, pal, d.tipX, d.tipY + d.remnant * 0.75, d.remnant, 1, 1.1, d.alpha)
    }
    ctx.beginPath()
    teardrop(ctx, d.x, d.y, R, d.sx, d.sy, d.m)
    shadeDrop(ctx, pal, d.x, d.y, R, d.sx, d.sy, d.alpha)
    return
  }
  if (d.mode === 'puddle') {
    // squash (side view) crossfading into the lens (top view)
    if (d.lens < 1) {
      ctx.beginPath()
      teardrop(ctx, d.x, d.y, R, d.sx, d.sy, 0)
      shadeDrop(ctx, pal, d.x, d.y, R, d.sx, d.sy, 1 - d.lens)
    }
    lens(ctx, pal, d.x, d.y, R * d.puddle, d.lens * (1 - d.soak))
  }
}
