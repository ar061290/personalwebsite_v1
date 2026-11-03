// The wall's canvas: lays out the curated signatures, replays them (and the visitor's saved
// ones) through the brush, and runs the visitor's live brush. React only draws the UI on top
// (labels, the name popup); everything here talks to it through the callbacks.
//
// Geometry: the brush works in reference pixels. One reference pixel is `s` CSS pixels, with
// s = 1 on a desktop-sized wall and smaller on narrow ones (so a signature keeps its proportions
// and look at any size). Every entry has an origin on the wall (curated: a layout slot; saved:
// a fraction of the wall's width and height) and its strokes are stored relative to it.
import { randomColor } from './brush.js'
import { curatedEntries } from './curated.js'
import { BRUSH_INK, BRUSH_SIZE, LivePainter, Painter } from './painter.js'

const REF_H = 520 // a wall this tall (or taller) paints at 1:1...
const REF_W = 820 // ...as long as it is at least this wide
const STEP_MS = 1000 / 60
const MAX_STEPS = 4 // per animation frame, so a throttled tab slows down instead of jumping
const DRAW_IN_SPEED = 3 // replay frames per step while the wall paints itself in
const DRAW_IN_STAGGER = 7 // steps between two signatures starting
const MAX_GROUP_FRAMES = 3600 // one minute of drawing, then it's time to sign
const HEADER_PX = 48 // the strip on top (title, buttons) gets no signatures
const LABEL_PX = 34 // room under a signature for its name

export function createWall(canvas, { mine = [], reducedMotion = false, onLabels, onStrokeStart, onStrokeEnd }) {
  const ctx = canvas.getContext('2d')
  const curated = curatedEntries().map((e) => ({ ...e, box: pointBox(e) }))
  let saved = mine.slice()
  let W = 0
  let H = 0
  let dpr = 1
  let s = 1
  let RW = 0
  let RH = 0
  let visibleCurated = []
  let revealed = false
  const finished = new Map() // id -> bounds (ref, relative to the entry's origin)
  let running = [] // replays and drips still going: { painter, entry, delay, speed }
  let group = null // { entry, live } while the visitor is signing
  const queue = [] // pointer events, consumed one per 60 Hz step
  let pointer = null // { id, x, y } (CSS px within the wall) while the tip is down
  let fed = null // pointer position fed at the last step
  let raf = 0
  let last = 0
  let acc = 0
  let destroyed = false

  // ---- layout ----------------------------------------------------------------------------

  function layout() {
    const top = HEADER_PX / s
    const bottom = LABEL_PX / s
    const usableH = Math.max(1, RH - top - bottom)
    const cols = clamp(Math.round(RW / 280), 2, 7)
    const rows = clamp(Math.floor(usableH / 175), 1, 6)
    const slotW = RW / cols
    const slotH = usableH / rows
    const slots = []
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const stagger = rows > 1 ? (r % 2 ? 0.18 : -0.18) : 0
        const x = (c + 0.5 + stagger) * slotW
        slots.push({ x, y: top + (r + 0.5) * slotH, d: Math.hypot((x - RW / 2) / RW, (top + (r + 0.5) * slotH - RH / 2) / RH) })
      }
    // the middle stays open for the visitor (and the hint behind the paint)
    const byCentre = slots.slice().sort((a, b) => a.d - b.d)
    // and a small wall shows fewer regulars (about one per 36 000 CSS px²)
    const shown = Math.min(curated.length, Math.max(3, Math.floor((W * H) / 36000)))
    const reserve = Math.max(1, slots.length - shown)
    const open = new Set(byCentre.slice(0, reserve))
    const free = slots.filter((sl) => !open.has(sl))
    // a fixed scramble so neighbours on the wall are not neighbours in the list
    free.sort((a, b) => hash(a.x * 7.1 + a.y * 3.3) - hash(b.x * 7.1 + b.y * 3.3))
    visibleCurated = []
    free.forEach((sl, i) => {
      const e = curated[i]
      if (!e) return
      // a signature too big for its slot is written a little smaller
      e.k = Math.min(1, (slotW * 0.86) / e.box.w, (slotH - LABEL_PX / s) / e.box.h)
      const w = e.box.w * e.k
      const jx = (hash(e.seed) - 0.5) * Math.max(0, slotW - w) * 0.8
      const jy = (hash(e.seed * 1.7) - 0.5) * Math.max(0, slotH - e.box.h * e.k - LABEL_PX / s) * 0.7
      e.ox = clamp(sl.x + jx, w / 2 + 8, RW - w / 2 - 8)
      e.oy = sl.y + jy - 10 / s
      visibleCurated.push(e)
    })
    visibleCurated.sort((a, b) => a.ox - b.ox + (a.oy - b.oy) * 0.3)
    for (const e of saved) placeSaved(e)
    if (group) placeSaved(group.entry)
  }

  function placeSaved(e) {
    e.ox = e.ax * RW
    e.oy = e.ay * RH
  }

  const entries = () => visibleCurated.concat(saved)

  // ---- painting ----------------------------------------------------------------------------

  function setOrigin(e) {
    const u = dpr * s
    const k = u * (e.k || 1)
    ctx.setTransform(k, 0, 0, k, e.ox * u, e.oy * u)
  }

  function clear() {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  /** Paints the whole wall at once (first sight with reduced motion, resizes, erasing). */
  function repaint() {
    clear()
    running = []
    finished.clear()
    if (!revealed) return emitLabels()
    for (const e of entries()) {
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

  function reveal() {
    if (revealed) return
    revealed = true
    if (reducedMotion) return repaint()
    clear()
    running = entries().map((e, i) => ({ painter: new Painter(e), entry: e, delay: i * DRAW_IN_STAGGER, speed: DRAW_IN_SPEED }))
    kick()
  }

  function emitLabels() {
    const list = []
    for (const e of entries()) {
      const b = finished.get(e.id)
      if (b) list.push(label(e, b))
    }
    onLabels?.(list)
  }

  function label(e, b) {
    const k = e.k || 1
    const cx = (e.ox + ((b.minX + b.maxX) / 2) * k) * s
    const below = (e.oy + b.maxY * k) * s + 2
    const above = (e.oy + b.minY * k) * s - 2
    const flip = below + LABEL_PX > H - 4 && above - LABEL_PX > HEADER_PX * 0.6
    return {
      id: e.id,
      name: e.name,
      msg: e.msg,
      t: e.t,
      mine: !!e.mine,
      x: clamp(cx, 86, Math.max(86, W - 86)),
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
    acc += Math.min(100, now - last)
    last = now
    let steps = Math.floor(acc / STEP_MS)
    acc -= steps * STEP_MS
    if (steps > MAX_STEPS) {
      steps = MAX_STEPS
      acc = 0
    }
    for (let i = 0; i < steps; i++) step((i + 1) / steps)
    if (busy()) raf = requestAnimationFrame(tick)
  }

  function busy() {
    return running.length > 0 || queue.length > 0 || (group && (group.live.busy || pointer))
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
      if (r.delay > 0) {
        r.delay--
        continue
      }
      setOrigin(r.entry)
      let more = true
      for (let k = 0; k < r.speed && more; k++) more = r.painter.step(ctx)
      if (!more) {
        running.splice(i--, 1)
        if (!r.tail) {
          finished.set(r.entry.id, r.painter.bounds)
          emitLabels()
        }
      }
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
    if (pointer || (ev.pointerType === 'mouse' && ev.button !== 0)) return
    ev.preventDefault()
    try {
      canvas.setPointerCapture(ev.pointerId)
    } catch {
      // capture is a nicety
    }
    if (!revealed) reveal()
    const p = local(ev)
    pointer = { id: ev.pointerId, ...p }
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
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    layout()
    repaint()
  }

  // ---- what React calls --------------------------------------------------------------------

  return {
    resize,
    reveal,
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
      if (!entry.strokes.length) return null
      entry.name = name.trim().slice(0, 40)
      entry.msg = msg.trim().slice(0, 80)
      saved.push(entry)
      finished.set(entry.id, live.bounds)
      if (live.busy) running.push({ painter: { step: (c) => (live.step(c, 0, 0), live.busy) }, entry, delay: 0, speed: 1, tail: true })
      emitLabels()
      kick()
      return entry
    },
    /** Throws away the signature in progress. */
    discard() {
      if (!group) return
      group = null
      queue.length = 0
      pointer = null
      repaint()
    },
    /** Replaces the visitor's saved signatures (e.g. after "erase mine" or trimming). */
    setMine(list) {
      saved = list.slice()
      for (const e of saved) placeSaved(e)
      repaint()
    },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('lostpointercapture', onUp)
    },
  }
}

/** A curated signature's extent from its points (plus the brush), for spacing the layout. */
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
  return { w: maxX - minX + e.size, h: maxY - minY + e.size }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

function hash(v) {
  const x = Math.sin(v * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
