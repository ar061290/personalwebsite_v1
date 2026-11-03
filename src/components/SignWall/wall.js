// The wall's canvases: lays out the regulars (real signatures, humans.js) on a long strip, paints
// each one once into a sprite and slides them past as the page scrolls; underneath that it runs
// the visitor's live brush and replays their saved signatures. React only draws the UI on top
// (labels, the name popup); everything here talks to it through the callbacks.
//
// The strip: the wall's frame looks onto a strip of paper. Its right end is the final view, the
// wall as it rests (a few regulars around the edges, the middle open for the visitor and the hint
// behind it); to its left runs a densely signed stretch with everyone else. Once the wall is
// mostly in view the frame pans by itself from that dense stretch to the final view, quick
// through the middle and easing into place at the end (`pan`: CSS px the strip is shifted right,
// so 0 is the final view). The visitor can only draw there, at rest.
//
// Browsing: the visitor can take the pan and look along the strip themselves, sideways only: a
// trackpad's swipe or a tilting wheel (Shift with an ordinary one), the buttons SignWall draws
// (browse(), home()) and, away from home, a finger dragged sideways. From then on the pan is
// theirs (`manual`, the auto-pan stops where it is): it heads for `want`, between home (0) and the
// dense stretch's far left end (L), with the same glide. Up and down is always the page's.
//
// Two canvases: the regulars' (below) is composited from sprites at their panned positions, and
// only while the pan moves; the visitor's (on top) is in the final view's coordinates, painted
// by the brush as they draw, and simply moved by a CSS transform (onPan) along with the labels.
//
// Geometry: the brush works in reference pixels. One reference pixel is `s` CSS pixels, with
// s = 1 on a desktop-sized wall and smaller on narrow ones (so a signature keeps its proportions
// and look at any size). Every entry has an origin on the strip (regulars: a layout slot; saved:
// a fraction of the final view's width and height) and its strokes are stored relative to it.
import { randomColor } from './brush.js'
import { humanEntries } from './humans.js'
import { BRUSH_INK, BRUSH_SIZE, LivePainter, Painter } from './painter.js'

const REF_H = 520 // a wall this tall (or taller) paints at 1:1...
const REF_W = 820 // ...as long as it is at least this wide
const STEP_MS = 1000 / 60
const MAX_STEPS = 4 // per animation frame, so a throttled tab slows down instead of jumping
const MAX_GROUP_FRAMES = 3600 // one minute of drawing, then it's time to sign
const HEADER_PX = 48 // the strip on top (title, buttons) gets no signatures
const LABEL_PX = 34 // room under a signature for its name
const FRAME_AREA = 200000 // CSS px² of wall per regular framing the final view (3 to 6 of them)
const DENSE_W = 200 // the dense stretch's columns (ref px; and at least 150 CSS px)...
const DENSE_H = 150 // ...and rows (ref px; and at least 120 CSS px)
const PAN_FROM = 0 // of the pan's progress (0 = waiting on the dense stretch): it starts...
const PAN_TO = 0.94 // ...and is home here, so a scroll a hair short of the end still rests
const PAN_TAU = 80 // ms: the view glides after the scroll, so a wheel's notches don't jump
const GLIDE_TAU = 150 // ms: the same glide for a button's, a key's or a flick's longer trip
const STEP_FRAC = 0.8 // of the wall's width: one press of "more signatures"...
const KEY_FRAC = 0.25 // ...and one arrow key (held down, it keeps going)
const DRAG_SLOP = 8 // CSS px a finger moves before it is a drag (sideways) or the page's (up, down)
const LINE_PX = 40 // a wheel's "line" (deltaMode 1), in CSS px
const SPRITE_BUDGET_MS = 6 // per animation frame for painting sprites
const RESPRITE_MS = 180 // after a resize, before the sprites are painted again at the new scale

export function createWall(canvas, { regulars, surface = canvas, mine = [], reducedMotion = false, onLabels, onPan, onRest, onNav, onStrokeStart, onStrokeEnd }) {
  const ctx = canvas.getContext('2d')
  const rctx = regulars.getContext('2d')
  // newest first: that is the order they get a place in
  const people = humanEntries(BRUSH_SIZE, BRUSH_INK).map((e) => ({ ...e, box: pointBox(e) }))
  let curated = people.slice() // the same, in painting order (left to right)
  let saved = mine.slice()
  let W = 0
  let H = 0
  let dpr = 1
  let s = 1
  let RW = 0
  let RH = 0
  let L = 0 // the dense stretch's width, ref px
  let prepared = false // sprites and saved signatures are painted once the wall comes near
  let jobs = [] // sprites being painted: { e, K, x0, y0, canvas, ctx, painter }
  let respriteTimer = 0
  let progress = 0 // of the scroll, 0..1
  let primed = false // the first scroll position puts the view there at once
  let target = 0 // where the pan is heading (CSS px)...
  let pan = 0 // ...and where it is
  let shown = NaN // ...and where the regulars were last composited
  let tau = PAN_TAU // the glide's time constant (ms) for the trip under way
  let manual = false // the visitor has taken the pan: the scroll (the auto-pan) no longer drives it...
  let want = 0 // ...and it heads here (ref px, so a resize keeps the spot): 0 home .. L far left
  let drag = null // a finger browsing the strip: { id, x, y, pan0, on, t, px, v }
  let settled = false // the pan came home once (or the visitor took it): the browse buttons show
  let nav = null // the browse buttons, as last told to React: { left, right }
  let resting = null
  const finished = new Map() // saved id -> bounds (ref, relative to the entry's origin)
  let running = [] // drips still falling after a commit: { painter, entry }
  let group = null // { entry, live } while the visitor is signing
  const queue = [] // pointer events, consumed one per 60 Hz step
  let pointer = null // { id, type, x, y } (CSS px within the wall) while the tip is down
  let signHeld = false // a phone's "hold to sign" is pressed: only then does a finger paint
  let fed = null // pointer position fed at the last step
  let raf = 0
  let last = 0
  let acc = 0
  let destroyed = false

  // ---- layout ----------------------------------------------------------------------------

  function layout() {
    const top = HEADER_PX / s
    const usableH = Math.max(1, RH - top - LABEL_PX / s)

    // the final view: the wall as it always was, a few regulars around an open middle
    const cols = clamp(Math.round(RW / 280), 2, 7)
    const rows = clamp(Math.floor(usableH / 175), 1, 6)
    const slotW = RW / cols
    const slotH = usableH / rows
    const slots = grid(cols, rows, slotW, slotH, top, 0)
    // the slots farthest from the middle frame it, leaving about a third of them open (and
    // fewer regulars on a small wall)
    const open = Math.max(1, Math.round(slots.length / 3))
    const shown = Math.min(people.length, slots.length - open, clamp(Math.floor((W * H) / FRAME_AREA), 3, 6))
    const frame = slots.sort((a, b) => b.d - a.d).slice(0, shown)
    // a fixed scramble so neighbours on the wall are not neighbours in the list
    frame.sort(scramble)

    // to its left, everyone else, packed in (and at least a wall's width of them)
    const dense = people.length - shown
    const rowsD = clamp(Math.floor(usableH / Math.max(DENSE_H, 120 / s)), 1, 6)
    const colsD = Math.max(1, Math.ceil(dense / rowsD))
    const slotWD = Math.max(RW / colsD, DENSE_W, 150 / s)
    L = dense ? colsD * slotWD : 0
    // (fewer of them than slots: the gaps fall here and there)
    const dslots = grid(colsD, rowsD, slotWD, usableH / rowsD, top, -L).sort(scramble)

    // the newest regulars frame the visitor's spot, the rest fill the stretch
    people.forEach((e, i) => {
      e.dense = i >= shown
      if (e.dense) place(e, dslots[i - shown], slotWD, usableH / rowsD, -L, 0)
      else place(e, frame[i], slotW, slotH, 0, RW)
    })
    curated = people.slice().sort((a, b) => a.ox - b.ox + (a.oy - b.oy) * 0.3)
    for (const e of saved) placeSaved(e)
    if (group) placeSaved(group.entry)
  }

  /** Slots of a staggered grid starting at x0, with their distance from the final view's middle. */
  function grid(cols, rows, sw, sh, top, x0) {
    const out = []
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const stagger = rows > 1 ? (r % 2 ? 0.18 : -0.18) : 0
        const x = x0 + (c + 0.5 + stagger) * sw
        const y = top + (r + 0.5) * sh
        out.push({ x, y, d: Math.hypot((x - RW / 2) / RW, (y - RH / 2) / RH) })
      }
    return out
  }

  function place(e, sl, sw, sh, lo, hi) {
    const b = e.box
    // a signature too big for its slot is written smaller
    e.k = Math.max(0.12, Math.min(1, (sw * 0.86) / b.w, (sh - LABEL_PX / s) / b.h))
    const w = b.w * e.k
    const jx = (hash(e.seed) - 0.5) * Math.max(0, sw - w) * 0.8
    const jy = (hash(e.seed * 1.7) - 0.5) * Math.max(0, sh - b.h * e.k - LABEL_PX / s) * 0.7
    // (the origin is wherever the strokes are centred: the box's middle goes on the slot)
    const cx = ((b.minX + b.maxX) / 2) * e.k
    const cy = ((b.minY + b.maxY) / 2) * e.k
    e.ox = clamp(sl.x + jx, lo + w / 2 + 8, Math.max(lo + w / 2 + 8, hi - w / 2 - 8)) - cx
    e.oy = sl.y + jy - 10 / s - cy
  }

  function placeSaved(e) {
    e.ox = e.ax * RW
    e.oy = e.ay * RH
  }

  const scramble = (a, b) => hash(a.x * 7.1 + a.y * 3.3) - hash(b.x * 7.1 + b.y * 3.3)

  // ---- the pan -----------------------------------------------------------------------------

  /** Scroll progress -> pan: held on the dense stretch, through it fast, then easing home. */
  function panFor(p) {
    // (no pan with reduced motion, or while the visitor is signing: their mark stays put)
    if (reducedMotion || group || !L) return 0
    const t = clamp((p - PAN_FROM) / (PAN_TO - PAN_FROM), 0, 1)
    const e = t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2
    const x = (1 - e) * L * s
    return x < 0.5 ? 0 : x // (home is home: rest comes with the last visible pixel)
  }

  /** Where the pan heads: the visitor's own spot once they have taken it, else the scroll's. */
  function goal() {
    if (!manual) return panFor(progress)
    const x = clamp(want, 0, L) * s
    return x < 0.5 ? 0 : x
  }

  function retarget(jump) {
    const t = goal()
    // (a scroll that changes nothing costs nothing)
    if (t === target && !jump) return
    target = t
    if (jump || reducedMotion) pan = target
    if (pan !== target) {
      syncRest() // (leaving home stops the drawing at once, before the first frame moves)
      return kick()
    }
    composite()
    onPan?.(pan)
    syncRest()
  }

  // (a finger dragging the strip home has not let go of it yet: no paint until it does)
  const atRest = () => pan === 0 && target === 0 && !drag?.on

  function syncRest() {
    const r = atRest()
    if (r !== resting) {
      resting = r
      onRest?.(r)
    }
    syncNav()
  }

  /** The browse buttons: "more signatures" while there is more to the left, "back to sign" while away. */
  function syncNav() {
    // they wait for the auto-pan to come home (or for the visitor to take the pan), and step
    // aside while a signature is in progress (its popup is up and the strip stays put for it);
    // they follow where the pan heads, so a press shows its answer at once
    if (!settled && (manual || (atRest() && (reducedMotion || progress >= PAN_TO)))) settled = true
    const on = settled && L > 0 && !group
    const left = on && target < L * s - 0.5
    const right = on && target > 0
    if (nav && nav.left === left && nav.right === right) return
    nav = { left, right }
    onNav?.(nav)
  }

  const canBrowse = () => W > 0 && L > 0 && !group && !pointer

  /** The visitor takes the pan from wherever it is (stopping the auto-pan if it still plays). */
  function takeOver() {
    if (manual) return
    manual = true
    want = pan / s
  }

  /** Heads the pan for x (CSS px, kept on the strip), gliding with time constant `t` (ms). */
  function browseTo(x, t) {
    takeOver()
    want = clamp(x, 0, L * s) / s
    tau = t
    // sprites still waiting to be painted go nearest the new view first
    if (jobs.length > 1) {
      const mid = (W / 2 - want * s) / s
      jobs.sort((a, b) => Math.abs(a.e.ox - mid) - Math.abs(b.e.ox - mid))
    }
    retarget(false)
  }

  // ---- browsing: wheel and finger ----------------------------------------------------------

  function onWheel(ev) {
    // sideways only: a trackpad's swipe, a tilting wheel, or Shift with an ordinary one (some
    // browsers turn that into deltaX themselves); up and down is the page's, and so is ctrl
    // (a pinch, or the page's zoom)
    if (ev.ctrlKey) return
    let d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.shiftKey ? ev.deltaY : 0
    if (!d) return
    // A sideways gesture over the wall is the wall's, even where the strip cannot follow it (at
    // home, at the far end, while the popup is open): left to the browser it would be its back
    // and forward swipe, and take the visitor off the page.
    ev.preventDefault()
    if (!canBrowse()) return
    d *= ev.deltaMode === 1 ? LINE_PX : ev.deltaMode === 2 ? W : 1
    // scrolling left (d < 0) looks further left: the strip moves right. The notches add up on
    // where the pan is heading, so a quick swipe goes as far as it says.
    const from = manual ? target : pan
    const to = clamp(from - d, 0, L * s)
    if (Math.abs(to - from) < 0.5) return
    browseTo(to, PAN_TAU)
  }

  // Away from home a finger drags the strip sideways (the wall's touch-action leaves up and down
  // to the browser, which scrolls and cancels the pointer). It follows the finger 1:1, and a
  // flick carries on as far as the glide that keeps its speed would take it. Heard on the whole
  // wall: the visitor's canvas rides the pan, so away from home it no longer covers it all.
  function dragDown(ev) {
    if (!W || ev.pointerType === 'mouse' || drag || !canBrowse()) return
    // at home a pen paints, and so does a finger while "hold to sign" is held; any other finger browses
    if (atRest() && (ev.pointerType !== 'touch' || signHeld)) return
    // (the buttons, and the popup's fields, keep their own touches)
    if (ev.target.closest?.('button, a, input, textarea, select, form')) return
    // (in client px: the visitor's canvas, which local() measures against, moves with the pan)
    const p = { x: ev.clientX, y: ev.clientY }
    drag = { id: ev.pointerId, x: p.x, y: p.y, pan0: 0, on: false, t: ev.timeStamp, px: p.x, v: 0 }
  }

  function dragMove(ev) {
    const d = drag
    if (!d || ev.pointerId !== d.id) return
    const p = { x: ev.clientX, y: ev.clientY }
    if (!d.on) {
      const dx = p.x - d.x
      const dy = p.y - d.y
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_SLOP) return
      // (mostly up or down: the page's, and the browser has most likely taken it already)
      if (Math.abs(dx) <= Math.abs(dy) || !canBrowse()) {
        drag = null
        return
      }
      d.on = true
      takeOver()
      d.pan0 = pan
      d.x = p.x
      try {
        surface.setPointerCapture(d.id)
      } catch {
        // capture is a nicety
      }
    }
    const dt = ev.timeStamp - d.t
    if (dt > 0) d.v = 0.7 * ((p.x - d.px) / dt) + 0.3 * d.v
    d.t = ev.timeStamp
    d.px = p.x
    want = clamp(d.pan0 + p.x - d.x, 0, L * s) / s
    // no glide while the finger holds it; the next frame composites (once, however many moves)
    target = pan = goal()
    kick()
  }

  function dragUp(ev) {
    const d = drag
    if (!d || ev.pointerId !== d.id) return
    // (a capture lost by something inside: the finger's own implicit one, handed to the wall)
    if (ev.type === 'lostpointercapture' && ev.target !== surface) return
    drag = null
    if (d.on && ev.type === 'pointerup' && ev.timeStamp - d.t < 80 && !reducedMotion) {
      want = clamp(pan + clamp(d.v * GLIDE_TAU, -W, W), 0, L * s) / s
      tau = GLIDE_TAU
    }
    retarget(false)
    syncRest() // (let go at home: the wall takes paint again)
  }

  // ---- the regulars: sprites -------------------------------------------------------------
  // A regular is painted once, drips and all, into a canvas of its own at the scale it shows
  // at; the wall then only copies sprites. After a resize the old sprite is drawn scaled until
  // the new one is ready.

  function prepare() {
    if (prepared) return
    prepared = true
    enqueueSprites()
    repaintMine()
  }

  function enqueueSprites() {
    if (!W) return // (laid out at the first resize, which comes back here)
    // nearest the view first (with reduced motion too: there is no auto-pan, but the visitor can
    // still browse along to the dense stretch)
    const mid = (W / 2 - pan) / s
    jobs = curated
      .filter((e) => !e.sprite || e.sprite.K !== dpr * s * e.k)
      .sort((a, b) => Math.abs(a.ox - mid) - Math.abs(b.ox - mid))
      .map(spriteJob)
    if (jobs.length) kick()
  }

  function spriteJob(e) {
    const K = dpr * s * e.k
    const b = e.box
    const pad = e.size * 0.5 + e.ink + 4
    const x0 = b.minX - pad
    const y0 = b.minY - pad
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.ceil((b.maxX - b.minX + pad * 2) * K))
    // (room below for the drips, which run up to ~5 brush widths)
    c.height = Math.max(1, Math.ceil((b.maxY - b.minY + pad + Math.max(pad, (e.size + e.ink) * 6)) * K))
    const sctx = c.getContext('2d')
    sctx.setTransform(K, 0, 0, K, -x0 * K, -y0 * K)
    return { e, K, x0, y0, canvas: c, ctx: sctx, painter: new Painter(e) }
  }

  /** Steps the sprite painters for a slice of the frame. True when one or more got done. */
  function paintSprites() {
    const until = performance.now() + SPRITE_BUDGET_MS
    let done = false
    while (jobs.length && performance.now() < until) {
      const j = jobs[0]
      let more = true
      for (let n = 0; n < 24 && more; n++) more = j.painter.step(j.ctx)
      if (more) continue
      jobs.shift()
      const b = j.painter.bounds
      if (!Number.isFinite(b.minX)) continue
      // only the painted part is ever copied
      const sx = clamp(Math.floor((b.minX - j.x0) * j.K) - 1, 0, j.canvas.width - 1)
      const sy = clamp(Math.floor((b.minY - j.y0) * j.K) - 1, 0, j.canvas.height - 1)
      const ex = clamp(Math.ceil((b.maxX - j.x0) * j.K) + 1, sx + 1, j.canvas.width)
      const ey = clamp(Math.ceil((b.maxY - j.y0) * j.K) + 1, sy + 1, j.canvas.height)
      j.e.sprite = { canvas: j.canvas, K: j.K, x0: j.x0, y0: j.y0, sx, sy, sw: ex - sx, sh: ey - sy, bounds: b }
      done = true
    }
    return done
  }

  /** The regulars' canvas: every sprite in view, at the current pan. */
  function composite() {
    shown = pan
    rctx.setTransform(1, 0, 0, 1, 0, 0)
    rctx.clearRect(0, 0, regulars.width, regulars.height)
    for (const e of curated) {
      const sp = e.sprite
      if (!sp) continue
      const u = dpr * s * e.k
      const scale = u / sp.K
      const dx = Math.round((e.ox * s + pan) * dpr + sp.x0 * u + sp.sx * scale)
      const dy = Math.round(e.oy * s * dpr + sp.y0 * u + sp.sy * scale)
      const dw = sp.sw * scale
      if (dx > regulars.width || dx + dw < 0) continue
      rctx.drawImage(sp.canvas, sp.sx, sp.sy, sp.sw, sp.sh, dx, dy, dw, sp.sh * scale)
    }
  }

  // ---- the visitor's canvas ----------------------------------------------------------------

  function setOrigin(e) {
    const u = dpr * s
    const k = u * (e.k || 1)
    ctx.setTransform(k, 0, 0, k, e.ox * u, e.oy * u)
  }

  function clear() {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  /** Paints the visitor's saved signatures at once (first sight, resizes, erasing). */
  function repaintMine() {
    clear()
    running = []
    finished.clear()
    if (!prepared) return emitLabels()
    for (const e of saved) {
      const p = new Painter(e)
      setOrigin(e)
      p.finish(ctx)
      finished.set(e.id, p.bounds)
    }
    if (group) {
      setOrigin(group.entry)
      group.live.rebuild(ctx)
    }
    emitLabels()
  }

  function emitLabels() {
    const list = []
    for (const e of curated) if (e.sprite) list.push(label(e, e.sprite.bounds))
    for (const e of saved) {
      const b = finished.get(e.id)
      if (b) list.push(label(e, b))
    }
    onLabels?.(list)
  }

  /** A name under (or over) its signature, in CSS px on the strip (the final view at 0..W). */
  function label(e, b) {
    const k = e.k || 1
    const cx = (e.ox + ((b.minX + b.maxX) / 2) * k) * s
    const below = (e.oy + b.maxY * k) * s + 2
    const above = (e.oy + b.minY * k) * s - 2
    const flip = below + LABEL_PX > H - 4 && above - LABEL_PX > HEADER_PX * 0.6
    const lo = e.dense ? 86 - L * s : 86
    return {
      id: e.id,
      name: e.name,
      msg: e.msg,
      t: e.t,
      mine: !!e.mine,
      x: clamp(cx, lo, Math.max(lo, W - 86)),
      y: flip ? above : Math.min(below, H - LABEL_PX + 6),
      above: flip,
    }
  }

  // ---- the loop ----------------------------------------------------------------------------

  function kick() {
    if (!raf && !destroyed) {
      last = performance.now()
      acc = STEP_MS // the first frame paints at once
      raf = requestAnimationFrame(tick)
    }
  }

  function tick(now) {
    raf = 0
    const dt = Math.min(100, Math.max(0, now - last))
    last = now
    // the view follows the scroll (or the visitor), a moment behind it; a finger moves it itself
    if (pan !== target) {
      pan += (target - pan) * (1 - Math.exp(-dt / tau))
      if (Math.abs(target - pan) < 0.5) pan = target
    }
    const moved = pan !== shown
    const fresh = jobs.length > 0 && paintSprites()
    acc += dt
    let steps = Math.floor(acc / STEP_MS)
    acc -= steps * STEP_MS
    if (steps > MAX_STEPS) {
      steps = MAX_STEPS
      acc = 0
    }
    for (let i = 0; i < steps; i++) step((i + 1) / steps)
    if (moved || fresh) composite()
    if (moved) {
      onPan?.(pan)
      syncRest()
    }
    if (fresh) emitLabels()
    if (busy()) raf = requestAnimationFrame(tick)
  }

  function busy() {
    return pan !== target || pan !== shown || jobs.length > 0 || running.length > 0 || queue.length > 0 || (group && (group.live.busy || pointer))
  }

  function step(t) {
    if (group) {
      const { live, entry } = group
      setOrigin(entry)
      const head = queue[0]
      if (head?.type === 'down' && !live.stroking) {
        queue.shift()
        const [x, y] = toRef(entry, head.x, head.y)
        live.down(x, y, head.color)
        fed = { x: head.x, y: head.y }
      }
      if (live.stroking) {
        const cur = pointer ?? fed
        const px = fed.x + (cur.x - fed.x) * t
        const py = fed.y + (cur.y - fed.y) * t
        const [x, y] = toRef(entry, px, py)
        live.step(ctx, x, y)
        if (t === 1) fed = { x: cur.x, y: cur.y }
        if (live.frames >= MAX_GROUP_FRAMES && !queue.length) queue.push({ type: 'up', forced: true })
      } else {
        live.step(ctx, 0, 0)
      }
      if (queue[0]?.type === 'up' && live.stroking) {
        const ev = queue.shift()
        live.up()
        onStrokeEnd?.({ forced: !!ev.forced })
      }
      // a release with no stroke left open (e.g. after a forced end) is dropped
      while (queue[0]?.type === 'up' && !live.stroking) queue.shift()
    }
    for (let i = 0; i < running.length; i++) {
      const r = running[i]
      setOrigin(r.entry)
      if (!r.painter.step(ctx)) running.splice(i--, 1)
    }
  }

  function toRef(e, x, y) {
    return [x / s - e.ox, y / s - e.oy]
  }

  // ---- pointer -----------------------------------------------------------------------------

  function local(ev) {
    const r = canvas.getBoundingClientRect()
    return { x: ev.clientX - r.left, y: ev.clientY - r.top }
  }

  function onDown(ev) {
    // only the final view takes paint; away from it a touch scrolls the page as usual, or
    // (sideways) browses the strip (dragDown, on the whole wall)
    if (!W || !atRest()) return
    // on a phone a finger paints only while "hold to sign" is held; otherwise it browses or scrolls
    if (ev.pointerType === 'touch' && !signHeld) return
    if (pointer || (ev.pointerType === 'mouse' && ev.button !== 0)) return
    ev.preventDefault()
    try {
      canvas.setPointerCapture(ev.pointerId)
    } catch {
      // capture is a nicety
    }
    if (!prepared) prepare()
    const p = local(ev)
    pointer = { id: ev.pointerId, type: ev.pointerType, ...p }
    if (!group) {
      const entry = {
        id: 'm' + Date.now().toString(36) + ((Math.random() * 1296) | 0).toString(36),
        mine: true,
        t: Date.now(),
        name: '',
        msg: '',
        ax: clamp(p.x / W, 0, 1),
        ay: clamp(p.y / H, 0, 1),
        seed: (Math.random() * 4294967296) >>> 0,
        size: BRUSH_SIZE,
        ink: BRUSH_INK,
        strokes: [],
      }
      placeSaved(entry)
      group = { entry, live: new LivePainter(entry) }
      syncNav()
    }
    // the pen: a new random colour on every stroke
    queue.push({ type: 'down', x: p.x, y: p.y, color: randomColor() })
    onStrokeStart?.()
    kick()
  }

  function onMove(ev) {
    if (!pointer || ev.pointerId !== pointer.id) return
    const p = local(ev)
    pointer.x = p.x
    pointer.y = p.y
  }

  function onUp(ev) {
    if (!pointer || ev.pointerId !== pointer.id) return
    // (a cancel or a lost capture carries no trustworthy position)
    if (ev.type === 'pointerup') {
      onMove(ev)
      fedFinal()
    }
    pointer = null
    queue.push({ type: 'up' })
    kick()
  }

  // the last position counts even when the release comes between two frames
  function fedFinal() {
    if (group?.live.stroking && fed && pointer) {
      setOrigin(group.entry)
      const [x, y] = toRef(group.entry, pointer.x, pointer.y)
      if (Math.abs(x - group.live.brush.x) > 0.5 || Math.abs(y - group.live.brush.y) > 0.5) {
        group.live.step(ctx, x, y)
        fed = { x: pointer.x, y: pointer.y }
      }
    }
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('lostpointercapture', onUp)
  // browsing is heard on the whole wall, buttons and all (the wheel not passive, so a sideways
  // swipe can be kept from the page)
  surface.addEventListener('wheel', onWheel, { passive: false })
  surface.addEventListener('pointerdown', dragDown)
  surface.addEventListener('pointermove', dragMove)
  surface.addEventListener('pointerup', dragUp)
  surface.addEventListener('pointercancel', dragUp)
  surface.addEventListener('lostpointercapture', dragUp)

  // ---- sizing ------------------------------------------------------------------------------

  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const d = Math.min(2, window.devicePixelRatio || 1)
    if (!w || !h || (w === W && h === H && d === dpr)) return
    W = w
    H = h
    dpr = d
    s = Math.min(H / REF_H, W / REF_W)
    RW = W / s
    RH = H / s
    canvas.width = regulars.width = Math.round(W * dpr)
    canvas.height = regulars.height = Math.round(H * dpr)
    layout()
    repaintMine()
    // sprites at the old scale stand in (stretched) until the resizing settles
    jobs = []
    clearTimeout(respriteTimer)
    if (prepared) respriteTimer = setTimeout(enqueueSprites, RESPRITE_MS)
    retarget(true)
  }

  // ---- what React calls --------------------------------------------------------------------

  return {
    resize,
    /** The wall is near: paint the sprites (in slices) and the visitor's saved signatures. */
    prepare,
    /** The pan's progress, 0 (waiting on the dense stretch) to 1 (home); SignWall plays it. */
    setScroll(p) {
      progress = clamp(p, 0, 1)
      retarget(!primed)
      primed = true
    },
    /** The visitor has taken the pan (and the auto-pan should stop playing). */
    get manual() {
      return manual
    },
    /** One step along the strip: dir -1 looks further left, +1 back towards home (`small`: a key's). */
    browse(dir, small = false) {
      if (!canBrowse()) return
      const step = Math.max(120, W * (small ? KEY_FRAC : STEP_FRAC))
      browseTo((manual ? target : pan) - dir * step, GLIDE_TAU)
    },
    /** A phone's "hold to sign" pressed or let go: letting go ends the finger's stroke. */
    setSignHeld(held) {
      signHeld = !!held
      if (signHeld || pointer?.type !== 'touch') return
      pointer = null
      queue.push({ type: 'up' })
      kick()
    },
    /** Glides home, to the final view, where the visitor can sign. */
    home() {
      if (canBrowse()) browseTo(0, GLIDE_TAU)
    },
    /** The visitor's signature in progress, in CSS px within the wall. */
    groupBox() {
      if (!group) return null
      const b = group.live.bounds
      const e = group.entry
      if (!Number.isFinite(b.minX)) return { x: e.ox * s, y: e.oy * s, w: 0, h: 0 }
      return { x: (e.ox + b.minX) * s, y: (e.oy + b.minY) * s, w: (b.maxX - b.minX) * s, h: (b.maxY - b.minY) * s }
    },
    get hasGroup() {
      return !!group
    },
    get drawing() {
      return !!pointer
    },
    /** Keeps the signature in progress, with its name and note. Returns the saved entry. */
    commit({ name = '', msg = '' } = {}) {
      if (!group || pointer) return null
      const { entry, live } = group
      group = null
      retarget(false)
      if (!entry.strokes.length) return null
      entry.name = name.trim().slice(0, 40)
      entry.msg = msg.trim().slice(0, 80)
      saved.push(entry)
      finished.set(entry.id, live.bounds)
      if (live.busy) running.push({ painter: { step: (c) => (live.step(c, 0, 0), live.busy) }, entry })
      emitLabels()
      syncNav()
      kick()
      return entry
    },
    /** Throws away the signature in progress. */
    discard() {
      if (!group) return
      group = null
      queue.length = 0
      pointer = null
      repaintMine()
      retarget(false)
      syncNav()
    },
    /** Replaces the visitor's saved signatures (e.g. after "erase mine" or trimming). */
    setMine(list) {
      saved = list.slice()
      for (const e of saved) placeSaved(e)
      repaintMine()
    },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      clearTimeout(respriteTimer)
      jobs = []
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('lostpointercapture', onUp)
      surface.removeEventListener('wheel', onWheel)
      surface.removeEventListener('pointerdown', dragDown)
      surface.removeEventListener('pointermove', dragMove)
      surface.removeEventListener('pointerup', dragUp)
      surface.removeEventListener('pointercancel', dragUp)
      surface.removeEventListener('lostpointercapture', dragUp)
    },
  }
}

/** A regular's extent from its points (plus the brush), for spacing the layout and its sprite. */
function pointBox(e) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const st of e.strokes)
    for (let i = 0; i < st.p.length; i += 2) {
      minX = Math.min(minX, st.p[i])
      maxX = Math.max(maxX, st.p[i])
      minY = Math.min(minY, st.p[i + 1])
      maxY = Math.max(maxY, st.p[i + 1])
    }
  const r = e.size / 2
  return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r, w: maxX - minX + e.size, h: maxY - minY + e.size }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

function hash(v) {
  const x = Math.sin(v * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
