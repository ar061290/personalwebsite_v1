// The visitor's own signatures, kept in this browser only (localStorage): each visitor sees the
// curated regulars plus what they signed themselves, never other visitors' marks.
import { decodeStroke, encodeStroke } from './painter.js'

const KEY = 'aadi-signwall'
const MAX_MINE = 12

/** Saved entries: { id, t, name, msg, ax, ay (origin as a fraction of the wall), seed, size, ink, strokes }. */
export function loadMine() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw || !Array.isArray(raw.e)) return []
    const out = []
    for (const e of raw.e) {
      try {
        out.push({
          id: String(e.id),
          mine: true,
          t: +e.t || Date.now(),
          name: String(e.n || '').slice(0, 40),
          msg: String(e.m || '').slice(0, 80),
          ax: clamp01(+e.ax),
          ay: clamp01(+e.ay),
          seed: e.r >>> 0,
          size: +e.s || 18,
          ink: +e.i || 6,
          strokes: e.k.map(decodeStroke),
        })
      } catch {
        // one unreadable entry never takes the others with it
      }
    }
    return out
  } catch {
    return []
  }
}

export function saveMine(entries) {
  try {
    const e = entries.slice(-MAX_MINE).map((x) => ({
      id: x.id,
      t: x.t,
      n: x.name || undefined,
      m: x.msg || undefined,
      ax: +x.ax.toFixed(4),
      ay: +x.ay.toFixed(4),
      r: x.seed,
      s: x.size,
      i: x.ink,
      k: x.strokes.map(encodeStroke),
    }))
    if (e.length) localStorage.setItem(KEY, JSON.stringify({ v: 1, e }))
    else localStorage.removeItem(KEY)
    return true
  } catch {
    return false // private mode or full: the signature still shows for this visit
  }
}

export { MAX_MINE }

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5)
